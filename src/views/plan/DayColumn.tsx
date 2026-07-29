import type { ReactNode } from 'react';
import type { AvailabilityWindow } from '../../db/types';
import type { Interval } from '../../lib/capacity';
import { minuteToPct } from '../../lib/grid';

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
  date, isToday, availabilityWindow, nowMinute, range, children,
}: {
  date: string;
  isToday: boolean;
  availabilityWindow: AvailabilityWindow | null;
  nowMinute: number | null;
  range: Interval;
  children: ReactNode;
}) {
  return (
    <div
      data-date={date}
      className={`relative min-w-0 overflow-hidden border-l border-line-soft ${
        availabilityWindow ? '' : 'bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgb(var(--c-hover))_4px,rgb(var(--c-hover))_8px)]'
      } ${isToday ? 'bg-hover/40' : ''}`}
    >
      {/* hours outside the working window, dimmed */}
      {availabilityWindow && (
        <>
          <div
            className="absolute left-0 right-0 top-0 bg-hover/60 pointer-events-none"
            style={{ height: `${Math.max(0, minuteToPct(availabilityWindow.startMin, range))}%` }}
          />
          <div
            className="absolute left-0 right-0 bottom-0 bg-hover/60 pointer-events-none"
            style={{ height: `${Math.max(0, 100 - minuteToPct(availabilityWindow.endMin, range))}%` }}
          />
        </>
      )}

      {children}

      {isToday && nowMinute !== null && nowMinute >= range.startMin && nowMinute <= range.endMin && (
        <div
          className="absolute left-0 right-0 h-0 border-t border-accent pointer-events-none z-[2]"
          style={{ top: `${minuteToPct(nowMinute, range)}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
