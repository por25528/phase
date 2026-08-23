import { pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core';

/**
 * Which droppable the thing in the air is over — the pointer decides, and the
 * rects decide when there is no pointer.
 *
 * Spent by BOTH boards that need it: the Goals board (`views/Goals.tsx`) and
 * the week calendar (`views/Plan.tsx`). The name is historical — it was written
 * for the board and the calendar carried a byte-for-byte copy of it, with its
 * own twenty lines of the same reasoning, until the two were merged here. It is
 * not board-specific and nothing in it knows what a bay or a day column is.
 *
 * **`closestCorners` cannot see an empty bay, and the Instrument board is what
 * made that fatal.** A bay is stretched to the height of the tallest column
 * beside it (`items-stretch` + `flex-1` in `views/goals/Column.tsx`) so its
 * hatched tail reaches the bottom of the sheet and there is something to drop
 * onto below the last card. That made every column droppable ~800px tall while
 * a card stayed ~120px, and `closestCorners` scores a droppable by the MEAN
 * distance to its four corners: a bay's two bottom corners sit ~670px below the
 * card in flight and drag its score down, so a compact card rect in the column
 * the drag STARTED in beats the bay the pointer is genuinely inside. The winner
 * was the dragged card's own droppable, `from === to`, and the card snapped
 * home. Measured, not reasoned: 316 for the card against 355 for the bay.
 *
 * A bay with cards in it was never affected — one of those cards is a droppable
 * in the TARGET column, so the move landed. That is why `Someday` accepted
 * drops and `Next` and `Later`, the two empty horizons, did not; and why
 * aiming at `Later` could quietly deposit the card in `Next`, whose stale-free
 * but badly-scored rect happened to win instead.
 *
 * So the pointer decides. `pointerWithin` returns every rect the cursor is
 * inside, nearest-centre first, which gives the two answers the board needs
 * from one rule: over a card it returns the card (the insertion point, so a
 * reorder still works), and over bare bay — an empty horizon, or the hatched
 * tail under the last card — it returns the bay. On the calendar it gives the
 * day column under the cursor, and `handleDragMove`/`handleDragEnd` resolve the
 * minute themselves from the ghost's own rect.
 *
 * **`rectIntersection` is the fallback because `KeyboardSensor` has no
 * pointer.** `pointerWithin` returns `[]` whenever `pointerCoordinates` is
 * null, and that is every keyboard drag: the activator is a `KeyboardEvent`,
 * `getEventCoordinates` has no `clientX`/`clientY` to read from it, and the
 * resulting null propagates all the way to `over`. A bare `pointerWithin` would
 * therefore make the `KeyboardSensor` registered in BOTH callers inert —
 * silently, because each one's drop handler guards on `e.over` and simply bails.
 * `rectIntersection` needs no pointer: it compares the dragging node's own
 * (translated) rect against the droppable rects, which is exactly right for the
 * keyboard case, where arrow keys move the dragging node rather than a cursor.
 * This is dnd-kit's own documented composite pattern for mixing sensor types
 * under one `collisionDetection`. **Do not simplify it back to bare
 * `pointerWithin`** — that regresses keyboard drops on both surfaces at once,
 * which is the cost of the two copies having become one.
 *
 * There is deliberately no third `closestCorners` step: with nothing under the
 * pointer and nothing intersecting, the honest answer is that the card is off
 * the sheet and no drop is meant — a nearest-anything fallback is what put the
 * card somewhere nobody aimed at in the first place.
 *
 * Module scope, not an inline arrow at either `DndContext`: it is pure, and an
 * inline arrow would hand dnd-kit a new function identity on every render.
 *
 * `views/project/BoardTab.tsx` runs the same four-column pattern on
 * `closestCorners` and is NOT affected: its columns are `items-start` with a
 * `min-h-[120px]`, so an empty one is card-sized and its corners are close.
 * Height is the whole difference, which is worth knowing before that board
 * grows a full-height tail of its own.
 */
export const boardCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : rectIntersection(args);
};
