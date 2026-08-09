import { describe, it, expect } from 'vitest';
import type { BusyBlock, AvailabilityWindow, Task } from '../db/types';
import type { PlannedLeaf } from './plan';
import { capacityBefore, freeMinutes, MAX_FORECAST_DAYS, mergeIntervals, workloadOf, weekCapacity, normalizeEstimate, type Now } from './capacity';

// Mon–Fri 09:00–18:00 (540 min window), weekend off.
const WINDOWS: AvailabilityWindow[] = [0, 1, 2, 3, 4].map((dow) => ({
  dow, startMin: 540, endMin: 1080,
}));

// 2026-07-27 Mon, 07-28 Tue, 07-29 Wed, 08-01 Sat
const MON = '2026-07-27';
const TUE = '2026-07-28';
const SAT = '2026-08-01';

// "Now" is Monday at 00:00 unless a test says otherwise, so the whole week is ahead.
const EARLY: Now = { date: MON, minute: 0 };

function block(date: string, startMin: number, endMin: number, title = 'x'): BusyBlock {
  return { date, startMin, endMin, title, allDay: false };
}

function leaf(over: Partial<PlannedLeaf> = {}): PlannedLeaf {
  return {
    goalId: 'g1', goalTitle: 'G', nodeId: 'n1', title: 'N',
    done: false, plannedWeek: MON, ...over,
  };
}

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: 'T', date: TUE, done: false, goalId: null, ...over };
}

describe('mergeIntervals', () => {
  it('merges overlapping intervals into their union', () => {
    expect(mergeIntervals([
      { startMin: 600, endMin: 700 },
      { startMin: 650, endMin: 800 },
    ])).toEqual([{ startMin: 600, endMin: 800 }]);
  });

  it('merges touching intervals', () => {
    expect(mergeIntervals([
      { startMin: 600, endMin: 700 },
      { startMin: 700, endMin: 800 },
    ])).toEqual([{ startMin: 600, endMin: 800 }]);
  });

  it('keeps disjoint intervals separate', () => {
    expect(mergeIntervals([
      { startMin: 600, endMin: 700 },
      { startMin: 800, endMin: 900 },
    ])).toEqual([
      { startMin: 600, endMin: 700 },
      { startMin: 800, endMin: 900 },
    ]);
  });

  it('absorbs a fully contained interval', () => {
    expect(mergeIntervals([
      { startMin: 600, endMin: 900 },
      { startMin: 700, endMin: 800 },
    ])).toEqual([{ startMin: 600, endMin: 900 }]);
  });

  it('handles unsorted input', () => {
    expect(mergeIntervals([
      { startMin: 800, endMin: 900 },
      { startMin: 600, endMin: 700 },
    ])).toEqual([
      { startMin: 600, endMin: 700 },
      { startMin: 800, endMin: 900 },
    ]);
  });
});

describe('freeMinutes', () => {
  it('returns the full window when nothing is booked', () => {
    expect(freeMinutes(TUE, WINDOWS, [], EARLY, true)).toBe(540);
  });

  it('returns zero on a day with no window', () => {
    expect(freeMinutes(SAT, WINDOWS, [], EARLY, true)).toBe(0);
  });

  it('subtracts a meeting inside the window', () => {
    expect(freeMinutes(TUE, WINDOWS, [block(TUE, 600, 660)], EARLY, true)).toBe(480);
  });

  it('does NOT double-count overlapping meetings', () => {
    // 10:00-11:00 and 10:30-12:00 overlap; union is 10:00-12:00 = 120 min.
    const blocks = [block(TUE, 600, 660), block(TUE, 630, 720)];
    expect(freeMinutes(TUE, WINDOWS, blocks, EARLY, true)).toBe(540 - 120);
  });

  it('ignores a meeting entirely outside the window', () => {
    // 22:00-23:00 is past an 18:00 window end.
    expect(freeMinutes(TUE, WINDOWS, [block(TUE, 1320, 1380)], EARLY, true)).toBe(540);
  });

  it('clips a meeting that straddles the window start', () => {
    // 08:00-10:00 overlaps the window only from 09:00 → 60 min consumed.
    expect(freeMinutes(TUE, WINDOWS, [block(TUE, 480, 600)], EARLY, true)).toBe(480);
  });

  it('ignores blocks belonging to another day', () => {
    expect(freeMinutes(TUE, WINDOWS, [block(MON, 600, 660)], EARLY, true)).toBe(540);
  });

  it('clamps at zero when the day is over-booked', () => {
    expect(freeMinutes(TUE, WINDOWS, [block(TUE, 0, 1440)], EARLY, true)).toBe(0);
  });

  describe('remaining capacity, not nominal', () => {
    it('gives a past day zero', () => {
      const now: Now = { date: TUE, minute: 0 };
      expect(freeMinutes(MON, WINDOWS, [], now, true)).toBe(0);
    });

    it('clips today to the current minute', () => {
      // Now is Tuesday 15:00 (900). Window 09:00-18:00 → 180 min left.
      const now: Now = { date: TUE, minute: 900 };
      expect(freeMinutes(TUE, WINDOWS, [], now, true)).toBe(180);
    });

    it('gives zero once today\'s window has closed', () => {
      const now: Now = { date: TUE, minute: 1200 }; // 20:00, past an 18:00 end
      expect(freeMinutes(TUE, WINDOWS, [], now, true)).toBe(0);
    });

    it('ignores a meeting that already finished today', () => {
      // Now 15:00; a 10:00-11:00 meeting is already spent, not deducted again.
      const now: Now = { date: TUE, minute: 900 };
      expect(freeMinutes(TUE, WINDOWS, [block(TUE, 600, 660)], now, true)).toBe(180);
    });

    it('deducts only the remaining part of an in-progress meeting', () => {
      // Now 15:00; meeting 14:00-16:00 → only 15:00-16:00 (60 min) still costs.
      const now: Now = { date: TUE, minute: 900 };
      expect(freeMinutes(TUE, WINDOWS, [block(TUE, 840, 960)], now, true)).toBe(120);
    });

    it('leaves future days at their full window', () => {
      const now: Now = { date: MON, minute: 900 };
      expect(freeMinutes(TUE, WINDOWS, [], now, true)).toBe(540);
    });
  });

  describe('all-day blocks', () => {
    const allDay: BusyBlock = {
      date: TUE, startMin: 0, endMin: 1440, title: 'Conference', allDay: true,
    };

    it('zeroes the day when allDayBlocks is on', () => {
      expect(freeMinutes(TUE, WINDOWS, [allDay], EARLY, true)).toBe(0);
    });

    it('is ignored when allDayBlocks is off', () => {
      expect(freeMinutes(TUE, WINDOWS, [allDay], EARLY, false)).toBe(540);
    });
  });
});

describe('workloadOf', () => {
  it('is empty for no commitments', () => {
    expect(workloadOf([], [])).toEqual({ plannedMin: 0, unestimated: 0 });
  });

  it('sums estimates across leaves', () => {
    const out = workloadOf([leaf({ estimateMin: 30 }), leaf({ estimateMin: 45 })], []);
    expect(out).toEqual({ plannedMin: 75, unestimated: 0 });
  });

  it('counts unestimated leaves separately, never as a default duration', () => {
    const out = workloadOf([leaf({ estimateMin: 30 }), leaf()], []);
    expect(out).toEqual({ plannedMin: 30, unestimated: 1 });
  });

  it('excludes done leaves from both figures', () => {
    const out = workloadOf([leaf({ done: true, estimateMin: 30 }), leaf({ done: true })], []);
    expect(out).toEqual({ plannedMin: 0, unestimated: 0 });
  });

  it('includes unfinished tasks', () => {
    const out = workloadOf([], [task({ estimateMin: 20 })]);
    expect(out).toEqual({ plannedMin: 20, unestimated: 0 });
  });

  it('counts unfinished tasks with no estimate as unestimated', () => {
    const out = workloadOf([], [task()]);
    expect(out).toEqual({ plannedMin: 0, unestimated: 1 });
  });

  it('excludes done tasks', () => {
    const out = workloadOf([], [task({ done: true, estimateMin: 20 }), task({ done: true })]);
    expect(out).toEqual({ plannedMin: 0, unestimated: 0 });
  });

  it('combines leaves and tasks', () => {
    const out = workloadOf(
      [leaf({ estimateMin: 30 }), leaf()],
      [task({ estimateMin: 20 }), task(), task({ done: true })],
    );
    expect(out).toEqual({ plannedMin: 50, unestimated: 2 });
  });

  it('ignores a non-positive or non-finite estimate as unestimated', () => {
    const out = workloadOf([leaf({ estimateMin: 0 }), leaf({ estimateMin: -5 })], []);
    expect(out).toEqual({ plannedMin: 0, unestimated: 2 });
  });
});

describe('weekCapacity', () => {
  const base = {
    week: MON,
    windows: WINDOWS,
    blocks: [] as BusyBlock[],
    leaves: [] as PlannedLeaf[],
    tasks: [] as Task[],
    now: EARLY,
    allDayBlocks: true,
    hasData: true,
  };

  it('returns seven days starting Monday', () => {
    const out = weekCapacity(base);
    expect(out.days).toHaveLength(7);
    expect(out.days[0].date).toBe(MON);
    expect(out.days[6].date).toBe('2026-08-02');
  });

  it('totals free minutes over five working days', () => {
    expect(weekCapacity(base).freeMin).toBe(540 * 5);
  });

  /**
   * "Planned" means ON THE CALENDAR — a day AND a start minute, the same
   * predicate `scheduledOn` and `backlogGroups` partition on. Anything merely
   * committed is reported as `backlogMin`.
   *
   * Folding the two together made the capacity readout contradict the rail
   * beside it: `⌘N` always sets a date and never a start minute, so every
   * captured task was billed to a day as "planned" while that day sat visibly
   * empty and the same item was listed under "To plan".
   */
  it('charges a PLACED leaf to its day and to the week', () => {
    const leaves = [leaf({ plannedDay: TUE, plannedStartMin: 600, estimateMin: 60 })];
    const out = weekCapacity({ ...base, leaves });
    expect(out.days.find((d) => d.date === TUE)?.plannedMin).toBe(60);
    expect(out.days.find((d) => d.date === TUE)?.backlogMin).toBe(0);
    expect(out.plannedMin).toBe(60);
    expect(out.backlogMin).toBe(0);
  });

  it('charges a day-pinned but UNPLACED leaf to backlog, not to planned', () => {
    const leaves = [leaf({ plannedDay: TUE, estimateMin: 60 })]; // no start minute
    const out = weekCapacity({ ...base, leaves });
    const tue = out.days.find((d) => d.date === TUE)!;
    expect(tue.plannedMin).toBe(0);
    expect(tue.backlogMin).toBe(60);
    expect(out.plannedMin).toBe(0);
    expect(out.backlogMin).toBe(60);
  });

  it('charges an anyday leaf to the week backlog and to no day', () => {
    const leaves = [leaf({ estimateMin: 60 })]; // no plannedDay
    const out = weekCapacity({ ...base, leaves });
    expect(out.backlogMin).toBe(60);
    expect(out.plannedMin).toBe(0);
    expect(out.days.every((d) => d.plannedMin === 0 && d.backlogMin === 0)).toBe(true);
  });

  it('still calls the week over-committed when the excess is unplaced', () => {
    // The whole week is 45h; commit 50h of unplaced work to it.
    const leaves = Array.from({ length: 50 }, (_, i) =>
      leaf({ nodeId: `n${i}`, estimateMin: 60 }));
    const out = weekCapacity({ ...base, leaves });
    expect(out.plannedMin).toBe(0);
    expect(out.plannedMin + out.backlogMin > out.freeMin).toBe(true);
  });

  it('charges an unestimated anyday leaf to the week count only', () => {
    const out = weekCapacity({ ...base, leaves: [leaf()] });
    expect(out.unestimated).toBe(1);
    expect(out.days.every((d) => d.unestimated === 0)).toBe(true);
  });

  it('charges a PLACED task to its date', () => {
    const out = weekCapacity({ ...base, tasks: [task({ date: TUE, startMin: 600, estimateMin: 25 })] });
    expect(out.days.find((d) => d.date === TUE)?.plannedMin).toBe(25);
    expect(out.plannedMin).toBe(25);
  });

  // Exactly what `⌘N` produces: a date, never a start minute.
  it('charges a captured task to backlog, not to the day it is dated to', () => {
    const out = weekCapacity({ ...base, tasks: [task({ date: TUE, estimateMin: 25 })] });
    const tue = out.days.find((d) => d.date === TUE)!;
    expect(tue.plannedMin).toBe(0);
    expect(tue.backlogMin).toBe(25);
    expect(out.plannedMin).toBe(0);
    expect(out.backlogMin).toBe(25);
  });

  it('lists what is blocking a day, deduplicated', () => {
    const blocks = [
      block(TUE, 600, 660, 'standup'),
      block(TUE, 700, 760, '1:1'),
      block(TUE, 700, 760, '1:1'),
    ];
    expect(weekCapacity({ ...base, blocks }).days.find((d) => d.date === TUE)?.blockedBy)
      .toEqual(['standup', '1:1']);
  });

  it('marks days as lacking data when hasData is false', () => {
    const out = weekCapacity({ ...base, hasData: false });
    expect(out.hasData).toBe(false);
    expect(out.days.every((d) => d.hasData === false)).toBe(true);
  });

  it('excludes a leaf pinned outside the week from day totals', () => {
    const leaves = [leaf({ plannedDay: '2026-08-10', plannedStartMin: 600, estimateMin: 60 })];
    const out = weekCapacity({ ...base, leaves });
    expect(out.days.every((d) => d.plannedMin === 0)).toBe(true);
    expect(out.plannedMin).toBe(60); // still a commitment for this week
  });

  // Blocked work leaves the QUEUE (backlogGroups), not the calendar. Capacity's
  // independence from status is guaranteed upstream, by the GoalNode →
  // PlannedLeaf projection dropping the field entirely (see
  // 'GoalNode → PlannedLeaf projection' in plan.test.ts) — `PlannedLeaf` has no
  // `status` property for `weekCapacity`/`workloadOf` to read here, so there is
  // nothing for this suite itself to pin.

  it('lists both occurrences of a same-titled event at different start times', () => {
    const blocks = [
      block(TUE, 600, 660, '1:1'),
      block(TUE, 900, 960, '1:1'),
    ];
    expect(weekCapacity({ ...base, blocks }).days.find((d) => d.date === TUE)?.blockedBy)
      .toEqual(['1:1', '1:1']);
  });

  it('collapses a same-titled event at the same start time to one entry', () => {
    const blocks = [
      block(TUE, 700, 760, '1:1'),
      block(TUE, 700, 760, '1:1'),
    ];
    expect(weekCapacity({ ...base, blocks }).days.find((d) => d.date === TUE)?.blockedBy)
      .toEqual(['1:1']);
  });

  it('does not mutate the caller-owned blocks array', () => {
    // The two later TUE blocks overlap (600-660 and 630-720) so
    // mergeIntervals's sorted pass actually walks the
    // `last.endMin = Math.max(...)` branch. If it ever regressed from
    // `out.push({ startMin, endMin })` (a fresh copy) to `out.push(cur)` (the
    // caller's own object) and then mutated it in place, a `snapshot` built
    // from `[...blocks]` — which holds the SAME object references as
    // `blocks` — would be corrupted right along with it, so `.toEqual` and
    // `.toBe` against that snapshot would still pass. `structuredClone`
    // keeps an independent, unmutated copy so the comparison actually means
    // something; the original references are kept separately to still catch
    // reordering.
    const blocks = [
      block(TUE, 900, 960, 'b'),
      block(TUE, 600, 660, 'a'),
      block(TUE, 630, 720, 'c'),
    ];
    const originalRefs = [...blocks];
    const snapshot = structuredClone(blocks);
    weekCapacity({ ...base, blocks });
    expect(blocks).toEqual(snapshot);
    expect(blocks[0]).toBe(originalRefs[0]);
    expect(blocks[1]).toBe(originalRefs[1]);
    expect(blocks[2]).toBe(originalRefs[2]);
    // Explicit field-level check: the regression above would widen this
    // block's endMin in place (600-660 merged with 630-720 → endMin 720).
    expect(blocks[1].endMin).toBe(660);
  });
});

/**
 * "Free" is two different questions depending on tense, and answering the
 * forward-looking one about a day that has been and gone produces a falsehood.
 *
 * `remainingWindow` returns null for any date before `now.date`, so every past
 * day reported 0 free — and with anything planned on it that is
 * `isOverCommitted`, so a whole past week rendered in warning red ("0m free ·
 * 6h planned") and, on a Thursday, so did Monday–Wednesday of the current week.
 */
describe('weekCapacity in the past tense', () => {
  const THU = '2026-07-30';
  const base = {
    week: MON,
    windows: WINDOWS,
    blocks: [] as BusyBlock[],
    leaves: [] as PlannedLeaf[],
    tasks: [] as Task[],
    now: { date: THU, minute: 12 * 60 } as Now,
    allDayBlocks: true,
    hasData: true,
  };

  it('reports what an elapsed day HELD, not what is left of it', () => {
    const out = weekCapacity(base);
    expect(out.days.find((d) => d.date === MON)?.freeMin).toBe(540);
    expect(out.days.find((d) => d.date === TUE)?.freeMin).toBe(540);
  });

  it('still clamps today to the hours actually remaining', () => {
    const out = weekCapacity(base);
    // Window 09:00–18:00, now is 12:00 → six hours left.
    expect(out.days.find((d) => d.date === THU)?.freeMin).toBe(360);
  });

  /**
   * The week total is the sum of the day figures, so the header and the day
   * headings beneath it describe the same span.
   *
   * Clamping the week to "what is still left" instead sounds more actionable,
   * but `plannedMin` counts the WHOLE week's commitments including the elapsed
   * days — and `isOverCommitted` compares the two. An ordinary Thursday with
   * Monday's work still on the board therefore read as over-committed, turning
   * the header red above a grid of perfectly healthy day chips.
   */
  it('sums the day figures, so it cannot contradict the grid beneath it', () => {
    const out = weekCapacity(base);
    expect(out.freeMin).toBe(out.days.reduce((sum, d) => sum + d.freeMin, 0));
    // Mon–Wed full (540 × 3) + Thu's remaining 360 + Fri full 540; weekend off.
    expect(out.freeMin).toBe(540 * 3 + 360 + 540);
  });

  it('does not call an ordinary mid-week Thursday over-committed', () => {
    const out = weekCapacity({
      ...base,
      leaves: [leaf({ plannedDay: MON, plannedStartMin: 600, estimateMin: 120 })], // Monday's, already spent
    });
    expect(out.plannedMin + out.backlogMin > out.freeMin).toBe(false);
  });

  it('reports a finished week as the capacity it had, so it cannot read as over-committed', () => {
    const out = weekCapacity({
      ...base,
      now: { date: '2026-08-10', minute: 0 },
      leaves: [leaf({ plannedDay: TUE, plannedStartMin: 600, estimateMin: 120 })],
    });
    expect(out.freeMin).toBe(540 * 5);
    expect(out.plannedMin).toBe(120);
    expect(out.plannedMin + out.backlogMin > out.freeMin).toBe(false);
  });
});

/*
 * `normalizeEstimate` is the single definition of "a usable estimate", read by
 * capacity, the weighted roll-up, the unestimated list and the store. It had no
 * direct tests, and that is exactly how it shipped returning 0.
 */
describe('normalizeEstimate', () => {
  it('rounds a usable value to whole minutes', () => {
    expect(normalizeEstimate(45)).toBe(45);
    expect(normalizeEstimate(45.6)).toBe(46);
    expect(normalizeEstimate(45.4)).toBe(45);
  });

  it('rejects anything that rounds away to nothing', () => {
    // The regression. `v > 0` was tested BEFORE rounding, so 0.4 passed the
    // guard and came back as Math.round(0.4) = 0 — not undefined, so every
    // caller treated it as a real estimate of zero minutes. Capacity then
    // counted the work as priced while adding nothing to plannedMin, and the
    // weighted roll-up gave a completed step a weight of 0.
    expect(normalizeEstimate(0.4)).toBeUndefined();
    expect(normalizeEstimate(0.49)).toBeUndefined();
    expect(normalizeEstimate(Number.MIN_VALUE)).toBeUndefined();
  });

  it('keeps the smallest value that survives rounding', () => {
    expect(normalizeEstimate(0.5)).toBe(1);
    expect(normalizeEstimate(1)).toBe(1);
  });

  it('rejects non-positive and non-finite values', () => {
    for (const bad of [0, -1, -0.4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(normalizeEstimate(bad)).toBeUndefined();
    }
  });

  it('rejects non-numbers, which imported data can carry', () => {
    for (const bad of [undefined, null, '45', {}, [], true]) {
      expect(normalizeEstimate(bad)).toBeUndefined();
    }
  });

  it('makes a sub-minute estimate count as unestimated in the workload', () => {
    const leaf = (over: Partial<PlannedLeaf>): PlannedLeaf => ({
      goalId: 'g', goalTitle: 'G', nodeId: 'n', title: 'T',
      done: false, plannedWeek: MON, ...over,
    });
    // Previously: plannedMin += 0 and unestimated stayed 0, so the work was
    // invisible to capacity AND absent from the "N unestimated" list that
    // exists to find precisely this.
    expect(workloadOf([leaf({ estimateMin: 0.4 })], [])).toEqual({
      plannedMin: 0, unestimated: 1,
    });
  });
});

/**
 * The denominator behind a goal's forecast: how many working minutes actually
 * exist between now and a date. An upper bound by construction — busy blocks
 * are a cache of whatever range was last fetched — so the health verdict built
 * on it has to be conservative in the same direction.
 */
describe('capacityBefore', () => {
  it('sums the free minutes of every day up to and including the deadline', () => {
    // Mon 00:00 → deadline Tue. Two full 540-minute windows.
    expect(capacityBefore(TUE, WINDOWS, [], EARLY, true)).toBe(1080);
  });

  it('counts only what is left of today', () => {
    const noon: Now = { date: MON, minute: 720 };
    // Monday 12:00–18:00 is 360, plus Tuesday's whole 540.
    expect(capacityBefore(TUE, WINDOWS, [], noon, true)).toBe(900);
  });

  it('skips days with no availability window at all', () => {
    // Sat and Sun are off, so a Saturday deadline adds nothing after Friday.
    expect(capacityBefore(SAT, WINDOWS, [], EARLY, true))
      .toBe(capacityBefore('2026-07-31', WINDOWS, [], EARLY, true));
  });

  it('deducts meetings, like every other capacity figure', () => {
    expect(capacityBefore(MON, WINDOWS, [block(MON, 600, 660)], EARLY, true)).toBe(480);
  });

  it('reports a passed deadline as no capacity rather than as negative time', () => {
    expect(capacityBefore('2026-07-01', WINDOWS, [], EARLY, true)).toBe(0);
  });

  /**
   * Past the horizon the sum is so large that every goal is trivially fine,
   * which is arithmetic with no opinion rather than a forecast. `null` lets
   * `goalHealth` say "too far out" instead of "on track".
   */
  it('refuses a deadline past the forecast horizon', () => {
    const far = new Date(Date.UTC(2026, 6, 27));
    far.setUTCDate(far.getUTCDate() + MAX_FORECAST_DAYS + 1);
    const iso = far.toISOString().slice(0, 10);
    expect(capacityBefore(iso, WINDOWS, [], EARLY, true)).toBeNull();
  });
});
