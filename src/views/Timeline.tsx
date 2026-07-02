import { useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr, fmtD, daysLeftLabel } from '../lib/dates';
import {
  zoomWindow, windowDays, windowFrac, windowSegments, expectedPct, behindPaceBy,
  moveSpan, resizeStart, resizeEnd, snapDelta,
} from '../lib/timeline';
import type { ZoomLevel } from '../db/types';
import { goalPct } from '../lib/pct';

const QUARTER_MONTHS = new Set([3, 6, 9]);

type TipPos = { x: number; y: number; goalId: string };
type Drag = {
  goalId: string; mode: 'move' | 'start' | 'end'; originX: number; pxPerDay: number;
  orig: { start: string; deadline: string }; preview: { start: string; deadline: string }; moved: boolean;
};

export function Timeline() {
  const { goals, zoom, actions } = useAppStore();
  const win = zoomWindow(zoom, todayStr());
  const segs = windowSegments(zoom, win);
  const tf = windowFrac(todayStr(), win) * 100;
  const [barTip, setBarTip] = useState<TipPos | null>(null);
  const [flagTip, setFlagTip] = useState<TipPos | null>(null);
  const [msTip, setMsTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);
  const total = windowDays(win);

  const barGoal = barTip ? (goals.find(g => g.id === barTip.goalId) ?? null) : null;
  const flagGoal = flagTip ? (goals.find(g => g.id === flagTip.goalId) ?? null) : null;

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Timeline</h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        Your year as production phases. Bar length is the time span; the fill is progress. Click a bar to open its plan.
      </p>

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
          const span = drag?.goalId === g.id ? drag.preview : { start: g.start, deadline: g.deadline };
          const sf = windowFrac(span.start, win) * 100;
          const ef = windowFrac(span.deadline, win) * 100;
          const out = ef < 0 || sf > 100;               // goal entirely outside window
          const left = Math.max(0, Math.min(100, sf));
          const right = Math.max(0, Math.min(100, ef));
          const w = Math.max(right - left, 2);
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

                {/* Goal bar — keyboard-accessible button (or out-of-window marker) */}
                {out ? (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 text-[.72rem] text-faint"
                    style={{ left: ef < 0 ? '8px' : undefined, right: sf > 100 ? '8px' : undefined }}
                  >
                    {ef < 0 ? '‹ earlier' : 'later ›'}
                  </span>
                ) : (
                  <button
                    className="absolute top-1/2 -translate-y-1/2 h-[22px] rounded-[6px] bg-track border border-line-2 cursor-grab active:cursor-grabbing touch-none overflow-hidden flex items-center z-[2] transition-[border-color,box-shadow] hover:border-accent hover:ring-2 hover:ring-accent-tint focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-tint"
                    style={{ left: `${left}%`, width: `${w}%` }}
                    aria-label={`${g.title}: ${p}% complete, ${fmtD(g.start)}–${fmtD(g.deadline)}. Arrow keys move by day, Shift for weeks, Alt+arrows adjust deadline.`}
                    onMouseMove={(e) => setBarTip({ x: e.clientX, y: e.clientY, goalId: g.id })}
                    onMouseLeave={() => setBarTip(null)}
                    onFocus={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setBarTip({ x: r.left + r.width / 2, y: r.top, goalId: g.id });
                    }}
                    onBlur={() => setBarTip(null)}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const plotW = e.currentTarget.parentElement!.getBoundingClientRect().width;
                      const off = e.clientX - rect.left;
                      const mode = off < 8 ? 'start' : off > rect.width - 8 ? 'end' : 'move';
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDrag({ goalId: g.id, mode, originX: e.clientX, pxPerDay: plotW / total,
                        orig: { start: g.start, deadline: g.deadline },
                        preview: { start: g.start, deadline: g.deadline }, moved: false });
                    }}
                    onPointerMove={(e) => {
                      if (!drag || drag.goalId !== g.id) return;
                      const delta = snapDelta((e.clientX - drag.originX) / drag.pxPerDay, e.shiftKey ? 'week' : 'day');
                      const preview =
                        drag.mode === 'move' ? moveSpan(drag.orig.start, drag.orig.deadline, delta)
                        : drag.mode === 'start' ? resizeStart(drag.orig.start, drag.orig.deadline, delta)
                        : resizeEnd(drag.orig.start, drag.orig.deadline, delta);
                      setDrag({ ...drag, preview, moved: drag.moved || Math.abs(e.clientX - drag.originX) > 3 });
                    }}
                    onPointerUp={() => {
                      if (!drag || drag.goalId !== g.id) return;
                      if (drag.moved) {
                        suppressClick.current = true;
                        if (drag.preview.start !== drag.orig.start || drag.preview.deadline !== drag.orig.deadline) {
                          actions.setGoalDates(g.id, drag.preview.start, drag.preview.deadline);
                        }
                      }
                      setDrag(null);
                    }}
                    onClick={() => {
                      if (suppressClick.current) { suppressClick.current = false; return; }
                      actions.openDrawer(g.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                      e.preventDefault();
                      const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1);
                      const next = e.altKey ? resizeEnd(g.start, g.deadline, d) : moveSpan(g.start, g.deadline, d);
                      actions.setGoalDates(g.id, next.start, next.deadline);
                    }}
                  >
                    <span className="absolute inset-y-0 left-0 w-[8px] cursor-ew-resize" aria-hidden="true" />
                    <span className="absolute inset-y-0 right-0 w-[8px] cursor-ew-resize" aria-hidden="true" />
                    <i className="tl-bar-fill" style={{ width: `${p}%` }} />
                    <b className="relative text-[.7rem] font-semibold text-white pl-[8px] [mix-blend-mode:difference] tabular-nums z-[2]">
                      {p}%
                    </b>
                  </button>
                )}

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

      <p className="text-[.76rem] text-muted mt-[10px]">
        The line marks today; flags mark deadlines. Click any bar to open its plan — ticking sub-goals fills the bar live.
      </p>

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
