import type { ReactNode } from 'react';
import type { AvailabilityWindow } from '../../db/types';
import type { Interval } from '../../lib/capacity';
import { windowForDate } from '../../lib/availability';
import { minuteToPct, hourMarks } from '../../lib/grid';
import { parseD } from '../../lib/dates';
import { DayColumn } from './DayColumn';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Pixel height of the hour grid. The pure geometry in lib/grid.ts works in
 * percentages; this is the one place a percentage becomes a pixel, and the
 * divisor Task 13 uses to turn a drop offset back into a minute.
 */
export const GRID_HEIGHT_PX = 720;

const AXIS_WIDTH_PX = 46;

function hourLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

/**
 * `WeekGrid` draws the chrome of the week calendar — hour axis, day columns,
 * availability shading, off-day hatching, now-line. It renders no content
 * blocks itself; `children` is handed the date for each column so the caller
 * can render whatever belongs there.
 *
 * `range` is computed once by the caller (Plan.tsx) via `visibleRange` and
 * passed down — Task 12 needs the identical range to position blocks, and
 * two independent computations could drift.
 */
export function WeekGrid({
  days, today, nowMinute, windows, range, readOnly, children,
}: {
  days: string[];
  today: string;
  nowMinute: number | null;
  windows: AvailabilityWindow[];
  range: Interval;
  /** True when the whole week is past — forwarded to every DayColumn. */
  readOnly?: boolean;
  children: (date: string) => ReactNode;
}) {
  const marks = hourMarks(range);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* day headings */}
        <div
          className="grid gap-0 mb-[4px]"
          style={{ gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))` }}
        >
          <span />
          {days.map((iso, i) => (
            <div key={iso} className="text-center">
              <div className={`font-mono text-[.58rem] tracking-[.12em] uppercase ${iso === today ? 'text-accent' : 'text-muted'}`}>
                {DOW[i]}
              </div>
              <div className={`text-[.82rem] tabular-nums ${iso === today ? 'text-ink font-semibold' : 'text-ink-soft'}`}>
                {parseD(iso).getDate()}
              </div>
            </div>
          ))}
        </div>

        {/* the hour grid */}
        <div
          className="grid relative border-t border-line"
          style={{
            gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))`,
            height: `${GRID_HEIGHT_PX}px`,
          }}
        >
          {/* hour rules, drawn once across the full width behind everything */}
          {marks.map((m) => (
            <div
              key={m}
              className="absolute left-0 right-0 border-t border-line-soft pointer-events-none"
              style={{ top: `${minuteToPct(m, range)}%` }}
              aria-hidden="true"
            />
          ))}

          {/* time axis */}
          <div className="relative">
            {marks.map((m) => (
              <span
                key={m}
                className="absolute right-[6px] -translate-y-1/2 font-mono text-[.58rem] text-faint tabular-nums"
                style={{ top: `${minuteToPct(m, range)}%` }}
              >
                {hourLabel(m)}
              </span>
            ))}
          </div>

          {days.map((iso) => (
            <DayColumn
              key={iso}
              date={iso}
              isToday={iso === today}
              availabilityWindow={windowForDate(iso, windows)}
              nowMinute={iso === today ? nowMinute : null}
              range={range}
              readOnly={readOnly}
            >
              {children(iso)}
            </DayColumn>
          ))}
        </div>
      </div>
    </div>
  );
}
