import type { ReactNode } from 'react';
import { ruleTag } from './sectionLabel';

/**
 * A divider that carries its own legend, the way a technical drawing does.
 *
 * `SectionHeader` — which this replaced, and which had no other caller — made
 * the label and the divider two objects: a mono label floating above a
 * hairline, with the section's one fact floating above the other end of it.
 * That was already an improvement on four labels floating in nothing, and it
 * left the same seam: on a page whose whole argument is that it is a MEASURED
 * OBJECT, the two things that mark where a section starts should not be two
 * things.
 *
 * So the label moves INTO the rule, in a tinted cell at its left end, the way
 * a legend sits on a technical drawing. The cell's own edges do the separating,
 * which is what lets `ruleTag` carry ink where `sectionLabel` had to recede.
 *
 * The tag is flush with the frame's left edge and the rows are inset past it —
 * the reverse of `SectionHeader`, where the label was inset to sit over the
 * checkbox and the rule bled full width. Both readings are consistent; this one
 * follows from the frame, where the rule now terminates against a real border
 * rather than against the page, so a tag inset from it would read as a cell
 * someone forgot to push home.
 *
 * `right` is a FACT about the section and never a control — a count where the
 * rows are capped and the total says something they cannot, the free-time
 * sentence where it explains why the rows exist. Sections whose rows already
 * answer it pass nothing, and the rule simply runs to the edge.
 *
 * ## It lives in `components/` because it has three surfaces now
 *
 * It began view-scoped in `views/today/`. The goal tree's containers are the
 * third consumer — a container is a RULE there rather than a row, which is
 * what makes its name and its percentage land on one line by construction —
 * so it moved here rather than being copied. `views/` must not import across
 * view folders in either direction, and a second copy of this grammar is
 * exactly the drift `sectionLabel.ts` exists to prevent.
 *
 * ## `lead` and `as` are what the tree needed, and nothing else
 *
 * A section heading on Today is inert: nothing in the rule is clickable, and
 * `<h2>` is the right element for it. A container's rule in the tree is a
 * `role="treeitem"` — it holds a drag handle and a twirl, it renames in place,
 * and a heading nested inside a treeitem would announce a heading level for
 * every container in the tree. So the element is switchable and the tag cell
 * can take leading controls. Both default to Today's shape, so no existing
 * caller moved.
 *
 * What is deliberately NOT configurable is the chrome — the cells, their
 * borders, the tint, the side the fact sits on. That is the part a caller must
 * not be able to reinvent per surface, which is the whole reason this is a
 * component and not a class string.
 */
export const RULE_H = 'h-[26px]';

export function RuleHeader({
  label,
  right,
  rightClassName = 'text-meta text-muted',
  lead,
  as = 'h2',
  className = '',
}: {
  /** The region's name, in the tinted cell at the left end. Absent draws a bare rule. */
  label?: ReactNode;
  /** The one FACT the region reports, on the far end of the same hairline. */
  right?: ReactNode;
  /**
   * The fact's tone. Overridable ONLY because two surfaces arrived at different
   * ones on parallel branches — Today and the tree set it in `text-meta`, the
   * board in `font-mono text-micro`, and the board additionally turns it warn
   * when Now is over its limit. Reconciling those two into one tone is a
   * deliberate follow-up, not something to settle inside a merge: see CLAUDE.md.
   */
  rightClassName?: string;
  /**
   * Controls that belong to the region itself, inside the tag cell before the
   * name — the tree's drag handle and twirl. Absent on a static heading.
   */
  lead?: ReactNode;
  /**
   * `h2` for a region of a page; `span` where the rule is already something
   * else's row and a heading would be announced on top of it.
   */
  as?: 'h2' | 'span';
  /**
   * The board passes `RULE_H` here: its four bays must draw their rules at one
   * fixed height so the hairlines line up across columns of different content.
   * Today and the tree let the rule take its content's height instead.
   */
  className?: string;
}) {
  const Tag = as;
  return (
    /* `overflow-hidden` is the safety net, not the plan. The board sizes its
       slim track to the longest horizon name plus its count (`EMPTY_TRACK_PX`),
       so nothing here should ever need to give — but a cell that DID overflow
       would spill across the hairline into the next bay, and a name clipped to
       an ellipsis is a far smaller lie than one printed over its neighbour. */
    <div className={`flex items-stretch border-b border-line overflow-hidden ${className}`}>
      {label !== undefined && (
        /* `flex-initial`, not `flex-none`: on Today the label is a constant and
           the spacer beside it absorbs every spare pixel, so the cell never
           shrinks — but a container's name in the tree is a user string, and a
           cell that could not give would push the fact off the far end of its
           own rule rather than truncating. */
        <Tag className={`flex-initial min-w-0 flex items-center gap-[6px] px-[9px] py-[4px] bg-chip border-r border-line ${ruleTag}`}>
          {lead}
          <span className="min-w-0 truncate">{label}</span>
        </Tag>
      )}
      {/* The span of rule between the two cells. It is what makes the header a
          DIVIDER that happens to hold labels, rather than two chips that
          happen to sit above one. */}
      <span className="flex-1 min-w-0" />
      {right !== undefined && right !== null && (
        <span className={`flex-none flex items-center px-[12px] py-[4px] border-l border-line tabular-nums ${rightClassName}`}>
          {right}
        </span>
      )}
    </div>
  );
}
