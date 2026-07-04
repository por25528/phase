import { useAppStore } from '../../state/store';
import { todayStr } from '../../lib/dates';
import { dateKicker, greeting, habitHitPct } from '../../lib/today';
import { minutesThisWeek, fmtMinutes } from '../../lib/sessions';

export function Hero() {
  const { habits, tasks, sessions } = useAppStore();
  const today = todayStr();
  const habitsDone = habits.filter((h) => h.checkins.includes(today)).length;
  const todayTasks = tasks.filter((t) => t.date === today);
  const tasksDone = todayTasks.filter((t) => t.done).length;
  const weekMin = minutesThisWeek(sessions, today);

  const stats: [string, string][] = [
    [`${habitsDone}/${habits.length}`, 'habits'],
    [`${tasksDone}/${todayTasks.length}`, 'tasks'],
    [weekMin > 0 ? fmtMinutes(weekMin).toLowerCase() : '0m', 'this week'],
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
