import { useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { todayStr, fmtD } from '../../lib/dates';
import { windowFrac, defaultNodeSpan, spanOutside } from '../../lib/timeline';
import type { DateWindow, Segment } from '../../lib/timeline';
import type { Goal, GoalNode, ZoomLevel } from '../../db/types';
import { nodePct } from '../../lib/pct';
import { SpanBar } from './SpanBar';

export const QUARTER_MONTHS = new Set([3, 6, 9]);

/** Shared month-grid + today-line backdrop for a plot area. `showToday` gates the
 * today-line — callers should only pass `true` when today falls inside the window
 * (`tf` in `[0, 100]`), since a window that doesn't contain today has no today-line. */
export function PlotGrid({ segs, tf, zoom, showToday }: { segs: Segment[]; tf: number; zoom: ZoomLevel; showToday: boolean }) {
  return (
    <>
      <div className="absolute inset-0 flex pointer-events-none">
        {segs.map((s, m) => (
          <span
            key={m}
            className={
              m === 0
                ? ''
                : zoom === 'year' && QUARTER_MONTHS.has(m)
                ? 'border-l border-line-2'
                : 'border-l border-line'
            }
            style={{ flex: `${s.days} 0 0` }}
          />
        ))}
      </div>
      {showToday && (
        <div
          className="absolute top-0 bottom-0 w-[1.5px] bg-accent opacity-55 z-[3] pointer-events-none"
          style={{ left: `${tf}%` }}
        />
      )}
    </>
  );
}

interface NodeLaneProps {
  goal: Goal;
  win: DateWindow;
  segs: Segment[];
  tf: number;
  zoom: ZoomLevel;
}

type NodeTip = { x: number; y: number; text: string };

/**
 * Expanded sub-goal section for one goal: a 34px lane per scheduled first-level
 * node (draggable SpanBar) plus a 30px "unscheduled" tray of chips. Nodes are
 * scheduling metadata only — dates never touch `done`/pct.
 */
export function NodeLane({ goal, win, segs, tf, zoom }: NodeLaneProps) {
  const { actions } = useAppStore();
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotW, setPlotW] = useState(0);
  const [tip, setTip] = useState<NodeTip | null>(null);
  const showToday = tf >= 0 && tf <= 100;

  // Measure the plot column's own width directly (not the whole row minus a
  // hardcoded label width) via a zero-height ruler that mirrors the real
  // label-column + plot-column split. Always mounted, so it tracks resizes
  // even while no node lane happens to be rendered yet.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const update = () => setPlotW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ruler = (
    <div className="flex h-0 overflow-hidden" aria-hidden="true">
      <div className="w-[200px] flex-shrink-0" />
      <div ref={plotRef} className="flex-1" />
    </div>
  );

  const isScheduled = (n: GoalNode) => Boolean(n.start && n.deadline);
  const scheduled = goal.nodes.filter(isScheduled);
  const unscheduled = goal.nodes.filter((n) => !isScheduled(n));

  if (goal.nodes.length === 0) {
    return (
      <div>
        {ruler}
        <div className="pl-[28px] pr-[12px] py-[9px] text-[.78rem] text-faint italic">
          No sub-goals yet — add them in the drawer.
        </div>
      </div>
    );
  }

  return (
    <div>
      {ruler}
      {scheduled.map((node) => {
        const span = { start: node.start!, deadline: node.deadline! };
        const warn = spanOutside(span, { start: goal.start, deadline: goal.deadline });
        const p = Math.round(nodePct(node));
        const barWidthPx = (windowFrac(span.deadline, win) - windowFrac(span.start, win)) * plotW;
        const showLabel = barWidthPx >= 90;
        return (
          <div key={node.id} className="group flex items-stretch h-[34px] border-t border-line">
            {/* Lane label */}
            <div className="w-[200px] flex-shrink-0 border-r border-line pl-[28px] pr-[8px] flex items-center justify-between gap-[4px] group-hover:bg-hover">
              <span className="text-[.78rem] text-ink-soft truncate">{node.title}</span>
              <button
                type="button"
                aria-label={`Unschedule ${node.title}`}
                onClick={() => actions.clearNodeDates(goal.id, node.id)}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-faint hover:text-warn text-[.8rem] leading-none px-[2px]"
              >
                ✕
              </button>
            </div>

            {/* Plot area */}
            <div className="flex-1 relative">
              <PlotGrid segs={segs} tf={tf} zoom={zoom} showToday={showToday} />
              <SpanBar
                span={span}
                win={win}
                pct={p}
                label={showLabel ? node.title : ''}
                ariaLabel={`${node.title}: ${p}% complete, ${fmtD(span.start)}–${fmtD(span.deadline)}, sub-goal of ${goal.title}. Arrow keys move by day, Shift for weeks, Alt+arrows adjust deadline.`}
                height={18}
                warn={warn}
                onCommit={(next) => actions.setNodeDates(goal.id, node.id, next.start, next.deadline)}
                onHover={(pos) =>
                  setTip(pos ? { x: pos.x, y: pos.y, text: `${node.title} · ${fmtD(span.start)} → ${fmtD(span.deadline)}` } : null)
                }
              />
            </div>
          </div>
        );
      })}

      {/* Unscheduled tray */}
      {unscheduled.length > 0 && (
        <div className="flex items-stretch min-h-[30px] border-t border-line">
          <div className="w-[200px] flex-shrink-0 border-r border-line pl-[28px] pr-[8px] flex items-center">
            <span className="font-mono text-[.6rem] tracking-[.1em] uppercase text-faint">Unscheduled</span>
          </div>
          <div className="flex-1 flex items-center gap-[6px] px-[8px] py-[4px] flex-wrap">
            {unscheduled.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  const sp = defaultNodeSpan({ start: goal.start, deadline: goal.deadline }, todayStr());
                  actions.setNodeDates(goal.id, node.id, sp.start, sp.deadline);
                }}
                className="bg-chip text-chip-ink rounded-full px-[10px] py-[2px] text-[.72rem] leading-[1.35] hover:opacity-80 transition-opacity"
              >
                + {node.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Node tooltip — fixed so it escapes the card's overflow:hidden */}
      {tip && (
        <div
          className="fixed z-[50] pointer-events-none bg-panel border border-line-2 rounded-[6px] px-[8px] py-[5px] select-none"
          style={{ left: tip.x + 10, top: tip.y - 38 }}
        >
          <span className="text-[.72rem] text-muted tabular-nums whitespace-nowrap">{tip.text}</span>
        </div>
      )}
    </div>
  );
}
