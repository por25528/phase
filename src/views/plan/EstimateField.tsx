import { useState, type KeyboardEvent } from 'react';
import { parseEstimateInput, formatEstimateValue } from './estimateInput';

/**
 * A one-keystroke estimate entry. Blur or Enter commits.
 * Unparseable input is rejected and the field reverts, so a typo can never
 * silently wipe an existing estimate.
 *
 * Escape does NOT just revert the draft in isolation: this field is always
 * rendered inside the planner's <Modal>, and Modal registers its keydown
 * listener on `window` in the CAPTURE phase (src/components/Modal.tsx).
 * That capture-phase listener runs before this field's own (bubble-phase,
 * React-synthetic) key handler ever fires, so pressing Escape here discards
 * the draft AND closes the surrounding planner overlay in the same
 * keystroke — there is no way for anything rendered below `window` to
 * preempt it. This is not a regression specific to this field; the same is
 * true of RailStep's break-into-tasks textarea in PlanWeekOverlay.tsx. A
 * real fix (having Escape revert the draft without closing the modal)
 * belongs in Modal.tsx, not here.
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
