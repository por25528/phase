import { describe, it, expect } from 'vitest';
import { minutesOn, minutesThisWeek, fmtMinutes } from './sessions';
import type { Session } from '../db/types';

const S = (date: string, minutes: number, goalId: string | null = 'g1'): Session =>
  ({ id: date + minutes, goalId, date, minutes, note: '' });

describe('sessions math', () => {
  it('minutesOn sums a single day, optionally per goal', () => {
    const s = [S('2026-07-02', 30), S('2026-07-02', 45, 'g2'), S('2026-07-01', 60)];
    expect(minutesOn(s, '2026-07-02')).toBe(75);
    expect(minutesOn(s, '2026-07-02', 'g1')).toBe(30);
  });
  it('minutesThisWeek sums the Sun–Sat week containing today', () => {
    // 2026-07-02 is a Thursday → week is Jun 28 – Jul 4
    const s = [S('2026-06-28', 10), S('2026-07-04', 20), S('2026-07-05', 99), S('2026-06-27', 99)];
    expect(minutesThisWeek(s, '2026-07-02')).toBe(30);
  });
  it('fmtMinutes renders h/m compactly', () => {
    expect(fmtMinutes(45)).toBe('45m');
    expect(fmtMinutes(60)).toBe('1h');
    expect(fmtMinutes(200)).toBe('3h 20m');
  });
});
