import { useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr, fmtD } from '../lib/dates';
import { ymOf, shiftYm, ymLabel, monthGrid } from '../lib/calendar';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Calendar() {
  const { goals, tasks, habits, actions } = useAppStore();
  const today = todayStr();
  const [ym, setYm] = useState(ymOf(today));
  const weeks = monthGrid(ym);

  // date → items lookups (small data, recompute per render is fine)
  const deadlines = new Map<string, { id: string; title: string }[]>();
  const milestones = new Map<string, string[]>();
  goals.forEach(g => {
    deadlines.set(g.deadline, [...(deadlines.get(g.deadline) ?? []), { id: g.id, title: g.title }]);
    (g.milestones ?? []).forEach(m =>
      milestones.set(m.date, [...(milestones.get(m.date) ?? []), m.title]));
  });
  const tasksOn = (d: string) => tasks.filter(t => t.date === d);
  const habitHits = (d: string) => habits.filter(h => h.checkins.includes(d)).length;

  function openDay(d: string) {
    actions.setSelDate(d);
    actions.setView('today');
  }

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Calendar</h1>
      <p className="text-muted text-[.86rem] mb-[22px]">
        Deadlines, milestones, tasks and habit hits at a glance. Click a day to plan it.
      </p>

      {/* Month navigator */}
      <div className="flex items-center gap-[8px] mb-[10px]">
        <button type="button" onClick={() => setYm(shiftYm(ym, -1))} aria-label="Previous month"
          className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover">‹</button>
        <span className="font-disp text-[1.04rem] font-medium min-w-[150px] text-center">{ymLabel(ym)}</span>
        <button type="button" onClick={() => setYm(shiftYm(ym, 1))} aria-label="Next month"
          className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover">›</button>
        {ym !== ymOf(today) && (
          <button type="button" onClick={() => setYm(ymOf(today))}
            className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover">
            This month
          </button>
        )}
      </div>

      <div className="border border-line rounded-[10px] overflow-hidden bg-panel">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-line bg-bg">
          {DOW.map(d => (
            <div key={d} className="px-[8px] py-[7px] text-[.68rem] tracking-[.1em] uppercase text-muted font-semibold">
              {d}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className={`grid grid-cols-7${wi < weeks.length - 1 ? ' border-b border-line' : ''}`}>
            {week.map((d, di) => {
              const inMonth = ymOf(d) === ym;
              const isToday = d === today;
              const dts = tasksOn(d);
              const dls = deadlines.get(d) ?? [];
              const mss = milestones.get(d) ?? [];
              const hits = habitHits(d);
              const dayNum = Number(d.slice(8));
              return (
                <button type="button" key={d} onClick={() => openDay(d)}
                  aria-label={`Open ${fmtD(d)}`}
                  className={`relative text-left align-top min-h-[96px] px-[7px] py-[5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint hover:bg-hover transition-colors duration-100${
                    di > 0 ? ' border-l border-line' : ''}${inMonth ? '' : ' opacity-45'}`}>
                  <span className={`text-[.74rem] tabular-nums font-medium ${
                    isToday
                      ? 'inline-grid place-items-center w-[20px] h-[20px] rounded-full bg-accent text-white'
                      : 'text-muted'}`}>
                    {dayNum}
                  </span>
                  <div className="mt-[3px] flex flex-col gap-[2px]">
                    {dls.map(g => (
                      <span key={g.id} className="text-[.68rem] text-accent font-medium truncate leading-[1.3]">⚑ {g.title}</span>
                    ))}
                    {mss.map((t, i) => (
                      <span key={i} className="text-[.68rem] text-accent truncate leading-[1.3]">◆ {t}</span>
                    ))}
                    {dts.slice(0, 3).map(t => (
                      <span key={t.id} className={`text-[.68rem] truncate leading-[1.3] ${
                        t.done ? 'line-through text-faint' : 'text-ink-soft'}`}>· {t.title}</span>
                    ))}
                    {dts.length > 3 && (
                      <span className="text-[.66rem] text-faint">+{dts.length - 3} more</span>
                    )}
                  </div>
                  {hits > 0 && (
                    <div className="absolute bottom-[5px] left-[7px] flex gap-[3px]" aria-label={`${hits} habit check-ins`}>
                      {Array.from({ length: Math.min(hits, 5) }, (_, i) => (
                        <span key={i} className="w-[5px] h-[5px] rounded-full bg-fill inline-block" />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {goals.length === 0 && tasks.length === 0 && (
        <p className="text-faint text-[.85rem] italic mt-[10px]">
          Nothing scheduled yet — add a goal in Goals › + new goal, or plan a task in Today.
        </p>
      )}

      <p className="text-[.76rem] text-muted mt-[10px]">
        ⚑ deadline · ◆ milestone · dots are habit check-ins. Click a day to open it in Today.
      </p>
    </div>
  );
}
