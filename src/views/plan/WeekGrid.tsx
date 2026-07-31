import { useEffect, useRef, type ReactNode } from 'react';
import type { AvailabilityWindow } from '../../db/types';
import type { DayCapacity, Interval } from '../../lib/capacity';
import { dayLoadLabel, dayLoadHint, isOverCommitted } from './capacityLabel';
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

import { clockLabel } from '../../lib/clock';

const AXIS_WIDTH_PX = 46;

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
  days, today, nowMinute, windows, range, readOnly, dayCapacity, children,
}: {
  days: string[];
  today: string;
  nowMinute: number | null;
  windows: AvailabilityWindow[];
  range: Interval;
  /** True when the whole week is past — forwarded to every DayColumn. */
  readOnly?: boolean;
  /**
   * Per-day free/planned, in `days` order. `weekCapacity` has always produced
   * this and nothing consumed it, so the only load figure on screen was the
   * week total — which cannot tell you that Tuesday is full.
   */
  dayCapacity?: DayCapacity[];
  children: (date: string) => ReactNode;
}) {
  const marks = hourMarks(range);
  const scrollerRef = useRef<HTMLDivElement>(null);

  /*
   * Bring today's column into view on mount and whenever the WEEK changes —
   * and at no other time.
   *
   * The dependency was `[days, today]`, but `days` is `weekDates(weekStart)`,
   * rebuilt into a new array on every render of Plan. So the identity always
   * changed and this ran on every render: the 60-second now-line tick, a drag
   * starting, a backlog row taking focus, a group expanding. Wherever the grid
   * actually overflows — routine below ~830px, i.e. a laptop in split screen —
   * that silently threw away the user's manual horizontal scroll, at worst
   * within a minute and at best instantly. Scrolling right to Friday was not
   * possible.
   *
   * `days[0]` is the week's Monday: a string, stable across renders, and
   * changing exactly when the effect should re-run. Plan.tsx documents this
   * same `weekDates` identity hazard for its keydown listener and fixes it the
   * same way.
   */
  const weekKey = days[0];

  /*
   * Two facts about this week, kept in refs because changing them must never
   * itself cause a render:
   *
   * `centredFor` — the week already centred. Centring is a once-per-week
   * courtesy, not an ongoing behaviour.
   *
   * `userScrolled` — whether the person moved the grid themselves. Once they
   * have, this stops touching it for that week: a view that re-centres under
   * your hands is worse than one that never centres at all.
   */
  const centredFor = useRef<string | null>(null);
  const userScrolled = useRef(false);
  const programmatic = useRef(false);

  useEffect(() => {
    centredFor.current = null;
    userScrolled.current = false;
  }, [weekKey]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    function centre(): void {
      const node = scrollerRef.current;
      if (!node) return;
      if (centredFor.current === weekKey || userScrolled.current) return;
      // Not scrollable YET. Returning without marking the week done is the
      // whole point of watching for resizes: the grid is `min-w-[780px]` inside
      // an `overflow-x-auto`, so a window dragged narrower makes it scrollable
      // long after mount, and it would otherwise sit pinned at Monday with
      // today off-screen until the week or the date changed.
      if (node.scrollWidth <= node.clientWidth) return;
      const index = days.indexOf(today);
      if (index < 0) {
        centredFor.current = weekKey; // today isn't in this week; nothing to do
        return;
      }
      const colWidth = (node.scrollWidth - AXIS_WIDTH_PX) / days.length;
      const target = Math.max(
        0,
        AXIS_WIDTH_PX + index * colWidth - (node.clientWidth - AXIS_WIDTH_PX - colWidth) / 2,
      );
      centredFor.current = weekKey;
      // Assigning the value it already holds fires no scroll event, which would
      // strand the flag and make this swallow the user's NEXT scroll instead.
      if (Math.abs(node.scrollLeft - target) < 1) return;
      programmatic.current = true;
      node.scrollLeft = target;
    }

    function onScroll(): void {
      // Scroll events are dispatched in the rendering steps before animation
      // frames, so the write above is always the first one seen here.
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      userScrolled.current = true;
    }

    centre();
    el.addEventListener('scroll', onScroll, { passive: true });
    // Guarded: jsdom and other non-browser hosts have no ResizeObserver, and
    // the initial `centre()` above already covers the common case.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => centre());
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `days` is derived
    // from `weekKey`; depending on the array re-runs this every render.
  }, [weekKey, today]);

  return (
    <div ref={scrollerRef} className="overflow-x-auto">
      {/* 7 columns cannot be legible on a phone, so the grid scrolls rather
          than squeezing — and it starts on today, which was otherwise cut in
          half at the right edge. 780px keeps a day column ~105px. */}
      <div className="min-w-[780px]">
        {/* day headings */}
        <div
          className="grid gap-0 mb-[4px]"
          style={{ gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))` }}
        >
          <span />
          {days.map((iso, i) => {
            const cap = dayCapacity?.[i];
            const load = cap ? dayLoadLabel(cap) : null;
            const over = cap ? isOverCommitted(cap) : false;
            return (
              <div key={iso} className="text-center">
                <div className={`font-mono text-tiny tracking-[.12em] uppercase ${iso === today ? 'text-accent' : 'text-muted'}`}>
                  {DOW[i]}
                </div>
                <div className={`text-body tabular-nums ${iso === today ? 'text-ink font-semibold' : 'text-ink-soft'}`}>
                  {parseD(iso).getDate()}
                </div>
                {/* A fixed-height slot whether or not the day has a figure, so
                    one busy day cannot shove the whole header row down by a
                    line relative to its neighbours. */}
                <div className="h-[12px] leading-[12px]">
                  {load && (
                    <span
                      title={cap ? dayLoadHint(cap) : undefined}
                      className={`font-mono text-eyebrow tabular-nums ${over ? 'text-warn font-semibold' : 'text-muted'}`}
                    >
                      {load}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
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

          {/* time axis — sticky so it survives horizontal scrolling */}
          <div className="relative sticky left-0 z-[3] bg-bg">
            {marks.map((m) => (
              <span
                key={m}
                className="absolute right-[6px] -translate-y-1/2 font-mono text-tiny text-muted tabular-nums"
                style={{ top: `${minuteToPct(m, range)}%` }}
              >
                {clockLabel(m)}
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
