import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr, parseD, addDays } from '../lib/dates';
import {
  PX_PER_DAY,
  PERIOD_DAYS,
  LABEL_W,
  EXTEND_THRESHOLD_PX,
  chunkDays,
  initialRange,
  rangeWidth,
  dateToX,
  centerDateOf,
  scrollLeftForCenter,
  monthSegments,
  daySegments,
  daysBetween,
} from '../lib/timeline';
import type { DateRange } from '../lib/timeline';
import type { ZoomLevel } from '../db/types';
import { GoalRow } from './timeline/GoalRow';
import { DaysLane } from './timeline/DaysLane';
import { useReducedMotion } from './today/useReducedMotion';

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Mono header label for the date at the viewport center: quarter → `Q3 2026`,
 * week/month → `JULY 2026`. */
function headerLabel(zoom: ZoomLevel, center: string): string {
  const d = parseD(center);
  const y = d.getFullYear();
  if (zoom === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${y}`;
  return `${MONTH_FULL[d.getMonth()].toUpperCase()} ${y}`;
}

/**
 * Infinite-scroll canvas timeline. Zoom is a fixed px-per-day scale; the canvas
 * covers `range` and quietly extends itself when scroll nears an edge (prepends
 * are compensated in a layout effect so nothing visually jumps). The label
 * column and time header are sticky; Today re-centers; switching zoom preserves
 * the date at the viewport center; `[`/`]` scroll one period.
 */
export function Timeline() {
  const { goals, zoom, actions } = useAppStore();
  const reduced = useReducedMotion();
  const pxPerDay = PX_PER_DAY[zoom];

  // Every date the canvas must contain (first-level node spans are what
  // NodeLane renders; deeper nodes are never plotted).
  const allDates = useMemo(() => {
    const ds: string[] = [];
    for (const g of goals) {
      ds.push(g.start, g.deadline);
      for (const m of g.milestones ?? []) ds.push(m.date);
      for (const n of g.nodes) {
        if (n.start) ds.push(n.start);
        if (n.deadline) ds.push(n.deadline);
      }
    }
    return ds;
  }, [goals]);
  const allDatesRef = useRef(allDates);
  allDatesRef.current = allDates;

  const [range, setRange] = useState<DateRange>(() => initialRange(zoom, todayStr(), allDates));
  const scrollerRef = useRef<HTMLDivElement>(null);
  const prevRangeStart = useRef(range.start);
  const pendingCenter = useRef<string | null>(todayStr());
  const extendLock = useRef(false);
  const lastZoom = useRef(zoom);
  const [headerCenter, setHeaderCenter] = useState(todayStr());

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // 1. Prepend compensation — after the DOM grows leftward, shift scrollLeft by
  // the same width before paint so the viewport doesn't visually move.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const shifted = daysBetween(range.start, prevRangeStart.current);
    prevRangeStart.current = range.start;
    extendLock.current = false;
    if (el && shifted > 0) el.scrollLeft += shifted * pxPerDay;
  }, [range.start, pxPerDay]);

  // 2. Zoom changed (radio click or persisted zoom arriving at init): rebuild
  // the range around the date that was at the viewport center.
  useLayoutEffect(() => {
    if (lastZoom.current === zoom) return;
    lastZoom.current = zoom;
    const center = pendingCenter.current ?? todayStr();
    pendingCenter.current = center;
    const next = initialRange(zoom, todayStr(), allDatesRef.current, center);
    prevRangeStart.current = next.start;
    setRange(next);
  }, [zoom]);

  // 3. Consume a pending center (mount → today; zoom switch → captured date).
  // Depends on `range` only: on a zoom-change render the range hasn't been
  // rebuilt yet, so this must not fire until effect 2's setRange lands.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pendingCenter.current) return;
    el.scrollLeft = scrollLeftForCenter(pendingCenter.current, el.clientWidth - LABEL_W, range.start, pxPerDay);
    setHeaderCenter(pendingCenter.current);
    pendingCenter.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // 4. Keep the range covering every plotted date (goals added/edited while
  // the timeline is mounted). Prepends are compensated by effect 1.
  useEffect(() => {
    setRange((r) => {
      let { start, end } = r;
      for (const d of allDates) {
        if (d < start) start = addDays(d, -chunkDays(pxPerDay));
        if (d > end) end = addDays(d, chunkDays(pxPerDay));
      }
      return start === r.start && end === r.end ? r : { start, end };
    });
  }, [allDates, pxPerDay]);

  // `[` / `]` scroll one period while the Timeline view is mounted (i.e. active).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== '[' && e.key !== ']') return;
      const dir = e.key === '[' ? -1 : 1;
      scrollerRef.current?.scrollBy({
        left: dir * PERIOD_DAYS[zoom] * PX_PER_DAY[zoom],
        behavior: reduced ? 'auto' : 'smooth',
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, reduced]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    if (!extendLock.current) {
      if (scrollLeft < EXTEND_THRESHOLD_PX) {
        extendLock.current = true;
        setRange((r) => ({ ...r, start: addDays(r.start, -chunkDays(pxPerDay)) }));
      } else if (scrollLeft > scrollWidth - clientWidth - EXTEND_THRESHOLD_PX) {
        extendLock.current = true;
        setRange((r) => ({ ...r, end: addDays(r.end, chunkDays(pxPerDay)) }));
      }
    }
    // Header label only needs month granularity — avoid re-rendering per frame.
    const c = centerDateOf(scrollLeft, clientWidth - LABEL_W, range.start, pxPerDay);
    if (c.slice(0, 7) !== headerCenter.slice(0, 7)) setHeaderCenter(c);
  }

  function scrollToToday() {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({
      left: scrollLeftForCenter(todayStr(), el.clientWidth - LABEL_W, range.start, pxPerDay),
      behavior: reduced ? 'auto' : 'smooth',
    });
  }

  function switchZoom(z: ZoomLevel) {
    if (z === zoom) return;
    const el = scrollerRef.current;
    pendingCenter.current = el
      ? centerDateOf(el.scrollLeft, el.clientWidth - LABEL_W, range.start, pxPerDay)
      : todayStr();
    actions.setZoom(z);
  }

  const segs = useMemo(
    () => (zoom === 'week' ? daySegments(range) : monthSegments(range)),
    [zoom, range],
  );
  const todayX = dateToX(todayStr(), range.start, pxPerDay);
  const canvasW = rangeWidth(range, pxPerDay);

  return (
    <div>
      <h1 className="font-disp text-[1.4rem] font-semibold tracking-[-0.015em] mb-[16px]">Timeline</h1>

      <div className="flex items-center justify-between mb-[10px]">
        <div className="flex items-center gap-[6px]">
          <button
            type="button"
            onClick={scrollToToday}
            title="Scroll to today"
            aria-label="Scroll to today"
            className="px-[10px] h-[26px] rounded-[6px] border border-line-2 text-[.78rem] text-ink-soft hover:bg-hover"
          >
            Today
          </button>
          <span className="font-mono text-[.78rem] tracking-[.05em] text-ink-soft tabular-nums ml-[6px]">
            {headerLabel(zoom, headerCenter)}
          </span>
        </div>

        <div className="flex border border-line-2 rounded-[6px] overflow-hidden text-[.78rem] font-medium">
          {(['week', 'month', 'quarter'] as ZoomLevel[]).map(z => (
            <button key={z} type="button" onClick={() => switchZoom(z)} aria-pressed={zoom === z}
              className={`px-[12px] py-[4px] transition-colors duration-100 ${
                zoom === z ? 'bg-accent-tint text-ink' : 'text-ink-soft hover:bg-hover'}`}>
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state — no canvas needed */}
      {goals.length === 0 ? (
        <div className="mt-[6px] border border-line rounded-[10px] bg-panel px-[12px] py-[32px] text-center text-faint text-[.85rem] italic">
          Nothing on your year yet — add a goal in Goals › + new goal to see it here.
        </div>
      ) : (
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="mt-[6px] border border-line rounded-[10px] bg-panel overflow-auto max-h-[calc(100vh-190px)]"
        >
          <div style={{ width: `${LABEL_W + canvasW}px` }}>
            {/* Time header — sticky against vertical scroll; its label cell also against horizontal */}
            <div className="sticky top-0 z-[15] flex border-b border-line bg-bg">
              <div className="sticky left-0 z-[16] w-[200px] flex-shrink-0 border-r border-line px-[12px] py-[9px] text-[.7rem] tracking-[.1em] uppercase text-muted font-semibold bg-bg">
                Goal
              </div>
              <div className="relative flex-none" style={{ width: `${canvasW}px` }}>
                {zoom === 'week' ? (
                  // Day-level detail absorbed from the Calendar page
                  <DaysLane segs={segs} rangeStart={range.start} pxPerDay={pxPerDay} />
                ) : (
                  <>
                    {/* Today caret sits above the today-line */}
                    <div
                      className="absolute inset-y-0 flex flex-col justify-start items-center pointer-events-none z-[5]"
                      style={{ left: `${todayX}px`, transform: 'translateX(-50%)' }}
                    >
                      <span className="text-accent text-[.62rem] tabular-nums font-medium leading-none pt-[3px] select-none">
                        Today
                      </span>
                    </div>
                    {segs.map((s) => {
                      const x = dateToX(s.start, range.start, pxPerDay);
                      return (
                        <div
                          key={s.start}
                          className={`absolute inset-y-0 py-[9px] pl-[7px] text-[.72rem] text-muted font-medium overflow-hidden whitespace-nowrap${
                            x <= 0 ? '' : s.major ? ' border-l border-line-2' : ' border-l border-line'
                          }`}
                          style={{ left: `${x}px`, width: `${s.days * pxPerDay}px` }}
                        >
                          {s.label}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* Goal rows */}
            {goals.map((g, i) => (
              <GoalRow
                key={g.id}
                goal={g}
                index={i}
                rangeStart={range.start}
                pxPerDay={pxPerDay}
                segs={segs}
                todayX={todayX}
                canvasW={canvasW}
                isExpanded={expanded.has(g.id)}
                onToggle={toggle}
                isLast={i === goals.length - 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
