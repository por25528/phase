import { useDroppable } from '@dnd-kit/core';
import { clockLabel } from '../../lib/clock';
import { projectBlockClass } from '../../lib/projectColour';
import type { ScheduledItem } from '../../lib/scheduled';
import { parseD } from '../../lib/dates';
import type { DayCapacity } from '../../lib/capacity';
import { formatMinutes, dayLoadHint } from './capacityLabel';

/**
 * How many chips a cell shows before collapsing the rest.
 *
 * A cell is a fixed fraction of the viewport, so an unbounded list either
 * overflows or shrinks every other row. Three plus an overflow row is what
 * fits at the smallest sensible cell height.
 */
export const MONTH_CHIP_CAP = 3;

/**
 * One day of the month grid.
 *
 * Chips, not scaled blocks: a month cell has no time axis, so a height would
 * encode nothing. The chip carries its start time as text instead, and the
 * project's colour so identity survives the change of scale — the same hash
 * the week grid's blocks use.
 */
export function MonthCell({
  date, items, inMonth, isToday, readOnly, capacity, onCreate, onOpenDay,
}: {
  date: string;
  items: ScheduledItem[];
  /** False for the leading/trailing days of neighbouring months. */
  inMonth: boolean;
  isToday: boolean;
  /** True for a day already spent — creation is refused, as on the grid. */
  readOnly?: boolean;
  /**
   * This day's figures. Absent in hosts that have none (tests, future
   * callers) — the cell then draws no load and reads exactly as it did before.
   */
  capacity?: DayCapacity;
  onCreate: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: !!readOnly });
  const shown = items.slice(0, MONTH_CHIP_CAP);
  const hidden = items.length - shown.length;
  /*
   * The same silence rule `dayLoadLabel` keeps: a day with nothing on it
   * reports nothing, because an empty cell already looks empty and 42
   * instances of "0m" is noise on the calmest surface in the app.
   *
   * The figure is `plannedMin` ALONE. That used to distinguish it from
   * `dayLoadLabel`'s `1h 30m / 6h`, which was sized for a week column heading;
   * both say the same thing now, since the free denominator is gone.
   */
  const load = capacity && (capacity.plannedMin > 0 || capacity.backlogMin > 0)
    ? formatMinutes(capacity.plannedMin)
    : null;

  return (
    <div
      ref={setNodeRef}
      data-testid="month-cell"
      data-date={date}
      role="group"
      aria-label={`${date}${isToday ? ' — today' : ''}`}
      className={`relative min-w-0 min-h-0 flex flex-col border-l border-t border-line-soft px-[5px] pt-[4px] ${
        inMonth ? 'text-ink' : 'text-faint bg-hover/30'
      } ${isOver && !readOnly ? 'bg-accent/5' : ''}`}
    >
      {/*
        The create target, rendered FIRST so everything below stacks above it in
        paint order. Not `-z-10`: the cell carries its own background, so a
        negative z-index would paint this behind it and swallow every click.
      */}
      <button
        type="button"
        data-testid="month-cell-canvas"
        aria-label={`Add work on ${date}`}
        disabled={!!readOnly}
        onClick={() => onCreate(date)}
        className="absolute inset-0 cursor-default disabled:cursor-not-allowed"
      />

      {/* Date left, load right. Centring the number was the one thing on this
          grid that no other calendar does — a date is an anchor, and an anchor
          goes in a corner. */}
      <div className="relative flex-none flex items-baseline justify-between gap-[4px]">
        <span
          data-testid="month-day-number"
          className={`text-meta tabular-nums ${
            isToday
              ? 'bg-ink text-paper rounded-full w-[18px] h-[18px] inline-flex items-center justify-center font-semibold -ml-[2px]'
              : 'text-ink-soft'
          }`}
        >
          {parseD(date).getDate()}
        </span>
        {load && (
          <span
            data-testid="month-day-load"
            title={(capacity && dayLoadHint(capacity)) || undefined}
            className="font-mono text-micro tabular-nums text-muted"
          >
            {load}
          </span>
        )}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden space-y-[1px] pt-[2px]">
        {shown.map((it) => (
          <div
            key={`${it.kind}:${it.id}`}
            data-testid="month-chip"
            title={`${it.title} · ${clockLabel(it.startMin)}`}
            className={`truncate rounded-[4px] border-l-[3px] px-[3px] text-badge leading-[1.3] ${
              projectBlockClass(it.goalId)
            } ${it.done ? 'opacity-55 line-through' : ''}`}
          >
            <span className="text-ink-soft tabular-nums mr-[3px]">{clockLabel(it.startMin)}</span>
            {it.title}
          </div>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => onOpenDay(date)}
            className="w-full text-left truncate text-meta text-muted hover:text-ink px-[3px]"
          >
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  );
}
