import type { KeyboardEvent, RefObject } from 'react';
import { useAppStore } from '../../state/store';
import { todayStr } from '../../lib/dates';
import { dispatchQuickAdd } from './workActions';
import type { QuickAddType } from './workActions';

export type QuickType = QuickAddType;

const PLACEHOLDER: Record<QuickType, string> = {
  habit: 'New habit name…',
  goal: 'New goal or project…',
  task: 'Task for today…',
};

const LABEL: Record<QuickType, string> = { habit: 'Habit', goal: 'Goal', task: 'Task' };

export function QuickAdd({
  type,
  onType,
  inputRef,
}: {
  type: QuickType;
  onType: (t: QuickType) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { actions } = useAppStore();

  function submit() {
    const el = inputRef.current;
    if (!el) return;
    if (!dispatchQuickAdd(type, el.value, actions, todayStr)) {
      el.focus();
      return;
    }
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
          type="button"
          onClick={submit}
          aria-label="Add"
          className="w-[36px] h-[36px] rounded-field bg-accent text-accent-contrast text-[17px] font-semibold flex-none grid place-items-center hover:bg-accent-deep"
        >
          +
        </button>
      </div>
      <div className="flex items-center gap-[6px] mt-[8px]">
        {(['habit', 'goal', 'task'] as QuickType[]).map((t) => (
          <button
            type="button"
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
