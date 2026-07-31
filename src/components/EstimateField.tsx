import { useState, type KeyboardEvent } from 'react';
import { parseEstimateInput, formatEstimateValue } from '../lib/estimateInput';

/**
 * A one-keystroke estimate entry. Blur or Enter commits.
 * Unparseable input is rejected and the field reverts, so a typo can never
 * silently wipe an existing estimate.
 *
 * Host: `EstimateControl`, which owns the badge this replaces and mounts this
 * field on demand when the badge is clicked — hence `autoFocus`. Do not mount
 * it directly; the control carries the focusout handling that keeps the preset
 * buttons reachable, and every surface has to enter an estimate the same way.
 *
 * Both `setNodeEstimate` and `setTaskEstimate` accept a change whether or not
 * the item is on the grid — an estimate is a fact about the WORK, so it is
 * warned about but never clamped (see `warnIfEstimateOverflows` in the store).
 * Drag-resize is a second, equivalent route for placed work, not the only one.
 *
 * Two constraints were written here for an earlier <Modal> host that no longer
 * exists. Both were re-derived for this one:
 *
 * - Escape. Under the modal, Modal's `window` keydown listener ran in the
 *   CAPTURE phase (src/components/Modal.tsx), so it fired before this field's
 *   own bubble-phase handler and Escape discarded the draft AND closed the
 *   overlay in one keystroke. There is no modal ancestor here, so Escape now
 *   does exactly what the branch below says and nothing more: revert the
 *   draft, then blur — which is what unmounts the field. App.tsx's
 *   `blur-target` Escape handling is a BUBBLE-phase `window` listener, and the
 *   `stopPropagation` below halts the native event at React's root container
 *   before it can reach `window`, so nothing else acts on the keystroke.
 * - dnd-kit. The old note required this to render OUTSIDE any element carrying
 *   @dnd-kit `listeners`. The backlog row spreads `listeners` on the row root,
 *   so that placement is no longer available; the same guarantee is met by
 *   stopping the two events dnd-kit activates on from reaching the row —
 *   `onPointerDown` (PointerSensor) and `onKeyDown` (KeyboardSensor). Without
 *   the first, a press on this input arms the drag sensor and a 5px twitch
 *   drags the row instead of focusing the field.
 *
 * Typed digits cannot trigger the Plan view's 1–7 weekday placement:
 * `resolvePlanKey` returns null for an `isEditableTarget`, which is true of
 * any INPUT (src/lib/appKeyboard.ts).
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
  // A set estimate is data; the empty `est` prompt is the only decoration here.
  const tone = minutes == null && draft == null ? 'text-faint' : 'text-ink-soft';

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
      // Only ever mounted in response to a click on the badge that replaces
      // it, so focus belongs here — the click that opened the field lands on
      // the badge, which is already gone by the time this renders.
      autoFocus
      aria-label={`Estimate for ${label}`}
      value={shown}
      placeholder="est"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`w-[34px] min-h-[24px] shrink-0 rounded-[6px] border border-transparent bg-transparent px-[3px] py-[1px] text-kbd tabular-nums hover:border-line-2 focus:border-line-2 focus:text-ink-soft focus:outline-none ${tone}`}
    />
  );
}
