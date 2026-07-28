import { useState, type KeyboardEvent } from 'react';
import { parseEstimateInput, formatEstimateValue } from './estimateInput';

/**
 * A one-keystroke estimate entry. Blur or Enter commits; Escape reverts.
 * Unparseable input is rejected and the field reverts, so a typo can never
 * silently wipe an existing estimate.
 *
 * Must be rendered OUTSIDE any element carrying @dnd-kit `listeners` —
 * see placement notes in PlanWeekOverlay.tsx.
 */
export function EstimateField({
  minutes,
  onChange,
  label,
}: {
  minutes: number | undefined;
  onChange: (minutes: number | null) => void;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatEstimateValue(minutes);

  function commit() {
    if (draft === null) return;
    const parsed = parseEstimateInput(draft);
    if (parsed !== undefined) onChange(parsed);
    setDraft(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // The planner owns global digit/Escape shortcuts (see appKeyboard.ts) and
    // some rail rows have their own keydown handlers for weekday planning —
    // stop this field's keystrokes from reaching either while typing.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      // blur() below re-fires onBlur={commit}, but that second call is a
      // no-op: this commit() already reset draft to null, and commit()
      // early-returns when draft === null.
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(null);
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <input
      aria-label={`Estimate for ${label}`}
      value={shown}
      placeholder="est"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      className="w-[34px] shrink-0 rounded-[5px] border border-transparent bg-transparent px-[3px] py-[1px] text-[.62rem] tabular-nums text-faint hover:border-line-2 focus:border-line-2 focus:text-ink-soft focus:outline-none"
    />
  );
}
