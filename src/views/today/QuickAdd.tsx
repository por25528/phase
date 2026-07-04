import type { KeyboardEvent, RefObject } from 'react';
import { useAppStore } from '../../state/store';
import { todayStr } from '../../lib/dates';

export type QuickType = 'task' | 'habit' | 'goal';

const PLACEHOLDER: Record<QuickType, string> = {
  task: 'Add a task for today…',
  habit: 'New habit name…',
  goal: 'New goal or project…',
};

const LABEL: Record<QuickType, string> = { task: 'Task', habit: 'Habit', goal: 'Goal' };

export function QuickAdd({
  type,
  onType,
  inputRef,
}: {
  type: QuickType;
  onType: (t: QuickType) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { selDate, actions } = useAppStore();

  function submit() {
    const el = inputRef.current;
    if (!el) return;
    const val = el.value.trim();
    if (!val) { el.focus(); return; }
    if (type === 'task') actions.addTask(val, selDate, null);
    if (type === 'habit') actions.addHabit(val, 'daily', 4);
    if (type === 'goal') actions.addGoal(val, `${todayStr().slice(0, 4)}-12-31`);
    el.value = '';
    el.focus();
  }

  return (
    <div className="bg-panel border border-line rounded-card shadow-card px-[16px] py-[12px]">
      <div className="font-mono text-[.66rem] tracking-[.12em] text-accent font-semibold mb-[8px]">QUICK ADD</div>
      <div className="flex gap-[8px]">
        <input
          ref={inputRef}
          aria-label="Quick add"
          placeholder={PLACEHOLDER[type]}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') submit(); }}
          className="flex-1 min-w-0 bg-field border border-line-2 rounded-field px-[12px] py-[8px] text-[.9rem] text-ink outline-none placeholder:text-faint"
        />
        <button
          onClick={submit}
          aria-label="Add"
          className="w-[36px] h-[36px] rounded-field bg-accent text-accent-contrast text-[17px] font-semibold flex-none grid place-items-center hover:bg-accent-deep"
        >
          +
        </button>
      </div>
      <div className="flex items-center gap-[6px] mt-[8px]">
        {(['task', 'habit', 'goal'] as QuickType[]).map((t) => (
          <button
            key={t}
            onClick={() => onType(t)}
            aria-pressed={type === t}
            className={`px-[12px] py-[3px] rounded-full text-[.76rem] font-semibold border ${
              type === t ? 'bg-ink text-paper border-ink' : 'text-ink-soft border-line-2 hover:bg-hover'
            }`}
          >
            {LABEL[t]}
          </button>
        ))}
        <span className="ml-auto font-mono text-[.6rem] tracking-[.08em] text-faint">ENTER ↵</span>
      </div>
    </div>
  );
}
