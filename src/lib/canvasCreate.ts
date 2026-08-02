import { DEFAULT_SLOT_MIN, SLOT_GRANULARITY_MIN } from './slot';
import { pxToMinute, DAY_START_MIN, DAY_END_MIN } from './grid';

/**
 * Below this much pointer travel the gesture is a click, not a drag.
 *
 * Expressed in pixels rather than minutes because it is a property of the
 * hand, not of the schedule. dnd-kit's own PointerSensor uses a 5px activation
 * distance for the same reason, and matching it means the canvas and the
 * blocks agree on what counts as a drag.
 */
export const CLICK_THRESHOLD_PX = 5;

export interface CanvasSpan {
  startMin: number;
  durationMin: number;
}

/** Round to the grain `resolveSlot` already snaps aims to. */
export function snapMinute(minute: number): number {
  return Math.round(minute / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
}

function clampMinute(minute: number): number {
  return Math.min(Math.max(minute, DAY_START_MIN), DAY_END_MIN);
}

/**
 * The block a canvas gesture is describing, from the pointer's anchor and
 * current position in the grid's content coordinates.
 *
 * A click — travel under `CLICK_THRESHOLD_PX` — means a default-length block
 * at that minute, the same thing every calendar does with a click on empty
 * space. Anything longer uses the dragged extent.
 *
 * Both edges are snapped and the result is clamped inside the day, so a drag
 * released past midnight produces a block that ends at midnight rather than
 * one the store will have to refuse.
 */
export function canvasSpan(anchorContentY: number, currentContentY: number): CanvasSpan {
  const isClick = Math.abs(currentContentY - anchorContentY) < CLICK_THRESHOLD_PX;

  if (isClick) {
    const start = clampMinute(snapMinute(pxToMinute(anchorContentY)));
    // Pull the whole block back inside the day rather than truncating it: a
    // click at 23:50 means "an hour of work here", and a 10-minute block is a
    // worse answer than an hour ending at midnight.
    const startMin = Math.min(start, DAY_END_MIN - DEFAULT_SLOT_MIN);
    return { startMin: Math.max(DAY_START_MIN, startMin), durationMin: DEFAULT_SLOT_MIN };
  }

  const a = clampMinute(snapMinute(pxToMinute(anchorContentY)));
  const b = clampMinute(snapMinute(pxToMinute(currentContentY)));
  const startMin = Math.min(a, b);
  const endMin = Math.max(a, b);
  return {
    startMin,
    durationMin: Math.max(SLOT_GRANULARITY_MIN, endMin - startMin),
  };
}
