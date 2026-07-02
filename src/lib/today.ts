import { parseD, addDays } from './dates';
import type { Habit } from '../db/types';

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
