import { useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr } from '../lib/dates';
import { zoomWindow, windowFrac, windowSegments } from '../lib/timeline';
import type { ZoomLevel } from '../db/types';
import { GoalRow } from './timeline/GoalRow';
import { QUARTER_MONTHS } from './timeline/NodeLane';

export function Timeline() {
  const { goals, zoom, actions } = useAppStore();
  const win = zoomWindow(zoom, todayStr());
  const segs = windowSegments(zoom, win);
  const tf = windowFrac(todayStr(), win) * 100;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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
        {goals.map((g, i) => (
          <GoalRow
            key={g.id}
            goal={g}
            index={i}
            win={win}
            segs={segs}
            tf={tf}
            zoom={zoom}
            isExpanded={expanded.has(g.id)}
            onToggle={() => toggle(g.id)}
            isLast={i === goals.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
