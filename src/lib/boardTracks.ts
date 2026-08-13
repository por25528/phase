/**
 * How wide each horizon column is, given what it holds.
 *
 * Four equal columns were the board's geometry for as long as it had one, and
 * with five goals in Someday and nothing committed that spent three quarters
 * of the width on the words "Nothing here". This is the same failure that sank
 * the budget line, recorded in `ideas/vision.md` open question 3: *each life
 * got 93px of a 307px cell while three empty horizons kept 307px each.*
 */

/**
 * The largest floor at which four populated columns still fit the 920px
 * breakpoint where the wide board begins: 4 × 200 + 3 × 14 = 842, leaving the
 * page gutter. Pinned by a test, because the relationship is the point.
 */
export const COLUMN_FLOOR_PX = 200;

/** The smallest track on which `Someday` sets on one line beside its count. */
export const EMPTY_TRACK_PX = 88;

/** The board's column gap, in the arithmetic above and in `Goals.tsx`. */
export const COLUMN_GAP_PX = 14;

/**
 * `grid-template-columns` for the board.
 *
 * **While dragging, every column is equal.** `handleDragOver` already moves ids
 * between columns live so cards part to show the drop target, so a width that
 * tracked card count would reflow continuously under the cursor — and an empty
 * Now, the single most important drop target on the board, would be the
 * narrowest thing on screen at the exact moment you need to hit it. One
 * transition at each end of the drag, not continuous reflow.
 */
export function columnTracks(counts: number[], opts: { dragging: boolean }): string {
  if (opts.dragging) return counts.map(() => 'minmax(0, 1fr)').join(' ');
  return counts
    .map((n) => (n === 0 ? `${EMPTY_TRACK_PX}px` : `minmax(${COLUMN_FLOOR_PX}px, ${n}fr)`))
    .join(' ');
}
