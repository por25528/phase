import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, BusyBlock } from '../db/types';
import {
  visibleRange, minuteToPct, pctToMinute, hourMarks, assignLanes,
  MIN_VISIBLE_START, MIN_VISIBLE_END, type LaneSpan,
  initialScrollWindow, minuteToPx, pxToMinute,
  PX_PER_MINUTE, DAY_START_MIN, DAY_END_MIN, DAY_HEIGHT_PX,
  Z_RULES, Z_BLOCK, Z_BLOCK_REVEALED, Z_NOW_LINE, Z_AXIS, Z_HEADINGS, Z_CORNER,
} from './grid';

const WEEK = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];
const NINE_TO_SIX: AvailabilityWindow[] = [0, 1, 2, 3, 4].map((dow) => ({ dow, startMin: 540, endMin: 1080 }));

function block(date: string, startMin: number, endMin: number, allDay = false): BusyBlock {
  return { date, startMin, endMin, title: 'x', allDay };
}

function span(startMin: number, endMin: number): LaneSpan {
  return { startMin, endMin };
}

describe('visibleRange', () => {
  it('never shrinks below the 08:00–20:00 floor', () => {
    expect(visibleRange(WEEK, NINE_TO_SIX, []))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('grows to cover an early availability window, floored to the hour', () => {
    const early: AvailabilityWindow[] = [{ dow: 2, startMin: 415, endMin: 1080 }]; // 06:55
    expect(visibleRange(WEEK, early, []).startMin).toBe(360); // 06:00
  });

  it('grows to cover a late availability window, ceiled to the hour', () => {
    const late: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1330 }]; // 22:10
    expect(visibleRange(WEEK, late, []).endMin).toBe(1380); // 23:00
  });

  it('grows to cover a timed calendar event outside the window', () => {
    expect(visibleRange(WEEK, NINE_TO_SIX, [block('2026-07-15', 420, 480)]).startMin).toBe(420);
  });

  it('ignores all-day events, which would otherwise blow the range to the whole day', () => {
    expect(visibleRange(WEEK, NINE_TO_SIX, [block('2026-07-15', 0, 1440, true)]))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('ignores events belonging to other weeks', () => {
    expect(visibleRange(WEEK, NINE_TO_SIX, [block('2026-08-01', 60, 120)]))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('grows to cover a scheduled span earlier than every window, floored to the hour', () => {
    // 06:10–06:40 (370–400) is earlier than NINE_TO_SIX's 540 start and below
    // the MIN_VISIBLE_START floor (480), so it must widen startMin, floored
    // down to the hour: floorToHour(370) = 360 (06:00).
    const spans = [span(370, 400)];
    expect(visibleRange(WEEK, NINE_TO_SIX, [], spans)).toEqual({ startMin: 360, endMin: 1200 });
  });

  it('grows to cover a scheduled span later than every window, ceiled to the hour', () => {
    // 21:05–21:35 (1265–1295) is later than NINE_TO_SIX's 1080 end and past
    // MIN_VISIBLE_END (1200), so it must widen endMin, ceiled up to the hour:
    // ceilToHour(1295) = 1320 (22:00). startMin is untouched by this span.
    const spans = [span(1265, 1295)];
    expect(visibleRange(WEEK, NINE_TO_SIX, [], spans)).toEqual({ startMin: 480, endMin: 1320 });
  });

  it('leaves the range unchanged when the scheduled span is already inside it', () => {
    // Baseline for NINE_TO_SIX + no spans is {480, 1200} (see the floor test
    // above). A span fully inside that, e.g. 10:00–11:00 (600–660), must not
    // move either edge.
    const spans = [span(600, 660)];
    expect(visibleRange(WEEK, NINE_TO_SIX, [], spans)).toEqual({ startMin: 480, endMin: 1200 });
  });

  it('still enforces the 08:00–20:00 minimum when there are no scheduled spans', () => {
    expect(visibleRange(WEEK, NINE_TO_SIX, [], []))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('always returns a range at least as wide as the 08:00–20:00 floor', () => {
    // WEEK (2026-07-13..19) covers dow 0-6, so a dow-6 window needs a dates
    // array missing dow 6 to be "absent" — hence SIX rather than WEEK there.
    const SIX = WEEK.slice(0, 6);
    const cases: Array<[string, string[], AvailabilityWindow[], BusyBlock[]]> = [
      ['empty week', WEEK, [], []],
      ['no windows or blocks', WEEK, [], []],
      ['windows only for absent days', SIX, [{ dow: 6, startMin: 600, endMin: 660 }], []],
      ['blocks only on absent dates', WEEK, [], [block('2027-01-01', 600, 660)]],
      ['a narrow midday window', WEEK, [{ dow: 2, startMin: 700, endMin: 720 }], []],
      ['a genuinely empty dates array', [], [], []],
    ];
    for (const [label, dates, windows, blocks] of cases) {
      const range = visibleRange(dates, windows, blocks);
      expect(range.endMin - range.startMin, label).toBeGreaterThanOrEqual(MIN_VISIBLE_END - MIN_VISIBLE_START);
      expect(range.endMin, label).toBeGreaterThan(range.startMin);
    }
  });
});

describe('minute ↔ percentage', () => {
  const range = { startMin: 480, endMin: 1200 };

  it('maps the range ends to 0 and 100', () => {
    expect(minuteToPct(480, range)).toBe(0);
    expect(minuteToPct(1200, range)).toBe(100);
  });

  it('maps the midpoint to 50', () => {
    expect(minuteToPct(840, range)).toBe(50);
  });

  it('round-trips every minute in the range', () => {
    const failures: string[] = [];
    for (let m = range.startMin; m <= range.endMin; m++) {
      const back = pctToMinute(minuteToPct(m, range), range);
      if (Math.abs(back - m) > 1e-6) failures.push(`${m} -> ${back}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('hourMarks', () => {
  it('lists every whole hour from the range start to its end', () => {
    expect(hourMarks({ startMin: 480, endMin: 720 })).toEqual([480, 540, 600, 660, 720]);
  });
});

describe('assignLanes', () => {
  const span = (id: string, startMin: number, endMin: number) => ({ id, startMin, endMin });

  it('gives a lone block the full width', () => {
    expect(assignLanes([span('a', 540, 600)]))
      .toEqual([{ item: span('a', 540, 600), lane: 0, laneCount: 1 }]);
  });

  it('puts two overlapping blocks in adjacent lanes', () => {
    const laid = assignLanes([span('a', 540, 660), span('b', 600, 720)]);
    expect(laid.map((l) => [l.item.id, l.lane, l.laneCount]))
      .toEqual([['a', 0, 2], ['b', 1, 2]]);
  });

  it('keeps touching-but-not-overlapping blocks in one lane', () => {
    // end is EXCLUSIVE, so 600–660 does not overlap 540–600.
    const laid = assignLanes([span('a', 540, 600), span('b', 600, 660)]);
    expect(laid.map((l) => [l.lane, l.laneCount])).toEqual([[0, 1], [0, 1]]);
  });

  it('scopes laneCount to the cluster, not the whole day', () => {
    const laid = assignLanes([span('a', 540, 660), span('b', 600, 720), span('c', 900, 960)]);
    expect(laid.map((l) => [l.item.id, l.lane, l.laneCount]))
      .toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 1]]);
  });

  it('reuses a lane freed by an earlier block in the same cluster', () => {
    const laid = assignLanes([span('a', 540, 600), span('b', 550, 700), span('c', 610, 660)]);
    expect(laid.map((l) => [l.item.id, l.lane])).toEqual([['a', 0], ['b', 1], ['c', 0]]);
    expect(laid.every((l) => l.laneCount === 2)).toBe(true);
  });

  // A bare `return []` satisfies `assignLanes([])` on its own — that input can
  // only ever produce `[]`, so no assertion on it alone can tell a real
  // implementation apart from a stub. Pairing it with a real, non-empty call
  // in the same test is what makes a stub actually fail this test.
  it('returns an empty array for empty input, and still lays out real input correctly', () => {
    expect(assignLanes([])).toEqual([]);
    expect(assignLanes([span('a', 540, 600)]))
      .toEqual([{ item: span('a', 540, 600), lane: 0, laneCount: 1 }]);
  });

  it('reuses a lane at the exact touching boundary inside a live cluster', () => {
    // b spans the whole cluster, so it stays open when c begins exactly where
    // a ended. End-exclusive means a and c do NOT overlap, so c must take a's
    // freed lane rather than opening a third one.
    const laid = assignLanes([span('a', 540, 600), span('b', 550, 700), span('c', 600, 660)]);
    expect(laid.map((l) => [l.item.id, l.lane])).toEqual([['a', 0], ['b', 1], ['c', 0]]);
    expect(laid.every((l) => l.laneCount === 2)).toBe(true);
  });

  it('closes a cluster when the next block starts exactly where it ended', () => {
    // a ends at 600 and b starts at 600 — a touch, not an overlap — so a is its
    // own cluster at full width, and only b and c share a two-lane cluster.
    const laid = assignLanes([span('a', 540, 600), span('b', 600, 660), span('c', 610, 700)]);
    expect(laid.map((l) => [l.item.id, l.lane, l.laneCount]))
      .toEqual([['a', 0, 1], ['b', 0, 2], ['c', 1, 2]]);
  });
});

describe('the scale', () => {
  it('spans the whole day', () => {
    expect(DAY_START_MIN).toBe(0);
    expect(DAY_END_MIN).toBe(1440);
  });

  // The density guard. 720px for a 480-1200 range — the old default — is
  // exactly 1px per minute, so holding PX_PER_MINUTE at 1 is what keeps the
  // remaster from silently restyling a locked visual identity.
  it('renders at the same density the stretching grid used by default', () => {
    expect(PX_PER_MINUTE).toBe(1);
    expect(minuteToPx(1200) - minuteToPx(480)).toBe(720);
  });

  it('is as tall as the day is long', () => {
    expect(DAY_HEIGHT_PX).toBe(1440 * PX_PER_MINUTE);
  });
});

describe('minute <-> pixel', () => {
  it('puts midnight at the top', () => {
    expect(minuteToPx(DAY_START_MIN)).toBe(0);
  });

  it('puts the end of the day at the full height', () => {
    expect(minuteToPx(DAY_END_MIN)).toBe(DAY_HEIGHT_PX);
  });

  it('is linear rather than range-relative', () => {
    // The old minuteToPct answered differently for the same minute depending
    // on which blocks happened to be on the week. This must not.
    expect(minuteToPx(600)).toBe(600 * PX_PER_MINUTE);
    expect(minuteToPx(1300)).toBe(1300 * PX_PER_MINUTE);
  });

  it('round-trips every minute of the day', () => {
    const failures: string[] = [];
    for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 1) {
      const back = pxToMinute(minuteToPx(m));
      if (Math.abs(back - m) > 1e-6) failures.push(`${m} -> ${back}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('the stacking order', () => {
  // A guard, not a tautology: the layers have a required ORDER, and the one
  // that actually regressed before was a revealed block sitting above the
  // sticky headings. Asserting the relation catches a reorder that asserting
  // the numbers individually would not.
  it('puts every layer above the one it must cover', () => {
    expect(Z_RULES).toBeLessThan(Z_BLOCK);
    expect(Z_BLOCK).toBeLessThan(Z_BLOCK_REVEALED);
    expect(Z_BLOCK_REVEALED).toBeLessThan(Z_NOW_LINE);
    expect(Z_NOW_LINE).toBeLessThan(Z_AXIS);
    expect(Z_AXIS).toBeLessThan(Z_HEADINGS);
    expect(Z_HEADINGS).toBeLessThan(Z_CORNER);
  });
});

describe('initialScrollWindow', () => {
  it('never returns less than the 08:00-20:00 floor', () => {
    expect(initialScrollWindow(WEEK, NINE_TO_SIX))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('grows to cover an early availability window, floored to the hour', () => {
    const early: AvailabilityWindow[] = [{ dow: 2, startMin: 415, endMin: 1080 }]; // 06:55
    expect(initialScrollWindow(WEEK, early).startMin).toBe(360); // 06:00
  });

  it('grows to cover a late availability window, ceiled to the hour', () => {
    const late: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1330 }]; // 22:10
    expect(initialScrollWindow(WEEK, late).endMin).toBe(1380); // 23:00
  });

  it('ignores windows for days not in the week', () => {
    const SIX = WEEK.slice(0, 6);
    expect(initialScrollWindow(SIX, [{ dow: 6, startMin: 60, endMin: 120 }]))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('stays inside the day even for an absurd window', () => {
    const w = initialScrollWindow(WEEK, [{ dow: 2, startMin: 0, endMin: 1440 }]);
    expect(w.startMin).toBeGreaterThanOrEqual(DAY_START_MIN);
    expect(w.endMin).toBeLessThanOrEqual(DAY_END_MIN);
  });

  it('always returns a positive-width window', () => {
    const cases: Array<[string, string[], AvailabilityWindow[]]> = [
      ['empty week', WEEK, []],
      ['a narrow midday window', WEEK, [{ dow: 2, startMin: 700, endMin: 720 }]],
      ['a genuinely empty dates array', [], []],
    ];
    for (const [label, dates, windows] of cases) {
      const w = initialScrollWindow(dates, windows);
      expect(w.endMin, label).toBeGreaterThan(w.startMin);
    }
  });
});
