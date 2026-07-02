import { useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr, fmtD, daysLeftLabel } from '../lib/dates';
import {
  zoomWindow, windowFrac, windowSegments, expectedPct, behindPaceBy,
} from '../lib/timeline';
import type { ZoomLevel } from '../db/types';
import { goalPct } from '../lib/pct';
import { SpanBar } from './timeline/SpanBar';

const QUARTER_MONTHS = new Set([3, 6, 9]);

type TipPos = { x: number; y: number; goalId: string };

export function Timeline() {
  const { goals, zoom, actions } = useAppStore();
  const win = zoomWindow(zoom, todayStr());
  const segs = windowSegments(zoom, win);
  const tf = windowFrac(todayStr(), win) * 100;
  const [barTip, setBarTip] = useState<TipPos | null>(null);
  const [flagTip, setFlagTip] = useState<TipPos | null>(null);
  const [msTip, setMsTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [preview, setPreview] = useState<{ goalId: string; span: { start: string; deadline: string } } | null>(null);

  const barGoal = barTip ? (goals.find(g => g.id === barTip.goalId) ?? null) : null;
  const flagGoal = flagTip ? (goals.find(g => g.id === flagTip.goalId) ?? null) : null;

  return (
    <div>
      <h1 className="font-disp text-[1.4rem] font-semibold tracking-[-0.015em] mb-[16px]">Timeline</h1>

      <div className="flex justify-end mb-[10px]">
        <div className="flex border border-line-2 rounded-[6px] overflow-hidden text-[.78rem] font-medium">
          {(['year', 'quarter', 'month'] as ZoomLevel[]).map(z => (
            <button key={z} type="button" onClick={() => actions.setZoom(z)} aria-pressed={zoom === z}
              className={`px-[12px] py-[4px] transition-colors duration-100 ${
                zoom === z ? 'bg-accent-tint text-ink' : 'text-ink-soft hover:bg-hover'}`}>
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-[6px] border border-line rounded-[10px] overflow-hidden bg-panel">
        {/* Header — month labels + today caret */}
        <div className="flex border-b border-line">
          <div className="w-[160px] flex-shrink-0 border-r border-line px-[12px] py-[9px] text-[.7rem] tracking-[.1em] uppercase text-muted font-semibold bg-bg">
            Goal
          </div>
          <div className="flex-1 flex relative">
            {/* Today caret sits above the today-line, in the header */}
            <div
              className="absolute inset-y-0 flex flex-col justify-start items-center pointer-events-none z-[5]"
              style={{ left: `${tf}%`, transform: 'translateX(-50%)' }}
            >
              <span className="text-accent text-[.62rem] tabular-nums font-medium leading-none pt-[3px] select-none">
                Today
              </span>
            </div>
            {segs.map((s, m) => (
              <div
                key={m}
                className={`py-[9px] pl-[7px] text-[.72rem] text-muted font-medium${
                  m === 0
                    ? ''
                    : zoom === 'year' && QUARTER_MONTHS.has(m)
                    ? ' border-l border-line-2'
                    : ' border-l border-line'
                }`}
                style={{ flex: `${s.days} 0 0` }}
              >
                {s.label}
              </div>
            ))}
          </div>
        </div>

        {/* Empty state */}
        {goals.length === 0 && (
          <div className="px-[12px] py-[32px] text-center text-faint text-[.85rem] italic">
            Nothing on your year yet — add a goal in Goals › + new goal to see it here.
          </div>
        )}

        {/* Goal rows */}
        {goals.map((g, i) => {
          const flagDeadline = preview?.goalId === g.id ? preview.span.deadline : g.deadline;
          const ef = windowFrac(flagDeadline, win) * 100;
          const p = Math.round(goalPct(g));

          return (
            <div
              key={g.id}
              className={`group flex items-stretch min-h-[46px]${
                i < goals.length - 1 ? ' border-b border-line' : ''
              }`}
            >
              {/* Lane label */}
              <div className="w-[160px] flex-shrink-0 border-r border-line px-[12px] py-[8px] flex flex-col justify-center gap-[2px] group-hover:bg-hover">
                <span className="text-[.66rem] text-faint font-semibold tracking-[.06em]">#{i + 1}</span>
                <span className="text-[.84rem] font-medium text-ink leading-[1.25]">{g.title}</span>
              </div>

              {/* Plot area */}
              <div className="flex-1 relative">
                {/* Month grid lines with quarter emphasis */}
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

                {/* Today line */}
                <div
                  className="absolute top-0 bottom-0 w-[1.5px] bg-accent opacity-55 z-[3] pointer-events-none"
                  style={{ left: `${tf}%` }}
                />

                {/* Goal bar — keyboard-accessible draggable/resizable span */}
                <SpanBar
                  span={{ start: g.start, deadline: g.deadline }}
                  win={win}
                  pct={p}
                  label={`${p}%`}
                  ariaLabel={`${g.title}: ${p}% complete, ${fmtD(g.start)}–${fmtD(g.deadline)}. Arrow keys move by day, Shift for weeks, Alt+arrows adjust deadline.`}
                  height={22}
                  onCommit={(next) => actions.setGoalDates(g.id, next.start, next.deadline)}
                  onOpen={() => actions.openDrawer(g.id)}
                  onHover={(pos) => setBarTip(pos ? { x: pos.x, y: pos.y, goalId: g.id } : null)}
                  onPreview={(s) => setPreview(s ? { goalId: g.id, span: s } : null)}
                />

                {/* Deadline flag — hover reveals date tooltip */}
                {ef >= 0 && ef <= 100 && (
                  <div
                    className="absolute top-[4px] bottom-[4px] w-[2px] bg-accent z-[4] cursor-default"
                    style={{ left: `${ef}%` }}
                    onMouseEnter={(e) => {
                      setBarTip(null);
                      setFlagTip({ x: e.clientX, y: e.clientY, goalId: g.id });
                    }}
                    onMouseLeave={() => setFlagTip(null)}
                  >
                    <span className="absolute top-[-1px] left-[-2px] border-[3px] border-transparent border-t-accent pointer-events-none" />
                  </div>
                )}

                {/* Milestone markers */}
                {(g.milestones ?? []).map((m) => {
                  const mf = windowFrac(m.date, win) * 100;
                  if (mf < 0 || mf > 100) return null;
                  return (
                    <span key={m.id}
                      className="absolute top-[3px] -translate-x-1/2 text-accent text-[.58rem] leading-none z-[4] cursor-default select-none"
                      style={{ left: `${mf}%` }}
                      onMouseEnter={(e) => setMsTip({ x: e.clientX, y: e.clientY, text: `${m.title} · ${fmtD(m.date)}` })}
                      onMouseLeave={() => setMsTip(null)}
                    >◆</span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bar tooltip — fixed so it escapes the card's overflow:hidden */}
      {barGoal && barTip && (
        <div
          className="fixed z-[50] pointer-events-none bg-panel border border-line-2 rounded-[6px] px-[10px] py-[7px] select-none"
          style={{ left: barTip.x + 14, top: barTip.y - 90 }}
        >
          <div className="text-[.8rem] font-medium text-ink whitespace-nowrap">{barGoal.title}</div>
          <div className="text-[.72rem] text-muted mt-[2px] tabular-nums whitespace-nowrap">
            {fmtD(barGoal.start)} → {fmtD(barGoal.deadline)}
          </div>
          <div className="text-[.72rem] text-muted tabular-nums">
            {Math.round(goalPct(barGoal))}% complete
          </div>
          <div className="text-[.72rem] text-muted tabular-nums">
            {daysLeftLabel(barGoal.deadline)}
          </div>
          <div className="text-[.72rem] text-muted tabular-nums">
            {(() => {
              const actual = Math.round(goalPct(barGoal));
              const behind = Math.round(behindPaceBy(actual, barGoal.start, barGoal.deadline, todayStr()));
              const expected = Math.round(expectedPct(barGoal.start, barGoal.deadline, todayStr()));
              return behind > 0
                ? `${behind} pts behind pace · expected ${expected}% by today`
                : `on pace · expected ${expected}% by today`;
            })()}
          </div>
        </div>
      )}

      {/* Deadline flag tooltip */}
      {flagGoal && flagTip && (
        <div
          className="fixed z-[50] pointer-events-none bg-panel border border-line-2 rounded-[6px] px-[8px] py-[5px] select-none"
          style={{ left: flagTip.x + 10, top: flagTip.y - 38 }}
        >
          <span className="text-[.72rem] text-muted tabular-nums whitespace-nowrap">
            {fmtD(flagGoal.deadline)}
          </span>
        </div>
      )}

      {/* Milestone tooltip */}
      {msTip && (
        <div className="fixed z-[50] pointer-events-none bg-panel border border-line-2 rounded-[6px] px-[8px] py-[5px] select-none"
          style={{ left: msTip.x + 10, top: msTip.y - 38 }}>
          <span className="text-[.72rem] text-muted whitespace-nowrap">{msTip.text}</span>
        </div>
      )}
    </div>
  );
}
