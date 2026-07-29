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

/**
 * A sentinel `Now` far enough in the past that it never clamps. Passing this
 * to `remainingWindow` (via `freeIntervals`/`resolveSlot`) disables its
 * past-clamping for any real date — the whole day's window is treated as
 * still ahead, whatever the actual wall clock says.
 *
 * Used wherever the caller is re-deriving or adjusting a commitment the user
 * already made, rather than placing brand-new work against "right now": the
 * migration re-homing old data, and a resize of something already scheduled
 * earlier today. Resizing a 09:00 block must stay possible at 14:00 — clamping
 * to the real clock would report no gap at all and silently refuse the edit.
 */
export const NO_PAST_LIMIT: Now = { date: '1970-01-01', minute: 0 };

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

export interface ResolveSlotInput {
  date: string;
  aimMin: number;        // where the user pointed, or where a migration starts looking
  durationMin: number;
  windows: AvailabilityWindow[];
  blocks: BusyBlock[];
  placed: PlacedSpan[];
  now: Now;
  allDayBlocks: boolean;
}

/**
 * The start minute a block should take on `date`, or null if it does not fit.
 *
 * The aim is snapped to SLOT_GRANULARITY_MIN BEFORE the search; the winning
 * candidate is then clamped inside its gap and returned as-is. A clamped result
 * can therefore be off-grid — that is intended. Rounding after clamping would
 * be a bug: rounding up can push the block past the end of the very gap that
 * accepted it.
 *
 * Ties are broken toward the earlier start without an explicit tie-break
 * clause: freeIntervals returns gaps ascending and disjoint, so candidate
 * start times strictly increase as the loop proceeds. On an exact distance
 * tie the earlier gap has therefore already won — a strict `<` comparison
 * keeps it and lets the later, equally-distant candidate fail to displace it.
 */
export function resolveSlot(input: ResolveSlotInput): number | null {
  const { date, durationMin, windows, blocks, placed, now, allDayBlocks } = input;
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;

  const aim = Math.round(input.aimMin / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
  const gaps = freeIntervals(date, windows, blocks, placed, now, allDayBlocks);

  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const gap of gaps) {
    if (gap.endMin - gap.startMin < durationMin) continue;
    const candidate = Math.min(Math.max(aim, gap.startMin), gap.endMin - durationMin);
    const distance = Math.abs(candidate - aim);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}
