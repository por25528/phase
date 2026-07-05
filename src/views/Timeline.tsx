import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr, parseD, addDays } from '../lib/dates';
import {
  PX_PER_DAY,
  DAY_DETAIL_MIN,
  DAY_TICK_MIN_PX,
  LABEL_W,
  LABEL_W_NARROW,
  LABEL_BREAKPOINT,
  EXTEND_THRESHOLD_PX,
  chunkDays,
  initialRange,
  rangeWidth,
  dateToX,
  xToDate,
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

// The sticky label column is LABEL_W (200px) at ≥640px and LABEL_W_NARROW (148px)
// below — matching the `.tl-label-w` Tailwind class. All plot geometry reads the live
// value or the mobile canvas drifts from the narrower label column. Defaults to the
// wide value where matchMedia is unavailable (SSR/tests) — same as pre-change behavior.
function useLabelW(): number {
  const query = `(min-width: ${LABEL_BREAKPOINT}px)`;
  const [wide, setWide] = useState(
    () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return wide ? LABEL_W : LABEL_W_NARROW;
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
  const labelW = useLabelW();
  const labelWRef = useRef(labelW);
  labelWRef.current = labelW;

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
  const rangeRef = useRef(range);
  rangeRef.current = range;
  // Plot-relative viewport x a zoom gesture is anchored to; null → scale about center.
  const anchorX = useRef<number | null>(null);
  const [headerCenter, setHeaderCenter] = useState(todayStr());

  // Decoration culling: ticks, day cells, and weekend bands only render for
  // the dates near the viewport, not the whole canvas — at day-detail scales
  // the full range is thousands of DOM nodes, which is what makes pinch
  // zooming chug. `view` covers the viewport ±1.5 viewports and only rebuilds
  // (hysteresis) when the visible edge escapes it or the scale changes.
  const [view, setView] = useState<{ range: DateRange; px: number }>(() => ({ range, px: pxPerDay }));
  const updateView = useCallback((el: HTMLDivElement) => {
    const px = pxRef.current;
    const whole = rangeRef.current;
    const plotW = el.clientWidth - labelWRef.current;
    setView((v) => {
      const visStart = xToDate(Math.max(0, el.scrollLeft), whole.start, px);
      const visEnd = xToDate(el.scrollLeft + plotW, whole.start, px);
      if (v.px === px && v.range.start <= visStart && visEnd <= v.range.end) return v;
      const start = xToDate(Math.max(0, el.scrollLeft - 1.5 * plotW), whole.start, px);
      const end = xToDate(el.scrollLeft + 2.5 * plotW, whole.start, px);
      return {
        px,
        range: {
          start: start < whole.start ? whole.start : start,
          end: end > whole.end ? whole.end : end,
        },
      };
    });
  }, []);

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
    if (el) {
      ensureCoverage(el);
      updateView(el);
    }
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
    const plotW = el.clientWidth - labelWRef.current;
    const q = anchorX.current ?? plotW / 2;
    anchorX.current = null;
    el.scrollLeft = (el.scrollLeft + q) * (pxPerDay / prev) - q;
    ensureCoverage(el);
    updateView(el);
  }, [pxPerDay, ensureCoverage, updateView]);

  // 3. Consume a pending center (mount → today; Today button while unmounted).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pendingCenter.current) return;
    el.scrollLeft = scrollLeftForCenter(pendingCenter.current, el.clientWidth - labelWRef.current, range.start, pxPerDay);
    setHeaderCenter(pendingCenter.current);
    pendingCenter.current = null;
    updateView(el);
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
    let lastClientX = 0;
    let raf: number | null = null;
    function flush() {
      raf = null;
      const f = pendingFactor;
      pendingFactor = 1;
      if (f === 1) return;
      // One layout read per frame, not per event — pinch fires at 60–120Hz
      const rect = el!.getBoundingClientRect();
      anchorX.current = Math.max(0, Math.min(el!.clientWidth - labelWRef.current, lastClientX - rect.left - labelWRef.current));
      actions.setScale(pxRef.current * f);
    }
    function queue(factor: number, clientX: number) {
      lastClientX = clientX;
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
      queue(Math.exp(-dy * 0.012), e.clientX);
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
      queue(Math.pow(g.scale / gestureBase, 1.5), g.clientX ?? el!.getBoundingClientRect().left + labelWRef.current);
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
      sc.scrollBy({ left: dir * 0.8 * (sc.clientWidth - labelWRef.current), behavior: reduced ? 'auto' : 'smooth' });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reduced]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    ensureCoverage(el);
    updateView(el);
    // Header label only needs month granularity — avoid re-rendering per frame.
    const c = centerDateOf(el.scrollLeft, el.clientWidth - labelWRef.current, range.start, pxPerDay);
    if (c.slice(0, 7) !== headerCenter.slice(0, 7)) setHeaderCenter(c);
  }

  function scrollToToday() {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({
      left: scrollLeftForCenter(todayStr(), el.clientWidth - labelWRef.current, range.start, pxPerDay),
      behavior: reduced ? 'auto' : 'smooth',
    });
  }

  const dayDetail = pxPerDay >= DAY_DETAIL_MIN;
  // All decorations generate over the culled `view`, not the whole range —
  // positions still use range.start as the origin, so nothing shifts.
  const decoRange = view.range;
  const ticks = useMemo(() => rulerTicks(decoRange, pxPerDay), [decoRange, pxPerDay]);
  const gridTicks: GridTick[] = useMemo(
    () =>
      dayDetail
        ? ticks.map((t) => ({ start: t.start, major: t.unit !== 'day' }))
        : ticks
            .filter((t) => t.unit !== 'day')
            .map((t) => ({ start: t.start, major: t.unit === 'month' || t.unit === 'year' })),
    [ticks, dayDetail],
  );
  const daySegs = useMemo(() => (dayDetail ? daySegments(decoRange) : null), [dayDetail, decoRange]);
  // Weekend shading appears with the day graduations — once days are
  // discernible, the Sat+Sun rhythm is orientation, not decoration.
  const showBands = pxPerDay >= DAY_TICK_MIN_PX;
  const bands = useMemo(() => (showBands ? weekendBands(decoRange) : []), [showBands, decoRange]);
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
          <div style={{ width: `${labelW + canvasW}px` }}>
            {/* Time header — sticky against vertical scroll; its label cell also against horizontal */}
            <div className="sticky top-0 z-[15] flex border-b border-line bg-bg">
              <div className="sticky left-0 z-[16] tl-label-w flex-shrink-0 border-r border-line px-[12px] py-[9px] text-[.7rem] tracking-[.1em] uppercase text-muted font-semibold bg-bg">
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
                labelW={labelW}
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
