import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useAppStore } from '../state/store';
import { SectionLabel } from '../components/SectionLabel';
import { Checkbox } from '../components/Checkbox';
import { Tag } from '../components/Tag';
import { todayStr, addDays, fmtD, parseD, weekDates, streak } from '../lib/dates';
import type { Habit } from '../db/types';

function p2(n: number) { return String(n).padStart(2, '0'); }

function Heatmap({ hb }: { hb: Habit }) {
  const WK = 15;
  const today = parseD(todayStr());
  const dow = today.getDay();
  const cols: React.ReactElement[] = [];
  for (let w = WK - 1; w >= 0; w--) {
    const cells: React.ReactElement[] = [];
    for (let d = 0; d < 7; d++) {
      const off = -(w * 7) + (d - dow);
      const date = new Date(today);
      date.setDate(today.getDate() + off);
      const s = `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
      const fut = date > today;
      const hit = hb.checkins.includes(s);
      cells.push(
        <div
          key={d}
          className={`heat-d${hit ? ' h' : ''}${fut ? ' fut' : ''}`}
          title={s}
        />
      );
    }
    cols.push(
      <div key={w} className="flex flex-col gap-[2px]">
        {cells}
      </div>
    );
  }
  return <div className="flex gap-[2px] mt-[8px] ml-[28px]">{cols}</div>;
}

export function Today() {
  const { goals, habits, tasks, selDate, actions } = useAppStore();
  const today = todayStr();
  const isToday = selDate === today;
  const wd = parseD(selDate).toLocaleDateString('en-US', { weekday: 'long' });
  const rel =
    selDate === today ? 'Today'
    : selDate === addDays(today, 1) ? 'Tomorrow'
    : selDate === addDays(today, -1) ? 'Yesterday'
    : wd;

  const [taskGoalId, setTaskGoalId] = useState('');

  const dayTasks = tasks.filter(t => t.date === selDate);

  function handleAddHabit() {
    const t = prompt('Habit name:');
    if (!t) return;
    const wk = confirm('Weekly habit? (OK = X times/week, Cancel = daily)');
    let tgt = 4;
    if (wk) tgt = parseInt(prompt('Times per week:', '4') || '4') || 4;
    actions.addHabit(t.trim(), wk ? 'weekly' : 'daily', tgt);
  }

  function handleTaskKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const input = e.target as HTMLInputElement;
      const val = input.value.trim();
      if (val) {
        actions.addTask(val, selDate, taskGoalId || null);
        input.value = '';
      }
    }
  }

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Today</h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — check your floors, plan ahead.
      </p>

      <SectionLabel first>Habits — today</SectionLabel>
      {habits.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">No habits yet. Add one below.</div>
      )}
      {habits.map(hb => {
        const done = hb.checkins.includes(today);
        const goal = hb.goalId ? goals.find(g => g.id === hb.goalId) : null;

        let stat: React.ReactElement;
        if (hb.cadence === 'weekly') {
          const c = weekDates(today).filter(d => hb.checkins.includes(d)).length;
          stat = (
            <span className="text-[.74rem] text-muted tabular-nums">
              this week <b className="text-accent font-semibold">{c}/{hb.weeklyTarget}</b>
            </span>
          );
        } else {
          stat = (
            <span className="text-[.74rem] text-muted tabular-nums">
              streak <b className="text-accent font-semibold">{streak(hb)}</b>
            </span>
          );
        }

        const y = addDays(today, -1);
        const y2 = addDays(today, -2);
        const showNudge =
          hb.cadence === 'daily' &&
          !hb.checkins.includes(y) &&
          !hb.checkins.includes(y2);

        return (
          <div key={hb.id} className="py-[11px] border-b border-line group">
            <div className="flex items-center gap-[11px]">
              <Checkbox checked={done} onClick={() => actions.toggleHabit(hb.id)} />
              <span className="text-[.92rem] font-[450] flex-1">{hb.title}</span>
              {goal && <Tag label={goal.title} />}
              {stat}
              <button
                className="text-faint text-[.8rem] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => actions.removeHabit(hb.id)}
              >✕</button>
            </div>
            {showNudge && (
              <div className="text-[.74rem] text-[#b06a4f] mt-[5px] ml-[28px]">
                Two days missed — don't let it become three.
              </div>
            )}
            <Heatmap hb={hb} />
          </div>
        );
      })}
      <div className="mt-[8px]">
        <button
          className="text-[.82rem] text-muted px-[9px] py-[5px] rounded-[6px] border border-line-2 hover:bg-hover"
          onClick={handleAddHabit}
        >+ habit</button>
      </div>

      <SectionLabel>Tasks</SectionLabel>
      <div className="flex items-center gap-[8px] mb-[4px]">
        <button
          className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover"
          onClick={() => actions.shiftDay(-1)}
        >‹</button>
        <span className="font-disp text-[1.04rem] font-medium">{rel}</span>
        <span className="text-[.76rem] text-muted">{fmtD(selDate)}</span>
        <button
          className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover"
          onClick={() => actions.shiftDay(1)}
        >›</button>
        {!isToday && (
          <button
            className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover"
            onClick={() => actions.goToToday()}
          >Today</button>
        )}
      </div>
      {dayTasks.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">
          Nothing planned {rel.toLowerCase()}. Add a task to plan it.
        </div>
      )}
      {dayTasks.map(t => {
        const goal = t.goalId ? goals.find(g => g.id === t.goalId) : null;
        return (
          <div key={t.id} className="flex items-center gap-[10px] p-[6px] rounded-[6px] hover:bg-hover group">
            <Checkbox checked={t.done} onClick={() => actions.toggleTask(t.id)} />
            <span className={`flex-1 text-[.9rem] text-ink-soft${t.done ? ' line-through text-faint' : ''}`}>
              {t.title}
            </span>
            {goal && <Tag label={goal.title} />}
            <button
              className="text-faint text-[.8rem] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => actions.removeTask(t.id)}
            >✕</button>
          </div>
        );
      })}
      <div className="flex items-center gap-[8px] mt-[8px]">
        <input
          className="ghost-in"
          placeholder={`Plan a task for ${rel.toLowerCase()}…`}
          onKeyDown={handleTaskKeyDown}
        />
        <select
          className="border border-line-2 rounded-[6px] px-[6px] py-[4px] text-[.78rem] bg-panel text-ink-soft"
          value={taskGoalId}
          onChange={e => setTaskGoalId(e.target.value)}
        >
          <option value="">no goal</option>
          {goals.map(g => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
