import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { todayStr, fmtD } from '../../lib/dates';
import { defaultNodeSpan, spanOutside, dateToX, daysBetween } from '../../lib/timeline';
import type { GridTick, DayBand } from '../../lib/timeline';
import type { Goal, GoalNode } from '../../db/types';
import { nodePct } from '../../lib/pct';
import { SpanBar } from './SpanBar';

/** Shared segment-divider + today-line backdrop for a canvas plot area.
 * Optional weekend `bands` shade Sat+Sun behind everything; dividers sit at
 * each segment start (skipping x=0); `major` segments (year boundaries, week
 * starts, month firsts) get the heavier line. The canvas range always
 * contains today, so the today-line is unconditional. */
export function CanvasGrid({
  segs, bands = [], rangeStart, pxPerDay, todayX,
}: { segs: GridTick[]; bands?: DayBand[]; rangeStart: string; pxPerDay: number; todayX: number }) {
  return (
    <>
      <div className="absolute inset-0 pointer-events-none">
        {bands.map((b) => (
          <span
            key={b.start}
            className="absolute top-0 bottom-0 bg-hover/50"
            style={{ left: `${dateToX(b.start, rangeStart, pxPerDay)}px`, width: `${b.days * pxPerDay}px` }}
          />
        ))}
        {segs.map((s) => {
          const x = dateToX(s.start, rangeStart, pxPerDay);
          if (x <= 0) return null;
          return (
            <span
              key={s.start}
              className={`absolute top-0 bottom-0 border-l ${s.major ? 'border-line-2' : 'border-line'}`}
              style={{ left: `${x}px` }}
            />
          );
        })}
      </div>
      <div
        className="absolute top-0 bottom-0 w-[1.5px] bg-accent opacity-55 z-[3] pointer-events-none"
        style={{ left: `${todayX}px` }}
      />
    </>
  );
}

interface NodeLaneProps {
  goal: Goal;
  rangeStart: string;
  pxPerDay: number;
  labelW: number;
  segs: GridTick[];
  bands: DayBand[];
  todayX: number;
  canvasW: number;
}

type NodeTip = { x: number; y: number; text: string };

/**
 * Expanded sub-goal section for one goal: a 34px lane per scheduled first-level
 * node (draggable SpanBar) plus a 30px "unscheduled" tray of chips. Nodes are
 * scheduling metadata only — dates never touch `done`/pct.
 */
export function NodeLane({ goal, rangeStart, pxPerDay, labelW, segs, bands, todayX, canvasW }: NodeLaneProps) {
  const { actions } = useAppStore();
  const [tip, setTip] = useState<NodeTip | null>(null);
  const today = todayStr();

  const isScheduled = (n: GoalNode) => Boolean(n.start && n.deadline);
  const scheduled = goal.nodes.filter(isScheduled);
  const unscheduled = goal.nodes.filter((n) => !isScheduled(n));

  // Schedule an unscheduled phase (default 7-day span) and open it for adjustment
  // rather than a separate date picker (spec §3.3).
  function schedule(node: GoalNode) {
    const sp = defaultNodeSpan({ start: goal.start, deadline: goal.deadline }, today);
    actions.setNodeDates(goal.id, node.id, sp.start, sp.deadline);
    actions.openDrawer(goal.id, node.id);
  }

  if (goal.nodes.length === 0) {
    return (
      <div className="sticky left-0 w-fit pl-[28px] pr-[12px] py-[9px] text-[.78rem] text-faint italic">
        No sub-goals yet — add them in the drawer.
      </div>
    );
  }

  return (
    <div>
      {scheduled.map((node) => {
        const span = { start: node.start!, deadline: node.deadline! };
        const p = Math.round(nodePct(node));
        // Warn when a phase falls outside the project span, or is past due while
        // still incomplete — mirrors roadmapWarnings' phase checks.
        const warn = spanOutside(span, { start: goal.start, deadline: goal.deadline }) || (span.deadline < today && p < 100);
        const barWidthPx = daysBetween(span.start, span.deadline) * pxPerDay;
        const showLabel = barWidthPx >= 90;
        return (
          <div key={node.id} className="group flex items-stretch h-[34px] border-t border-line">
            {/* Lane label — sticky so it stays put while the canvas scrolls under it */}
            <div className="sticky left-0 z-[10] tl-label-w flex-shrink-0 border-r border-line pl-[28px] pr-[8px] flex items-center justify-between gap-[4px] bg-panel group-hover:bg-hover">
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
            <div className="relative flex-none" style={{ width: `${canvasW}px` }}>
              <CanvasGrid segs={segs} bands={bands} rangeStart={rangeStart} pxPerDay={pxPerDay} todayX={todayX} />
              <SpanBar
                span={span}
                rangeStart={rangeStart}
                pxPerDay={pxPerDay}
                pct={p}
                label={showLabel ? node.title : ''}
                ariaLabel={`${node.title}: ${p}% complete, ${fmtD(span.start)}–${fmtD(span.deadline)}, sub-goal of ${goal.title}. Arrow keys move by day, Shift for weeks, Alt+arrows adjust deadline.`}
                height={18}
                warn={warn}
                onCommit={(next) => actions.setNodeDates(goal.id, node.id, next.start, next.deadline)}
                onOpen={() => actions.openDrawer(goal.id, node.id)}
                onHover={(pos) =>
                  setTip(pos ? { x: pos.x, y: pos.y, text: `${node.title} · ${fmtD(span.start)} → ${fmtD(span.deadline)}` } : null)
                }
              />
            </div>
          </div>
        );
      })}

      {/* Unscheduled phases — a labelled row (no long chip tray); each phase has
          Schedule (assigns the default span + opens it) and Open (spec §3.3). */}
      {unscheduled.length > 0 && (
        <div className="flex items-stretch min-h-[30px] border-t border-line">
          <div className="sticky left-0 z-[10] tl-label-w flex-shrink-0 border-r border-line pl-[28px] pr-[8px] flex items-center bg-panel">
            <span className="font-mono text-[.6rem] tracking-[.1em] uppercase text-faint">
              Unscheduled phases ({unscheduled.length})
            </span>
          </div>
          <div className="flex-none px-[8px] py-[4px]" style={{ width: `${canvasW}px` }}>
            <div
              className="sticky inline-flex items-center gap-[10px] flex-wrap"
              style={{ left: `${labelW + 8}px` }}
            >
              {unscheduled.map((node) => (
                <span key={node.id} className="inline-flex items-center gap-[5px] text-[.72rem]">
                  <span className="text-ink-soft truncate max-w-[160px]">{node.title}</span>
                  <button
                    type="button"
                    onClick={() => schedule(node)}
                    className="text-accent-deep font-medium hover:underline"
                  >
                    Schedule
                  </button>
                  <span className="text-faint">·</span>
                  <button
                    type="button"
                    onClick={() => actions.openDrawer(goal.id, node.id)}
                    className="text-muted hover:text-ink"
                  >
                    Open
                  </button>
                </span>
              ))}
            </div>
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
