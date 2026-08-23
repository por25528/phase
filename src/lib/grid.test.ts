import { describe, it, expect } from 'vitest';
import {
  hourMarks, assignLanes,
  MIN_VISIBLE_START, MIN_VISIBLE_END,
  initialScrollWindow, minuteToPx, pxToMinute,
  PX_PER_MINUTE, DAY_START_MIN, DAY_END_MIN, DAY_HEIGHT_PX,
  Z_RULES, Z_BLOCK, Z_BLOCK_REVEALED, Z_NOW_LINE, Z_AXIS, Z_HEADINGS, Z_CORNER,
} from './grid';

const WEEK = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];

describe('hourMarks', () => {
  it('labels every whole hour of the day, both ends inclusive', () => {
    const marks = hourMarks();
    expect(marks).toHaveLength(25);
    expect(marks[0]).toBe(0);
    expect(marks[24]).toBe(1440);
    expect(marks[9]).toBe(540);
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
    // The old percentage mapping answered differently for the same minute
    // depending on which blocks happened to be on the week. This must not.
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
  const clear = () => [];
  const on = (date: string, startMin: number, endMin: number) =>
    (d: string) => (d === date ? [{ startMin, endMin }] : []);

  it('opens on the ordinary day when the week is empty', () => {
    expect(initialScrollWindow(WEEK, clear))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('grows to cover an early sitting, floored to the hour', () => {
    expect(initialScrollWindow(WEEK, on('2026-07-15', 415, 480)).startMin).toBe(360); // 06:55 → 06:00
  });

  it('grows to cover a late sitting, ceiled to the hour', () => {
    expect(initialScrollWindow(WEEK, on('2026-07-15', 1260, 1330)).endMin).toBe(1380); // 22:10 → 23:00
  });

  it('ignores sittings on days not in the week', () => {
    const SIX = WEEK.slice(0, 6);
    expect(initialScrollWindow(SIX, on('2026-07-19', 60, 120)))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('stays inside the day even for an absurd sitting', () => {
    const w = initialScrollWindow(WEEK, on('2026-07-15', 0, 1440));
    expect(w.startMin).toBeGreaterThanOrEqual(DAY_START_MIN);
    expect(w.endMin).toBeLessThanOrEqual(DAY_END_MIN);
  });

  it('always returns a positive-width window', () => {
    const cases: Array<[string, string[], (d: string) => { startMin: number; endMin: number }[]]> = [
      ['empty week', WEEK, clear],
      ['a narrow midday sitting', WEEK, on('2026-07-15', 700, 720)],
      ['a genuinely empty dates array', [], clear],
    ];
    for (const [label, dates, spansFor] of cases) {
      const w = initialScrollWindow(dates, spansFor);
      expect(w.endMin, label).toBeGreaterThan(w.startMin);
    }
  });
});
