import { parseD, addDays, isoWeekNumber } from './dates';
import type { Goal, Habit } from '../db/types';
import { hasTrustedSchedule, needsDateConfirmation } from './schedule';

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export function dateKicker(s: string): string {
  const d = parseD(s);
  const wd = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  const mo = d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  return `${wd} · ${d.getDate()} ${mo} ${d.getFullYear()}`;
}

/**
 * The date, as a two-cell stamp: the weekday, then the day it belongs to.
 *
 * Not a replacement for `dateKicker` and not a shortening of it. The kicker is
 * one continuous phrase in the eyebrow slot above a heading; this is a STAMP —
 * two cells with a rule between them, the first inverted — so it needs the
 * split to be a fact about the string rather than something the renderer
 * guesses with a `split('·')`.
 *
 * The week number is the second half's whole reason for existing at a terse
 * `SAT` / `22 AUG 2026` width: a planner whose other surfaces are addressed by
 * week (`weekOf`, `plannedWeek`, the Plan grid) should say which week you are
 * standing in, and Today never did. It is `isoWeekNumber` — the same
 * Thursday-anchored count `dates.ts` already publishes, never a second one.
 */
export function dayStamp(s: string): { dow: string; span: string } {
  const d = parseD(s);
  const dow = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const mo = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return {
    dow,
    span: `${d.getDate()} ${mo} ${d.getFullYear()} · WEEK ${isoWeekNumber(s)}`,
  };
}

export function daysLeftInYear(s: string): number {
  const d = parseD(s);
  const end = new Date(d.getFullYear(), 11, 31);
  return Math.round((end.getTime() - d.getTime()) / 86_400_000);
}

export function lastNDays(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(s, -i));
  return out;
}

export function habitHitPct(habits: Habit[], today: string, windowDays = 20): number {
  if (habits.length === 0) return 0;
  const days = new Set(lastNDays(today, windowDays));
  const hits = habits.reduce(
    (acc, h) => acc + h.checkins.filter((c) => days.has(c)).length,
    0,
  );
  return Math.round((100 * hits) / (habits.length * windowDays));
}

export function deadlineChip(deadline: string, today: string): string {
  const d = parseD(deadline);
  const mo = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const diff = Math.round((d.getTime() - parseD(today).getTime()) / 86_400_000);
  const rel = diff >= 0 ? `${diff}D` : `${-diff}D OVER`;
  return `${mo} ${d.getDate()} · ${rel}`;
}

// The Today goal-rail deadline chip. Only a user-confirmed (trusted) schedule
// earns a countdown; an unconfirmed legacy deadline must never surface an
// overdue claim, so it returns null and the rail shows its "Dates unconfirmed"
// badge instead. A project with no dates reads "No deadline".
export function railDeadlineChip(goal: Goal, today: string): string | null {
  if (hasTrustedSchedule(goal)) return deadlineChip(goal.deadline, today);
  if (needsDateConfirmation(goal)) return null;
  return 'No deadline';
}
