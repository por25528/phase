/**
 * Note autosave is deliberately held while an undo is pending. `setAndPersist`
 * correctly drops whole-slice restores when an ordinary write lands; exempting
 * notes would let an undo restore stale text over a note the user just typed.
 * A debounce timer must not spend an undo the user did not knowingly use, so it
 * waits. An explicit departure, such as blur or unmount, always flushes because
 * losing the user's typing is worse than losing an undo they may never use.
 */
export const NOTE_SAVE_DEBOUNCE_MS = 800;

export function shouldFlushNoteSave(
  hasPendingUndo: boolean,
  reason: 'debounce' | 'blur' | 'unmount',
): boolean {
  return reason !== 'debounce' || !hasPendingUndo;
}
