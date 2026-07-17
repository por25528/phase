import { useAppStore } from '../../state/store';
import { todayStr } from '../../lib/dates';
import { dateKicker, greeting, habitHitPct } from '../../lib/today';
import { plannedLeaves, weekOf } from '../../lib/plan';

export function Hero() {
  const { habits, goals } = useAppStore();
  const today = todayStr();
  const habitsDone = habits.filter((h) => h.checkins.includes(today)).length;
  const wk = plannedLeaves(goals, weekOf(today));
  const wkDone = wk.filter((l) => l.done).length;

  const stats: [string, string][] = [
    [`${habitsDone}/${habits.length}`, 'habits'],
    [`${wkDone}/${wk.length}`, 'planned this week'],
  ];
  if (habits.length > 0) stats.push([`${habitHitPct(habits, today, 20)}%`, 'habit hits']);

  return (
    <div>
      <div className="font-mono text-[.7rem] tracking-[.12em] text-muted mb-[5px]">{dateKicker(today)}</div>
      <h1 className="font-disp text-[1.5rem] font-semibold tracking-[-0.015em] leading-[1.1] mb-[9px]">
        {greeting(new Date().getHours())}
      </h1>
      <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-[3px]">
        {stats.map(([value, label]) => (
          <span key={label} className="inline-flex items-baseline gap-[5px]">
            <span className="font-semibold text-ink text-[.92rem] tabular-nums">{value}</span>
            <span className="text-[.78rem] text-muted">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
