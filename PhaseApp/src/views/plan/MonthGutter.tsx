import { formatMinutes } from './capacityLabel';
import type { MonthCapacityRow } from './monthCapacity';

/** The gutter's width, shared with `MonthGrid`'s two grid templates. */
export const MONTH_GUTTER_PX = 44;

/**
 * One week row's summary, and the route into that week.
 *
 * How much is on the row that IS the week, rather than left to be assembled by
 * eye from seven day figures. It is also the second route into week mode: the
 * range switch is in the far top-right, and the week you want to open is right
 * here under the cursor.
 *
 * It used to answer "which weeks am I underwater?", with a bar and a warn
 * colour. Nothing weighs a week against available hours any more, so the row
 * states the figure and passes no verdict — and the bar went with the verdict,
 * because a bar whose only denominator is its own value is always full.
 *
 * A `<button>`, not a click handler on a div: it is real navigation and has to
 * be reachable from the keyboard. The accessible name carries the figure,
 * which would otherwise announce as a bare number.
 */
export function MonthGutter({ row, onOpen }: {
  row: MonthCapacityRow;
  onOpen: (week: string) => void;
}) {
  const planned = formatMinutes(row.capacity.plannedMin);
  const empty = row.capacity.plannedMin === 0 && row.capacity.backlogMin === 0;

  return (
    <button
      type="button"
      data-testid="month-gutter-row"
      onClick={() => onOpen(row.week)}
      aria-label={`Open week ${row.isoWeekLabel} — ${planned} planned`}
      className="group border-b border-line-soft flex flex-col justify-center items-end gap-[2px] pr-[8px] text-right hover:bg-hover"
    >
      {/* `text-muted`, NOT `text-faint`: this names the week and is read.
          Task 2's review caught the identical slip on the header's span
          label — the Global Constraints reserve `faint` for decoration. */}
      <span className="font-mono text-micro tracking-[.08em] text-muted group-hover:text-ink">
        {row.isoWeekLabel}
      </span>
      {/* A week with nothing on it says nothing — the same silence rule the day
          cells keep, for the same reason. */}
      {!empty && (
        <span className="font-mono text-meta tabular-nums font-semibold text-ink">
          {planned}
        </span>
      )}
    </button>
  );
}
