import { parseD, addDays, pad, MO } from './dates';
import type { ZoomLevel } from '../db/types';

export function daysBetween(a: string, b: string): number {
  return Math.round((parseD(b).getTime() - parseD(a).getTime()) / 86400000);
}

export function clampSpan(
  start: string,
  deadline: string,
): { start: string; deadline: string } {
  return start <= deadline ? { start, deadline } : { start: deadline, deadline: start };
}

export function moveSpan(
  start: string,
  deadline: string,
  deltaDays: number,
): { start: string; deadline: string } {
  return { start: addDays(start, deltaDays), deadline: addDays(deadline, deltaDays) };
}

export function resizeStart(
  start: string,
  deadline: string,
  deltaDays: number,
): { start: string; deadline: string } {
  const next = addDays(start, deltaDays);
  return { start: next <= deadline ? next : deadline, deadline };
}

export function resizeEnd(
  start: string,
  deadline: string,
  deltaDays: number,
): { start: string; deadline: string } {
  const next = addDays(deadline, deltaDays);
  return { start, deadline: next >= start ? next : start };
}

export function snapDelta(deltaDays: number, unit: 'day' | 'week'): number {
  const size = unit === 'week' ? 7 : 1;
  // `|| 0` converts -0 to 0 when negative inputs round to zero
  return (Math.round(deltaDays / size) * size) || 0;
}

export function expectedPct(
  start: string,
  deadline: string,
  todayStr: string,
): number {
  const total = daysBetween(start, deadline);
  if (total <= 0) return 100;
  const elapsed = daysBetween(start, todayStr);
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

export function behindPaceBy(
  actualPct: number,
  start: string,
  deadline: string,
  todayStr: string,
): number {
  return Math.max(0, expectedPct(start, deadline, todayStr) - actualPct);
}

export interface DateWindow { start: string; end: string } // both inclusive

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function zoomWindow(zoom: ZoomLevel, today: string): DateWindow {
  const d = parseD(today);
  const y = d.getFullYear();
  if (zoom === 'year') return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (zoom === 'quarter') {
    const q = Math.floor(d.getMonth() / 3) * 3;
    return { start: iso(new Date(y, q, 1)), end: iso(new Date(y, q + 3, 0)) };
  }
  return { start: iso(new Date(y, d.getMonth(), 1)), end: iso(new Date(y, d.getMonth() + 1, 0)) };
}

export function shiftAnchor(zoom: ZoomLevel, anchor: string, n: number): string {
  const d = parseD(anchor);
  const months = zoom === 'year' ? 0 : zoom === 'quarter' ? 3 * n : n;
  const years = zoom === 'year' ? n : 0;
  const targetYear = d.getFullYear() + years + Math.floor((d.getMonth() + months) / 12);
  const targetMonth = ((d.getMonth() + months) % 12 + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d.getDate(), lastDay);
  return iso(new Date(targetYear, targetMonth, day));
}

export function defaultNodeSpan(
  goal: { start: string; deadline: string },
  today: string,
): { start: string; deadline: string } {
  const latest = today > goal.start ? today : goal.start; // max(today, goal.start)
  const start = latest < goal.deadline ? latest : goal.deadline; // clamp to goal.deadline
  const deadline = addDays(start, 6);
  return { start, deadline: deadline < goal.deadline ? deadline : goal.deadline };
}

export function spanOutside(
  span: { start: string; deadline: string },
  goal: { start: string; deadline: string },
): boolean {
  return span.start < goal.start || span.deadline > goal.deadline;
}

export function windowDays(win: DateWindow): number {
  return daysBetween(win.start, win.end) + 1;
}

export function windowFrac(date: string, win: DateWindow): number {
  return daysBetween(win.start, date) / windowDays(win);
}

export interface Segment { label: string; days: number }

export function windowSegments(zoom: ZoomLevel, win: DateWindow): Segment[] {
  if (zoom === 'month') {
    const total = windowDays(win);
    const segs: Segment[] = [];
    for (let done = 0, w = 1; done < total; w++) {
      const days = Math.min(7, total - done);
      segs.push({ label: `W${w}`, days });
      done += days;
    }
    return segs;
  }
  const startD = parseD(win.start);
  const count = zoom === 'year' ? 12 : 3;
  const segs: Segment[] = [];
  for (let k = 0; k < count; k++) {
    const first = new Date(startD.getFullYear(), startD.getMonth() + k, 1);
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    segs.push({ label: MO[first.getMonth()], days });
  }
  return segs;
}
