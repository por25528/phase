import { ruleTag } from './sectionLabel';

/**
 * A divider that carries its own legend, the way a technical drawing does.
 *
 * A section heading and the rule under it have always been two objects here:
 * the label floats on the surface, the hairline sits below it, and the one
 * fact the section reports drifts to the far end on an `ml-auto` — which in a
 * 714px board column put the count 700px from the label it belongs to. This
 * makes them ONE object. The rule is the header: a tinted cell at its left end
 * holds the name, a cell at its right end holds the fact, and the hairline runs
 * the whole width between and beneath them.
 *
 * The voice is `ruleTag` from `sectionLabel.ts` — the one file `designScale`
 * lets declare a capitalised label voice, which is why it is imported here
 * rather than hand-rolled. What lives HERE is the chrome — the cells, their
 * borders, the fixed row height — because that is the part a caller must not
 * be able to reinvent per surface.
 *
 * **The height is fixed, and that is load-bearing.** `RULE_H` is what lets an
 * unlabelled rule sit flush with a labelled one across a row of columns; the
 * Goals board's trailing spacer draws exactly that, so its hairline continues
 * the four above it instead of stepping. Both cells are `items-center` inside
 * it, so neither the label nor the fact sets the height.
 *
 * A near-duplicate of this lives at `views/today/RuleHeader.tsx` on the
 * parallel Today branch. That is deliberate for now — two agents editing one
 * new shared file on two branches is a worse merge than one duplicate — and
 * consolidating the two into this component is a follow-up.
 */

/**
 * The row height every rule header shares.
 *
 * 26px: `text-micro` (11px) at its line height plus 4px above and below, which
 * is the smallest cell that does not crop the mono ascenders and descenders.
 * Exported because an unlabelled continuation of the same rule — a spacer, a
 * gutter — has no content to derive it from.
 */
export const RULE_H = 'h-[26px]';

const CELL = 'flex items-center px-[9px] whitespace-nowrap';

export function RuleHeader({
  label,
  fact,
  factClassName = 'text-muted',
  className = '',
}: {
  /** The region's name. Absent draws a bare rule — see `RULE_H` above. */
  label?: string;
  /**
   * The one fact the region reports, at the far end of the same rule. A count,
   * a ratio, a total. Absent draws no cell rather than an empty one.
   */
  fact?: React.ReactNode;
  /** The fact's tone — the board spends it to turn an over-limit count warn. */
  factClassName?: string;
  className?: string;
}) {
  return (
    /* `overflow-hidden` is the safety net, not the plan. The board sizes its
       slim track to the longest horizon name plus its count (`EMPTY_TRACK_PX`),
       so nothing here should ever need to give — but a cell that DID overflow
       would spill across the hairline into the next bay, and a name clipped to
       an ellipsis is a far smaller lie than one printed over its neighbour.
       The name gives first and the fact never does: a count is the shorter
       string and the one a truncation would destroy outright. */
    <div className={`flex items-stretch ${RULE_H} border-b border-line overflow-hidden ${className}`}>
      {label !== undefined && (
        <span className={`${CELL} min-w-0 ${ruleTag} bg-chip border-r border-line`}>
          <span className="truncate">{label}</span>
        </span>
      )}
      {/* The span of rule between the two cells. It is what makes the header a
          DIVIDER that happens to hold labels, rather than two chips that
          happen to sit above one. */}
      <span className="flex-1 min-w-0" />
      {fact !== undefined && (
        <span className={`${CELL} flex-none font-mono text-micro tabular-nums border-l border-line ${factClassName}`}>
          {fact}
        </span>
      )}
    </div>
  );
}
