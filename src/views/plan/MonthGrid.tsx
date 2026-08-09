import { monthGrid, ymOf } from '../../lib/calendar';
import { GRID_VIEWPORT_PX } from '../../lib/grid';
import type { ScheduledItem } from '../../lib/scheduled';
import { MonthCell } from './MonthCell';

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
  ym, today, itemsByDay, isPastDay, onCreate, onOpenDay,
}: {
  /** 'YYYY-MM' — the month to draw. */
  ym: string;
  today: string;
  itemsByDay: Map<string, ScheduledItem[]>;
  isPastDay: (date: string) => boolean;
  onCreate: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const weeks = monthGrid(ym);

  return (
    <div
      data-testid="month-grid"
      className="flex flex-col min-h-0 border-r border-b border-line-soft"
      style={{ height: `${GRID_VIEWPORT_PX}px` }}
    >
      <div className="grid grid-cols-7 flex-none">
        {DOW.map((d) => (
          <div
            key={d}
            className="text-center font-mono text-tiny tracking-[.12em] uppercase text-muted pb-[4px]"
          >
            {d}
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7 flex-1 min-h-0"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {weeks.flat().map((date) => (
          <MonthCell
            key={date}
            date={date}
            items={itemsByDay.get(date) ?? []}
            inMonth={ymOf(date) === ym}
            isToday={date === today}
            readOnly={isPastDay(date)}
            onCreate={onCreate}
            onOpenDay={onOpenDay}
          />
        ))}
      </div>
    </div>
  );
}
