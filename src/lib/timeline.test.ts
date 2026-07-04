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

import {
  defaultNodeSpan,
  spanOutside,
} from './timeline';

describe('defaultNodeSpan', () => {
  it('today within goal span: start = today, deadline = today + 6 days', () => {
    const goal = { start: '2026-01-01', deadline: '2026-12-31' };
    expect(defaultNodeSpan(goal, '2026-06-01')).toEqual({
      start: '2026-06-01',
      deadline: '2026-06-07',
    });
  });
  it('today before goal start: start = goal.start, deadline = goal.start + 6 days', () => {
    const goal = { start: '2026-06-01', deadline: '2026-12-31' };
    expect(defaultNodeSpan(goal, '2026-01-01')).toEqual({
      start: '2026-06-01',
      deadline: '2026-06-07',
    });
  });
  it('today after goal deadline: start clamps to goal.deadline (0-day span)', () => {
    const goal = { start: '2026-01-01', deadline: '2026-06-01' };
    expect(defaultNodeSpan(goal, '2026-12-31')).toEqual({
      start: '2026-06-01',
      deadline: '2026-06-01',
    });
  });
  it('deadline is capped at goal.deadline when the 7-day window would overrun', () => {
    const goal = { start: '2026-01-01', deadline: '2026-06-03' };
    expect(defaultNodeSpan(goal, '2026-06-01')).toEqual({
      start: '2026-06-01',
      deadline: '2026-06-03',
    });
  });
  it('goal span shorter than 7 days: span is whatever fits, start = max(today, goal.start)', () => {
    const goal = { start: '2026-06-01', deadline: '2026-06-03' };
    expect(defaultNodeSpan(goal, '2026-01-01')).toEqual({
      start: '2026-06-01',
      deadline: '2026-06-03',
    });
  });
  it('goal span is a single day: 0-day span at that day', () => {
    const goal = { start: '2026-06-01', deadline: '2026-06-01' };
    expect(defaultNodeSpan(goal, '2026-01-01')).toEqual({
      start: '2026-06-01',
      deadline: '2026-06-01',
    });
  });
  it('today exactly on goal.deadline: 0-day span at deadline', () => {
    const goal = { start: '2026-01-01', deadline: '2026-06-01' };
    expect(defaultNodeSpan(goal, '2026-06-01')).toEqual({
      start: '2026-06-01',
      deadline: '2026-06-01',
    });
  });
});

describe('spanOutside', () => {
  const goal = { start: '2026-01-01', deadline: '2026-12-31' };
  it('false when span is fully within goal bounds', () => {
    expect(spanOutside({ start: '2026-02-01', deadline: '2026-03-01' }, goal)).toBe(false);
  });
  it('false when span exactly matches goal bounds', () => {
    expect(spanOutside({ start: '2026-01-01', deadline: '2026-12-31' }, goal)).toBe(false);
  });
  it('true when span starts before goal.start', () => {
    expect(spanOutside({ start: '2025-12-31', deadline: '2026-06-01' }, goal)).toBe(true);
  });
  it('true when span ends after goal.deadline', () => {
    expect(spanOutside({ start: '2026-06-01', deadline: '2027-01-01' }, goal)).toBe(true);
  });
  it('true when both bounds are outside', () => {
    expect(spanOutside({ start: '2025-01-01', deadline: '2027-01-01' }, goal)).toBe(true);
  });
});

import {
  PX_PER_DAY,
  PERIOD_DAYS,
  chunkDays,
  rangeDays,
  rangeWidth,
  dateToX,
  xToDate,
  centerDateOf,
  scrollLeftForCenter,
  initialRange,
  monthSegments,
  daySegments,
} from './timeline';

describe('dateToX / xToDate', () => {
  it('is 0 at rangeStart', () => {
    expect(dateToX('2026-07-01', '2026-07-01', 40)).toBe(0);
  });
  it('scales by pxPerDay', () => {
    expect(dateToX('2026-07-08', '2026-07-01', 40)).toBe(280);
    expect(dateToX('2026-07-08', '2026-07-01', 13)).toBe(91);
  });
  it('is negative before rangeStart', () => {
    expect(dateToX('2026-06-28', '2026-07-01', 40)).toBe(-120);
  });
  it('round-trips through xToDate, including cross-month/year', () => {
    for (const d of ['2026-07-01', '2026-08-15', '2026-12-31', '2027-01-01', '2025-11-30']) {
      expect(xToDate(dateToX(d, '2026-07-01', 40), '2026-07-01', 40)).toBe(d);
    }
  });
  it('xToDate floors within a day column', () => {
    const x = dateToX('2026-07-10', '2026-07-01', 40);
    expect(xToDate(x + 39, '2026-07-01', 40)).toBe('2026-07-10');
    expect(xToDate(x + 40, '2026-07-01', 40)).toBe('2026-07-11');
  });
  it('xToDate handles negative x', () => {
    expect(xToDate(-1, '2026-07-01', 40)).toBe('2026-06-30');
    expect(xToDate(-40, '2026-07-01', 40)).toBe('2026-06-30');
    expect(xToDate(-41, '2026-07-01', 40)).toBe('2026-06-29');
  });
});

describe('rangeDays / rangeWidth', () => {
  const july = { start: '2026-07-01', end: '2026-07-31' };
  it('counts inclusive days', () => {
    expect(rangeDays(july)).toBe(31);
    expect(rangeDays({ start: '2026-07-01', end: '2026-07-01' })).toBe(1);
  });
  it('width = days * pxPerDay', () => {
    expect(rangeWidth(july, 40)).toBe(1240);
  });
});

describe('centerDateOf / scrollLeftForCenter', () => {
  const rangeStart = '2026-01-01';
  it('are inverses when no clamping occurs', () => {
    for (const zoom of ['week', 'month', 'quarter'] as const) {
      const ppd = PX_PER_DAY[zoom];
      const sl = scrollLeftForCenter('2026-07-04', 1000, rangeStart, ppd);
      expect(centerDateOf(sl, 1000, rangeStart, ppd)).toBe('2026-07-04');
    }
  });
  it('scrollLeftForCenter clamps at 0 near the range start', () => {
    expect(scrollLeftForCenter('2026-01-01', 1000, rangeStart, 40)).toBe(0);
  });
});

describe('initialRange', () => {
  it('contains today and all supplied dates', () => {
    const r = initialRange('month', '2026-07-04', ['2026-03-01', '2026-12-31']);
    expect(r.start < '2026-03-01').toBe(true);
    expect(r.end > '2026-12-31').toBe(true);
  });
  it('contains the optional center date', () => {
    const r = initialRange('month', '2026-07-04', [], '2024-01-01');
    expect(r.start < '2024-01-01').toBe(true);
    expect(r.end > '2026-07-04').toBe(true);
  });
  it('pad in days grows as pxPerDay shrinks', () => {
    const week = initialRange('week', '2026-07-04', []);
    const quarter = initialRange('quarter', '2026-07-04', []);
    expect(daysBetween(week.start, '2026-07-04')).toBe(Math.ceil(4000 / PX_PER_DAY.week));
    expect(daysBetween(quarter.start, '2026-07-04')).toBe(Math.ceil(4000 / PX_PER_DAY.quarter));
  });
  it('spans today only (plus pad) when no dates given', () => {
    const r = initialRange('month', '2026-07-04', []);
    expect(daysBetween(r.start, '2026-07-04')).toBe(100);
    expect(daysBetween('2026-07-04', r.end)).toBe(100);
  });
});

describe('monthSegments', () => {
  it('covers whole months when range aligns to month bounds', () => {
    const segs = monthSegments({ start: '2026-07-01', end: '2026-09-30' });
    expect(segs.map((s) => ({ label: s.label, days: s.days, start: s.start }))).toEqual([
      { label: 'Jul', days: 31, start: '2026-07-01' },
      { label: 'Aug', days: 31, start: '2026-08-01' },
      { label: 'Sep', days: 30, start: '2026-09-01' },
    ]);
  });
  it('clips the first and last months to the range', () => {
    const segs = monthSegments({ start: '2026-07-15', end: '2026-08-10' });
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ start: '2026-07-15', days: 17 });
    expect(segs[1]).toMatchObject({ start: '2026-08-01', days: 10 });
  });
  it('segment days always sum to rangeDays', () => {
    const range = { start: '2026-02-10', end: '2027-03-05' };
    const segs = monthSegments(range);
    expect(segs.reduce((s, x) => s + x.days, 0)).toBe(rangeDays(range));
  });
  it('handles leap-year February', () => {
    const segs = monthSegments({ start: '2028-02-01', end: '2028-02-29' });
    expect(segs).toEqual([
      { start: '2028-02-01', days: 29, label: 'Feb', major: false },
    ]);
  });
  it('labels January with the year and marks it major', () => {
    const segs = monthSegments({ start: '2026-12-01', end: '2027-01-31' });
    expect(segs[1]).toMatchObject({ label: 'Jan 2027', major: true });
  });
});

describe('daySegments', () => {
  it('emits one segment per day', () => {
    const range = { start: '2026-07-01', end: '2026-07-14' };
    const segs = daySegments(range);
    expect(segs).toHaveLength(rangeDays(range));
    expect(segs.every((s) => s.days === 1)).toBe(true);
  });
  it('labels with day-of-month', () => {
    const segs = daySegments({ start: '2026-07-30', end: '2026-08-02' });
    expect(segs.map((s) => s.label)).toEqual(['30', '31', '1', '2']);
  });
  it('marks Sundays and month firsts as major', () => {
    // 2026-07-05 is a Sunday; 2026-08-01 is a Saturday (still major as the 1st)
    const segs = daySegments({ start: '2026-07-04', end: '2026-08-01' });
    const byDate = new Map(segs.map((s) => [s.start, s.major]));
    expect(byDate.get('2026-07-05')).toBe(true);
    expect(byDate.get('2026-07-06')).toBe(false);
    expect(byDate.get('2026-08-01')).toBe(true);
  });
});

describe('canvas constants', () => {
  it('chunkDays converts px to whole days', () => {
    expect(chunkDays(40)).toBe(75);
    expect(chunkDays(130)).toBe(Math.ceil(3000 / 130));
  });
  it('PERIOD_DAYS matches zoom semantics', () => {
    expect(PERIOD_DAYS.week).toBe(7);
    expect(PERIOD_DAYS.month).toBe(30);
    expect(PERIOD_DAYS.quarter).toBe(91);
  });
});

