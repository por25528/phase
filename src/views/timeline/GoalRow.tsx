import { memo, useState } from 'react';
import { useAppStore } from '../../state/store';
import { todayStr, fmtD, daysLeftLabel } from '../../lib/dates';
import { expectedPct, behindPaceBy, dateToX } from '../../lib/timeline';
import type { GridTick } from '../../lib/timeline';
import type { Goal } from '../../db/types';
import { goalPct } from '../../lib/pct';
import { SpanBar, type Span } from './SpanBar';
import { NodeLane, CanvasGrid } from './NodeLane';
import { BehindChip } from '../../components/BehindChip';
import { useReducedMotion } from '../today/useReducedMotion';

interface GoalRowProps {
  goal: Goal;
  index: number;
  rangeStart: string;
  pxPerDay: number;
  segs: GridTick[];
  todayX: number;
  canvasW: number;
  isExpanded: boolean;
  onToggle(id: string): void;
  isLast: boolean;
}

/**
 * One goal's Timeline row: the sticky lane-label column (chevron + `#n` kicker +
 * title), the canvas plot area (segment grid + today line + goal SpanBar +
 * deadline flag + milestones), and — when expanded — the NodeLane sub-goal
 * section. Owns its own tooltip/preview state; the fixed-position tooltips
 * escape the card overflow. Memoized so scroll-driven header re-renders in the
 * parent don't touch every row.
 */
export const GoalRow = memo(function GoalRow({
  goal: g, index: i, rangeStart, pxPerDay, segs, todayX, canvasW, isExpanded, onToggle, isLast,
}: GoalRowProps) {
  const { actions } = useAppStore();
  const reduced = useReducedMotion();
  const [barTip, setBarTip] = useState<{ x: number; y: number } | null>(null);
  const [flagTip, setFlagTip] = useState<{ x: number; y: number } | null>(null);
  const [msTip, setMsTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [preview, setPreview] = useState<Span | null>(null);

  const flagDeadline = preview ? preview.deadline : g.deadline;
  const flagX = dateToX(flagDeadline, rangeStart, pxPerDay);
  const p = Math.round(goalPct(g));
  const behind = Math.round(behindPaceBy(p, g.start, g.deadline, todayStr()));

  return (
    <div className={isLast ? '' : 'border-b border-line'}>
      <div className="group flex items-stretch min-h-[52px]">
        {/* Lane label — sticky so it stays put while the canvas scrolls under it */}
        <div className="sticky left-0 z-[10] w-[200px] flex-shrink-0 border-r border-line px-[12px] py-[8px] flex items-center gap-[7px] bg-panel group-hover:bg-hover">
          <button
            type="button"
            onClick={() => onToggle(g.id)}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${g.title}`}
            className="flex-shrink-0 w-[16px] h-[16px] flex items-center justify-center text-muted hover:text-ink rounded-[3px] hover:bg-hover-deep"
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              aria-hidden="true"
              className={reduced ? '' : 'transition-transform duration-150'}
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}
            >
              <path d="M2 1 L6 4 L2 7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex flex-col justify-center gap-[2px] min-w-0">
            <span className="text-[.66rem] text-faint font-semibold tracking-[.06em]">#{i + 1}</span>
            <span className="text-[.84rem] font-medium text-ink leading-[1.25]">{g.title}</span>
            <span className="flex items-center gap-[5px] min-w-0">
              <span className="text-[.68rem] text-muted tabular-nums truncate">
                {p}% · {daysLeftLabel(g.deadline)}
              </span>
              {behind >= 10 && <BehindChip pts={behind} className="flex-none" />}
            </span>
          </div>
        </div>

        {/* Plot area */}
        <div className="relative flex-none" style={{ width: `${canvasW}px` }}>
          <CanvasGrid segs={segs} rangeStart={rangeStart} pxPerDay={pxPerDay} todayX={todayX} />

          {/* Goal bar — keyboard-accessible draggable/resizable span */}
          <SpanBar
            span={{ start: g.start, deadline: g.deadline }}
            rangeStart={rangeStart}
            pxPerDay={pxPerDay}
            pct={p}
            label={`${p}%`}
            ariaLabel={`${g.title}: ${p}% complete, ${fmtD(g.start)}–${fmtD(g.deadline)}. Arrow keys move by day, Shift for weeks, Alt+arrows adjust deadline.`}
            height={22}
            onCommit={(next) => actions.setGoalDates(g.id, next.start, next.deadline)}
            onOpen={() => actions.openDrawer(g.id)}
            onHover={(pos) => setBarTip(pos)}
            onPreview={(s) => setPreview(s)}
          />

          {/* Deadline flag — hover reveals date tooltip */}
          <div
            className="absolute top-[4px] bottom-[4px] w-[2px] bg-accent z-[4] cursor-default"
            style={{ left: `${flagX}px` }}
            onMouseEnter={(e) => {
              setBarTip(null);
              setFlagTip({ x: e.clientX, y: e.clientY });
            }}
            onMouseLeave={() => setFlagTip(null)}
          >
            <span className="absolute top-[-1px] left-[-2px] border-[3px] border-transparent border-t-accent pointer-events-none" />
          </div>

          {/* Milestone markers */}
          {(g.milestones ?? []).map((m) => (
            <span
              key={m.id}
              className="absolute top-[3px] -translate-x-1/2 text-accent text-[.58rem] leading-none z-[4] cursor-default select-none"
              style={{ left: `${dateToX(m.date, rangeStart, pxPerDay)}px` }}
              onMouseEnter={(e) => setMsTip({ x: e.clientX, y: e.clientY, text: `${m.title} · ${fmtD(m.date)}` })}
              onMouseLeave={() => setMsTip(null)}
            >
              ◆
            </span>
          ))}
        </div>
      </div>

      {/* Expanded sub-goal lanes + unscheduled tray */}
      {isExpanded && (
        <NodeLane
          goal={g}
          rangeStart={rangeStart}
          pxPerDay={pxPerDay}
          segs={segs}
          todayX={todayX}
          canvasW={canvasW}
        />
      )}

      {/* Bar tooltip — fixed so it escapes the card's overflow:hidden */}
      {barTip && (
        <div
          className="fixed z-[50] pointer-events-none bg-panel border border-line-2 rounded-[6px] px-[10px] py-[7px] select-none"
          style={{ left: barTip.x + 14, top: barTip.y - 90 }}
        >
          <div className="text-[.8rem] font-medium text-ink whitespace-nowrap">{g.title}</div>
          <div className="text-[.72rem] text-muted mt-[2px] tabular-nums whitespace-nowrap">
            {fmtD(g.start)} → {fmtD(g.deadline)}
          </div>
          <div className="text-[.72rem] text-muted tabular-nums">{Math.round(goalPct(g))}% complete</div>
          <div className="text-[.72rem] text-muted tabular-nums">{daysLeftLabel(g.deadline)}</div>
          <div className="text-[.72rem] text-muted tabular-nums">
            {(() => {
              const actual = Math.round(goalPct(g));
              const behind = Math.round(behindPaceBy(actual, g.start, g.deadline, todayStr()));
              const expected = Math.round(expectedPct(g.start, g.deadline, todayStr()));
              return behind > 0
                ? `${behind} pts behind pace · expected ${expected}% by today`
                : `on pace · expected ${expected}% by today`;
            })()}
          </div>
        </div>
      )}

      {/* Deadline flag tooltip */}
      {flagTip && (
        <div
          className="fixed z-[50] pointer-events-none bg-panel border border-line-2 rounded-[6px] px-[8px] py-[5px] select-none"
          style={{ left: flagTip.x + 10, top: flagTip.y - 38 }}
        >
          <span className="text-[.72rem] text-muted tabular-nums whitespace-nowrap">{fmtD(g.deadline)}</span>
        </div>
      )}

      {/* Milestone tooltip */}
      {msTip && (
        <div
          className="fixed z-[50] pointer-events-none bg-panel border border-line-2 rounded-[6px] px-[8px] py-[5px] select-none"
          style={{ left: msTip.x + 10, top: msTip.y - 38 }}
        >
          <span className="text-[.72rem] text-muted whitespace-nowrap">{msTip.text}</span>
        </div>
      )}
    </div>
  );
});
