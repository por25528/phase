import type { ReactNode } from 'react';
import { ruleTag } from '../../components/sectionLabel';

/**
 * A region heading on Today: the rule IS the heading.
 *
 * `SectionHeader` — which this replaces, and which had no other caller — made
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
 */
export function RuleHeader({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="flex items-stretch border-b border-line">
      <h2 className={`flex-none flex items-center px-[9px] py-[4px] bg-chip border-r border-line ${ruleTag}`}>
        {label}
      </h2>
      <span className="flex-1" />
      {right !== undefined && right !== null && (
        <span className="flex-none flex items-center px-[12px] py-[4px] border-l border-line text-meta text-muted tabular-nums">
          {right}
        </span>
      )}
    </div>
  );
}
