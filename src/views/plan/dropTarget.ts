import { pxToMinute, DAY_START_MIN, DAY_END_MIN } from '../../lib/grid';

/** What a draggable carries. `goalId` is null for tasks. */
export interface PlanDragData {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
  /**
   * How long the block will be, from `durationOf`. Carried on the drag so the
   * week's day headings can say whether it fits BEFORE the drop — a refusal
   * after the fact is feedback arriving one action too late, and the user has
   * already let go of the thing they were aiming.
   */
  durationMin: number;
  /**
   * Set when the thing being dragged is an EXISTING sitting, absent when it is
   * a row from the rail.
   *
   * That difference is what tells the drop whether to move a bar or to place
   * the task for the first time — and with several sittings, which bar.
   */
  blockId?: string;
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

/**
 * The minute a live drag is aiming at, or null when the release is not
 * actually over the calendar.
 *
 * ONE function, spent by `onDragMove` (which draws the landing outline) and by
 * `onDragEnd` (which writes). They must not be able to disagree about where
 * the pointer is: an outline resolved from one basis and a drop resolved from
 * another is the same class of defect as a preview that recomputes its slots
 * at apply time, and it would show up as the bar landing a few minutes off
 * where the outline promised — small enough to look like rounding and never be
 * reported.
 *
 * `rect` is `active.rect.current.translated`, dnd-kit's live `collisionRect`
 * and, with a `DragOverlay`, exactly where the ghost is drawn.
 *
 * The null case is the scroller-bounds guard, and it is not a nicety: a day
 * column is a grid item of a 1440px-tall grid inside a 720px scroller, and
 * `getBoundingClientRect` — how dnd-kit measures droppables — is NOT clipped by
 * an ancestor's overflow. Each column's rect therefore reaches hundreds of
 * pixels above and below the visible grid, across the week header and the
 * panels beneath it, so `over` is set for releases plainly not on the calendar.
 */
export function aimFromDrag(input: {
  /** `active.rect.current.translated` — null before the first move. */
  rect: { top: number } | null;
  /** The grid's scroller, live. */
  scroller: HTMLElement | null;
  /** The hour grid inside it. `offsetTop` is scroll-independent. */
  grid: HTMLElement | null;
}): number | null {
  const { rect, scroller, grid } = input;
  if (!rect || !scroller) return null;

  const scrollerRect = scroller.getBoundingClientRect();
  if (rect.top < scrollerRect.top || rect.top > scrollerRect.bottom) return null;

  return aimMinuteFor({
    draggedTopViewport: rect.top,
    scrollerTopViewport: scrollerRect.top,
    scrollTop: scroller.scrollTop,
    gridOffsetPx: grid?.offsetTop ?? 0,
  });
}
