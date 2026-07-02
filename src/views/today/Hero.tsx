import { useAppStore } from '../../state/store';
import { todayStr } from '../../lib/dates';
import { dateKicker, greeting, daysLeftInYear } from '../../lib/today';

export function Hero() {
  const { habits, tasks } = useAppStore();
  const today = todayStr();
  const habitsDone = habits.filter((h) => h.checkins.includes(today)).length;
  const todayTasks = tasks.filter((t) => t.date === today);
  const tasksDone = todayTasks.filter((t) => t.done).length;

  return (
    <div>
      <div className="font-mono text-[.72rem] tracking-[.12em] text-muted mb-[6px]">{dateKicker(today)}</div>
      <h1 className="font-disp text-[2.5rem] font-semibold tracking-[-0.015em] leading-[1.1] mb-[6px]">
        {greeting(new Date().getHours())}
      </h1>
      <p className="text-[.9rem] text-chip-ink m-0">
        {habitsDone} of {habits.length} habits · {tasksDone} of {todayTasks.length} tasks done ·{' '}
        {daysLeftInYear(today)} days left in {today.slice(0, 4)}
      </p>
    </div>
  );
}
