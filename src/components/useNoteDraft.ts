import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { registerPendingNoteFlush, useAppStore } from '../state/store';
import { NOTE_SAVE_DEBOUNCE_MS, shouldFlushNoteSave } from '../lib/noteAutosave';

/**
 * One note editor's draft, its debounce, and its departure flush.
 *
 * Extracted because three surfaces need it — the goal's Notes tab, the
 * container inspector, and a task's page — and what it encodes is an invariant,
 * not a convenience: a debounce timer must never spend a pending undo, while an
 * explicit departure (blur, subject switch, unmount) always saves, because
 * losing typing is worse than losing an undo nobody used. Three copies of that
 * rule would be three chances to get it wrong.
 *
 * `save` receives the subject id the text was typed against, not the current
 * one. Switching subjects flushes the OLD draft before reseeding, and passing
 * today's id there would file the previous task's note under the new task.
 */
export function useNoteDraft(
  subjectId: string,
  stored: string,
  save: (subjectId: string, markdown: string) => void,
): {
  value: string;
  onChange: (markdown: string) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
} {
  const { pendingUndo } = useAppStore();
  const [draft, setDraft] = useState(stored);
  const draftRef = useRef(stored);
  const savedRef = useRef(stored);
  const subjectRef = useRef(subjectId);
  const pendingUndoRef = useRef(pendingUndo);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  pendingUndoRef.current = pendingUndo;

  function clearTimer(): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function flush(reason: 'debounce' | 'blur' | 'unmount'): void {
    if (!shouldFlushNoteSave(pendingUndoRef.current !== null, reason)) return;
    if (draftRef.current === savedRef.current) return;
    clearTimer();
    const markdown = draftRef.current;
    savedRef.current = markdown;
    saveRef.current(subjectRef.current, markdown);
  }

  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => registerPendingNoteFlush(() => flushRef.current('unmount')), []);

  // The editor is reused across subjects, so reset the draft when the subject
  // changes instead of relying on a remount. The guard means an external edit
  // to the SAME subject never clobbers what is being typed.
  useEffect(() => {
    if (subjectRef.current === subjectId) return;
    flushRef.current('unmount');
    clearTimer();
    subjectRef.current = subjectId;
    draftRef.current = stored;
    savedRef.current = stored;
    setDraft(stored);
  }, [subjectId, stored]);

  useEffect(() => {
    if (draftRef.current === savedRef.current) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushRef.current('debounce');
    }, NOTE_SAVE_DEBOUNCE_MS);
    return clearTimer;
  }, [draft, pendingUndo]);

  useEffect(() => () => flushRef.current('unmount'), []);

  return {
    // Use the incoming value for the first render after a subject switch, so
    // NoteEditor's docKey effect reseeds from the new subject immediately.
    value: subjectRef.current === subjectId ? draft : stored,
    onChange(markdown: string) {
      draftRef.current = markdown;
      setDraft(markdown);
    },
    onBlur(event: FocusEvent<HTMLElement>) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        flushRef.current('blur');
      }
    },
  };
}
