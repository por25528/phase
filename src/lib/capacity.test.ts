import { describe, it, expect } from 'vitest';
import type { BusyBlock, Task } from '../db/types';
import type { PlannedLeaf } from './plan';
import { mergeIntervals, workloadOf, weekCapacity, normalizeEstimate, type Now } from './capacity';
import { makeBlock } from './blocks';

// 2026-07-27 Mon, 07-28 Tue
const MON = '2026-07-27';
const TUE = '2026-07-28';

// "Now" is Monday at 00:00 unless a test says otherwise, so the whole week is ahead.
const EARLY: Now = { date: MON, minute: 0 };

function block(date: string, startMin: number, endMin: number, title = 'x'): BusyBlock {
  return { date, startMin, endMin, title, allDay: false };
}

function leaf(over: Partial<PlannedLeaf> = {}): PlannedLeaf {
  return {
    goalId: 'g1', goalTitle: 'G', nodeId: 'n1', title: 'N',
    done: false, plannedWeek: MON, blocks: [], ...over,
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

/*
 * `freeMinutes`, `remainingWindow` and `capacityBefore` are gone with the
 * availability windows they priced. Every one of them answered "how much of
 * this day is still available", and nothing asks any more — `weekCapacity`
 * reports COMMITMENTS, and `longestFreeGap` in slot.ts answers the narrower
 * question "is there a run long enough on this day", measured against
 * occupancy rather than against a window.
 */

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
    const leaves = [leaf({ estimateMin: 60, blocks: [makeBlock(TUE, 600, 60)] })];
    const out = weekCapacity({ ...base, leaves });
    expect(out.days.find((d) => d.date === TUE)?.plannedMin).toBe(60);
    expect(out.days.find((d) => d.date === TUE)?.backlogMin).toBe(0);
    expect(out.plannedMin).toBe(60);
    expect(out.backlogMin).toBe(0);
  });

  /**
   * A leaf has no DAY commitment any more — the week is the commitment and a
   * sitting is the placement — so this is now a week-committed leaf with
   * nothing on the calendar, which is exactly what "to place" means.
   */
  it('charges a committed but UNPLACED leaf to backlog, not to planned', () => {
    const leaves = [leaf({ estimateMin: 60 })]; // no sitting
    const out = weekCapacity({ ...base, leaves });
    const tue = out.days.find((d) => d.date === TUE)!;
    expect(tue.plannedMin).toBe(0);
    // No day owns it: a leaf with no sitting belongs to the WEEK's backlog.
    expect(tue.backlogMin).toBe(0);
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

  /*
   * Unplaced commitment is `backlogMin` and never `plannedMin`. There is no
   * over-commitment verdict left to check it against — nothing weighs a week
   * against available hours — but the split is what the rail beside the header
   * partitions on, so it still has to hold.
   */
  it('reports unplaced commitment separately from what is on the calendar', () => {
    const leaves = Array.from({ length: 50 }, (_, i) =>
      leaf({ nodeId: `n${i}`, estimateMin: 60 }));
    const out = weekCapacity({ ...base, leaves });
    expect(out.plannedMin).toBe(0);
    expect(out.backlogMin).toBe(50 * 60);
  });

  it('charges an unestimated anyday leaf to the week count only', () => {
    const out = weekCapacity({ ...base, leaves: [leaf()] });
    expect(out.unestimated).toBe(1);
    expect(out.days.every((d) => d.unestimated === 0)).toBe(true);
  });

  it('charges a PLACED task to its date', () => {
    const out = weekCapacity({ ...base, tasks: [task({ date: TUE, estimateMin: 25, blocks: [makeBlock(TUE, 600, 25)] })] });
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

  /**
   * A sitting outside the week is outside the week — for the day figures AND
   * for the total. The week's planned time is the sum of the sittings that
   * fall in it, so the header cannot claim hours the grid does not draw.
   *
   * It is not backlog either: the work IS placed, just not here.
   */
  it('excludes a sitting outside the week from every figure', () => {
    const leaves = [leaf({ estimateMin: 60, blocks: [makeBlock('2026-08-10', 600, 60)] })];
    const out = weekCapacity({ ...base, leaves });
    expect(out.days.every((d) => d.plannedMin === 0)).toBe(true);
    expect(out.plannedMin).toBe(0);
    expect(out.backlogMin).toBe(0);
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

/*
 * This describe used to be about the one tense-sensitive figure in the app:
 * `freeMin` reported what a PAST day held rather than what was left of it, so
 * a retrospective read "you had six hours and planned two" instead of "you
 * have nothing left". The figure is gone with the availability windows that
 * priced it, and every figure that remains is a COMMITMENT — which a Thursday
 * does not make less true about a Monday.
 *
 * What survives is the check that the clock changes nothing.
 */
describe('weekCapacity is indifferent to the clock', () => {
  const THU = '2026-07-30';
  const base = {
    week: MON,
    blocks: [] as BusyBlock[],
    leaves: [] as PlannedLeaf[],
    tasks: [] as Task[],
    now: { date: THU, minute: 12 * 60 } as Now,
    allDayBlocks: true,
    hasData: true,
  };

  it('reports an elapsed day\'s commitments in full', () => {
    const out = weekCapacity({
      ...base,
      leaves: [leaf({ estimateMin: 120, blocks: [makeBlock(MON, 600, 120)] })],
    });
    expect(out.days.find((d) => d.date === MON)?.plannedMin).toBe(120);
    expect(out.plannedMin).toBe(120);
  });

  it('answers identically from a week that has entirely passed', () => {
    const leaves = [leaf({ estimateMin: 120, blocks: [makeBlock(TUE, 600, 120)] })];
    const during = weekCapacity({ ...base, leaves });
    const after = weekCapacity({ ...base, leaves, now: { date: '2026-08-10', minute: 0 } });
    expect(after).toEqual(during);
  });

  it('sums the day figures, so it cannot contradict the grid beneath it', () => {
    const out = weekCapacity({
      ...base,
      leaves: [
        leaf({ nodeId: 'a', estimateMin: 120, blocks: [makeBlock(MON, 600, 120)] }),
        leaf({ nodeId: 'b', estimateMin: 60, blocks: [makeBlock(THU, 600, 60)] }),
      ],
    });
    expect(out.plannedMin).toBe(out.days.reduce((sum, d) => sum + d.plannedMin, 0));
  });
});

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
      done: false, plannedWeek: MON, blocks: [], ...over,
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
