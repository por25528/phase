import { useDroppable } from '@dnd-kit/core';
import { clockLabel } from '../../lib/clock';
import { projectBlockClass } from '../../lib/projectColour';
import type { ScheduledItem } from '../../lib/scheduled';
import { parseD } from '../../lib/dates';

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
  date, items, inMonth, isToday, readOnly, onCreate, onOpenDay,
}: {
  date: string;
  items: ScheduledItem[];
  /** False for the leading/trailing days of neighbouring months. */
  inMonth: boolean;
  isToday: boolean;
  /** True for a day already spent — creation is refused, as on the grid. */
  readOnly?: boolean;
  onCreate: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: !!readOnly });
  const shown = items.slice(0, MONTH_CHIP_CAP);
  const hidden = items.length - shown.length;

  return (
    <div
      ref={setNodeRef}
      data-testid="month-cell"
      data-date={date}
      role="group"
      aria-label={`${date}${isToday ? ' — today' : ''}`}
      className={`relative min-w-0 min-h-0 flex flex-col border-l border-t border-line-soft px-[3px] pt-[2px] ${
        inMonth ? 'text-ink' : 'text-faint bg-hover/30'
      } ${isOver && !readOnly ? 'bg-accent/5' : ''}`}
    >
      {/*
        The create target, rendered FIRST so everything below stacks above it in
        paint order. Not `-z-10`: the cell carries its own background, so a
        negative z-index would paint this behind it and swallow every click.
        Same layering rule DayCanvas uses on the week grid.
      */}
      <button
        type="button"
        data-testid="month-cell-canvas"
        aria-label={`Add work on ${date}`}
        disabled={!!readOnly}
        onClick={() => onCreate(date)}
        className="absolute inset-0 cursor-default disabled:cursor-not-allowed"
      />

      <div className={`relative flex-none text-tiny tabular-nums text-center ${
        isToday ? 'text-accent font-semibold' : ''
      }`}>
        {parseD(date).getDate()}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden space-y-[1px] pt-[1px]">
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
            className="w-full text-left truncate text-tiny text-muted hover:text-ink px-[3px]"
          >
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  );
}
