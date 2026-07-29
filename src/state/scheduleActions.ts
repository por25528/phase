import type { AvailabilityWindow, BusyBlock, GoalNode } from '../db/types';
import { freeIntervals, NO_PAST_LIMIT, SLOT_GRANULARITY_MIN, type PlacedSpan } from '../lib/slot';
import { weekOf } from '../lib/plan';

/**
 * The single writer for a scheduled slot.
 *
 * `plannedWeek` is fully derivable from `plannedDay` and is kept only to avoid
 * a 31-site refactor (see the spec). Routing every write through here — and
 * never assigning the three fields separately — is what stops the two from
 * ever disagreeing. Its sibling test is the guard.
 */
export function setPlannedSlot(node: GoalNode, day: string, startMin: number): void {
  node.plannedWeek = weekOf(day);
  node.plannedDay = day;
  node.plannedStartMin = startMin;
}

/** Remove all three together — a partial clear would leave an illegal half-state. */
export function clearPlannedSlot(node: GoalNode): void {
  delete node.plannedWeek;
  delete node.plannedDay;
  delete node.plannedStartMin;
}

export interface ClampResizeInput {
  date: string;
  startMin: number;      // where the block currently starts — unchanged by a resize
  requestedMin: number;  // the duration the drag is asking for
  windows: AvailabilityWindow[];
  blocks: BusyBlock[];
  placed: PlacedSpan[];  // MUST exclude the block being resized
  allDayBlocks: boolean;
}

/**
 * The largest duration a block at `startMin` may take without colliding, or
 * null if the request is nonsense or the block sits outside any free gap.
 *
 * A resize must not be able to create the overlap a drop is forbidden from
 * creating, so the requested duration is clamped to the gap the block occupies.
 * The gap cap is applied LAST, after the 5-minute floor: when fewer than 5
 * minutes remain in the gap, flooring first and capping second would let the
 * floor win and return a duration that overlaps the next block. The cap must
 * always have the final say, even if that means returning less than
 * SLOT_GRANULARITY_MIN.
 *
 * `NO_PAST_LIMIT` is used deliberately: resizing something already scheduled at
 * 09:00 must stay possible at 14:00, and the real clock's past-clamp would
 * otherwise report no gap at all.
 */
export function clampResize(input: ClampResizeInput): number | null {
  const { date, startMin, requestedMin, windows, blocks, placed, allDayBlocks } = input;
  if (!Number.isFinite(requestedMin) || requestedMin <= 0) return null;

  const gap = freeIntervals(date, windows, blocks, placed, NO_PAST_LIMIT, allDayBlocks)
    .find((g) => startMin >= g.startMin && startMin < g.endMin);
  if (!gap) return null;

  const rounded = Math.round(requestedMin / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
  return Math.min(Math.max(SLOT_GRANULARITY_MIN, rounded), gap.endMin - startMin);
}
