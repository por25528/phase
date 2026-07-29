import type { AvailabilityWindow, BusyBlock } from '../db/types';
import { windowForDate } from './availability';
import type { Interval } from './capacity';

const MINUTES_PER_HOUR = 60;

/** The grid always shows at least 08:00–20:00, so it never collapses to a sliver. */
export const MIN_VISIBLE_START = 480;
export const MIN_VISIBLE_END = 1200;

function floorToHour(minute: number): number {
  return Math.floor(minute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}
function ceilToHour(minute: number): number {
  return Math.ceil(minute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}

/**
 * The hours the grid draws: the union of the week's availability windows and
 * its TIMED calendar events, expanded outward to whole hours, then expanded
 * again if needed to include 08:00–20:00.
 *
 * All-day events are excluded on purpose: they typically span 0..1440, so
 * including them would stretch every week containing one to a full 24 hours.
 * Whether all-day events consume capacity is a separate question, already
 * handled by `freeIntervals` — this function is only about visible geometry.
 */
export function visibleRange(
  dates: string[],
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
): Interval {
  let startMin = MIN_VISIBLE_START;
  let endMin = MIN_VISIBLE_END;

  for (const date of dates) {
    const w = windowForDate(date, windows);
    if (!w) continue;
    startMin = Math.min(startMin, w.startMin);
    endMin = Math.max(endMin, w.endMin);
  }

  const dateSet = new Set(dates);
  for (const b of blocks) {
    if (!dateSet.has(b.date)) continue;
    if (b.allDay) continue; // see doc comment — never widens the grid
    startMin = Math.min(startMin, b.startMin);
    endMin = Math.max(endMin, b.endMin);
  }

  return { startMin: floorToHour(startMin), endMin: ceilToHour(endMin) };
}

/** Vertical position of `minute` within `range`, as a percentage. */
export function minuteToPct(minute: number, range: Interval): number {
  return ((minute - range.startMin) / (range.endMin - range.startMin)) * 100;
}

/** Inverse of `minuteToPct` — used to turn a drop position into a time. */
export function pctToMinute(pct: number, range: Interval): number {
  return range.startMin + (pct / 100) * (range.endMin - range.startMin);
}

/** Every whole hour the axis should label, inclusive of both ends. */
export function hourMarks(range: Interval): number[] {
  const out: number[] = [];
  for (let m = ceilToHour(range.startMin); m <= range.endMin; m += MINUTES_PER_HOUR) out.push(m);
  return out;
}
