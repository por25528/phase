import { useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr, addDays, weekDates } from '../lib/dates';
import { weekOf, attentionRank, unplannedOpenLeaves } from '../lib/plan';

/**
 * The week calendar. Owns which week is shown; everything else is derived.
 *
 * The backlog list below is SCAFFOLDING — plan 2 replaces it with the sidebar
 * accordion. It exists so there is something to drag from.
 */
export function Plan() {
  const { goals, hydration } = useAppStore();
  const today = todayStr();
  const [weekStart, setWeekStart] = useState(() => weekOf(today));
  const days = weekDates(weekStart);

  if (hydration !== 'ready') {
    return <div className="text-muted text-[.85rem] py-[40px]">Loading…</div>;
  }

  const backlog = attentionRank(goals, today)
    .map((goal) => ({ goal, leaves: unplannedOpenLeaves(goal, weekStart) }))
    .filter((g) => g.leaves.length > 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[232px_1fr] gap-[18px] items-start">
      <div className="min-w-0">
        <h3 className="font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold mb-[8px]">
          To plan
        </h3>
        {backlog.length === 0 ? (
          <div className="text-faint text-[.82rem] italic">Nothing left to plan.</div>
        ) : (
          backlog.map(({ goal, leaves }) => (
            <div key={goal.id} className="mb-[10px]">
              <div className="font-disp text-[.86rem] font-semibold truncate">{goal.title}</div>
              {leaves.map((leaf) => (
                <div
                  key={leaf.id}
                  className="text-[.78rem] text-ink-soft truncate px-[6px] py-[4px] rounded-[6px] border border-line-2 bg-panel mt-[3px]"
                >
                  {leaf.title}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-[10px] mb-[10px]">
          <h3 className="font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold">
            Your week
          </h3>
          <span className="flex-1" />
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className="text-muted hover:text-ink px-[6px]">‹</button>
          <button type="button" onClick={() => setWeekStart(weekOf(today))} className="text-[.72rem] text-muted hover:text-ink">today</button>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} className="text-muted hover:text-ink px-[6px]">›</button>
        </div>
        <div className="text-faint text-[.8rem]">{days[0]} – {days[6]}</div>
      </div>
    </div>
  );
}
