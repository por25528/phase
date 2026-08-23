import type { BusyBlock } from '../db/types';
import { MINUTES_PER_DAY } from './availability';
import {
  mergeIntervals,
  normalizeEstimate,
  remainingSpan,
  type Interval,
  type Now,
} from './capacity';

/** Height of a block whose step carries no usable estimate. */
export const DEFAULT_SLOT_MIN = 60;

/** Start times are snapped to this grid before searching for a gap. */
export const SLOT_GRANULARITY_MIN = 5;

/**
 * Re-exported from `capacity`, where it now lives next to `Now` and
 * `remainingWindow` — the clamp it switches off. `weekCapacity` needs it too,
 * to report what a past day's window WAS rather than what is left of it, and
 * `slot` already imports from `capacity`, so keeping the definition here would
 * have made that dependency circular.
 */
export { NO_PAST_LIMIT } from './capacity';

/**
 * Every minute of the day — the region a MANUAL placement searches.
 *
 * This constant is the whole of Job 1. `resolveSlot` used to take
 * `AvailabilityWindow[]` and refuse anything outside the day's window, so the
 * same setting that priced the week also decided whether a drop was allowed;
 * "remove working hours so I can place a block anywhere" is that gate and
 * nothing else. It cannot be reinstated by accident either — availability is
 * no longer reachable from this function's arguments at all, so a caller that
 * wants the window has to name it (only the two REPLAN paths do, and they are
 * automatic rather than manual).
 *
 * What survives untouched is COLLISION handling. `freeIntervals` still
 * subtracts calendar events and work already placed, and `resolveSlot` still
 * slides a block to the nearest gap that fits. Removing the fence widened the
 * region; it did not make two bars able to claim the same minutes.
 */
export const WHOLE_DAY: Interval = Object.freeze({ startMin: 0, endMin: MINUTES_PER_DAY });

/**
 * The span an AUTOMATIC placement aims inside: 08:00–20:00.
 *
 * This is what is left of working hours, and it is deliberately the smallest
 * thing that could be left. It is NOT a fence — every manual route still
 * passes `WHOLE_DAY`, so a drag, a drawn block and a `1`-`7` keypress all land
 * at any minute of any day. It is NOT a setting: nothing edits it, because a
 * number a person can change is a number that has to be explained, drawn and
 * defended, which is the model that was just removed. And it is NOT drawn:
 * `DayColumn` marks nothing outside it.
 *
 * What it IS: the region searched when the APP is choosing the hour — a
 * replan, a slot migration, a booking made from a distance. Without it those
 * paths would search `WHOLE_DAY` from minute 0 and book 4am, which is not a
 * recovery.
 */
export const ORDINARY_DAY: Interval = Object.freeze({ startMin: 8 * 60, endMin: 20 * 60 });

/**
 * Where a placement made FROM A DISTANCE should point on `date`.
 *
 * A drag and a drawn block carry their own aim — the minute the pointer was
 * over. `ScheduleMenu`'s "Today", the backlog's `1`-`7`, a month-cell drop and
 * Today's free-time offer carry none: they name a DAY and leave the hour to
 * be chosen. That used to be spelled `aimMin: 0` and it worked only because
 * the availability window fenced the search — with the fence gone, 0 means
 * midnight and every one of those verbs would book 00:00.
 *
 * So `ORDINARY_DAY` is the AIM rather than a gate: point there, and let the
 * gap search move off it if the hour is taken. Every day answers the same way
 * now — there are no days off to make an exception for — and nothing is
 * refused for being outside it, because nothing is refused any more.
 *
 * Today is clamped forward to the clock. Not because the past is forbidden (a
 * drag onto this morning is allowed, and is how you record what actually
 * happened) but because "put this on today" said at 3pm cannot mean 8am: the
 * aim is the only thing left that carries that intent.
 */
export function aimFor(date: string, now: Now): number {
  return date === now.date
    ? Math.max(ORDINARY_DAY.startMin, now.minute)
    : ORDINARY_DAY.startMin;
}

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
 * The disjoint, ascending free gaps on `date`: `span` minus calendar events
 * minus work already placed.
 *
 * `span` was `AvailabilityWindow[]` and this function looked the day's window
 * up itself, which is what made availability a fence. It is now a REGION the
 * caller chooses: `WHOLE_DAY` for a manual placement, `ORDINARY_DAY` for the
 * automatic paths that propose hours on your behalf.
 *
 * Busy blocks and placed spans are merged together before subtraction — two
 * overlapping meetings must contribute their UNION, or the overlap is
 * subtracted twice and free time is understated (same reasoning as
 * `freeMinutes` in capacity.ts, which this deliberately mirrors).
 */
export function freeIntervals(
  date: string,
  span: Interval | null,
  blocks: BusyBlock[],
  placed: PlacedSpan[],
  now: Now,
  allDayBlocks: boolean,
): Interval[] {
  const win = remainingSpan(date, span, now);
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

/**
 * The widest unbooked RUN inside `span` on `date`, in minutes. `0` when the
 * span is entirely taken.
 *
 * This is the one measure of "does this day have room in it", and both callers
 * that ask spend it: Today's offer, deciding which day to name, and the week
 * grid's drag chip, deciding whether the bar under the cursor will fit. Two
 * surfaces answering that question with two derivations is how a heading comes
 * to read `fits` above a column that then refuses the drop.
 *
 * It reports a RUN and never a sum. Three separate half-hours are not an hour
 * of room, and a figure that added them up would promise a sitting that cannot
 * be placed — which is exactly the false promise `resolveSlot` would then have
 * to break.
 */
export function longestFreeGap(
  date: string,
  span: Interval | null,
  blocks: BusyBlock[],
  placed: PlacedSpan[],
  now: Now,
  allDayBlocks: boolean,
): number {
  return freeIntervals(date, span, blocks, placed, now, allDayBlocks)
    .reduce((widest, gap) => Math.max(widest, gap.endMin - gap.startMin), 0);
}

export interface ResolveSlotInput {
  date: string;
  aimMin: number;        // where the user pointed, or where a migration starts looking
  durationMin: number;
  /** The region to search. `WHOLE_DAY` unless something is PROPOSING an hour. */
  span: Interval | null;
  blocks: BusyBlock[];
  placed: PlacedSpan[];
  now: Now;
  allDayBlocks: boolean;
}

/**
 * The start minute a block should take on `date`, or null if it does not fit.
 *
 * "Does not fit" now means one thing only: every gap in `span` that is clear
 * of existing work is shorter than `durationMin`. With `WHOLE_DAY` that is a
 * day booked solid, which is rare and real — it is NOT "outside your working
 * hours", which is what it used to mean and what Job 1 removed.
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
  const { date, durationMin, span, blocks, placed, now, allDayBlocks } = input;
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;

  const aim = Math.round(input.aimMin / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
  const gaps = freeIntervals(date, span, blocks, placed, now, allDayBlocks);

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
