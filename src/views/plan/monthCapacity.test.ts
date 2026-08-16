import { describe, expect, it } from 'vitest';
import { monthCapacity } from './monthCapacity';
import type { Goal, Task } from '../../db/types';

// AvailabilityWindow.dow is 0 = MONDAY … 6 = Sunday, matching weekDates()
// order — NOT the JS Date convention. 0-4 is Mon-Fri; 1-5 would be Tue-Sat.
const windows = [
  { dow: 0, startMin: 540, endMin: 1020 },
  { dow: 1, startMin: 540, endMin: 1020 },
  { dow: 2, startMin: 540, endMin: 1020 },
  { dow: 3, startMin: 540, endMin: 1020 },
  { dow: 4, startMin: 540, endMin: 1020 },
];

const input = {
  ym: '2026-08',
  goals: [] as Goal[],
  tasks: [] as Task[],
  windows,
  now: { date: '2026-08-16', minute: 600 },
  allDayBlocks: false,
};

describe('monthCapacity', () => {
  it('returns one row per week the grid draws', () => {
    const m = monthCapacity(input);
    // August 2026 starts Sat 1st and ends Mon 31st: 6 Monday-first rows.
    expect(m.rows.length).toBe(6);
    expect(m.rows[0].week).toBe('2026-07-27');
  });

  // THE invariant. If this fails the header and the gutter are lying to each
  // other, which is the entire reason this module exists rather than a
  // month-wide capacity computation.
  it('sums its rows exactly into its total', () => {
    const m = monthCapacity(input);
    const sum = (pick: (c: { freeMin: number; plannedMin: number; backlogMin: number; unestimated: number }) => number) =>
      m.rows.reduce((n, r) => n + pick(r.capacity), 0);
    expect(m.total.freeMin).toBe(sum((c) => c.freeMin));
    expect(m.total.plannedMin).toBe(sum((c) => c.plannedMin));
    expect(m.total.backlogMin).toBe(sum((c) => c.backlogMin));
    expect(m.total.unestimated).toBe(sum((c) => c.unestimated));
  });

  it('labels its span with the first and last day it actually covers', () => {
    const m = monthCapacity(input);
    expect(m.spanLabel).toMatch(/^Jul 27\b/);
    expect(m.spanLabel).toMatch(/Sep 6$/);
  });

  it('counts a straddling week once, in its own row', () => {
    const m = monthCapacity(input);
    const weeks = m.rows.map((r) => r.week);
    expect(new Set(weeks).size).toBe(weeks.length);
  });

  it('handles a five-row month', () => {
    // February 2027 starts Mon 1st and ends Sun 28th — exactly 4 rows.
    const m = monthCapacity({ ...input, ym: '2027-02' });
    expect(m.rows.length).toBe(4);
    expect(m.total.freeMin).toBe(m.rows.reduce((n, r) => n + r.capacity.freeMin, 0));
  });

  it('numbers its rows', () => {
    const m = monthCapacity(input);
    expect(m.rows.every((r) => /^W\d{1,2}$/.test(r.isoWeekLabel))).toBe(true);
  });
});
