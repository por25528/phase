/**
 * How wide each horizon column is, given what it holds.
 *
 * Four equal columns were the board's geometry for as long as it had one, and
 * with five goals in Someday and nothing committed that spent three quarters
 * of the width on the words "Nothing here". This is the same failure that sank
 * the budget line, recorded in `ideas/vision.md` open question 3: *each life
 * got 93px of a 307px cell while three empty horizons kept 307px each.*
 *
 * The rule is **a column claims no more width than its cards can fill**, and
 * whatever is left over is the sheet's margin rather than another column's
 * padding. `{n}fr` promised proportion and delivered greed: the single
 * populated column of a sparse board took every leftover pixel — ~714px of
 * 1100 — and then drew one 188px card in it, stranded beside two dead tracks
 * its own inner `auto-fill` grid had created. `columnCap` below is the ceiling
 * that ends that, and `Column.tsx`'s `auto-fit` is what stops a card from
 * refusing the room the ceiling does leave it.
 *
 * **It is a ceiling and not a ratio, and the difference is worth knowing.**
 * Under the ceiling, CSS grid hands out free space EQUALLY from a common floor
 * rather than in proportion to card count — a three-card Now and a two-card
 * Next on a 1228px board both land at 374px, because neither is near its cap.
 * The sizes still track content wherever it matters: a column freezes the
 * moment it reaches what it can draw (a one-card Someday stops at 240 and
 * hands the rest back), so the columns that differ VISIBLY in what they hold
 * are exactly the ones the caps separate. Proportionality below the ceiling
 * would need pixel arithmetic against a container width this module cannot
 * see, to widen a column that is already drawing every card it has at full
 * size. This file promised that ratio once and delivered the greed instead;
 * it now promises the ceiling, which is the part that was ever worth having.
 */

/**
 * The floor below which a column is not squeezed, however little it holds.
 *
 * It was chosen as the largest floor at which four populated columns still fit
 * the 920px breakpoint where the wide board begins — 4 × 200 + 3 × 14 = 842
 * under the 14px gaps the board used to carry. The Instrument closed those
 * gaps (`COLUMN_GAP_PX` below), so the same four now come to 4 × 200 + 3 × 0 =
 * 800 and the relationship holds with 120px of slack rather than 78.
 *
 * Deliberately NOT widened to spend that slack. The floor exists so a one-card
 * column is not crushed beside a five-card one, and 200 already clears the
 * 188px minimum `Column.tsx`'s inner grid sets for a card; raising it would
 * only take room from whichever column has the work in it. Pinned by a test,
 * because the relationship is the point.
 */
export const COLUMN_FLOOR_PX = 200;

/** The smallest track on which `Someday` sets on one line beside its count. */
export const EMPTY_TRACK_PX = 88;

/**
 * The board's column gap, in the arithmetic above and in `Goals.tsx`.
 *
 * Zero, and that is the Instrument's doing rather than an oversight. The bays
 * share their hairlines now — each column draws a `border-r` and its rule
 * header runs full-bleed — so a gap between tracks would break the one line
 * across the sheet into four, and separate two cards by a void instead of by a
 * rule. The separation moved INTO the bay as its own 12px padding, which is
 * more space between neighbouring cards than the 14px gap ever gave.
 *
 * Kept as a named constant at 0 rather than deleted: the breakpoint arithmetic
 * above spends it, and a literal 0 there would hide the fact that a gap is a
 * thing this layout has an opinion about.
 */
export const COLUMN_GAP_PX = 0;

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
