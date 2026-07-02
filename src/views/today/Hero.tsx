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

  return (
    <div>
      <div className="font-mono text-[.72rem] tracking-[.12em] text-muted mb-[6px]">{dateKicker(today)}</div>
      <h1 className="font-disp text-[1.7rem] font-semibold tracking-[-0.015em] leading-[1.1] mb-[6px]">
        {greeting(new Date().getHours())}
      </h1>
      <p className="text-[.9rem] text-chip-ink m-0">
        {habitsDone} of {habits.length} habits · {tasksDone} of {todayTasks.length} tasks done ·{' '}
        {weekMin > 0 ? fmtMinutes(weekMin).toLowerCase() : '0m'} logged this week
        {habits.length > 0 && <> · {habitHitPct(habits, today, 20)}% habit hits</>}
      </p>
    </div>
  );
}
