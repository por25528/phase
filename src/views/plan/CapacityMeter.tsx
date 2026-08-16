import type { CapacityFigures } from './capacityLabel';
import { capacityMeter, unestimatedLabel } from './capacityLabel';

/**
 * The header's load readout: one stacked bar over the figures it summarises.
 *
 * This is PRESENTATION ONLY. Every number it draws arrives already computed —
 * `parts` from `weekLoadParts`, the geometry from `capacityMeter` — so there is
 * no arithmetic here that could drift from the text beside it.
 *
 * Colour fires in exactly one circumstance: `meter.over`. A healthy week is
 * accent-on-track and reads as chrome, which is the point — a bar that is
 * always coloured is a bar nobody looks at.
 *
 * `spanLabel` exists for month mode, where the figure covers the week rows the
 * grid draws rather than the calendar month in the title. A meter that reports
 * a different span from the heading above it has to say so.
 */
export function CapacityMeter({
  figures,
  parts,
  spanLabel,
  unestimatedOpen,
  onToggleUnestimated,
}: {
  figures: CapacityFigures;
  /** Already-formatted phrases, e.g. `weekLoadParts(capacity, today)`. */
  parts: string[];
  /** What the figures cover, when that is not what the heading says. */
  spanLabel?: string;
  unestimatedOpen?: boolean;
  /** Omitted where there is nowhere to open the list (tests, future hosts). */
  onToggleUnestimated?: () => void;
}) {
  const meter = capacityMeter(figures);
  const unestimated = unestimatedLabel(figures);
  const fill = meter.over ? 'bg-warn' : 'bg-accent';

  return (
    <div className="min-w-[180px] max-w-[420px] flex-1">
      <div className="relative h-[6px] rounded-full bg-track overflow-hidden">
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
            className={`h-full ${meter.over ? 'bg-warn/45' : 'bg-faint-2'}`}
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

      <div className="flex flex-wrap items-baseline gap-x-[13px] gap-y-[2px] mt-[6px] text-meta tabular-nums text-muted">
        {parts.map((part) => (
          <span key={part}>{part}</span>
        ))}
        {unestimated && (
          onToggleUnestimated ? (
            <button
              type="button"
              onClick={onToggleUnestimated}
              aria-expanded={unestimatedOpen ?? false}
              title="Show the work that has no estimate"
              className="tabular-nums text-muted underline decoration-dotted underline-offset-[3px] min-h-[24px] inline-flex items-center px-[2px] rounded-[4px] hover:text-ink hover:bg-hover"
            >
              {unestimated}
            </button>
          ) : (
            <span className="tabular-nums">{unestimated}</span>
          )
        )}
        {spanLabel && (
          <>
            {/* `text-muted`, NOT `text-faint`. This states which days the figures
                cover, and a reader who does not take it in will read a six-week
                total as a month's — it is the opposite of decorative. */}
            <span className="font-mono text-micro text-muted">{spanLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
