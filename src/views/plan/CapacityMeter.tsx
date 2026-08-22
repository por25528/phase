import type { CapacityFigures, DayGaugeCell, LoadCell } from './capacityLabel';
import { capacityMeter, unestimatedLabel } from './capacityLabel';
import { sectionLabel } from '../../components/sectionLabel';

/** Monday-first, matching `weekDates` and therefore `WeekCapacity.days`. */
const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * The header's load readout: a gauge over the figures it summarises.
 *
 * This is PRESENTATION ONLY. Every number it draws arrives already computed —
 * `cells` from `weekLoadCells`, the gauge from `dayGaugeCells`, the geometry
 * from `capacityMeter` — so there is no arithmetic here that could drift from
 * the text beside it.
 *
 * Colour fires in exactly one circumstance: `meter.over`, which is
 * `isOverCommitted` delegated. A healthy week is accent-on-track and reads as
 * chrome, which is the point — a bar that is always coloured is a bar nobody
 * looks at. **The gauge inherits that one verdict whole.** It does not colour a
 * cell for being fuller than its neighbours: `isOverCommitted` compares a
 * WEEK's committed minutes against a WEEK's free minutes and makes no per-day
 * judgement, and `dayGaugeCells` drops `over` at its boundary precisely so
 * this file cannot render one it was never given.
 *
 * `spanLabel` exists for month mode, where the figure covers the week rows the
 * grid draws rather than the calendar month in the title. A meter that reports
 * a different span from the heading above it has to say so.
 */
export function CapacityMeter({
  figures,
  cells,
  gauge,
  today,
  spanLabel,
  unestimatedOpen,
  onToggleUnestimated,
}: {
  figures: CapacityFigures;
  /** Already-formatted key/value pairs, e.g. `weekLoadCells(capacity, today)`. */
  cells: LoadCell[];
  /**
   * One cell per day, in `weekDates` order. Present in WEEK mode only.
   *
   * Absent ⇒ the single stacked bar this replaced. That is not a fallback, it
   * is the honest answer for month mode: a seven-cell gauge is a WEEK
   * instrument, and thirty-five slivers under a month heading would be a
   * texture rather than a reading. The month keeps one bar, summarising the
   * same rows `monthCapacity` sums, with `spanLabel` beside it.
   */
  gauge?: DayGaugeCell[];
  /** Today's date, so the gauge can mark its cell. Only meaningful with `gauge`. */
  today?: string;
  /** What the figures cover, when that is not what the heading says. */
  spanLabel?: string;
  unestimatedOpen?: boolean;
  /** Omitted where there is nowhere to open the list (tests, future hosts). */
  onToggleUnestimated?: () => void;
}) {
  const meter = capacityMeter(figures);
  const unestimated = unestimatedLabel(figures);
  const fill = meter.over ? 'bg-warn' : 'bg-accent';
  const trail = meter.over ? 'bg-warn/45' : 'bg-faint-2';

  return (
    <div className="min-w-0 flex-1">
      {gauge ? (
        <div className="mb-[9px]">
          {/*
            Seven cells on one track, ruled apart. `aria-hidden`: every figure
            it draws is stated in words on the rule below, and a screen reader
            being read seven unlabelled percentages is worse than being read
            the sentence they summarise.
          */}
          <div
            data-testid="week-gauge"
            aria-hidden="true"
            className="grid h-[20px] rounded-[4px] border border-line-2 bg-panel overflow-hidden"
            style={{ gridTemplateColumns: `repeat(${gauge.length}, minmax(0, 1fr))` }}
          >
            {gauge.map((cell) => (
              <div
                key={cell.date}
                data-testid={`gauge-cell-${cell.date}`}
                className={`relative border-r border-line last:border-r-0 ${
                  cell.date === today ? 'ring-1 ring-inset ring-warn' : ''
                }`}
              >
                <div className="absolute inset-y-0 left-0 flex w-full">
                  <div
                    data-testid={`gauge-planned-${cell.date}`}
                    className={`h-full ${fill} opacity-[.55]`}
                    style={{ width: `${cell.plannedFrac * 100}%` }}
                  />
                  <div
                    className={`h-full ${trail}`}
                    style={{ width: `${cell.backlogFrac * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="grid mt-[4px]"
            style={{ gridTemplateColumns: `repeat(${gauge.length}, minmax(0, 1fr))` }}
          >
            {gauge.map((cell, i) => (
              <span
                key={cell.date}
                className={`font-mono text-eyebrow tracking-[.1em] text-center ${
                  cell.date === today ? 'text-ink' : 'text-faint'
                }`}
              >
                {DAY_INITIALS[i % DAY_INITIALS.length]}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="relative h-[6px] rounded-full bg-track overflow-hidden mb-[9px]">
          <div className="absolute inset-0 flex">
            <div
              data-testid="meter-planned"
              className={`h-full ${fill}`}
              style={{ width: `${meter.plannedFrac * 100}%` }}
            />
            {/* "To place" is committed but not on the grid, so it is the same
                bar at a lower contrast — not a second colour. `faint-2` is
                decorative here by definition: the figure beside it carries the
                information. */}
            <div
              data-testid="meter-backlog"
              className={`h-full ${trail}`}
              style={{ width: `${meter.backlogFrac * 100}%` }}
            />
          </div>
          {meter.over && (
            <div
              data-testid="capacity-mark"
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-px bg-panel"
              style={{ left: `${meter.capacityMarkFrac * 100}%` }}
            />
          )}
        </div>
      )}

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
