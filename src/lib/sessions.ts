import type { Session } from '../db/types';
import { weekDates } from './dates';

export function minutesOn(sessions: Session[], date: string, goalId?: string): number {
  return sessions
    .filter(s => s.date === date && (goalId === undefined || s.goalId === goalId))
    .reduce((sum, s) => sum + s.minutes, 0);
}

export function minutesThisWeek(sessions: Session[], today: string, goalId?: string): number {
  const week = new Set(weekDates(today));
  return sessions
    .filter(s => week.has(s.date) && (goalId === undefined || s.goalId === goalId))
    .reduce((sum, s) => sum + s.minutes, 0);
}

export function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
