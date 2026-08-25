import { useMemo, useState } from 'react';
import { todayStr, addDays } from '@app/lib/dates';
import { isPlanningHorizon } from '@app/lib/horizons';
import type { PhoneStore } from '../state/phoneStore';

const NO_PROJECT = '';

/**
 * Get it out of your head.
 *
 * One field, and everything else optional. The project picker offers Now and
 * Next projects only — `isPlanningHorizon`, the same gate the desktop's rail
 * spends — because a picker listing every reading list you have ever parked is
 * a picker nobody scrolls.
 *
 * The day chips appear only for a LOOSE task. `add_task` puts a step in a
 * project's tree and has nowhere to put a date; a chip that silently did
 * nothing would be worse than no chip.
 */
export function Capture({ store }: { store: PhoneStore }) {
  const state = store.usePhoneStore();
  const [title, setTitle] = useState('');
  const [goalId, setGoalId] = useState<string>(NO_PROJECT);
  const [day, setDay] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);

  const today = todayStr();
  const projects = useMemo(
    () =>
      (state.projected?.goals ?? []).filter(
        (goal) => !goal.completedAt && isPlanningHorizon(goal.column),
      ),
    [state.projected],
  );

  const trimmed = title.trim();

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!trimmed) return;
    if (goalId === NO_PROJECT) await store.ops.addLooseTask(trimmed, day ?? undefined);
    else await store.ops.addStep(goalId, trimmed);
    setTitle('');
    setDay(null);
    setCaptured(trimmed);
  }

  const chip = (label: string, value: string) => (
    <button
      key={value}
      type="button"
      aria-pressed={day === value}
      className={`h-[34px] px-[12px] rounded-field border text-ui ${
        day === value ? 'border-accent text-accent' : 'border-line-2 text-muted'
      }`}
      onClick={() => setDay(day === value ? null : value)}
    >
      {label}
    </button>
  );

  return (
    <form className="flex flex-col gap-[16px] px-[18px] pt-[18px]" onSubmit={submit}>
      <input
        // Autofocused: this screen exists to be typed into, and a keyboard that
        // needs a tap first is a capture that loses the thought.
        autoFocus
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setCaptured(null);
        }}
        aria-label="What needs doing?"
        placeholder="What needs doing?"
        className="w-full h-[46px] px-[12px] rounded-field border border-line-2 bg-field text-body text-ink placeholder:text-faint"
      />

      <label className="flex flex-col gap-[6px]">
        <span className="section-label text-muted">Project</span>
        <select
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          className="w-full h-[42px] px-[10px] rounded-field border border-line-2 bg-field text-body text-ink"
        >
          <option value={NO_PROJECT}>No project</option>
          {projects.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.title}
            </option>
          ))}
        </select>
      </label>

      {goalId === NO_PROJECT && (
        <div className="flex flex-col gap-[6px]">
          <span className="section-label text-muted">When</span>
          <div className="flex gap-[8px]">
            {chip('Today', today)}
            {chip('Tomorrow', addDays(today, 1))}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={!trimmed}
        className="h-[46px] rounded-field bg-accent text-accent-contrast text-body font-semibold disabled:opacity-40"
      >
        Capture
      </button>

      {/* The confirmation is inline and quiet. A toast on a screen whose whole
          job is to be typed into again would cover the field it just cleared. */}
      {captured && (
        <p role="status" className="text-meta text-muted">
          Captured “{captured}”
        </p>
      )}
    </form>
  );
}
