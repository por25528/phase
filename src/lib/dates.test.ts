import { describe, it, expect } from 'vitest';
import { millisecondsUntilNextLocalMidnight, weekDates } from './dates';

describe('millisecondsUntilNextLocalMidnight', () => {
  it('returns the remaining local-clock time through the next day boundary', () => {
    const now = new Date(2026, 6, 18, 23, 59, 59, 900);
    expect(millisecondsUntilNextLocalMidnight(now)).toBe(100);
  });

  it('crosses month and year boundaries using the local calendar', () => {
    const now = new Date(2026, 11, 31, 23, 0, 0, 0);
    const next = new Date(2027, 0, 1, 0, 0, 0, 0);
    expect(millisecondsUntilNextLocalMidnight(now)).toBe(next.getTime() - now.getTime());
  });
});

describe('weekDates (Monday-based)', () => {
  it('a Wednesday maps to the preceding Monday', () => {
    // 2026-07-15 is a Wednesday
    expect(weekDates('2026-07-15')[0]).toBe('2026-07-13');
    expect(weekDates('2026-07-15')[6]).toBe('2026-07-19');
  });

  it('a Sunday belongs to the PRECEDING Monday', () => {
    // 2026-07-19 is a Sunday
    expect(weekDates('2026-07-19')[0]).toBe('2026-07-13');
  });

  it('a Monday is its own week start', () => {
    expect(weekDates('2026-07-13')[0]).toBe('2026-07-13');
  });

  it('crosses the year boundary', () => {
    // 2027-01-01 is a Friday; its Monday is 2026-12-28
    expect(weekDates('2027-01-01')[0]).toBe('2026-12-28');
    expect(weekDates('2027-01-01')[6]).toBe('2027-01-03');
  });

  it('returns 7 consecutive days', () => {
    const w = weekDates('2026-07-15');
    expect(w).toHaveLength(7);
  });
});
