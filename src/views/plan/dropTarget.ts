import type { Interval } from '../../lib/capacity';
import { pxToMinute, pctToMinute, DAY_START_MIN, DAY_END_MIN } from '../../lib/grid';

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
 *
 * Transitional: this is the pre-scroller, range-relative aim function, kept
 * alongside `aimMinuteFor` only because `Plan.tsx`'s grid is still the old
 * fixed-height, non-scrolling one. Task 7 turns the grid into a real
 * scroller, rewires `handleDragEnd` to call `aimMinuteFor` instead, and
 * deletes this function.
 */
export function aimMinuteInRange(
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

export interface AimInput {
  /**
   * Viewport Y of the TOP EDGE of the thing being dragged — not the pointer.
   * A block is grabbed anywhere along its body, but its top edge is what the
   * user sees lined up against the hour grid, so that edge is the aim basis.
   * Callers derive it from `active.rect.current.initial.top + delta.y`.
   */
  draggedTopViewport: number;
  /** Live `getBoundingClientRect().top` of the grid's scroller. */
  scrollerTopViewport: number;
  /** Live `scrollTop` of that same scroller. */
  scrollTop: number;
  /** Offset of the hour grid inside the scroller's content — the sticky day headings and all-day lane. */
  gridOffsetPx: number;
}

/**
 * The minute a drag is aiming at, in the grid's own content coordinates.
 *
 * The previous version worked in viewport coordinates against a droppable rect
 * measured at drag start, and carried a comment forbidding a live rect because
 * pairing a live rect with a start-of-drag delta double-counts scroll. That
 * whole problem was a symptom of a fixed-height grid: there was no vertical
 * scroll, so viewport space and content space were the same space.
 *
 * They are not the same space any more. `scrollTop` is what reconciles them,
 * and taking it live alongside a live scroller rect is consistent precisely
 * because BOTH are live — the double-counting the old comment warned about
 * came from mixing one live measurement with one stale one.
 *
 * This is what makes `autoScroll` safe to re-enable on the DndContext.
 */
export function aimMinuteFor(input: AimInput): number {
  const { draggedTopViewport, scrollerTopViewport, scrollTop, gridOffsetPx } = input;
  const contentY = draggedTopViewport - scrollerTopViewport + scrollTop - gridOffsetPx;
  const minute = pxToMinute(contentY);
  return Math.round(Math.min(Math.max(minute, DAY_START_MIN), DAY_END_MIN));
}
