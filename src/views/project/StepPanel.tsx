import { useEffect, useRef, useState, type FocusEvent, type JSX } from 'react';
import type { Goal, GoalNode } from '../../db/types';
import { registerPendingNoteFlush, useAppStore } from '../../state/store';
import { DateField } from '../../components/DateField';
import {
  IconArrowRight,
  IconArrowUpRight,
  IconCalendar,
  IconCheck,
  IconCircle,
  IconClock,
  IconDiamond,
  IconPlus,
  IconRotate,
  IconX,
} from '../../components/Icons';
import { EstimateControl } from '../../components/EstimateControl';
import { InlineEdit } from '../../components/InlineEdit';
import { LogTimeControl } from '../../components/LogTimeControl';
import { NoteEditor } from '../../components/NoteEditor';
import {
  PropertyOption,
  PropertyRow,
  PropertyStatic,
  PropertyToggle,
} from '../../components/PropertyRow';
import { loggedForNode } from '../../lib/actuals';
import { NOTE_SAVE_DEBOUNCE_MS, shouldFlushNoteSave } from '../../lib/noteAutosave';
import { fmtD, todayStr } from '../../lib/dates';
import { containerStatus, isDone, STATUS_WORD, stepStatus } from '../../lib/status';
import { clockLabel } from '../../lib/clock';
import { planVsEstimate, sortedBlocks } from '../../lib/blocks';
import { ScheduleMenu } from '../../components/SchedulePopover';
import { fmtMinutes } from '../../lib/effort';
import type { StepStatus } from '../../db/types';

const STATUS_ORDER: readonly StepStatus[] = ['todo', 'doing', 'blocked', 'done'];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-meta font-semibold text-muted mb-[7px]">
      {children}
    </div>
  );
}

/**
 * A property whose editor is already an inline swap — estimate, time logged.
 *
 * `EstimateControl` and `LogTimeControl` each own a badge that becomes a field,
 * with focus-return, preset buttons and pointer guards that took several passes
 * to get right. Putting either behind a `PropertyRow` popover would add a click
 * to reach an editor that already appears on the first one, and would nest a
 * disclosure inside a disclosure. So they keep their own behaviour and only
 * borrow the row's metrics, which is what makes the column line up.
 */
function InlineProperty({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full flex items-center gap-[8px] px-[6px] py-[5px] rounded-[6px] group hover:bg-hover">
      <span className="flex-none inline-flex text-faint">{icon}</span>
      <span className="flex-1 min-w-0 flex items-center">{children}</span>
    </div>
  );
}

/** A hairline between the inspector's stacked concerns. */
function PanelRule() {
  return <div className="my-[10px] border-t border-line" />;
}

/**
 * The mark beside a status word.
 *
 * Four states, three marks: `todo` and `doing` share the ring and are told
 * apart by the accent, because they are the same task at different moments —
 * where `blocked` and `done` are the two ways it stops being work you can pick
 * up. The mark never toggles anything; `LeafStatusBox` on the tree row is the
 * one tickable control, and giving the panel a second one is how "ticking the
 * checkbox is the only thing that moves a number" stops being true.
 */
function StatusMark({ status }: { status: StepStatus }) {
  if (status === 'done') return <IconCheck size={13} />;
  if (status === 'blocked') return <IconDiamond size={11} filled={false} />;
  return <IconCircle size={13} className={status === 'doing' ? 'text-accent' : ''} />;
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
  const children = node.children ?? [];
  // Counts DIRECT children, matching the list rendered beside it. `nodePct`
  // rolls the whole subtree up and would state a fraction whose denominator is
  // nowhere on screen.
  const childDone = children.filter((c) => isDone(c)).length;
  const sittings = sortedBlocks(node);
  const discrepancy = planVsEstimate(node);

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
      {/* Header. The title carries the panel; the two verbs beside it are
          icon-sized because they are the same two verbs on every task, and a
          word-width `Close` next to a word-width `Milestone` made the header
          read as a toolbar with a heading in it. */}
      <div className="flex items-start gap-[6px]">
        <h2 aria-label={node.title} className="m-0 flex-1 min-w-0">
          {editingTitle ? (
            <InlineEdit
              value={node.title}
              className="text-title font-semibold tracking-[-0.01em]"
              onCommit={(title) => {
                if (title !== node.title) actions.renameNode(node.id, title);
                setEditingTitle(false);
              }}
              onCancel={() => setEditingTitle(false)}
            />
          ) : (
            <button
              type="button"
              className="text-title font-semibold tracking-[-0.01em] cursor-text hover:text-ink-hover w-full text-left rounded-[6px]"
              onClick={() => setEditingTitle(true)}
              aria-label={`Rename task "${node.title}"`}
              title="Click to rename"
            >
              {node.title}
            </button>
          )}
        </h2>
        {/* Open — containers only, and the same verb the row's `O` and its
            double-click run. A leaf has nothing behind it: its whole content is
            already on this panel, so an ↗ there would promise a page that would
            have to be this one again. */}
        {!isLeaf && (
          <button
            type="button"
            aria-label={`Open "${node.title}" as a workspace`}
            title="Open as a workspace (O)"
            onClick={() => actions.openArea(node.id)}
            className="flex-none w-[24px] h-[24px] grid place-items-center rounded-[6px] text-muted hover:text-ink hover:bg-hover"
          >
            <IconArrowUpRight size={13} />
          </button>
        )}
        <button
          type="button"
          aria-label="Close task details"
          title="Close (Esc)"
          onClick={() => actions.closeStep()}
          className="flex-none w-[24px] h-[24px] grid place-items-center rounded-[6px] text-muted hover:text-ink hover:bg-hover"
        >
          <IconX size={13} />
        </button>
      </div>

      {/* Properties. Four short facts that used to cost four labelled sections
          and ~240 vertical pixels; the editors are one click behind the values
          they edit. */}
      <div className="mt-[10px] -mx-[6px]">
        {isLeaf ? (
          <PropertyRow
            label="Status"
            icon={<StatusMark status={stepStatus(node)} />}
            value={STATUS_WORD[stepStatus(node)]}
            placeholder="Todo"
            panelWidth={188}
          >
            {(close) => (
              <>
                {STATUS_ORDER.map((s) => (
                  <PropertyOption
                    key={s}
                    close={close}
                    current={stepStatus(node) === s}
                    onSelect={() => {
                      // Route 'done' through toggleLeaf so completing from the
                      // panel arms the same "Completed X" undo the tree
                      // checkbox does — same state change, same reversibility.
                      // toggleLeaf TOGGLES, so it must only fire on the
                      // transition INTO 'done'; picking an already-done option
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
                  >
                    <StatusMark status={s} />
                    {STATUS_WORD[s]}
                  </PropertyOption>
                ))}
              </>
            )}
          </PropertyRow>
        ) : (
          <PropertyStatic icon={<StatusMark status={containerStatus(node)} />}>
            {STATUS_WORD[containerStatus(node)]}
          </PropertyStatic>
        )}

        {/* The reason stays OUT of the popover. It is the one piece of free
            text here, it is what makes a blocked task actionable, and hiding it
            behind the control that set the status would mean the panel could
            show "Blocked" without ever showing what by. */}
        {isLeaf && stepStatus(node) === 'blocked' && (
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
            className="mt-[2px] mb-[4px] w-[calc(100%-12px)] mx-[6px] text-ui px-[9px] py-[5px] rounded-field border border-line-2 bg-field text-ink placeholder:text-muted"
          />
        )}

        {isLeaf && (
          <PropertyToggle
            label={
              node.checkpoint
                ? `Stop treating "${node.title}" as a milestone`
                : `Make "${node.title}" a milestone`
            }
            icon={<IconDiamond size={13} filled={!!node.checkpoint} />}
            on={!!node.checkpoint}
            onToggle={() => actions.toggleCheckpoint(node.id)}
          >
            {node.checkpoint ? 'Milestone' : 'Not a milestone'}
          </PropertyToggle>
        )}

        {/* Dates. Phase stores a SPAN — start and deadline, both or neither —
            so the popover keeps both fields and the row states the end, which
            is the date anyone reads a task for. */}
        <PropertyRow
          label="Dates"
          icon={<IconCalendar size={13} />}
          value={node.deadline ? fmtD(node.deadline) : null}
          placeholder="No dates"
          panelRole="dialog"
          panelWidth={244}
        >
          {() => (
            <div className="px-[4px] py-[2px]">
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
              <p className="m-0 mt-[6px] text-meta text-muted">
                A span needs both ends; clearing either clears both.
              </p>
            </div>
          )}
        </PropertyRow>

        {isLeaf && (
          <>
            <InlineProperty icon={<IconClock size={13} />}>
              <EstimateControl
                minutes={node.estimateMin}
                label={node.title}
                alwaysShow
                onChange={(minutes) => actions.setNodeEstimate(node.id, minutes)}
              />
            </InlineProperty>
            {/* IconRotate, not IconCheck. `StatusMark` draws a tick for `done`
                three rows above, and the same mark meaning both "this task is
                finished" and "time was recorded against it" is the icon
                ambiguity the row redesign set out to remove. A rotation reads
                as elapsed time, which is what a ledger of sittings is. */}
            <InlineProperty icon={<IconRotate size={13} />}>
              <LogTimeControl
                loggedMin={loggedForNode(sessions, node.id)}
                estimateMin={node.estimateMin}
                label={node.title}
                alwaysShow
                onLog={(minutes) => actions.logSession('step', node.id, minutes)}
                onClear={() => actions.clearSessionsFor('step', node.id)}
              />
            </InlineProperty>
          </>
        )}
      </div>

      <PanelRule />

      <section>
        <SectionLabel>Schedule</SectionLabel>
        {/*
          This used to read "Not planned — use the Plan view to commit this to
          a week", which is a dead end: the inspector knew the answer and sent
          the user to another surface to act on it. Scheduling is the single
          most common thing to do to a task you have just opened.

          `aimMin: 0` means "the earliest gap that fits", the same rule
          `replanNode` uses. The store refuses with a toast when the day has no
          room, so a full day says so rather than silently landing the block
          somewhere else.
        */}
        {sittings.length > 0 ? (
          <div className="flex flex-col gap-[4px]">
            {/*
              One row per SITTING. A four-hour task sat twice is two rows here,
              each removable on its own — the panel used to be able to state one
              placement, so the second sitting had nowhere to be named.
            */}
            {sittings.map((b) => (
              <div key={b.id} className="flex items-center gap-[8px]">
                <span className="text-ui text-ink-soft tabular-nums flex-1 min-w-0">
                  {fmtD(b.date)} · {clockLabel(b.startMin)}
                  <span className="text-muted"> · {fmtMinutes(b.minutes)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove the sitting on ${fmtD(b.date)}`}
                  onClick={() => actions.unscheduleNode(goal.id, node.id, b.id)}
                  className="text-meta font-semibold text-muted px-[6px] py-[3px] min-h-[24px] rounded-field hover:bg-hover hover:text-ink"
                >
                  Remove
                </button>
              </div>
            ))}
            {/*
              The discrepancy, stated rather than refused. It is only expressible
              because a sitting owns its own length: "you have set aside 2h for a
              3h task" is two real numbers, not a guess.
            */}
            {discrepancy && discrepancy.planned !== discrepancy.estimate && (
              <p className="m-0 text-meta text-muted">
                {fmtMinutes(discrepancy.planned)} set aside for a {fmtMinutes(discrepancy.estimate)} task
              </p>
            )}
            <div className="flex flex-wrap items-center gap-[5px] mt-[2px]">
              <button
                type="button"
                onClick={() => actions.scheduleNode(goal.id, node.id, todayStr(), 0, { mode: 'add' })}
                title="Another sitting for the same task, leaving the others where they are"
                className="text-meta font-semibold text-accent-deep px-[8px] py-[4px] rounded-field hover:bg-accent-tint"
              >
                Sit again today
              </button>
              <button
                type="button"
                onClick={() => actions.unscheduleNode(goal.id, node.id)}
                className="text-meta font-medium text-muted px-[8px] py-[4px] rounded-field hover:bg-hover hover:text-ink"
              >
                Clear all
              </button>
            </div>
          </div>
        ) : node.plannedWeek ? (
          <div className="flex flex-wrap items-center gap-[8px]">
            <span className="text-ui text-ink-soft tabular-nums">
              Week of {fmtD(node.plannedWeek)} — not placed on a day
            </span>
            <button
              type="button"
              onClick={() => actions.unscheduleNode(goal.id, node.id)}
              className="text-meta font-semibold text-muted px-[6px] py-[3px] min-h-[24px] rounded-field hover:bg-hover hover:text-ink"
            >
              Clear
            </button>
          </div>
        ) : isLeaf ? (
          <div className="flex flex-wrap items-center gap-[5px]">
            {/* One trigger, not a row of three verbs. `ScheduleMenu` is the
                same component the tree row's WHEN cell opens, so the two
                surfaces cannot drift about what scheduling offers. */}
            <PropertyRow
              label="Schedule"
              icon={<IconCalendar size={13} />}
              value={null}
              placeholder="Not scheduled"
              align="start"
              panelWidth={188}
            >
              {(close) => <ScheduleMenu goalId={goal.id} node={node} close={close} />}
            </PropertyRow>
          </div>
        ) : (
          <p className="m-0 text-ui text-muted">
            A group is scheduled through its tasks.
          </p>
        )}
      </section>

      {/* A container's children, on the panel that selected it.
          Reaching a milestone's task list used to mean leaving the inspector,
          finding the row again in the tree and expanding it — for the one
          question you open a milestone to ask. Rows are read-only markers plus
          a title that selects; completion stays on the tree's own checkbox, so
          there is exactly one place a task gets ticked. */}
      {!isLeaf && (
        <>
          <PanelRule />
          <section>
            <div className="flex items-baseline gap-[8px] mb-[7px]">
              <div className="text-meta font-semibold text-muted flex-1">Tasks</div>
              <span className="text-meta text-faint tabular-nums">
                {childDone} / {children.length}
              </span>
            </div>
            <div className="-mx-[6px]">
              {children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => actions.openStep(child.id)}
                  className="w-full flex items-center gap-[8px] px-[6px] py-[4px] rounded-[6px] text-ui text-left hover:bg-hover"
                >
                  <span className="flex-none inline-flex text-faint">
                    {isDone(child) ? <IconCheck size={12} /> : <IconCircle size={12} />}
                  </span>
                  <span
                    className={`flex-1 min-w-0 truncate ${
                      isDone(child) ? 'line-through text-faint' : 'text-ink-soft'
                    }`}
                  >
                    {child.title}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => actions.addChild(node.id)}
              className="mt-[2px] -ml-[0px] inline-flex items-center gap-[6px] text-ui text-muted hover:text-ink px-[6px] py-[4px] rounded-[6px] hover:bg-hover"
            >
              <IconPlus size={12} />
              Add task
            </button>
          </section>
        </>
      )}

      <PanelRule />

      <section>
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
            ariaLabel="Task notes"
          />
        </div>
      </section>
    </div>
  );
}
