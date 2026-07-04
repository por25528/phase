import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useAppStore } from '../../state/store';
import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import { todayStr, addDays } from '../../lib/dates';
import { minutesOn, minutesThisWeek, fmtMinutes } from '../../lib/sessions';

export function StudyLogCard() {
  const { sessions, goals, selDate, actions } = useAppStore();
  const today = todayStr();
  const rel =
    selDate === today ? 'today' : selDate === addDays(today, 1) ? 'tomorrow' : selDate === addDays(today, -1) ? 'yesterday' : 'that day';
  const daySessions = sessions.filter((s) => s.date === selDate);
  const [logMins, setLogMins] = useState('30');
  const [logGoalId, setLogGoalId] = useState('');

  function handleNoteKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const mins = parseInt(logMins, 10);
      if (mins > 0) {
        actions.addSession(logGoalId || null, selDate, mins, (e.target as HTMLInputElement).value.trim());
        (e.target as HTMLInputElement).value = '';
      }
    }
  }

  return (
    <CardSection
      label="Study log"
      right={
        <span className="font-mono text-[.72rem] text-muted tracking-[.04em]">
          {fmtMinutes(minutesThisWeek(sessions, today)).toUpperCase()} THIS WEEK
        </span>
      }
    >
      {daySessions.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">Nothing logged for {rel} yet.</div>
      )}
      {daySessions.map((s) => {
        const goal = s.goalId ? goals.find((g) => g.id === s.goalId) : null;
        return (
          <div key={s.id} className="group flex items-center gap-[12px] py-[6px] px-[8px] -mx-[8px] rounded-field hover:bg-hover">
            <span className="font-mono text-[.78rem] font-semibold text-ink w-[48px] flex-none tabular-nums">
              {fmtMinutes(s.minutes)}
            </span>
            <span className="flex-1 min-w-0 truncate text-[.88rem] text-ink-soft">{s.note || 'Session'}</span>
            {goal && <Tag label={goal.title} />}
            <button
              type="button"
              onClick={() => actions.removeSession(s.id)}
              aria-label="Remove session"
              className="text-faint text-[.8rem] hover:text-[#B4453A] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
              ✕
            </button>
          </div>
        );
      })}
      {daySessions.length > 0 && (
        <div className="font-mono text-[.68rem] text-muted mt-[4px] tabular-nums">
          {fmtMinutes(minutesOn(sessions, selDate))} TOTAL
        </div>
      )}
      <div className="flex gap-[8px] mt-[10px]">
        <input
          type="number"
          min={1}
          max={600}
          value={logMins}
          onChange={(e) => setLogMins(e.target.value)}
          aria-label="Minutes"
          className="w-[60px] bg-field border border-line-2 rounded-field px-[10px] py-[8px] text-[.88rem] text-ink tabular-nums outline-none"
        />
        <input
          className="flex-1 min-w-0 bg-field border border-line-2 rounded-field px-[12px] py-[8px] text-[.88rem] text-ink outline-none placeholder:text-faint"
          placeholder="What did you work on?"
          aria-label="Session note"
          onKeyDown={handleNoteKeyDown}
        />
        <select
          className="bg-field border border-line-2 rounded-field px-[8px] text-[.78rem] text-chip-ink outline-none"
          value={logGoalId}
          onChange={(e) => setLogGoalId(e.target.value)}
          aria-label="Tag session to a goal"
        >
          <option value="">no goal</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </div>
    </CardSection>
  );
}
