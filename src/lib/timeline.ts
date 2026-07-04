import { parseD, addDays, MO } from './dates';
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

// Preset scales for the Week/Month/Quarter buttons; the actual scale is a
// continuous px-per-day value driven by pinch/ctrl-wheel zoom.
export const PX_PER_DAY: Record<ZoomLevel, number> = { week: 130, month: 40, quarter: 13 };
export const MIN_PX_PER_DAY = 3;
export const MAX_PX_PER_DAY = 260;
// At and above this scale, day columns are wide enough for full day detail
// (the DaysLane header with numbers, task counts, habit dots).
export const DAY_DETAIL_MIN = 48;
export const LABEL_W = 200; // sticky goal-label column width (px)

export function clampScale(n: number): number {
  return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, n));
}

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
  pxPerDay: number,
  today: string,
  dates: string[],
  center?: string,
): DateRange {
  const pad = Math.ceil(INITIAL_PAD_PX / pxPerDay);
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

// Minimal shape the row grid needs — daySegments and rulerTicks both satisfy it.
export interface GridTick { start: string; major?: boolean }

export type RulerUnit = 'day' | 'week' | 'month' | 'year';
export interface RulerTick { start: string; unit: RulerUnit; label?: string }

// A finer graduation appears once its period is wide enough to read:
const WEEK_TICK_MIN_PX = 24;  // Sunday ticks when a week spans ≥ this
const WEEK_LABEL_MIN_PX = 56; // ...and get day-of-month labels at ≥ this
// Per-day graduations — also gates day-scoped decoration like weekend bands.
export const DAY_TICK_MIN_PX = 18;

/**
 * Hierarchical ruler graduations for the range at a continuous scale, like a
 * physical ruler gaining finer tick marks as you zoom in. Every date carries
 * its highest unit: year (Jan 1, labeled with the year) > month (the 1st,
 * labeled) > week (Sundays, once wide enough) > day (once wide enough).
 */
export function rulerTicks(range: DateRange, pxPerDay: number): RulerTick[] {
  const showDays = pxPerDay >= DAY_TICK_MIN_PX;
  const showWeeks = pxPerDay * 7 >= WEEK_TICK_MIN_PX;
  const labelWeeks = pxPerDay * 7 >= WEEK_LABEL_MIN_PX;
  const ticks: RulerTick[] = [];
  const n = rangeDays(range);
  let day = range.start;
  for (let i = 0; i < n; i++) {
    const dt = parseD(day);
    const dom = dt.getDate();
    if (dom === 1 && dt.getMonth() === 0) {
      ticks.push({ start: day, unit: 'year', label: String(dt.getFullYear()) });
    } else if (dom === 1) {
      ticks.push({ start: day, unit: 'month', label: MO[dt.getMonth()] });
    } else if (dt.getDay() === 0 && showWeeks) {
      ticks.push({ start: day, unit: 'week', label: labelWeeks ? String(dom) : undefined });
    } else if (showDays) {
      ticks.push({ start: day, unit: 'day' });
    }
    day = addDays(day, 1);
  }
  return ticks;
}

export interface DayBand { start: string; days: number }

// Sat+Sun bands for weekend shading, clipped to the range (a range opening on
// a Sunday or closing on a Saturday yields a 1-day band).
export function weekendBands(range: DateRange): DayBand[] {
  const bands: DayBand[] = [];
  const n = rangeDays(range);
  let day = range.start;
  for (let i = 0; i < n; i++) {
    const dow = parseD(day).getDay();
    if (dow === 6) {
      bands.push({ start: day, days: i + 1 < n ? 2 : 1 });
    } else if (dow === 0 && i === 0) {
      bands.push({ start: day, days: 1 });
    }
    day = addDays(day, 1);
  }
  return bands;
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

