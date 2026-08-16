import type { ReactNode } from 'react';
import { sectionLabel } from './sectionLabel';

/**
 * A region heading on a working surface: the label, a rule to the reading edge,
 * and one optional fact on the far end.
 *
 * `sectionLabel` gave every region the same VOICE and nothing else, so on Today
 * four labels floated in whitespace with no line anywhere and the page dissolved
 * into its own background — the eye had no edge to travel along and the right
 * half of a 720px measure was empty from the header down. The rule is what turns
 * a label into a region: it states where the section starts, it gives the
 * right-hand metadata a lane to align in, and it is the one structural device on
 * the page, so nothing else has to be invented to separate two lists.
 *
 * The label keeps its own `px-[8px]` rather than the row taking it, so the label
 * sits on the same left edge as a `TaskRow`'s checkbox while the rule bleeds the
 * full measure. That difference is deliberate — a rule inset to match the
 * content reads as a box someone forgot to finish.
 *
 * `right` is a FACT about the section, never a control: a count where the rows
 * are capped and the total is bigger than what is shown, the free-time sentence
 * where it explains why the rows exist. Sections whose rows already answer it
 * pass nothing, and the rule simply runs to the edge.
 */
export function SectionHeader({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-[10px] pb-[6px] mb-[2px] border-b border-line">
      <h2 className={`px-[8px] ${sectionLabel}`}>{label}</h2>
      <span className="flex-1" />
      {right !== undefined && right !== null && (
        <span className="flex-none px-[8px] text-meta text-muted">{right}</span>
      )}
    </div>
  );
}
