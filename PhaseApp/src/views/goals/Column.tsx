import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { RULE_H, RuleHeader } from '../../components/RuleHeader';

/**
 * One horizon, as a ruled bay.
 *
 * The header used to be a word and a count with `ml-auto` between them, above a
 * 140px box that was either cards or the word "Nothing here". In a column that
 * had grown to 714px the count sat 700px from the label it belonged to, and
 * three of the four bays were a void with a hairline down one side.
 *
 * Now the divider IS the header (`RuleHeader`) and the void is MATERIAL. The
 * bays share their hairlines — the board grid closes its gap and each column
 * carries a `border-r` — so the four rule headers join into one line across the
 * sheet, and everything a bay does not fill is hatched.
 *
 * **The tail is hatched, not just the empty bays.** A bay holding one card
 * beside a bay holding three has more unclaimed area than an empty one does,
 * so hatching only the empty ones would have left the board's largest void
 * untouched while dressing its smallest. One rule instead: the cards sit at the
 * top of the bay and the hatch runs from the last card to the bottom edge — the
 * same move Today makes with the tail below its last row.
 *
 * An empty bay is that rule with the cards taken away, and it paints the hatch
 * on the bay ITSELF rather than on a tail under nothing. Not a saving: the
 * narrow switcher still says "Nothing here" in an empty horizon, and with a
 * tail element that sentence would have sat in a clear band with the material
 * beginning below it — the words and the surface they are about, separated.
 */
export function Column({
  col,
  index,
  ids,
  children,
  solo,
  slim,
  nowLimit,
}: {
  col: { id: string; label: string };
  index: number;
  ids: string[];
  children: React.ReactNode;
  solo?: boolean; // rendered alone in the narrow horizon switcher → full width, no divider
  slim?: boolean; // wide board, nothing in the column → the hatch is the whole answer
  nowLimit: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const isNow = index === 0;
  const over = isNow && ids.length > nowLimit;
  const empty = ids.length === 0;

  return (
    <section
      className={`flex flex-col min-w-0 ${solo ? 'w-full' : 'border-r border-line last:border-r-0'}`}
    >
      <RuleHeader
        label={col.label}
        // Mono and tabular, as it always was — what changed is where it sits.
        // `Now` alone states the limit as well as the count, because that is
        // the one column with a cap; the gauge in the page header draws the
        // same ratio, and both read it off `nowLimit`.
        right={isNow ? `${ids.length} / ${nowLimit}` : String(ids.length)}
        rightClassName={`font-mono text-micro ${over ? 'text-warn font-semibold' : 'text-muted'}`}
        className={RULE_H}
      />
      {/* The droppable is the whole bay, tail included. `flex-1` against the
          board's `items-stretch` is what gives an under-filled column the
          height of the tallest one beside it — without it the hatch would stop
          where the cards do and there would be nothing to drop onto below. */}
      <div
        ref={setNodeRef}
        className={`flex flex-col flex-1 min-h-[140px] transition-colors ${
          empty ? 'hatch' : ''
        } ${isOver ? 'bg-hover' : ''}`}
      >
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div
            className={`grid gap-[11px] ${empty ? '' : 'p-[12px]'}`}
            /* auto-FIT, not auto-fill. `auto-fill` keeps the tracks it creates
               even when nothing lands in them, so a lone card drew at its 188px
               floor beside two dead tracks and wrapped its title to three lines
               fighting the due chip. `auto-fit` collapses the empties and gives
               the row back to the cards that exist — which is what
               `BoardTab.tsx`'s identical grid has always done. The 11px gap is
               `CARD_GAP_PX` in `lib/boardTracks.ts`, where the track cap spends
               it; it stays a literal here because Tailwind cannot read a
               constant. */
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(188px, 1fr))' }}
          >
            {children}
            {/* No dashed box. A dashed border is the app's DROP-TARGET signal —
                it is what `DayColumn` draws while something is in the air — and
                spending it on "nothing is here" in four columns at once is how
                it stops meaning anything.
                What replaced the emptiness is the 45° hatch on this bay: a
                gradient,
                which is why it can fill four bays at once without ever being
                mistaken for the dashed signal, and why it survives untouched
                while `bg-hover` paints over it the moment a card is dragged in.
                The words went with it on the wide board — a hatched bay under a
                rule tag reading `Later · 0` has already said everything
                "Nothing here" said, four times over. They stay in the narrow
                switcher, where one bay fills the screen and a hatch with no
                words in it would read as a rendering fault. */}
            {empty && !slim && (
              <p className="min-h-[80px] pt-[22px] text-faint text-meta text-center px-[10px]">
                Nothing here
              </p>
            )}
          </div>
          {/* The tail, from the last card to the bottom edge. Only when there
              IS a last card: an empty bay hatches the whole droppable above
              instead, so the narrow switcher's "Nothing here" sits ON the
              material rather than floating in a clear band above it.
              `aria-hidden` either way — it says nothing the rule tag's count
              has not already said; it is the bay's material, not a row. */}
          {!empty && <div aria-hidden="true" className="flex-1 hatch" />}
        </SortableContext>
      </div>
    </section>
  );
}
