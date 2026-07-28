import { describe, it, expect } from 'vitest';
import type { BusyBlock, AvailabilityWindow, Task } from '../db/types';
import type { PlannedLeaf } from './plan';
import { freeMinutes, mergeIntervals, workloadOf, type Now } from './capacity';

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
