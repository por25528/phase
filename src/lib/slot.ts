import type { AvailabilityWindow, BusyBlock } from '../db/types';
import {
  mergeIntervals,
  normalizeEstimate,
  remainingWindow,
  type Interval,
  type Now,
} from './capacity';

/** Height of a block whose step carries no usable estimate. */
export const DEFAULT_SLOT_MIN = 60;

/** Start times are snapped to this grid before searching for a gap. */
export const SLOT_GRANULARITY_MIN = 5;

/** A span already occupying part of a day. */
export interface PlacedSpan {
  startMin: number;
  endMin: number;
}

/**
 * How tall a block is. An absent or unusable estimate yields DEFAULT_SLOT_MIN;
 * the caller renders that case with a dashed border so a guessed hour never
 * reads as a real estimate.
 */
export function durationOf(estimateMin: number | undefined): number {
  return normalizeEstimate(estimateMin) ?? DEFAULT_SLOT_MIN;
}

/**
 * The disjoint, ascending free gaps on `date`: the remaining availability
 * window minus calendar events minus work already placed.
 *
 * Busy blocks and placed spans are merged together before subtraction — two
 * overlapping meetings must contribute their UNION, or the overlap is
 * subtracted twice and free time is understated (same reasoning as
 * `freeMinutes` in capacity.ts, which this deliberately mirrors).
 */
export function freeIntervals(
  date: string,
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  placed: PlacedSpan[],
  now: Now,
  allDayBlocks: boolean,
): Interval[] {
  const win = remainingWindow(date, windows, now);
  if (!win) return [];

  const dayBlocks = blocks.filter((b) => b.date === date && (allDayBlocks || !b.allDay));
  if (dayBlocks.some((b) => b.allDay)) return []; // an all-day event consumes the day

  const busy = mergeIntervals([
    ...dayBlocks.map((b) => ({ startMin: b.startMin, endMin: b.endMin })),
    ...placed.map((p) => ({ startMin: p.startMin, endMin: p.endMin })),
  ]);

  const out: Interval[] = [];
  let cursor = win.startMin;
  for (const b of busy) {
    if (b.endMin <= cursor) continue;      // entirely behind the cursor
    if (b.startMin >= win.endMin) break;   // past the window — nothing left to cut
    if (b.startMin > cursor) out.push({ startMin: cursor, endMin: Math.min(b.startMin, win.endMin) });
    cursor = Math.max(cursor, b.endMin);
    if (cursor >= win.endMin) break;
  }
  if (cursor < win.endMin) out.push({ startMin: cursor, endMin: win.endMin });

  return out.filter((i) => i.endMin > i.startMin);
}
