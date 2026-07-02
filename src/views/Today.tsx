import { useState, useRef } from 'react';
import { useAppStore } from '../state/store';
import { SectionLabel } from '../components/SectionLabel';
import { Tag } from '../components/Tag';
import { Hero } from './today/Hero';
import { WeekStrip } from './today/WeekStrip';
import { HabitsCard } from './today/HabitsCard';
import { TasksCard } from './today/TasksCard';
import { QuickAdd } from './today/QuickAdd';
import type { QuickType } from './today/QuickAdd';
import { todayStr, addDays, parseD } from '../lib/dates';
import { minutesOn, minutesThisWeek, fmtMinutes } from '../lib/sessions';

export function Today() {
  const { goals, sessions, selDate, actions } = useAppStore();
  const today = todayStr();
  const wd = parseD(selDate).toLocaleDateString('en-US', { weekday: 'long' });
  const rel =
    selDate === today
      ? 'Today'
      : selDate === addDays(today, 1)
      ? 'Tomorrow'
      : selDate === addDays(today, -1)
      ? 'Yesterday'
      : wd;

  const [logMins, setLogMins] = useState('30');
  const [logGoalId, setLogGoalId] = useState('');

  const quickRef = useRef<HTMLInputElement>(null);
  const [quickType, setQuickType] = useState<QuickType>('task');
  function focusQuick(t: QuickType) {
    setQuickType(t);
    quickRef.current?.focus();
  }
  void focusQuick; // wired up in Task 10 (GoalsCard)

  return (
    <div className="pt-[26px]">
      {/* Hero + quick add */}
      <div className="today-hero grid gap-[28px] items-end mb-[20px]">
        <Hero />
        <QuickAdd type={quickType} onType={setQuickType} inputRef={quickRef} />
      </div>

      <WeekStrip />

      {/* Main grid */}
      <div className="today-main grid gap-[22px] items-start mt-[20px]">
        <div className="flex flex-col gap-[18px] min-w-0">
          <HabitsCard />

          {/* ── Study log ───────────────────────────────────── */}
          <SectionLabel>Study log</SectionLabel>
          {(() => {
            const daySessions = sessions.filter(s => s.date === selDate);
            return (
              <>
                {daySessions.length === 0 && (
                  <div className="text-faint text-[.85rem] italic py-[6px]">
                    Nothing logged for {rel.toLowerCase()} yet.
                  </div>
                )}
                {daySessions.map(s => {
                  const goal = s.goalId ? goals.find(g => g.id === s.goalId) : null;
                  return (
                    <div key={s.id} className="flex items-center gap-[10px] p-[6px] rounded-[6px] hover:bg-hover group">
                      <span className="text-[.8rem] font-semibold tabular-nums text-ink min-w-[52px]">{fmtMinutes(s.minutes)}</span>
                      <span className="flex-1 text-[.88rem] text-ink-soft">{s.note || 'Session'}</span>
                      {goal && <Tag label={goal.title} />}
                      <button type="button" onClick={() => actions.removeSession(s.id)} aria-label="Remove session"
                        className="text-faint text-[.8rem] hover:text-[#b4453a] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </div>
                  );
                })}
                {daySessions.length > 0 && (
                  <div className="text-[.74rem] text-muted mt-[4px] px-[6px] tabular-nums">
                    {fmtMinutes(minutesOn(sessions, selDate))} total · {fmtMinutes(minutesThisWeek(sessions, today))} this week
                  </div>
                )}
                {/* add row: minutes number input + note + goal select, Enter submits */}
                <div className="flex items-center gap-[8px] mt-[8px]">
                  <input type="number" min={1} max={600} value={logMins} onChange={e => setLogMins(e.target.value)}
                    aria-label="Minutes" placeholder="min"
                    className="w-[64px] border border-line-2 rounded-[6px] px-[6px] py-[4px] text-[.82rem] bg-panel text-ink tabular-nums" />
                  <input className="ghost-in" placeholder="What did you work on?" aria-label="Session note"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const mins = parseInt(logMins, 10);
                        if (mins > 0) {
                          actions.addSession(logGoalId || null, selDate, mins, (e.target as HTMLInputElement).value.trim());
                          (e.target as HTMLInputElement).value = '';
                        }
                      }
                    }} />
                  <select className="border border-line-2 rounded-[6px] px-[6px] py-[4px] text-[.78rem] bg-panel text-ink-soft"
                    value={logGoalId} onChange={e => setLogGoalId(e.target.value)} aria-label="Tag session to a goal">
                    <option value="">no goal</option>
                    {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                  </select>
                </div>
              </>
            );
          })()}

          <TasksCard />
        </div>
        <div className="flex flex-col gap-[18px] min-w-0">
          {/* GoalsCard (Task 10) and MiniCalendar (Task 11) mount here */}
        </div>
      </div>

      {/* FooterStats mounts here in Task 12 */}
    </div>
  );
}
