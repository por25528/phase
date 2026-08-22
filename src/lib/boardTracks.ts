/**
 * How wide each horizon column is, given what it holds.
 *
 * Four equal columns were the board's geometry for as long as it had one, and
 * with five goals in Someday and nothing committed that spent three quarters
 * of the width on the words "Nothing here". This is the same failure that sank
 * the budget line, recorded in `ideas/vision.md` open question 3: *each life
 * got 93px of a 307px cell while three empty horizons kept 307px each.*
 *
 * The rule is **a column claims width in proportion to what it holds, capped
 * at what it can actually draw** — and until now only the first half was true.
 * A `{n}fr` track takes every leftover pixel, so the single populated column of
 * a sparse board grew to ~714px of 1100 and then drew one 188px card in it,
 * stranded beside two dead tracks its own inner `auto-fill` grid had created.
 * The cap below is the second half, and `Column.tsx`'s `auto-fit` is what
 * stops the card from refusing the room the cap does leave it.
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
 * The widest a board card wants to be, and the gap between two of them.
 *
 * `CARD_MAX_PX` is not a new opinion about cards — it is the width the drag
 * overlay already draws one at (`w-[240px]` in `Goals.tsx`), and comfortably
 * above the 188px floor `Column.tsx`'s inner grid sets. `CARD_GAP_PX`
 * is that grid's `gap-[11px]`, written here because the arithmetic below spends
 * it; the class stays a literal there because Tailwind cannot read a constant.
 */
export const CARD_MAX_PX = 240;
export const CARD_GAP_PX = 11;

/**
 * The most cards a column will set side by side before it starts a second row.
 *
 * Three is where a horizon stops reading as a column and starts reading as a
 * grid of its own — and past it the cap would grow without bound, which is the
 * bug this whole cap exists to close.
 */
export const CARDS_ABREAST_MAX = 3;

/**
 * The widest track a column holding `n` cards can fill.
 *
 * `k` cards abreast at their full width, plus the `k - 1` gaps between them:
 * 240, 491, 742 for one, two and three or more. The column's own padding is
 * deliberately NOT added — it is 14px at the board's base and 18px above `xl`,
 * so folding it in would make the cap a function of the breakpoint. The cost is
 * that a full row of three sits a few pixels under `CARD_MAX_PX` each; the
 * point of the cap is that the track stops growing, not that it lands on an
 * exact pixel.
 */
function columnCap(n: number): number {
  const abreast = Math.min(n, CARDS_ABREAST_MAX);
  return abreast * CARD_MAX_PX + (abreast - 1) * CARD_GAP_PX;
}

/**
 * `grid-template-columns` for the board.
 *
 * **While dragging, every column is equal.** `handleDragOver` already moves ids
 * between columns live so cards part to show the drop target, so a width that
 * tracked card count would reflow continuously under the cursor — and an empty
 * Now, the single most important drop target on the board, would be the
 * narrowest thing on screen at the exact moment you need to hit it. One
 * transition at each end of the drag, not continuous reflow.
 *
 * **At rest there is one more track than there are columns.** Every populated
 * track is capped at `columnCap`, so the remainder has to go somewhere; it goes
 * to a single trailing spacer rather than being shared out among columns that
 * would leave it empty. `Goals.tsx` renders an inert div for it — and renders
 * it only at rest, because the dragging branch emits no spacer track and a
 * fifth child against four tracks would drop into an implicit second row.
 *
 * A capped `minmax(200px, 742px)` still SHRINKS: grid sizes such a track at its
 * min and then grows it into free space up to the max, so the four-populated
 * case at the 920px breakpoint lands at ~219px each rather than overflowing.
 * That is why the cap is written as a `minmax` max and not as a fixed width.
 */
export function columnTracks(counts: number[], opts: { dragging: boolean }): string {
  if (opts.dragging) return counts.map(() => 'minmax(0, 1fr)').join(' ');
  return [
    ...counts.map((n) => (
      n === 0 ? `${EMPTY_TRACK_PX}px` : `minmax(${COLUMN_FLOOR_PX}px, ${columnCap(n)}px)`
    )),
    'minmax(0, 1fr)',
  ].join(' ');
}
