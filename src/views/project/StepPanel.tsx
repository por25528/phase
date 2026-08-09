import { useEffect, useRef, useState, type FocusEvent, type JSX } from 'react';
import type { Goal, GoalNode } from '../../db/types';
import { registerPendingNoteFlush, useAppStore } from '../../state/store';
import { DateField } from '../../components/DateField';
import { IconArrowRight, IconDiamond } from '../../components/Icons';
import { EstimateControl } from '../../components/EstimateControl';
import { InlineEdit } from '../../components/InlineEdit';
import { LogTimeControl } from '../../components/LogTimeControl';
import { NoteEditor } from '../../components/NoteEditor';
import { loggedForNode } from '../../lib/actuals';
import { NOTE_SAVE_DEBOUNCE_MS, shouldFlushNoteSave } from '../../lib/noteAutosave';
import { nodePct } from '../../lib/pct';
import { fmtD } from '../../lib/dates';
import { containerStatus, STATUS_WORD, stepStatus } from '../../lib/status';
import type { StepStatus } from '../../db/types';

const STATUS_ORDER: readonly StepStatus[] = ['todo', 'doing', 'blocked', 'done'];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-meta font-[550] uppercase tracking-[0.08em] text-muted mb-[7px]">
      {children}
    </div>
  );
}

export function StepPanel({ goal, node, actions }: {
  goal: Goal;
  node: GoalNode;
  actions: ReturnType<typeof useAppStore>['actions'];
}): JSX.Element {
  const { sessions, pendingUndo } = useAppStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftStart, setDraftStart] = useState(node.start ?? '');
  const [draftDeadline, setDraftDeadline] = useState(node.deadline ?? '');
  const [draftBlockedOn, setDraftBlockedOn] = useState(node.blockedOn ?? '');
  const initialNotes = node.notes ?? '';
  const [draftNotes, setDraftNotes] = useState(initialNotes);
  const draftNotesRef = useRef(initialNotes);
  const savedNotesRef = useRef(initialNotes);
  const noteSubjectRef = useRef(node.id);
  const pendingUndoRef = useRef(pendingUndo);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  pendingUndoRef.current = pendingUndo;
  const isLeaf = !node.children || node.children.length === 0;

  useEffect(() => {
    setEditingTitle(false);
  }, [node.id]);

  useEffect(() => {
    setDraftStart(node.start ?? '');
    setDraftDeadline(node.deadline ?? '');
  }, [node.id, node.start, node.deadline]);

  useEffect(() => {
    setDraftBlockedOn(node.blockedOn ?? '');
  }, [node.id, node.blockedOn]);

  function clearNoteTimer(): void {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = null;
  }

  function flushNotes(reason: 'debounce' | 'blur' | 'unmount'): void {
    if (!shouldFlushNoteSave(pendingUndoRef.current !== null, reason)) return;
    if (draftNotesRef.current === savedNotesRef.current) return;
    clearNoteTimer();
    const markdown = draftNotesRef.current;
    savedNotesRef.current = markdown;
    actionsRef.current.setNodeNotes(noteSubjectRef.current, markdown);
  }

  const flushNotesRef = useRef(flushNotes);
  flushNotesRef.current = flushNotes;

  useEffect(() => registerPendingNoteFlush(() => flushNotesRef.current('unmount')), []);

  // The editor is intentionally reused across steps, so reset the draft when
  // its subject changes instead of relying on a remount.
  useEffect(() => {
    if (noteSubjectRef.current === node.id) return;
    flushNotesRef.current('unmount');
    clearNoteTimer();
    noteSubjectRef.current = node.id;
    const next = node.notes ?? '';
    draftNotesRef.current = next;
    savedNotesRef.current = next;
    setDraftNotes(next);
  }, [node.id]);

  useEffect(() => {
    if (draftNotesRef.current === savedNotesRef.current) return;
    clearNoteTimer();
    noteTimerRef.current = setTimeout(() => {
      noteTimerRef.current = null;
      flushNotesRef.current('debounce');
    }, NOTE_SAVE_DEBOUNCE_MS);
    return clearNoteTimer;
  }, [draftNotes, pendingUndo]);

  useEffect(() => () => flushNotesRef.current('unmount'), []);

  function handleNotesBlur(event: FocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      flushNotesRef.current('blur');
    }
  }

  function commitDates(start: string, deadline: string): void {
    setDraftStart(start);
    setDraftDeadline(deadline);
    if (start === '' || deadline === '') {
      actions.clearNodeDates(goal.id, node.id);
      return;
    }
    actions.setNodeDates(goal.id, node.id, start, deadline);
  }

  return (
    <div className="px-[14px] py-[12px]">
      <div className="flex items-start gap-[10px]">
        <h2 aria-label={node.title} className="m-0 flex-1 min-w-0">
          {editingTitle ? (
            <InlineEdit
              value={node.title}
              className="font-disp text-h2 font-semibold tracking-[-0.01em]"
              onCommit={(title) => {
                if (title !== node.title) actions.renameNode(node.id, title);
                setEditingTitle(false);
              }}
              onCancel={() => setEditingTitle(false)}
            />
          ) : (
            <button
              type="button"
              className="font-disp text-h2 font-semibold tracking-[-0.01em] cursor-text hover:text-ink-hover w-fit text-left rounded-[6px]"
              onClick={() => setEditingTitle(true)}
              aria-label={`Rename step "${node.title}"`}
              title="Click to rename"
            >
              {node.title}
            </button>
          )}
        </h2>
        {isLeaf && (
          <button
            type="button"
            aria-label={
              node.checkpoint
                ? `Remove checkpoint from "${node.title}"`
                : `Mark "${node.title}" as a checkpoint`
            }
            title="Checkpoint"
            onClick={() => actions.toggleCheckpoint(node.id)}
            className={`px-[6px] py-[4px] min-h-[24px] inline-flex items-center rounded-field hover:bg-hover ${
              node.checkpoint ? 'text-accent' : 'text-muted hover:text-accent'
            }`}
          >
            {/* Solid when it IS one, hollow when it could be — the same pair the
                `◆`/`◇` characters carried, minus the two fallback faces. */}
            <IconDiamond size={12} filled={!!node.checkpoint} />
          </button>
        )}
        <button
          type="button"
          aria-label="Close step details"
          onClick={() => actions.closeStep()}
          className="text-meta font-semibold text-muted px-[7px] py-[4px] min-h-[24px] rounded-field hover:bg-hover hover:text-ink"
        >
          Close
        </button>
      </div>

      <section className="mt-[22px]">
        <SectionLabel>Status</SectionLabel>
        {isLeaf ? (
          <>
            <div role="radiogroup" aria-label="Status" className="flex gap-[4px]">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={stepStatus(node) === s}
                  onClick={() => {
                    // Route 'done' through toggleLeaf so completing from the
                    // panel arms the same "Completed X" undo the tree
                    // checkbox does — same state change, same reversibility.
                    // toggleLeaf TOGGLES, so it must only fire on the
                    // transition INTO 'done'; clicking an already-done radio
                    // would otherwise uncheck it. blockedOn is discarded by
                    // toggleLeaf exactly as setNodeStatus('done', …) already
                    // did, since neither passes a reason through on entering
                    // 'done'.
                    if (s === 'done') {
                      if (stepStatus(node) !== 'done') actions.toggleLeaf(node.id);
                      return;
                    }
                    actions.setNodeStatus(node.id, s, s === 'blocked' ? draftBlockedOn : undefined);
                  }}
                  className={`text-compact px-[9px] py-[5px] rounded-field border ${
                    stepStatus(node) === s
                      ? 'border-accent text-accent-deep bg-accent-tint'
                      : 'border-line-2 text-ink-soft hover:bg-hover'
                  }`}
                >
                  {STATUS_WORD[s]}
                </button>
              ))}
            </div>
            {stepStatus(node) === 'blocked' && (
              <input
                type="text"
                value={draftBlockedOn}
                onChange={(e) => setDraftBlockedOn(e.target.value)}
                onBlur={() => {
                  if (draftBlockedOn.trim() === (node.blockedOn ?? '').trim()) return;
                  actions.setNodeStatus(node.id, 'blocked', draftBlockedOn);
                }}
                placeholder="Blocked on…"
                aria-label="Blocked on"
                className="mt-[8px] w-full text-ui px-[9px] py-[6px] rounded-field border border-line-2 bg-field text-ink placeholder:text-muted"
              />
            )}
          </>
        ) : (
          <span className="text-ui text-ink-soft">{STATUS_WORD[containerStatus(node)]}</span>
        )}
      </section>

      <section className="mt-[22px]">
        <SectionLabel>Span</SectionLabel>
        <div className="flex flex-wrap items-center gap-[6px]">
          <DateField
            value={draftStart}
            ariaLabel="Span start"
            placeholder="Start"
            onCommit={(next) => commitDates(next, draftDeadline)}
          />
          <span className="text-muted inline-flex" aria-hidden="true"><IconArrowRight size={13} /></span>
          <DateField
            value={draftDeadline}
            ariaLabel="Span end"
            placeholder="End"
            onCommit={(next) => commitDates(draftStart, next)}
          />
        </div>
      </section>

      <section className="mt-[22px]">
        <SectionLabel>Plan</SectionLabel>
        {node.plannedWeek ? (
          <div className="flex items-center gap-[8px]">
            <span className="text-ui text-ink-soft tabular-nums">
              Week of {fmtD(node.plannedWeek)}
              {node.plannedDay ? ` · ${fmtD(node.plannedDay)}` : ''}
            </span>
            <button
              type="button"
              onClick={() => actions.unscheduleNode(goal.id, node.id)}
              className="text-meta font-semibold text-muted px-[6px] py-[3px] min-h-[24px] rounded-field hover:bg-hover hover:text-ink"
            >
              Unschedule
            </button>
          </div>
        ) : (
          <p className="m-0 text-ui text-muted">
            Not planned — use the Plan view to commit this to a week.
          </p>
        )}
      </section>

      {isLeaf && (
        <>
          <section className="mt-[22px]">
            <SectionLabel>Estimate</SectionLabel>
            <EstimateControl
              minutes={node.estimateMin}
              label={node.title}
              onChange={(minutes) => actions.setNodeEstimate(node.id, minutes)}
            />
          </section>

          <section className="mt-[22px]">
            <SectionLabel>Time logged</SectionLabel>
            <LogTimeControl
              loggedMin={loggedForNode(sessions, node.id)}
              estimateMin={node.estimateMin}
              label={node.title}
              onLog={(minutes) => actions.logSession('step', node.id, minutes)}
              onClear={() => actions.clearSessionsFor('step', node.id)}
            />
          </section>
        </>
      )}

      {!isLeaf && (
        <section className="mt-[22px]">
          <SectionLabel>Progress</SectionLabel>
          <span className="text-title text-ink-soft tabular-nums">{Math.round(nodePct(node))}%</span>
        </section>
      )}

      <section className="mt-[22px]">
        <SectionLabel>Notes</SectionLabel>
        <div onBlur={handleNotesBlur}>
          <NoteEditor
            docKey={node.id}
            value={noteSubjectRef.current === node.id ? draftNotes : initialNotes}
            onChange={(markdown) => {
              draftNotesRef.current = markdown;
              setDraftNotes(markdown);
            }}
            placeholder="What actually happened?"
            ariaLabel="Step notes"
          />
        </div>
      </section>
    </div>
  );
}
