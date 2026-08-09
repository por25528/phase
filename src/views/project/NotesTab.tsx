import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { NoteEditor } from '../../components/NoteEditor';
import { NOTE_SAVE_DEBOUNCE_MS, shouldFlushNoteSave } from '../../lib/noteAutosave';

// Shared uppercase section label so the project page's sections read as one system.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-meta font-[550] uppercase tracking-[0.08em] text-muted mb-[9px]">
      {children}
    </div>
  );
}

// ── Notes ─────────────────────────────────────────────────────────────────────
function NotesSection({
  goal: g,
  actions,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  const { pendingUndo } = useAppStore();
  const initialNotes = g.notes ?? '';
  const [draft, setDraft] = useState(initialNotes);
  const draftRef = useRef(initialNotes);
  const savedRef = useRef(initialNotes);
  const subjectRef = useRef(g.id);
  const pendingUndoRef = useRef(pendingUndo);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
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
    actionsRef.current.setGoalNotes(subjectRef.current, markdown);
  }

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // `NoteEditor` stays mounted while the project page changes subjects. Flush
  // the old draft before reseeding the editor with the new project's notes.
  useEffect(() => {
    if (subjectRef.current === g.id) return;
    flushRef.current('unmount');
    clearTimer();
    subjectRef.current = g.id;
    const next = g.notes ?? '';
    draftRef.current = next;
    savedRef.current = next;
    setDraft(next);
  }, [g.id]);

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

  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      flushRef.current('blur');
    }
  }

  // Use the incoming value for the first render after a subject switch. This
  // lets NoteEditor's docKey effect reseed from the new subject immediately.
  const editorValue = subjectRef.current === g.id ? draft : initialNotes;

  return (
    <div onBlur={handleBlur}>
      <SectionLabel>Notes</SectionLabel>
      <NoteEditor
        docKey={g.id}
        value={editorValue}
        onChange={(markdown) => {
          draftRef.current = markdown;
          setDraft(markdown);
        }}
        placeholder="Working notes — strategy, links, blockers…"
        ariaLabel="Goal notes"
      />
    </div>
  );
}

export function NotesTab({
  goal,
  actions,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  return (
    <div className="flex flex-col max-w-[720px]">
      <NotesSection goal={goal} actions={actions} />
    </div>
  );
}
