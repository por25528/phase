import { isEditableTarget } from './appKeyboard';

/** What a key press means inside the Plan view. */
export type PlanKeyCommand =
  | { kind: 'place'; dow: number }   // 0 = Monday … 6 = Sunday
  | { kind: 'week'; delta: number }  // -1 previous, +1 next
  | { kind: 'today' };

interface PlanKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}

/**
 * Pure key resolution for the Plan view.
 *
 * `1`–`7` are weekdays, matching this codebase's `dow` convention where
 * Monday is 0 — so the digit is one greater than the index it produces.
 *
 * Every branch is gated on an unmodified key with a non-editable target: the
 * sidebar's habit-add form and the inline estimate fields sit inside this view,
 * and swallowing a typed "7" there would be worse than having no shortcut.
 */
export function resolvePlanKey(event: PlanKeyEvent): PlanKeyCommand | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isEditableTarget(event.target)) return null;

  if (event.key >= '1' && event.key <= '7') {
    return { kind: 'place', dow: Number(event.key) - 1 };
  }
  if (event.key === '[') return { kind: 'week', delta: -1 };
  if (event.key === ']') return { kind: 'week', delta: 1 };
  if (event.key === 't' || event.key === 'T') return { kind: 'today' };
  return null;
}
