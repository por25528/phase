import { useEffect, useState, type JSX } from 'react';
import type { Goal, GoalNode, StepStatus } from '../../db/types';
import { useAppStore } from '../../state/store';
import { DateField } from '../../components/DateField';
import {
  IconArrowRight,
  IconCalendar,
  IconClock,
  IconDiamond,
  IconDots,
  IconRotate,
  IconSparkle,
} from '../../components/Icons';
import { EstimateControl } from '../../components/EstimateControl';
import { InlineEdit } from '../../components/InlineEdit';
import { LogTimeControl } from '../../components/LogTimeControl';
import { NoteEditor } from '../../components/NoteEditor';
import { Popover, PopoverItem, PopoverSeparator } from '../../components/Popover';
import {
  PropertyChip,
  PropertyChipInline,
  PropertyChipToggle,
  PropertyOption,
} from '../../components/PropertyRow';
import { ScheduleMenu } from '../../components/SchedulePopover';
import { StatusMark } from '../../components/StatusMark';
import { useNoteDraft } from '../../components/useNoteDraft';
import { ProposalPanel } from './ProposalPanel';
import { loggedForNode } from '../../lib/actuals';
import { planVsEstimate, sortedBlocks } from '../../lib/blocks';
import { clockLabel } from '../../lib/clock';
import { fmtD, todayStr } from '../../lib/dates';
import { fmtMinutes } from '../../lib/effort';
import { STATUS_WORD, stepStatus } from '../../lib/status';
import { taskPageActionGroups, type RowActionId } from '../../lib/rowActions';
import { findNodePath, findParentList } from '../../lib/tree';

const STATUS_ORDER: readonly StepStatus[] = ['todo', 'doing', 'blocked', 'done'];

/**
 * One task, as its own page.
 *
 * The invariant this overturns said a page for a leaf "would be the inspector
 * again with more chrome". The answer is that this page's job is the NOTE: the
 * body runs the full 720px measure with its images inline, and the properties
 * above it are chips — the same `Popover` controls the inspector used, stated
 * as readouts — rather than a second property list. It is the note with its
 * context above it.
 *
 * It is still a LENS on the open goal, by exactly the mechanism `openArea`
 * uses: `openGoalId` stays set behind it, so the breadcrumb is real navigation
 * and Back is one step. `onBack` is `closeStep`, which is also what Escape
 * runs — one way out, spelled two ways.
 *
 * LEAVES ONLY. Callers branch before rendering this; a container keeps the
 * docked inspector, which has a task list this page would have nothing to put.
 */
export function TaskPage({
  goal,
  node,
  backLabel,
  onBack,
}: {
  goal: Goal;
  node: GoalNode;
  backLabel: string;
  onBack: () => void;
}): JSX.Element {
  const { goals, sessions, actions } = useAppStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [draftStart, setDraftStart] = useState(node.start ?? '');
  const [draftDeadline, setDraftDeadline] = useState(node.deadline ?? '');
  const [draftBlockedOn, setDraftBlockedOn] = useState(node.blockedOn ?? '');
  const noteDraft = useNoteDraft(node.id, node.notes ?? '', (id, markdown) =>
    actions.setNodeNotes(id, markdown),
  );

  const status = stepStatus(node);
  const sittings = sortedBlocks(node);
  const discrepancy = planVsEstimate(node);
  const logged = loggedForNode(sessions, node.id);

  useEffect(() => {
    setEditingTitle(false);
    setProposing(false);
  }, [node.id]);

  useEffect(() => {
    setDraftStart(node.start ?? '');
    setDraftDeadline(node.deadline ?? '');
  }, [node.id, node.start, node.deadline]);

  useEffect(() => {
    setDraftBlockedOn(node.blockedOn ?? '');
  }, [node.id, node.blockedOn]);

  function commitDates(start: string, deadline: string): void {
    setDraftStart(start);
    setDraftDeadline(deadline);
    if (start === '' || deadline === '') {
      actions.clearNodeDates(goal.id, node.id);
      return;
    }
    actions.setNodeDates(goal.id, node.id, start, deadline);
  }

  const parent = findParentList(goals, node.id);
  const path = findNodePath(goals, node.id);
  const menuGroups = taskPageActionGroups({
    isContainer: false,
    isDone: status === 'done',
    isMilestone: node.checkpoint === true,
    canIndent: parent !== null && parent.index > 0,
    canOutdent: path !== null && path.length > 1,
  });

  function runAction(id: RowActionId): void {
    switch (id) {
      case 'rename': setEditingTitle(true); return;
      case 'indent': actions.indentNode(node.id); return;
      case 'outdent': actions.outdentNode(node.id); return;
      // `removeNode` nulls `openStepId` when the open node is inside what it
      // deleted, so this unmounts the page and lands back on the tree without
      // this component arranging anything.
      case 'delete': actions.removeNode(node.id); return;
      default: return;
    }
  }

  const whenValue =
    sittings.length > 0
      ? `${fmtD(sittings[0].date)} · ${clockLabel(sittings[0].startMin)}${
          sittings.length > 1 ? ` +${sittings.length - 1}` : ''
        }`
      : node.plannedWeek
        ? `Week of ${fmtD(node.plannedWeek)}`
        : null;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="flex items-center gap-[5px] text-meta text-muted pt-[8px]">
        <button
          type="button"
          onClick={onBack}
          className="px-[6px] py-[4px] -ml-[6px] min-h-[24px] inline-flex items-center gap-[5px] rounded-[6px] hover:bg-hover hover:text-ink"
        >
          <span aria-hidden="true">‹</span>
          <span className="truncate max-w-[220px]">{backLabel}</span>
        </button>
      </nav>

      <div className="max-w-[720px]">
        <div className="flex items-start gap-[10px] py-[4px]">
          <h1 className="m-0 min-w-0 flex-1">
            {editingTitle ? (
              <InlineEdit
                value={node.title}
                className="text-h2 font-semibold tracking-[-0.01em]"
                onCommit={(title) => {
                  if (title !== node.title) actions.renameNode(node.id, title);
                  setEditingTitle(false);
                }}
                onCancel={() => setEditingTitle(false)}
              />
            ) : (
              <button
                type="button"
                className="text-h2 font-semibold tracking-[-0.01em] cursor-text hover:text-ink-hover w-full text-left rounded-[6px]"
                onClick={() => setEditingTitle(true)}
                aria-label={`Rename task "${node.title}"`}
                title="Click to rename"
              >
                {node.title}
              </button>
            )}
          </h1>
          <Popover
            label={`Actions for "${node.title}"`}
            role="menu"
            align="end"
            panelWidth={196}
            triggerClassName="flex-none w-[24px] h-[24px] grid place-items-center rounded-[6px] text-muted hover:text-ink hover:bg-hover"
            trigger={<IconDots size={13} />}
          >
            {(close) =>
              menuGroups.map((group, index) => (
                <div key={group[0].id}>
                  {index > 0 && <PopoverSeparator />}
                  {group.map((action) => (
                    <PopoverItem
                      key={action.id}
                      close={close}
                      hint={action.hint}
                      tone={action.tone}
                      onSelect={() => runAction(action.id)}
                    >
                      {action.label}
                    </PopoverItem>
                  ))}
                </div>
              ))
            }
          </Popover>
        </div>

        {/* The chips. Every one of them opens the SAME control the inspector
            opens, so the page and the panel cannot drift about what a property
            offers. */}
        <div className="flex flex-wrap items-center gap-[6px] mt-[6px]">
          <PropertyChip
            label="Status"
            icon={<StatusMark status={status} />}
            value={STATUS_WORD[status]}
            placeholder={STATUS_WORD.todo}
            panelWidth={188}
          >
            {(close) => (
              <>
                {STATUS_ORDER.map((s) => (
                  <PropertyOption
                    key={s}
                    close={close}
                    current={status === s}
                    onSelect={() => {
                      // Route 'done' through toggleLeaf so completing from the
                      // page arms the same "Completed X" undo the tree checkbox
                      // does. toggleLeaf TOGGLES, so it must only fire on the
                      // transition INTO 'done'.
                      if (s === 'done') {
                        if (status !== 'done') actions.toggleLeaf(node.id);
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
          </PropertyChip>

          <PropertyChip
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
          </PropertyChip>

          <PropertyChip
            label="Schedule"
            icon={<IconCalendar size={13} />}
            value={whenValue}
            placeholder="Not scheduled"
            panelWidth={188}
          >
            {(close) => <ScheduleMenu goalId={goal.id} node={node} close={close} />}
          </PropertyChip>

          <PropertyChipInline icon={<IconClock size={13} />}>
            <EstimateControl
              minutes={node.estimateMin}
              label={node.title}
              alwaysShow
              onChange={(minutes) => actions.setNodeEstimate(node.id, minutes)}
            />
          </PropertyChipInline>

          <PropertyChipToggle
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
          </PropertyChipToggle>
        </div>

        {/* The reason stays OUT of the status popover. It is the one piece of
            free text here, it is what makes a blocked task actionable, and
            hiding it behind the control that set the status would let the page
            say "Blocked" without ever saying what by. */}
        {status === 'blocked' && (
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
            className="mt-[8px] w-full text-ui px-[9px] py-[5px] rounded-field border border-line-2 bg-field text-ink placeholder:text-muted"
          />
        )}

        {sittings.length > 0 && (
          <div className="mt-[10px] flex flex-col gap-[4px]">
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
        )}

        <div className="my-[14px] border-t border-line" />

        <div onBlur={noteDraft.onBlur}>
          <NoteEditor
            docKey={node.id}
            value={noteDraft.value}
            onChange={noteDraft.onChange}
            placeholder="What actually happened?"
            ariaLabel="Task notes"
          />
        </div>

        {/* The breakdown proposal, which used to live under the tree. It is
            leaf-only, and a leaf no longer opens in the tree — so it comes here,
            beside its subject, which is where its own docstring says it belongs.
            Accepting one gives this node children, and the caller's render-time
            branch turns the page into the container inspector on the next
            paint. */}
        {proposing ? (
          <div className="mt-[14px]">
            <ProposalPanel
              goal={goal}
              node={node}
              actions={actions}
              onClose={() => setProposing(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setProposing(true)}
            className="mt-[14px] inline-flex items-center gap-[6px] text-ui font-medium text-accent-deep hover:bg-accent-tint px-[8px] py-[5px] rounded-[6px] -ml-[1px]"
          >
            <IconSparkle size={12} />
            Break "{node.title}" into subtasks
          </button>
        )}

        <div className="my-[14px] border-t border-line" />

        <section className="pb-[60px]">
          {/* One label, so it is a div and not a component. */}
          <div className="text-meta font-semibold text-muted mb-[7px]">Time</div>
          {/* IconRotate, not IconCheck. StatusMark draws a tick for `done` in
              the chip row above, and one mark meaning both "finished" and "time
              was recorded" is the icon ambiguity the row redesign removed. */}
          <PropertyChipInline icon={<IconRotate size={13} />}>
            <LogTimeControl
              loggedMin={logged}
              estimateMin={node.estimateMin}
              label={node.title}
              alwaysShow
              onLog={(minutes) => actions.logSession('step', node.id, minutes)}
              onClear={() => actions.clearSessionsFor('step', node.id)}
            />
          </PropertyChipInline>
        </section>
      </div>
    </div>
  );
}
