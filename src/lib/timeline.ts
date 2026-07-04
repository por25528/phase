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

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

// ── Canvas (infinite-scroll timeline) ────────────────────────────────────────
// The canvas replaces the fixed window: a DateRange rendered at a constant
// px-per-day scale per zoom, scrolled horizontally and extended on demand.

export const PX_PER_DAY: Record<ZoomLevel, number> = { week: 130, month: 40, quarter: 13 };
export const PERIOD_DAYS: Record<ZoomLevel, number> = { week: 7, month: 30, quarter: 91 };
export const LABEL_W = 200; // sticky goal-label column width (px)

// Extend the range when scroll comes within this many px of an edge…
export const EXTEND_THRESHOLD_PX = 1000;
// …by this many px worth of days.
const EXTEND_CHUNK_PX = 3000;
// Initial slack on each side of the outermost dates.
const INITIAL_PAD_PX = 4000;

export function chunkDays(pxPerDay: number): number {
  return Math.ceil(EXTEND_CHUNK_PX / pxPerDay);
}

export interface DateRange { start: string; end: string } // both inclusive

export function rangeDays(r: DateRange): number {
  return daysBetween(r.start, r.end) + 1;
}

export function rangeWidth(r: DateRange, pxPerDay: number): number {
  return rangeDays(r) * pxPerDay;
}

export function dateToX(date: string, rangeStart: string, pxPerDay: number): number {
  return daysBetween(rangeStart, date) * pxPerDay;
}

export function xToDate(x: number, rangeStart: string, pxPerDay: number): string {
  return addDays(rangeStart, Math.floor(x / pxPerDay));
}

// `clientW` in both center helpers is the visible PLOT width — the scroller's
// clientWidth minus the sticky label column. With that convention the label
// offset cancels out of the math entirely (the plot origin and the plot
// viewport are both shifted by LABEL_W).
export function centerDateOf(
  scrollLeft: number,
  clientW: number,
  rangeStart: string,
  pxPerDay: number,
): string {
  return xToDate(scrollLeft + clientW / 2, rangeStart, pxPerDay);
}

export function scrollLeftForCenter(
  date: string,
  clientW: number,
  rangeStart: string,
  pxPerDay: number,
): number {
  return Math.max(0, dateToX(date, rangeStart, pxPerDay) + pxPerDay / 2 - clientW / 2);
}

// Range spanning every date the timeline can show (goal/node spans, milestones,
// today, and optionally the date to keep centered), padded so there's always
// scroll room before the first extension kicks in. Guarantees every bar is
// on-canvas from the start.
export function initialRange(
  zoom: ZoomLevel,
  today: string,
  dates: string[],
  center?: string,
): DateRange {
  const pad = Math.ceil(INITIAL_PAD_PX / PX_PER_DAY[zoom]);
  let min = today;
  let max = today;
  for (const d of center ? [...dates, center] : dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { start: addDays(min, -pad), end: addDays(max, pad) };
}

export interface CanvasSeg {
  start: string;   // first date of the segment (clipped to the range)
  days: number;    // day count within the range
  label: string;
  major?: boolean; // heavier divider: year boundary (months) / week start, 1st (days)
}

// One segment per calendar month intersecting the range, first/last clipped to
// the range edges so x positions stay exact. January carries the year.
export function monthSegments(range: DateRange): CanvasSeg[] {
  const segs: CanvasSeg[] = [];
  const first = parseD(range.start);
  let d = new Date(first.getFullYear(), first.getMonth(), 1);
  while (iso(d) <= range.end) {
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const start = iso(d) < range.start ? range.start : iso(d);
    const end = iso(monthEnd) > range.end ? range.end : iso(monthEnd);
    segs.push({
      start,
      days: daysBetween(start, end) + 1,
      label: d.getMonth() === 0 ? `Jan ${d.getFullYear()}` : MO[d.getMonth()],
      major: d.getMonth() === 0,
    });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return segs;
}

// One segment per day; `major` marks week starts (Sunday, matching weekDates)
// and month firsts.
export function daySegments(range: DateRange): CanvasSeg[] {
  const segs: CanvasSeg[] = [];
  const n = rangeDays(range);
  let day = range.start;
  for (let i = 0; i < n; i++) {
    const dt = parseD(day);
    segs.push({
      start: day,
      days: 1,
      label: String(dt.getDate()),
      major: dt.getDay() === 0 || dt.getDate() === 1,
    });
    day = addDays(day, 1);
  }
  return segs;
}

