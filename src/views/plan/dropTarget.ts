import { pxToMinute, DAY_START_MIN, DAY_END_MIN } from '../../lib/grid';

/** What a draggable carries. `goalId` is null for tasks. */
export interface PlanDragData {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
}

export interface AimInput {
  /**
   * Viewport Y of the TOP EDGE of the thing being dragged — not the pointer.
   * A block is grabbed anywhere along its body, but its top edge is what the
   * user sees lined up against the hour grid, so that edge is the aim basis.
   * Callers read `active.rect.current.translated.top` — dnd-kit's
   * `collisionRect`, which with a `DragOverlay` is where the ghost is drawn.
   *
   * NOT `initial.top + delta.y`. `delta` is `scrollAdjustedTranslate`, so it
   * already carries the scroll of the over-node's scrollable ancestors, and
   * adding the scroller's own `scrollTop` below would count it twice.
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
 * and it is sound to add precisely because the caller's Y carries no scroll of
 * its own. That is the whole reason `translated` is the required input: dnd-kit's
 * `delta` is `scrollAdjustedTranslate` and already contains the scroll, so
 * deriving the Y from it would double-count regardless of whether the other
 * operands were live or stale.
 *
 * This is what makes `autoScroll` safe to re-enable on the DndContext.
 */
export function aimMinuteFor(input: AimInput): number {
  const { draggedTopViewport, scrollerTopViewport, scrollTop, gridOffsetPx } = input;
  const contentY = draggedTopViewport - scrollerTopViewport + scrollTop - gridOffsetPx;
  const minute = pxToMinute(contentY);
  return Math.round(Math.min(Math.max(minute, DAY_START_MIN), DAY_END_MIN));
}
