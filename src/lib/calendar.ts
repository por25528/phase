import { pad } from './dates';

/**
 * Month arithmetic for the Plan view's month mode.
 *
 * Deliberately built on real `Date` rollover — `shiftYm` constructs
 * `new Date(y, m - 1 + n, 1)` and lets the platform normalise it, so December
 * → January and January → December cross the year correctly. Do NOT reach for
 * `YEAR`, `DAYS` or `monthFrac` in `./dates`: `YEAR` is pinned to 2026 and
 * `DAYS` has February at 28 with no leap-year case. Those three exist only for
 * the Timeline's year bar and are wrong for anything that navigates.
 *
 * This module was deleted once (04f00e9) along with the Today view that used
 * it — not because it was wrong. It is pure and owns no view; keep it that way.
 */

const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function ymOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftYm(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function ymLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${FULL[m - 1]} ${y}`;
}

export function monthGrid(ym: string): string[][] {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const cur = new Date(first);
  cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7)); // back to Monday
  const last = new Date(y, m, 0);
  const weeks: string[][] = [];
  while (cur <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}
