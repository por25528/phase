import { describe, it, expect } from 'vitest';
import { greeting, dateKicker, daysLeftInYear, lastNDays, habitHitPct, deadlineChip, railDeadlineChip } from './today';
import type { Goal, Habit } from '../db/types';

describe('greeting', () => {
  it('morning before noon', () => expect(greeting(8)).toBe('Good morning.'));
  it('afternoon before 18', () => expect(greeting(12)).toBe('Good afternoon.'));
  it('evening from 18', () => expect(greeting(18)).toBe('Good evening.'));
  it('evening late night hours', () => expect(greeting(23)).toBe('Good evening.'));
});

describe('dateKicker', () => {
  it('formats WEEKDAY · D MONTH YYYY', () => {
    expect(dateKicker('2026-07-02')).toBe('THURSDAY · 2 JULY 2026');
  });
});

describe('daysLeftInYear', () => {
  it('counts to Dec 31', () => expect(daysLeftInYear('2026-07-02')).toBe(182));
  it('is 0 on Dec 31', () => expect(daysLeftInYear('2026-12-31')).toBe(0));
});

describe('lastNDays', () => {
  it('returns n dates ending today, oldest first', () => {
    expect(lastNDays('2026-07-02', 3)).toEqual(['2026-06-30', '2026-07-01', '2026-07-02']);
  });
});

describe('habitHitPct', () => {
  const mk = (checkins: string[]): Habit =>
    ({ id: 'h', title: 'h', cadence: 'daily', weeklyTarget: 4, goalId: null, checkins });
  it('0 with no habits', () => expect(habitHitPct([], '2026-07-02')).toBe(0));
  it('counts hits inside the window only', () => {
    // window of 2 days: 07-01 and 07-02; one hit inside, one outside
    expect(habitHitPct([mk(['2026-07-02', '2026-01-01'])], '2026-07-02', 2)).toBe(50);
  });
  it('averages across habits', () => {
    expect(habitHitPct([mk(['2026-07-02', '2026-07-01']), mk([])], '2026-07-02', 2)).toBe(50);
  });
});

describe('deadlineChip', () => {
  it('future deadline', () => expect(deadlineChip('2026-12-31', '2026-07-02')).toBe('DEC 31 · 182D'));
  it('due today', () => expect(deadlineChip('2026-07-02', '2026-07-02')).toBe('JUL 2 · 0D'));
  it('overdue', () => expect(deadlineChip('2026-06-27', '2026-07-02')).toBe('JUN 27 · 5D OVER'));
});

describe('railDeadlineChip', () => {
  const goal = (patch: Partial<Goal> = {}): Goal => ({ id: 'g', title: 'G', nodes: [], ...patch });

  it('shows a countdown only for a user-confirmed schedule', () => {
    const g = goal({ start: '2026-01-01', deadline: '2026-12-31', datesConfirmed: true });
    expect(railDeadlineChip(g, '2026-07-02')).toBe(deadlineChip('2026-12-31', '2026-07-02'));
  });

  it('suppresses the chip for an unconfirmed legacy deadline — even a past one — so no false OVER shows', () => {
    const g = goal({ start: '2026-01-01', deadline: '2026-06-27' });
    // The raw chip would claim overdue for this past date...
    expect(deadlineChip('2026-06-27', '2026-07-02')).toContain('OVER');
    // ...but the rail must not, because the schedule is unconfirmed.
    expect(railDeadlineChip(g, '2026-07-02')).toBeNull();
  });

  it('does not trust a confirmed but reversed span', () => {
    const g = goal({ start: '2026-12-31', deadline: '2026-01-01', datesConfirmed: true });
    expect(railDeadlineChip(g, '2026-07-02')).toBe('No deadline');
  });

  it('reads "No deadline" when the project has no dates', () => {
    expect(railDeadlineChip(goal(), '2026-07-02')).toBe('No deadline');
  });
});
