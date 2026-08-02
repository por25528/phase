import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { AvailabilityWindow } from '../../db/types';
import { minuteToPx, DAY_HEIGHT_PX, Z_NOW_LINE } from '../../lib/grid';
import { fmtD } from '../../lib/dates';

/**
 * One day. Draws the availability shading, the now-line, and nothing else —
 * the blocks themselves arrive as `children` so this file stays about geometry.
 *
 * A day with no window is hatched and, from Task 13 onward, refuses drops.
 *
 * The availability window prop is named `availabilityWindow` rather than
 * `window` because the latter shadows the global `window` object — a
 * neighbouring component (Task 13) adds `window.addEventListener` calls.
 */
export function DayColumn({
  date, isToday, availabilityWindow, nowMinute, readOnly, children,
}: {
  date: string;
  isToday: boolean;
  availabilityWindow: AvailabilityWindow | null;
  nowMinute: number | null;
  /** True when this column belongs to a past week — every drop is refused. */
  readOnly?: boolean;
  children: ReactNode;
}) {
  // A day with no availability window, OR a day in a read-only (past) week,
  // refuses drops outright — the disabled droppable is what makes `over` null
  // there, so nothing is ever scheduled onto a day off or into the past.
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: !availabilityWindow || !!readOnly });

  return (
    // `group` + a label, because the blocks inside carry no day of their own.
    // Seven of these render in DOM order, so tabbing the grid was twenty-eight
    // blocks in a row with nothing saying which day any of them was on.
    <div
      ref={setNodeRef}
      data-date={date}
      role="group"
      aria-label={`${fmtD(date)}${isToday ? ' — today' : ''}${availabilityWindow ? '' : ' — no working hours'}`}
      className={`relative min-w-0 overflow-hidden border-l border-line-soft ${
        availabilityWindow ? '' : 'bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgb(var(--c-hover))_4px,rgb(var(--c-hover))_8px)]'
      } ${isToday ? 'bg-hover/40' : ''} ${isOver && availabilityWindow ? 'bg-accent/5' : ''}`}
    >
      {/* hours outside the working window, dimmed */}
      {availabilityWindow && (
        <>
          <div
            className="absolute left-0 right-0 top-0 bg-hover/60 pointer-events-none"
            style={{ height: `${minuteToPx(availabilityWindow.startMin)}px` }}
          />
          <div
            className="absolute left-0 right-0 bottom-0 bg-hover/60 pointer-events-none"
            style={{ height: `${DAY_HEIGHT_PX - minuteToPx(availabilityWindow.endMin)}px` }}
          />
        </>
      )}

      {children}

      {isToday && nowMinute !== null && (
        <div
          className="absolute left-0 right-0 h-0 border-t border-accent pointer-events-none"
          style={{ top: `${minuteToPx(nowMinute)}px`, zIndex: Z_NOW_LINE }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
