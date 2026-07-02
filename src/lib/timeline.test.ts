import { describe, it, expect } from 'vitest';
import {
  clampSpan,
  moveSpan,
  resizeStart,
  resizeEnd,
  snapDelta,
  daysBetween,
  expectedPct,
  behindPaceBy,
} from './timeline';

describe('daysBetween', () => {
  it('returns positive from earlier to later', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
  });
  it('returns negative from later to earlier', () => {
    expect(daysBetween('2026-01-08', '2026-01-01')).toBe(-7);
  });
  it('returns 0 for the same date', () => {
    expect(daysBetween('2026-06-15', '2026-06-15')).toBe(0);
  });
});

describe('clampSpan', () => {
  it('no-ops when start <= deadline', () => {
    expect(clampSpan('2026-01-01', '2026-12-31')).toEqual({
      start: '2026-01-01',
      deadline: '2026-12-31',
    });
  });
  it('no-ops when start === deadline', () => {
    expect(clampSpan('2026-06-01', '2026-06-01')).toEqual({
      start: '2026-06-01',
      deadline: '2026-06-01',
    });
  });
  it('swaps when start > deadline', () => {
    expect(clampSpan('2026-12-31', '2026-01-01')).toEqual({
      start: '2026-01-01',
      deadline: '2026-12-31',
    });
  });
});

describe('moveSpan', () => {
  it('shifts both endpoints by deltaDays', () => {
    const r = moveSpan('2026-01-01', '2026-01-31', 7);
    expect(r.start).toBe('2026-01-08');
    expect(r.deadline).toBe('2026-02-07');
  });
  it('preserves span length after shift', () => {
    const r = moveSpan('2026-01-01', '2026-01-31', 7);
    expect(daysBetween(r.start, r.deadline)).toBe(30);
  });
  it('handles negative delta (shift backward)', () => {
    const r = moveSpan('2026-03-01', '2026-03-31', -7);
    expect(r.start).toBe('2026-02-22');
    expect(r.deadline).toBe('2026-03-24');
    expect(daysBetween(r.start, r.deadline)).toBe(30);
  });
});

describe('resizeStart', () => {
  it('moves start earlier without clamping', () => {
    const r = resizeStart('2026-01-15', '2026-01-31', -5);
    expect(r.start).toBe('2026-01-10');
    expect(r.deadline).toBe('2026-01-31');
  });
  it('moves start later without crossing deadline', () => {
    const r = resizeStart('2026-01-15', '2026-01-31', 5);
    expect(r.start).toBe('2026-01-20');
    expect(r.deadline).toBe('2026-01-31');
  });
  it('clamps start to deadline when delta would exceed it', () => {
    const r = resizeStart('2026-01-15', '2026-01-31', 20);
    expect(r.start).toBe('2026-01-31');
    expect(r.deadline).toBe('2026-01-31');
  });
});

describe('resizeEnd', () => {
  it('moves deadline later without clamping', () => {
    const r = resizeEnd('2026-01-01', '2026-01-31', 5);
    expect(r.start).toBe('2026-01-01');
    expect(r.deadline).toBe('2026-02-05');
  });
  it('moves deadline earlier without crossing start', () => {
    const r = resizeEnd('2026-01-01', '2026-01-31', -10);
    expect(r.deadline).toBe('2026-01-21');
    expect(r.start).toBe('2026-01-01');
  });
  it('clamps deadline to start when delta would go before it', () => {
    const r = resizeEnd('2026-01-15', '2026-01-31', -20);
    expect(r.deadline).toBe('2026-01-15');
    expect(r.start).toBe('2026-01-15');
  });
});

describe('snapDelta', () => {
  it('rounds to nearest day (unit=day is identity for integers)', () => {
    expect(snapDelta(3, 'day')).toBe(3);
    expect(snapDelta(0, 'day')).toBe(0);
  });
  it('rounds fractional days', () => {
    expect(snapDelta(1.4, 'day')).toBe(1);
    expect(snapDelta(1.6, 'day')).toBe(2);
  });
  it('rounds to nearest week', () => {
    expect(snapDelta(2, 'week')).toBe(0);   // closer to 0 than 7 (3.5 is halfway)
    expect(snapDelta(3, 'week')).toBe(0);   // 3 < 3.5, rounds to 0
    expect(snapDelta(4, 'week')).toBe(7);   // 4 >= 3.5, rounds to 7
    expect(snapDelta(10, 'week')).toBe(7);  // closer to 7 than 14
    expect(snapDelta(11, 'week')).toBe(14); // closer to 14 than 7
  });
  it('handles negative deltas', () => {
    expect(snapDelta(-4, 'week')).toBe(-7);
    expect(snapDelta(-3, 'week')).toBe(0);  // 3 < 3.5, rounds to 0
    expect(snapDelta(-2, 'week')).toBe(0);
  });
});

describe('expectedPct', () => {
  it('returns 0 before start', () => {
    expect(expectedPct('2026-02-01', '2026-12-31', '2026-01-01')).toBe(0);
  });
  it('returns 100 after deadline', () => {
    expect(expectedPct('2026-01-01', '2026-06-30', '2026-12-31')).toBe(100);
  });
  it('returns 100 when start equals deadline', () => {
    expect(expectedPct('2026-06-01', '2026-06-01', '2026-06-01')).toBe(100);
  });
  it('returns ~50 at midpoint', () => {
    // 100 days: Jan 1 → Apr 11 (31-1 in Jan + 28 Feb + 31 Mar + 11 Apr = 100)
    // midpoint: Jan 1 + 50 days = Feb 20
    const pct = expectedPct('2026-01-01', '2026-04-11', '2026-02-20');
    expect(pct).toBeCloseTo(50, 0);
  });
  it('clamps to 0..100', () => {
    expect(expectedPct('2026-06-01', '2026-06-10', '2026-01-01')).toBe(0);
    expect(expectedPct('2026-06-01', '2026-06-10', '2026-12-31')).toBe(100);
  });
});

describe('behindPaceBy', () => {
  it('returns 0 when ahead of pace', () => {
    // actualPct=100, expectedPct≈50 → max(0, 50-100)=0
    expect(behindPaceBy(100, '2026-01-01', '2026-04-11', '2026-02-20')).toBe(0);
  });
  it('returns deficit when behind pace', () => {
    // actualPct=0, expectedPct≈50 → max(0, 50-0)≈50
    const result = behindPaceBy(0, '2026-01-01', '2026-04-11', '2026-02-20');
    expect(result).toBeCloseTo(50, 0);
  });
  it('returns 0 when before start (expected=0)', () => {
    expect(behindPaceBy(0, '2026-06-01', '2026-12-31', '2026-01-01')).toBe(0);
  });
  it('returns 0 when exactly on pace', () => {
    const pct = expectedPct('2026-01-01', '2026-04-11', '2026-02-20');
    expect(behindPaceBy(pct, '2026-01-01', '2026-04-11', '2026-02-20')).toBe(0);
  });
});

import { zoomWindow, windowDays, windowFrac, windowSegments } from './timeline';

describe('zoomWindow', () => {
  it('year spans Jan 1 – Dec 31 of today year', () => {
    expect(zoomWindow('year', '2026-07-02')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
  it('quarter spans the current quarter', () => {
    expect(zoomWindow('quarter', '2026-07-02')).toEqual({ start: '2026-07-01', end: '2026-09-30' });
    expect(zoomWindow('quarter', '2026-01-15')).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(zoomWindow('quarter', '2026-12-31')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });
  it('month spans the current month', () => {
    expect(zoomWindow('month', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});

describe('windowDays / windowFrac', () => {
  const july = { start: '2026-07-01', end: '2026-07-31' };
  it('counts inclusive days', () => {
    expect(windowDays(july)).toBe(31);
    expect(windowDays(zoomWindow('year', '2026-07-02'))).toBe(365);
  });
  it('frac is 0 at start, 1 at day after end, negative before', () => {
    expect(windowFrac('2026-07-01', july)).toBe(0);
    expect(windowFrac('2026-08-01', july)).toBe(1);
    expect(windowFrac('2026-06-30', july)).toBeLessThan(0);
    expect(windowFrac('2026-07-17', july)).toBeCloseTo(16 / 31);
  });
});

describe('windowSegments', () => {
  it('year → 12 month segments summing to 365', () => {
    const segs = windowSegments('year', zoomWindow('year', '2026-07-02'));
    expect(segs).toHaveLength(12);
    expect(segs[0]).toEqual({ label: 'Jan', days: 31 });
    expect(segs.reduce((s, x) => s + x.days, 0)).toBe(365);
  });
  it('quarter → 3 month segments', () => {
    expect(windowSegments('quarter', zoomWindow('quarter', '2026-07-02'))).toEqual([
      { label: 'Jul', days: 31 }, { label: 'Aug', days: 31 }, { label: 'Sep', days: 30 },
    ]);
  });
  it('month → weekly segments', () => {
    expect(windowSegments('month', zoomWindow('month', '2026-07-02'))).toEqual([
      { label: 'W1', days: 7 }, { label: 'W2', days: 7 }, { label: 'W3', days: 7 },
      { label: 'W4', days: 7 }, { label: 'W5', days: 3 },
    ]);
  });
});
