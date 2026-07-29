import type { Interval } from '../../lib/capacity';
import { pctToMinute } from '../../lib/grid';

/** What a draggable carries. `goalId` is null for tasks. */
export interface PlanDragData {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
}

/**
 * The minute a drop is aiming at, given the Y position of the TOP EDGE of the
 * thing being dragged (`draggedTop`) — not the pointer's Y. A block is
 * grabbed anywhere along its body, but its top edge is what the user sees
 * lined up against the hour grid in the drag ghost, so that edge — not the
 * grab point — is the aim basis. Callers derive `draggedTop` from
 * `active.rect.current.initial.top + delta.y`, both scroll-adjusted the same
 * way `rectTop` (from `over.rect`) is.
 *
 * Clamped to the range: a drop released above or below the column still means
 * "the earliest/latest time shown" rather than an out-of-range minute that
 * resolveSlot would silently push somewhere surprising.
 */
export function aimMinuteFor(
  draggedTop: number,
  rectTop: number,
  rectHeight: number,
  range: Interval,
): number {
  if (rectHeight <= 0) return range.startMin;
  const pct = ((draggedTop - rectTop) / rectHeight) * 100;
  const minute = pctToMinute(pct, range);
  return Math.round(Math.min(Math.max(minute, range.startMin), range.endMin));
}
