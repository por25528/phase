// TODO(round-2): full Today UI — see prototype.html
import { useAppStore } from '../state/store';
import { SectionLabel } from '../components/SectionLabel';
import { Checkbox } from '../components/Checkbox';
import { todayStr, fmtD } from '../lib/dates';

export function Today() {
  const { selDate, habits, tasks, actions } = useAppStore();
  const today = todayStr();
  const dayTasks = tasks.filter((t) => t.date === selDate);

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Today</h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — check your floors, plan ahead.
      </p>

      <SectionLabel first>Habits — today</SectionLabel>
      {habits.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">No habits yet.</div>
      )}
      {habits.map((hb) => {
        const done = hb.checkins.includes(today);
        return (
          <div key={hb.id} className="flex items-center gap-[11px] py-[11px] border-b border-line">
            <Checkbox checked={done} onClick={() => actions.toggleHabit(hb.id)} />
            <span className="text-[.92rem] font-[450] flex-1">{hb.title}</span>
          </div>
        );
      })}

      <SectionLabel>Tasks — {fmtD(selDate)}</SectionLabel>
      {dayTasks.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">Nothing planned.</div>
      )}
      {dayTasks.map((t) => (
        <div key={t.id} className="flex items-center gap-[10px] p-[6px] rounded-[6px] hover:bg-hover">
          <Checkbox checked={t.done} onClick={() => actions.toggleTask(t.id)} />
          <span className={`flex-1 text-[.9rem] text-ink-soft ${t.done ? 'line-through text-faint' : ''}`}>
            {t.title}
          </span>
        </div>
      ))}
    </div>
  );
}
