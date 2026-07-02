import type { Habit } from '../db/types';

export const YEAR = 2026;
export const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fmtD(s: string): string {
  const d = parseD(s);
  return `${MO[d.getMonth()]} ${d.getDate()}`;
}

export function addDays(s: string, n: number): string {
  const d = parseD(s);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function yearFrac(s: string): number {
  const d = parseD(s);
  const a = new Date(YEAR, 0, 1);
  const b = new Date(YEAR, 11, 31, 23, 59);
  return Math.max(0, Math.min(1, (d.getTime() - a.getTime()) / (b.getTime() - a.getTime())));
}

export function monthFrac(m: number): number {
  let s = 0;
  for (let i = 0; i < m; i++) s += DAYS[i];
  return s / 365;
}

export function weekDates(s: string): string[] {
  const out: string[] = [];
  const d = parseD(s);
  const dow = d.getDay();
  for (let i = 0; i < 7; i++) {
    const x = new Date(d);
    x.setDate(d.getDate() - dow + i);
    out.push(`${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`);
  }
  return out;
}

export function daysLeftLabel(deadline: string): string {
  const today = parseD(todayStr());
  const end = parseD(deadline);
  const diff = Math.round((end.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'due today';
  if (diff > 0) return `${diff} days left`;
  return `${Math.abs(diff)} days overdue`;
}

export function streak(habit: Habit): number {
  let n = 0;
  let d = todayStr();
  if (!habit.checkins.includes(d)) d = addDays(d, -1);
  while (habit.checkins.includes(d)) { n++; d = addDays(d, -1); }
  return n;
}
