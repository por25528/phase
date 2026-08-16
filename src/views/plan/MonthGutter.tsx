import { capacityMeter, formatMinutes } from './capacityLabel';
import type { MonthCapacityRow } from './monthCapacity';

/** The gutter's width, shared with `MonthGrid`'s two grid templates. */
export const MONTH_GUTTER_PX = 44;

/**
 * One week row's summary, and the route into that week.
 *
 * This is the answer to the question month mode exists to ask — "which weeks am
 * I underwater?" — put on the row that IS the week, rather than left to be
 * assembled by eye from seven day figures. It is also the second route into
 * week mode: the range switch is in the far top-right, and the week you want to
 * open is right here under the cursor.
 *
 * A `<button>`, not a click handler on a div: it is real navigation and has to
 * be reachable from the keyboard. The accessible name carries the load, because
 * the bar beside it is decorative and the figure alone would announce as a
 * bare number.
 */
export function MonthGutter({ row, onOpen }: {
  row: MonthCapacityRow;
  onOpen: (week: string) => void;
}) {
  const meter = capacityMeter(row.capacity);
  const planned = formatMinutes(row.capacity.plannedMin);
  const empty = row.capacity.plannedMin === 0 && row.capacity.backlogMin === 0;

  return (
    <button
      type="button"
      data-testid="month-gutter-row"
      onClick={() => onOpen(row.week)}
      aria-label={`Open week ${row.isoWeekLabel} — ${planned} planned${meter.over ? ' — over-committed' : ''}`}
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
        <>
          <span
            className={`font-mono text-meta tabular-nums font-semibold ${
              meter.over ? 'text-warn' : 'text-ink'
            }`}
          >
            {planned}
          </span>
          <span aria-hidden="true" className="w-[26px] h-[3px] rounded-full bg-track overflow-hidden">
            <span
              className={`block h-full ${meter.over ? 'bg-warn' : 'bg-accent'}`}
              style={{ width: `${Math.min(1, meter.plannedFrac + meter.backlogFrac) * 100}%` }}
            />
          </span>
        </>
      )}
    </button>
  );
}
