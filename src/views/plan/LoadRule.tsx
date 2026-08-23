import type { CapacityFigures, LoadCell } from './capacityLabel';
import { unestimatedLabel } from './capacityLabel';
import { sectionLabel } from '../../components/sectionLabel';

/**
 * The header's load readout: the week's figures as labelled cells on a rule.
 *
 * PRESENTATION ONLY. Every number arrives already computed by `weekLoadCells`,
 * so there is no arithmetic here that could drift from the text beside it.
 *
 * **There is no bar.** A bar is read as a share of a whole, and the whole was
 * free time; with none, the only denominator left would be the figures
 * themselves, which is a bar that is always exactly full. A gauge went the
 * same way — seven cells drawn against nothing. What replaced them is the
 * figures alone, which is what the bar was always summarising.
 *
 * `spanLabel` survives for month mode, where the figure covers the week rows
 * the grid draws rather than the calendar month in the title: a readout that
 * reports a different span from the heading above it has to say so.
 */
export function LoadRule({
  figures,
  cells,
  spanLabel,
  unestimatedOpen,
  onToggleUnestimated,
}: {
  figures: CapacityFigures;
  /** Already-formatted key/value pairs, e.g. `weekLoadCells(capacity)`. */
  cells: LoadCell[];
  /** What the figures cover, when that is not what the heading says. */
  spanLabel?: string;
  unestimatedOpen?: boolean;
  /** Omitted where there is nowhere to open the list (tests, future hosts). */
  onToggleUnestimated?: () => void;
}) {
  const unestimated = unestimatedLabel(figures);

  return (
    <div className="min-w-0 flex-1">
      {/*
        The figures as labelled cells ON a rule, rather than as four phrases of
        equal weight. `items-stretch` and a per-cell right border make the rule
        and the cells one object: a divider that runs behind separate captions
        is two objects a reader has to relate, which is the fault the flat
        `text-meta text-muted` list had.
      */}
      <div className="flex items-stretch flex-wrap border-t border-line">
        {cells.map((cell, i) => (
          <span
            key={cell.key}
            data-fig={cell.key.toLowerCase()}
            className={`flex flex-col gap-[1px] py-[5px] pr-[12px] border-r border-line ${
              i === 0 ? '' : 'pl-[12px]'
            }`}
          >
            <span className={sectionLabel}>{cell.key}</span>
            <span
              className={`tabular-nums leading-[1.1] ${
                cell.tone === 'head' ? 'text-body font-semibold text-ink' : 'text-meta text-muted'
              }`}
            >
              {cell.value}
            </span>
          </span>
        ))}

        {spanLabel && (
          // Beside the figures and BEFORE the spacer: the reading edge belongs
          // to the exception, and a caveat that outranks it would be the
          // hierarchy the figures rule exists to establish, undone.
          // `text-muted`, NOT `text-faint` — a reader who does not take this in
          // will read a six-week total as a month's, which is the opposite of
          // decorative.
          <span className="self-center font-mono text-micro text-muted px-[12px] border-r border-line">
            {spanLabel}
          </span>
        )}

        <span className="flex-1 min-w-[12px] border-r border-line" />

        {unestimated && (
          <span data-fig="unestimated" className="flex flex-col gap-[1px] py-[5px] pl-[12px]">
            <span className={sectionLabel}>Unestimated</span>
            {onToggleUnestimated ? (
              <button
                type="button"
                onClick={onToggleUnestimated}
                aria-expanded={unestimatedOpen ?? false}
                aria-label={unestimated}
                title="Show the work that has no estimate"
                className="self-start tabular-nums text-meta leading-[1.1] text-warn underline decoration-dotted underline-offset-[3px] rounded-[4px] hover:text-ink hover:bg-hover"
              >
                {figures.unestimated}
              </button>
            ) : (
              <span aria-label={unestimated} className="tabular-nums text-meta leading-[1.1] text-warn">
                {figures.unestimated}
              </span>
            )}
          </span>
        )}

      </div>
    </div>
  );
}
