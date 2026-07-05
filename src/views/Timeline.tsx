import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr, parseD, addDays } from '../lib/dates';
import {
  PX_PER_DAY,
  DAY_DETAIL_MIN,
  DAY_TICK_MIN_PX,
  LABEL_W,
  EXTEND_THRESHOLD_PX,
  chunkDays,
  initialRange,
  rangeWidth,
  dateToX,
  centerDateOf,
  scrollLeftForCenter,
  rulerTicks,
  daySegments,
  weekendBands,
  daysBetween,
} from '../lib/timeline';
import type { DateRange, GridTick } from '../lib/timeline';
import type { ZoomLevel } from '../db/types';
import { GoalRow } from './timeline/GoalRow';
import { DaysLane } from './timeline/DaysLane';
import { Ruler } from './timeline/Ruler';
import { useReducedMotion } from './today/useReducedMotion';

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Mono header label for the date at the viewport center — month + year, or
 * just the year once zoomed far enough out that a single month is noise. */
function headerLabel(pxPerDay: number, center: string): string {
  const d = parseD(center);
  if (pxPerDay < 8) return String(d.getFullYear());
  return `${MONTH_FULL[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
}

/**
 * Infinite-scroll canvas timeline with a continuous, gesture-driven scale.
 * `pxPerDay` (store state) is adjusted by trackpad pinch / ctrl- or cmd-wheel,
 * anchored at the cursor so the date under the pointer stays put; the
 * Week/Month/Quarter buttons snap to preset scales about the viewport center.
 * The canvas covers `range` and quietly extends itself near scroll edges
 * (prepends compensated before paint). The header renders an adaptive ruler
 * whose graduations densify as you zoom; past DAY_DETAIL_MIN it becomes the
 * DaysLane day strip.
 */
export function Timeline() {
  const { goals, pxPerDay, actions } = useAppStore();
  const reduced = useReducedMotion();

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

  const [range, setRange] = useState<DateRange>(() => initialRange(pxPerDay, todayStr(), allDates));
  const scrollerRef = useRef<HTMLDivElement>(null);
  const prevRangeStart = useRef(range.start);
  const pendingCenter = useRef<string | null>(todayStr());
  const extendLock = useRef(false);
  const prevPx = useRef(pxPerDay);
  const pxRef = useRef(pxPerDay);
  pxRef.current = pxPerDay;
  // Plot-relative viewport x a zoom gesture is anchored to; null → scale about center.
  const anchorX = useRef<number | null>(null);
  const [headerCenter, setHeaderCenter] = useState(todayStr());

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Extend the range when scroll (or a zoom-out) brings an edge near the
  // viewport. One chunk per pass; the unlock effect re-checks, so repeated
  // passes converge without a loop here.
  const ensureCoverage = useCallback((el: HTMLDivElement) => {
    if (extendLock.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    if (scrollLeft < EXTEND_THRESHOLD_PX) {
      extendLock.current = true;
      setRange((r) => ({ ...r, start: addDays(r.start, -chunkDays(pxRef.current)) }));
    } else if (scrollLeft > scrollWidth - clientWidth - EXTEND_THRESHOLD_PX) {
      extendLock.current = true;
      setRange((r) => ({ ...r, end: addDays(r.end, chunkDays(pxRef.current)) }));
    }
  }, []);

  // 1. Prepend compensation + extension unlock — after the DOM grows leftward,
  // shift scrollLeft by the same width before paint so nothing visually moves.
  // Keyed on the whole range: appends must also unlock and re-check coverage.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const shifted = daysBetween(range.start, prevRangeStart.current);
    prevRangeStart.current = range.start;
    extendLock.current = false;
    if (el && shifted > 0) el.scrollLeft += shifted * pxPerDay;
    if (el) ensureCoverage(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // 2. Scale changed: rescale the scroll position about the gesture anchor
  // (cursor) or, absent one (presets, persisted-scale load), the viewport
  // center — the anchored date stays visually fixed while time stretches.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const prev = prevPx.current;
    prevPx.current = pxPerDay;
    if (!el || prev === pxPerDay) return;
    const plotW = el.clientWidth - LABEL_W;
    const q = anchorX.current ?? plotW / 2;
    anchorX.current = null;
    el.scrollLeft = (el.scrollLeft + q) * (pxPerDay / prev) - q;
    ensureCoverage(el);
  }, [pxPerDay, ensureCoverage]);

  // 3. Consume a pending center (mount → today; Today button while unmounted).
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

  // 5. Pinch / ctrl+wheel / cmd+wheel zoom, rAF-coalesced and cursor-anchored.
  // Native listeners: React registers wheel as passive, which would forbid
  // preventDefault (the browser would page-zoom instead).
  const hasCanvas = goals.length > 0;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let pendingFactor = 1;
    let raf: number | null = null;
    function flush() {
      raf = null;
      const f = pendingFactor;
      pendingFactor = 1;
      if (f !== 1) actions.setScale(pxRef.current * f);
    }
    function queue(factor: number, clientX: number) {
      const rect = el!.getBoundingClientRect();
      anchorX.current = Math.max(0, Math.min(el!.clientWidth - LABEL_W, clientX - rect.left - LABEL_W));
      pendingFactor *= factor;
      if (raf == null) raf = requestAnimationFrame(flush);
    }
    function onWheel(e: WheelEvent) {
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (!e.ctrlKey && !e.metaKey) {
        // Plain vertical wheel: when the card has no vertical overflow to
        // spend it on, pan the timeline horizontally instead (Gantt idiom) —
        // this is what makes mouse-wheel scrolling useful here.
        if (el!.scrollHeight <= el!.clientHeight && Math.abs(dy) > Math.abs(e.deltaX)) {
          e.preventDefault();
          el!.scrollLeft += dy;
        }
        return; // trackpad pinch arrives as ctrl+wheel; anything else is native
      }
      e.preventDefault();
      queue(Math.exp(-dy * 0.009), e.clientX);
    }
    // Safari fires proprietary gesture events for pinch instead
    let gestureBase = 1;
    function onGestureStart(e: Event) {
      e.preventDefault();
      gestureBase = 1;
    }
    function onGestureChange(e: Event) {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX?: number };
      // Amplify past the physical pinch ratio so a full gesture covers more range
      queue(Math.pow(g.scale / gestureBase, 1.5), g.clientX ?? el!.getBoundingClientRect().left + LABEL_W);
      gestureBase = g.scale;
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [hasCanvas, actions]);

  // `[` / `]` page by most of a viewport while the Timeline view is mounted.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== '[' && e.key !== ']') return;
      const sc = scrollerRef.current;
      if (!sc) return;
      const dir = e.key === '[' ? -1 : 1;
      sc.scrollBy({ left: dir * 0.8 * (sc.clientWidth - LABEL_W), behavior: reduced ? 'auto' : 'smooth' });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reduced]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    ensureCoverage(el);
    // Header label only needs month granularity — avoid re-rendering per frame.
    const c = centerDateOf(el.scrollLeft, el.clientWidth - LABEL_W, range.start, pxPerDay);
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

  const dayDetail = pxPerDay >= DAY_DETAIL_MIN;
  const ticks = useMemo(() => rulerTicks(range, pxPerDay), [range, pxPerDay]);
  const gridTicks: GridTick[] = useMemo(
    () =>
      dayDetail
        ? ticks.map((t) => ({ start: t.start, major: t.unit !== 'day' }))
        : ticks
            .filter((t) => t.unit !== 'day')
            .map((t) => ({ start: t.start, major: t.unit === 'month' || t.unit === 'year' })),
    [ticks, dayDetail],
  );
  const daySegs = useMemo(() => (dayDetail ? daySegments(range) : null), [dayDetail, range]);
  // Weekend shading appears with the day graduations — once days are
  // discernible, the Sat+Sun rhythm is orientation, not decoration.
  const showBands = pxPerDay >= DAY_TICK_MIN_PX;
  const bands = useMemo(() => (showBands ? weekendBands(range) : []), [showBands, range]);
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
            {headerLabel(pxPerDay, headerCenter)}
          </span>
        </div>

        <div
          className="flex border border-line-2 rounded-[6px] overflow-hidden text-[.78rem] font-medium"
          title="Pinch or ⌃/⌘-scroll the timeline to zoom freely"
        >
          {(['week', 'month', 'quarter'] as ZoomLevel[]).map(z => (
            <button key={z} type="button" onClick={() => actions.setScale(PX_PER_DAY[z])}
              aria-pressed={Math.abs(pxPerDay - PX_PER_DAY[z]) < 0.5}
              className={`px-[12px] py-[4px] transition-colors duration-100 ${
                Math.abs(pxPerDay - PX_PER_DAY[z]) < 0.5 ? 'bg-accent-tint text-ink' : 'text-ink-soft hover:bg-hover'}`}>
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state — no canvas needed */}
      {!hasCanvas ? (
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
                {dayDetail ? (
                  // Day-level detail absorbed from the Calendar page
                  <DaysLane segs={daySegs!} rangeStart={range.start} pxPerDay={pxPerDay} />
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
                    <Ruler ticks={ticks} rangeStart={range.start} pxPerDay={pxPerDay} />
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
                segs={gridTicks}
                bands={bands}
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
