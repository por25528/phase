import { Fragment } from 'react';
import { monthGrid, ymOf } from '../../lib/calendar';
import { GRID_VIEWPORT_PX } from '../../lib/grid';
import type { ScheduledItem } from '../../lib/scheduled';
import type { DayCapacity } from '../../lib/capacity';
import type { MonthCapacity } from './monthCapacity';
import { MonthCell } from './MonthCell';
import { MonthGutter, MONTH_GUTTER_PX } from './MonthGutter';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The month, as a 7-column grid of days.
 *
 * Rows come from `monthGrid`, which is Monday-first and includes the leading
 * and trailing days of the neighbouring months. Those render dimmed but fully
 * live: they are real days, and refusing to plan into the last three days of a
 * month because the grid calls them "next month" would be an artefact of the
 * layout rather than a rule about time.
 *
 * Row count comes from `weeks.length` rather than a fixed 6, and the rows are
 * `minmax(0, 1fr)`: a 5-row month and a 6-row month both fill the same space
 * instead of one leaving a gap and the other overflowing.
 *
 * That space is `GRID_VIEWPORT_PX`, declared HERE and not inherited. `1fr`
 * divides a height; a `flex-1` box inside an auto-height parent has none to
 * divide, so every row collapsed to its date number and a month of work drew
 * as six lines of digits. It is the same figure the week grid's scroller uses,
 * so the two modes occupy one rectangle and the toggle does not move the page.
 */
export function MonthGrid({
  ym, today, itemsByDay, isPastDay, capacity, onCreate, onOpenDay, onOpenWeek,
}: {
  /** 'YYYY-MM' — the month to draw. */
  ym: string;
  today: string;
  itemsByDay: Map<string, ScheduledItem[]>;
  isPastDay: (date: string) => boolean;
  /** Per-week figures for the gutter. Absent ⇒ no gutter is drawn. */
  capacity?: MonthCapacity;
  onCreate: (date: string) => void;
  onOpenDay: (date: string) => void;
  /** Open a week in week mode. Absent ⇒ no gutter is drawn. */
  onOpenWeek?: (week: string) => void;
}) {
  const weeks = monthGrid(ym);
  const gutter = capacity && onOpenWeek ? capacity : null;
  const cols = gutter ? `${MONTH_GUTTER_PX}px repeat(7, minmax(0, 1fr))` : 'repeat(7, minmax(0, 1fr))';
  // One flat lookup so a cell's figure costs nothing to find. `monthCapacity`
  // already produced every DayCapacity the grid needs; re-deriving them per
  // cell would be the seven-passes-per-render mistake Plan.tsx's memo block
  // exists to prevent.
  const dayCap = new Map<string, DayCapacity>(
    (capacity?.total.days ?? []).map((d) => [d.date, d]),
  );

  return (
    <div
      data-testid="month-grid"
      className="flex flex-col min-h-0 border-r border-b border-line-soft"
      style={{ height: `${GRID_VIEWPORT_PX}px` }}
    >
      <div className="grid flex-none" style={{ gridTemplateColumns: cols }}>
        {gutter && <span />}
        {DOW.map((d) => (
          <div
            key={d}
            className="text-center font-mono text-micro tracking-[.12em] uppercase text-muted pb-[4px]"
          >
            {d}
          </div>
        ))}
      </div>
      <div
        className="grid flex-1 min-h-0"
        style={{
          gridTemplateColumns: cols,
          gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))`,
        }}
      >
        {weeks.map((row, i) => (
          <Fragment key={row[0]}>
            {gutter && (
              gutter.rows[i] && onOpenWeek
                ? <MonthGutter row={gutter.rows[i]} onOpen={onOpenWeek} />
                // `rows[i]` (or `onOpenWeek`) missing must still occupy the
                // grid cell — an omitted element here would let CSS grid
                // auto-placement shift the rest of this row's seven day cells
                // one track left, a silent visual corruption rather than a
                // missing gutter.
                : <span />
            )}
            {row.map((date) => (
              <MonthCell
                key={date}
                date={date}
                items={itemsByDay.get(date) ?? []}
                capacity={dayCap.get(date)}
                inMonth={ymOf(date) === ym}
                isToday={date === today}
                readOnly={isPastDay(date)}
                onCreate={onCreate}
                onOpenDay={onOpenDay}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
