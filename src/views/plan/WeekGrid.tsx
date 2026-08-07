import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { AvailabilityWindow } from '../../db/types';
import type { DayCapacity, Interval } from '../../lib/capacity';
import { dayLoadLabel, dayLoadHint, isOverCommitted } from './capacityLabel';
import { windowForDate } from '../../lib/availability';
import { minuteToPx, hourMarks, halfHourMarks, DAY_HEIGHT_PX, Z_RULES, Z_AXIS, Z_HEADINGS, Z_CORNER } from '../../lib/grid';
import { parseD } from '../../lib/dates';
import type { CanvasSpan } from '../../lib/canvasCreate';
import { DayColumn } from './DayColumn';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

import { clockLabel } from '../../lib/clock';

/**
 * How tall the scroller itself is — the window onto the day, not the day.
 *
 * 720px is the scroller's own height: the sticky day headings now live INSIDE
 * this box, eating into it, exactly as they do in every calendar, so the
 * visible hour grid is shorter than 720px by whatever the heading row costs.
 * The sidebar bounds itself to this region, whatever it nets out to — see
 * the rail note in CLAUDE.md. The content behind the headings is
 * `DAY_HEIGHT_PX` tall and reachable by scrolling.
 */
export const GRID_VIEWPORT_PX = 720;

const AXIS_WIDTH_PX = 46;

/**
 * `WeekGrid` draws the chrome of the week calendar — hour axis, day columns,
 * availability shading, off-day hatching, now-line. It renders no content
 * blocks itself; `children` is handed the date for each column so the caller
 * can render whatever belongs there.
 *
 * The grid is a full day tall (`DAY_HEIGHT_PX`) inside a `GRID_VIEWPORT_PX`
 * scroller — every minute is reachable by scrolling, not just the window
 * `scrollWindow` opens on.
 */
export function WeekGrid({
  days, today, nowMinute, windows, scrollWindow, readOnly, dayCapacity,
  onCreate, scrollerRef, gridRef, children,
}: {
  days: string[];
  today: string;
  nowMinute: number | null;
  windows: AvailabilityWindow[];
  /** Where to scroll on mount. Nothing positions against it — see initialScrollWindow. */
  scrollWindow: Interval;
  /** True when the whole week is past — forwarded to every DayColumn. */
  readOnly?: boolean;
  /**
   * Per-day free/planned, in `days` order. `weekCapacity` has always produced
   * this and nothing consumed it, so the only load figure on screen was the
   * week total — which cannot tell you that Tuesday is full.
   */
  dayCapacity?: DayCapacity[];
  /** Draw a block on a day's empty canvas. Absent ⇒ no canvas is rendered. */
  onCreate?: (date: string, span: CanvasSpan) => void;
  /** Owned by Plan, which needs it live to resolve a drop. */
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The hour grid inside the scroller. Plan reads its offsetTop as gridOffsetPx. */
  gridRef: RefObject<HTMLDivElement | null>;
  children: (date: string) => ReactNode;
}) {
  /*
   * Two axes, restored independently.
   *
   * Horizontal: bring today into view once per week. Vertical: put the working
   * day at the top once per week. Each stops the moment the user moves THAT
   * axis themselves — separate flags, because scrolling sideways to reach
   * Friday should not forfeit the scroll-to-working-hours, and vice versa.
   *
   * `weekKey` rather than `days`: `weekDates` returns a fresh array every
   * render, so keying on it re-ran this on the 60-second now-line tick and
   * threw away the user's scroll. See the note Plan.tsx carries for the same
   * hazard on its keydown listener.
   */
  const weekKey = days[0];
  const doneFor = useRef<string | null>(null);
  const userScrolledX = useRef(false);
  const userScrolledY = useRef(false);
  const programmaticX = useRef(false);
  const programmaticY = useRef(false);
  const lastLeft = useRef(0);
  const lastTop = useRef(0);

  /*
   * A LAYOUT effect, and it must be declared ABOVE the restore effect below.
   *
   * React flushes every layout effect during commit, before any passive
   * effect. If this stayed a `useEffect` while `restore` became a
   * `useLayoutEffect`, the ordering the original code relied on would invert:
   * on a week change `restore` would read the PREVIOUS week's `userScrolled`
   * flags, skip both axes because the user had scrolled last week, and only
   * then would this clear them — with nothing left to call `restore`. The
   * grid would neither centre on today nor scroll to the working day until an
   * unrelated resize happened to fire.
   */
  useLayoutEffect(() => {
    doneFor.current = null;
    userScrolledX.current = false;
    userScrolledY.current = false;
  }, [weekKey]);

  /*
   * Layout effect, not effect: the scroller's content starts at 00:00, so a
   * post-paint scroll shows the user midnight for one frame before jumping to
   * their working day. This runs before the browser paints.
   */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    function restore(): void {
      const node = scrollerRef.current;
      if (!node || doneFor.current === weekKey) return;

      if (!userScrolledY.current) {
        const targetTop = minuteToPx(scrollWindow.startMin);
        if (Math.abs(node.scrollTop - targetTop) >= 1) {
          programmaticY.current = true;
          node.scrollTop = targetTop;
          // Deliberately NOT updating `lastTop` here. The scroll event this
          // write provokes is the only thing that clears `programmaticY`, and
          // it only looks at the axis when the offset differs from `lastTop`.
          // Recording the new value up front makes them equal, the branch is
          // skipped, the flag stays latched — and it is then spent swallowing
          // the user's next real scroll instead.
        }
      }

      // Horizontal centring only applies once the grid actually overflows.
      // Returning WITHOUT marking the week done is the point of watching for
      // resizes: the grid is min-w-[780px], so a window dragged narrower makes
      // it scrollable long after mount.
      if (node.scrollWidth <= node.clientWidth) return;
      if (!userScrolledX.current) {
        const index = days.indexOf(today);
        if (index >= 0) {
          const colWidth = (node.scrollWidth - AXIS_WIDTH_PX) / days.length;
          const targetLeft = Math.max(
            0,
            AXIS_WIDTH_PX + index * colWidth - (node.clientWidth - AXIS_WIDTH_PX - colWidth) / 2,
          );
          if (Math.abs(node.scrollLeft - targetLeft) >= 1) {
            programmaticX.current = true;
            node.scrollLeft = targetLeft;
            // See the note on the vertical write: `lastLeft` is updated by the
            // scroll handler, never here.
          }
        }
      }
      doneFor.current = weekKey;
    }

    /*
     * One scroll event serves both axes, so which flag to set is decided by
     * which offset actually moved. Without the comparison, a programmatic
     * vertical scroll would consume the flag guarding the horizontal one.
     */
    function onScroll(): void {
      const node = scrollerRef.current;
      if (!node) return;
      if (node.scrollLeft !== lastLeft.current) {
        if (programmaticX.current) programmaticX.current = false;
        else userScrolledX.current = true;
        lastLeft.current = node.scrollLeft;
      }
      if (node.scrollTop !== lastTop.current) {
        if (programmaticY.current) programmaticY.current = false;
        else userScrolledY.current = true;
        lastTop.current = node.scrollTop;
      }
    }

    restore();
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => restore());
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `days` is derived
    // from `weekKey`; depending on the array re-runs this every render.
  }, [weekKey, today, scrollWindow.startMin]);

  const marks = hourMarks();
  const halfMarks = halfHourMarks();

  return (
    <div
      ref={scrollerRef}
      // `relative` makes this the `offsetParent` for `gridRef` below, which is
      // load-bearing: Plan.tsx reads `gridRef.current.offsetTop` as that
      // element's offset within THIS scroller. Drop `relative` and `offsetTop`
      // is measured against a different ancestor instead — silently, since
      // jsdom returns 0 for `offsetTop` regardless and no test would catch it.
      className="overflow-auto relative"
      style={{ height: `${GRID_VIEWPORT_PX}px` }}
    >
      {/* 7 columns cannot be legible on a phone, so the grid scrolls rather
          than squeezing — and it starts on today. 780px keeps a day column
          ~105px. */}
      <div className="min-w-[780px]">
        {/* day headings — sticky so they survive VERTICAL scrolling, over an
            opaque background so blocks pass behind rather than through */}
        <div
          className="grid gap-0 mb-[4px] sticky top-0 bg-bg"
          style={{ gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))`, zIndex: Z_HEADINGS }}
        >
          {/* The heading row is `sticky` with `zIndex: Z_HEADINGS`, which creates
              a stacking context the corner's `Z_CORNER` is scoped inside — it
              isn't compared against `Z_AXIS` at all. What actually keeps the
              corner above the axis is `Z_HEADINGS` (5) > `Z_AXIS` (4) on the
              parent row. */}
          <span className="sticky left-0 bg-bg" style={{ zIndex: Z_CORNER }} />
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
                {/* Fixed-height slot whether or not the day has a figure, so one
                    busy day cannot shove the header row down relative to its
                    neighbours. */}
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

        {/* the hour grid — a full day tall */}
        <div
          ref={gridRef}
          className="grid relative border-t border-line"
          style={{
            gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))`,
            height: `${DAY_HEIGHT_PX}px`,
          }}
        >
          {marks.map((m) => (
            <div
              key={m}
              className="absolute left-0 right-0 border-t border-line-soft pointer-events-none"
              style={{ top: `${minuteToPx(m)}px`, zIndex: Z_RULES }}
              aria-hidden="true"
            />
          ))}
          {/* Fainter than the hour rules — a reference, not a division. */}
          {halfMarks.map((m) => (
            <div
              key={`half-${m}`}
              className="absolute left-0 right-0 border-t border-line-soft/50 pointer-events-none"
              style={{ top: `${minuteToPx(m)}px`, zIndex: Z_RULES }}
              aria-hidden="true"
            />
          ))}

          <div className="sticky left-0 bg-bg" style={{ zIndex: Z_AXIS }}>
            {marks.map((m) => (
              <span
                key={m}
                className="absolute right-[6px] -translate-y-1/2 font-mono text-tiny text-muted tabular-nums"
                style={{ top: `${minuteToPx(m)}px` }}
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
              readOnly={readOnly}
              onCreate={onCreate ? (span) => onCreate(iso, span) : undefined}
            >
              {children(iso)}
            </DayColumn>
          ))}
        </div>
      </div>
    </div>
  );
}
