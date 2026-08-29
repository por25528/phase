import type { Habit } from '../db/types';

export const YEAR = 2026;
export const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The LOCAL calendar day of an instant, in the `YYYY-MM-DD` form every date
 * field in this app carries.
 *
 * Local and never UTC: `toISOString().slice(0, 10)` names a different day than
 * the person in front of the screen does for part of every day — the whole
 * night east of Greenwich, the whole evening west of it — and every comparison
 * here (`plannedWeek`, `doneAt === today`, `date < today`) is against a day the
 * user picked in their own zone.
 */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): string {
  return localDay(new Date());
}

export function millisecondsUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next.getTime() - now.getTime();
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
  const dow = (d.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
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

/**
 * A date, with the year only when the year is not obvious.
 *
 * `fmtD` prints `Jun 30`, which is right almost everywhere — inside a week
 * grid, a month cell or a project header the year is fixed by the surface. On
 * a Someday card it is not: the board can hold a goal due this June and one due
 * June two years out, and it printed them identically.
 *
 * `fmtD` itself is untouched. Most of its callers sit inside a context that
 * already fixes the year, and a suffix there would be noise.
 */
export function fmtDY(s: string, today: string): string {
  return s.slice(0, 4) === today.slice(0, 4) ? fmtD(s) : `${fmtD(s)}, ${s.slice(0, 4)}`;
}

/**
 * The ISO-8601 week number for a date. Thursday-anchored: the week belongs to
 * whichever year holds its Thursday, which is what stops 29 December landing in
 * week 1 of the wrong year.
 */
export function isoWeekNumber(date: string): number {
  const d = parseD(date);
  const thursday = new Date(d);
  // getDay(): Sunday 0 … Saturday 6. Shift so Monday is 0, then step to Thursday.
  thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(
    firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3,
  );
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}
