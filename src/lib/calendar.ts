import { pad, addDays } from './dates';
import { weekOf } from './plan';

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

/**
 * Which month a week belongs to: the month of its Thursday.
 *
 * NOT `ymOf(weekStart)`. A month whose 1st is any day but Monday has its first
 * week starting in the PREVIOUS month — September 2026 begins on a Tuesday, so
 * `weekOf('2026-09-01')` is Mon Aug 31 and `ymOf` of that says August. Paging
 * to September would then draw August, and paging back would never leave it.
 *
 * The Thursday is the ISO week-numbering rule and the majority day: any week
 * has at least four of its days in the month its Thursday falls in, so this
 * round-trips under `shiftYm` in both directions.
 */
export function ymOfWeek(weekStart: string): string {
  return ymOf(addDays(weekStart, 3));
}

/**
 * The week cursor that shows `ym` — the exact inverse of `ymOfWeek`.
 *
 * Anchored on the 4th, not the 1st. A month starting on a Sunday (February
 * 2026) has only ONE of its days in the week containing its 1st, so that
 * week's Thursday — and therefore `ymOfWeek` — still points at the previous
 * month, and paging forward would stick. The 4th is the smallest anchor whose
 * week always belongs to the month itself, which is the same reason ISO
 * defines week 1 as the one containing January 4th.
 *
 * `ymOfWeek(weekShowingMonth(ym)) === ym` for every month; its sibling test
 * asserts that as a round trip rather than a set of examples.
 */
export function weekShowingMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return weekOf(`${y}-${pad(m)}-04`);
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

/**
 * The month grid a PICKER needs: always six rows.
 *
 * `monthGrid` returns the weeks a month actually touches — four for a February
 * that starts on a Monday, six for a long month starting late — and the Plan
 * view sizes its rows `minmax(0, 1fr)` inside a fixed viewport, so a varying
 * count costs it nothing.
 *
 * A popover has no such viewport: it is sized by its content. Paging `›` from a
 * five-row month into a six-row one would grow the panel under the cursor and
 * slide the day being aimed at out from under it. Six is the most rows any
 * month can touch, so this is a ceiling rather than a guess.
 */
export function paddedMonthGrid(ym: string): string[][] {
  const weeks = monthGrid(ym).map((week) => [...week]);
  while (weeks.length < 6) {
    const tail = weeks[weeks.length - 1][6];
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(tail, i + 1)));
  }
  return weeks;
}

export interface DatePreset {
  label: string;
  date: string;
}

/**
 * The shortcuts under the grid, for a GOAL deadline.
 *
 * A preset earns its place by covering what the grid is SLOW at. Any day in the
 * visible month is already one click, so `End of year` — five presses of `›`
 * from August — is the clearest case. `End of month` is the exception that
 * proves the rule: it is one click away, but it asks you to know which day the
 * month ends on, and February is why that is not free.
 *
 * `Today` and `Tomorrow`, which `ScheduleMenu` offers a task, are deliberately
 * absent. They are task-shaped. A goal deadline is a semester-scale fact.
 */
export function deadlinePresets(today: string): DatePreset[] {
  const [y, m] = today.split('-').map(Number);
  const candidates: DatePreset[] = [
    { label: 'In 2 weeks', date: addDays(today, 14) },
    { label: 'End of month', date: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` },
    { label: 'End of year', date: `${y}-12-31` },
  ];
  const seen = new Set<string>();
  const out: DatePreset[] = [];
  for (const preset of candidates) {
    if (seen.has(preset.date)) continue;
    seen.add(preset.date);
    out.push(preset);
  }
  return out;
}
