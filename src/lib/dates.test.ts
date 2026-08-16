import { describe, it, expect } from 'vitest';
import { fmtD, fmtDY, isoWeekNumber, millisecondsUntilNextLocalMidnight, weekDates } from './dates';

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

/**
 * `Due · Jun 30` on a Someday card means June 2027 as often as June 2026, and
 * the two are the same six characters. On the board's most-read chip that is
 * not an inconvenience, it is misinformation.
 */
describe('fmtDY', () => {
  it('says nothing extra inside the current year', () => {
    expect(fmtDY('2026-06-30', '2026-08-14')).toBe('Jun 30');
    expect(fmtDY('2026-06-30', '2026-08-14')).toBe(fmtD('2026-06-30'));
  });

  it('names the year outside it, in both directions', () => {
    expect(fmtDY('2027-06-30', '2026-08-14')).toBe('Jun 30, 2027');
    expect(fmtDY('2025-12-31', '2026-08-14')).toBe('Dec 31, 2025');
  });

  it('compares years and not distance — Dec 31 and Jan 1 are a day apart', () => {
    expect(fmtDY('2027-01-01', '2026-12-31')).toBe('Jan 1, 2027');
  });
});

describe('isoWeekNumber', () => {
  it('numbers ISO weeks from the Thursday that anchors them', () => {
    expect(isoWeekNumber('2026-01-01')).toBe(1);
    expect(isoWeekNumber('2026-08-10')).toBe(33);
    // Early January (2027-01-03) in the previous year's final week (53)
    expect(isoWeekNumber('2027-01-03')).toBe(53);
    // Late December (2025-12-29, a Monday) in the following year's first week
    expect(isoWeekNumber('2025-12-29')).toBe(1);
  });
});
