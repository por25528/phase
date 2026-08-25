import type { BusyBlock, GoalNode } from '../db/types';
import { addBlock, clearBlocks, makeBlock, setOnlyBlock } from '../lib/blocks';
import { freeIntervals, NO_PAST_LIMIT, SLOT_GRANULARITY_MIN, WHOLE_DAY, type PlacedSpan } from '../lib/slot';
import { weekOf } from '../lib/plan';

/**
 * The single writer for a leaf's ONE sitting.
 *
 * A leaf can hold several now, so this is the "replace whatever is there with
 * this" write — what a drag from the rail, a `1`-`7` placement and a Today/
 * Tomorrow button all mean. Adding a sitting beside the existing ones is
 * `addPlannedSlot`, and the two are separate functions rather than a boolean
 * because "move it" and "sit again" are different intents and a flag would let
 * a caller pick the wrong one silently.
 *
 * `plannedWeek` moves with it. The week is the COMMITMENT, and placing work on
 * a Wednesday is committing to that Wednesday's week — routing every write
 * through here is what stops the two from disagreeing.
 */
export function setPlannedSlot(node: GoalNode, day: string, startMin: number, minutes: number): void {
  node.plannedWeek = weekOf(day);
  setOnlyBlock(node, makeBlock(day, startMin, minutes));
}

/** A second (or fifth) sitting for the same leaf, leaving the others alone. */
export function addPlannedSlot(node: GoalNode, day: string, startMin: number, minutes: number): void {
  node.plannedWeek ??= weekOf(day);
  addBlock(node, makeBlock(day, startMin, minutes));
}

/**
 * Remove every sitting AND the week commitment together.
 *
 * Both, because "unschedule" means the work is not happening — leaving the week
 * behind would drop the leaf into the rail's "to place" bucket, which reads as
 * a commitment the user has just withdrawn.
 */
export function clearPlannedSlot(node: GoalNode): void {
  delete node.plannedWeek;
  clearBlocks(node);
}

export interface ClampResizeInput {
  date: string;
  startMin: number;      // where the block currently starts — unchanged by a resize
  requestedMin: number;  // the duration the drag is asking for
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
 *
 * `WHOLE_DAY`, not the day's availability window: dragging a block's bottom
 * edge past 18:00 was refused by the same fence Job 1 removed from every other
 * placement, and a resize that stopped at a line nothing draws is the friction
 * the user named. The gap cap is unchanged and is the point of the function —
 * a resize still must not be able to create the overlap a drop is forbidden
 * from creating.
 */
export function clampResize(input: ClampResizeInput): number | null {
  const { date, startMin, requestedMin, blocks, placed, allDayBlocks } = input;
  if (!Number.isFinite(requestedMin) || requestedMin <= 0) return null;

  const gap = freeIntervals(date, WHOLE_DAY, blocks, placed, NO_PAST_LIMIT, allDayBlocks)
    .find((g) => startMin >= g.startMin && startMin < g.endMin);
  if (!gap) return null;

  const rounded = Math.round(requestedMin / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
  return Math.min(Math.max(SLOT_GRANULARITY_MIN, rounded), gap.endMin - startMin);
}
