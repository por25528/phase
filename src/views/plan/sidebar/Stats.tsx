import { useAppStore } from '../../../state/store';
import { todayStr } from '../../../lib/dates';
import { habitHitPct } from '../../../lib/today';
import { plannedLeaves, weekOf } from '../../../lib/plan';

/**
 * The three figures the old Today hero carried. The greeting and date kicker
 * are dropped: the week header above the grid already says what day it is.
 */
export function Stats() {
  const { habits, goals } = useAppStore();
  const today = todayStr();
  const habitsDone = habits.filter((h) => h.checkins.includes(today)).length;
  const wk = plannedLeaves(goals, weekOf(today));
  const wkDone = wk.filter((l) => l.done).length;

  const stats: [string, string, string][] = [
    [`${habitsDone}/${habits.length}`, 'habits', 'Habits checked off today'],
    [`${wkDone}/${wk.length}`, 'planned this week', 'Planned steps completed this week'],
  ];
  if (habits.length > 0) {
    stats.push([
      `${habitHitPct(habits, today, 20)}%`,
      'habit hits',
      'Share of the last 20 days your habits were completed',
    ]);
  }

  return (
    <div className="flex flex-col gap-[3px]">
      {stats.map(([value, label, hint]) => (
        <span key={label} title={hint} className="flex items-baseline gap-[5px] cursor-help text-ui">
          <span className="font-semibold text-ink tabular-nums">{value}</span>
          <span className="text-muted">{label}</span>
        </span>
      ))}
    </div>
  );
}
