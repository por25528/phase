import { useEffect, useMemo, useState, type JSX } from 'react';
import type { Goal, GoalNode, StepStatus } from '../../db/types';
import { useAppStore } from '../../state/store';
import { DateField } from '../../components/DateField';
import {
  IconArrowRight,
  IconCalendar,
  IconCircle,
  IconClock,
  IconDiamond,
  IconDots,
  IconRotate,
  IconSparkle,
  IconWarning,
} from '../../components/Icons';
import { EstimateControl } from '../../components/EstimateControl';
import { InlineEdit } from '../../components/InlineEdit';
import { LogTimeControl } from '../../components/LogTimeControl';
import { NoteEditor } from '../../components/NoteEditor';
import { Popover, PopoverItem, PopoverSeparator } from '../../components/Popover';
import {
  PropertyLine,
  PropertyLineField,
  PropertyLineInline,
  PropertyLineToggle,
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
import { demandIndex, DEMANDS, DEMAND_WORD } from '../../lib/demand';
import { fmtMinutes } from '../../lib/effort';
import { looksOversized } from '../../lib/proposal';
import { aimFor } from '../../lib/slot';
import { STATUS_WORD, stepStatus } from '../../lib/status';
import { taskPageActionGroups, type RowActionId } from '../../lib/rowActions';
import { dayLabel, nextSitting } from '../../lib/rowSchedule';
import { findNode, findNodePath, findParentList } from '../../lib/tree';
import { nextFreeDay } from '../../lib/todayPlan';
import { spansOn } from '../../lib/scheduled';

const STATUS_ORDER: readonly StepStatus[] = ['todo', 'doing', 'blocked', 'done'];

/**
 * One task, as its own page.
 *
 * The invariant this overturns said a page for a leaf "would be the inspector
 * again with more chrome". The answer is that this page's job is the NOTE: the
 * body runs the full 720px measure with its images inline, and the properties
 * above it are its context.
 *
 * Those properties were chips, on the rule that "the value IS the label". That
 * rule is right for the docked inspector and wrong here, and the empty state is
 * what proves it: five bordered chips under the title, FOUR of them reading
 * "No dates", "Not scheduled", "No estimate", "Not a milestone" — a row of
 * negations with more visual weight than the document they introduced. Split
 * into labelled lines, the labels stay quiet and constant and only the values
 * carry ink, so an untouched task reads as a page with a blank margin instead
 * of a page listing what it lacks. `PropertyLine` opens the identical
 * `Popover` with the identical children, so the page and the panel still
 * cannot drift about what a property offers.
 *
 * The note is the document, not a field on it: no box, no padding, its first
 * line on the same left edge as the title and the property labels. The whole
 * column is centred, and the two horizontal rules that used to cut it into
 * strips are gone — including the one over a "Time" section, which is the
 * `Time logged` line in the list now.
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
  const { goals, tasks, sessions, allDayBlocks, actions } = useAppStore();
  /*
   * Where "Sit again today" points. It was a literal `0`, which only ever
   * landed sensibly because a window fenced `resolveSlot`; with the fence gone
   * a bare 0 is midnight, so `ORDINARY_DAY` is the aim instead. Recomputed per
   * render rather than memoised — it reads the clock, and a render is the only
   * moment it is spent.
   */
  const sitAgainAim = aimFor(todayStr(), {
    date: todayStr(),
    minute: new Date().getHours() * 60 + new Date().getMinutes(),
  });
  const [nowMinute, setNowMinute] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
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

  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinute(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

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

  // The resolved value, and the ancestor it came from. `demandIndex` is ONE
  // pass over the goal, and nothing is written down — a node that gains a tag
  // re-resolves on the next paint, exactly as the tree's leaf/container branch
  // is computed at render rather than stored. `node.id` is stable per mount
  // (the page is one leaf, remounted when the open step changes).
  const resolved = useMemo(() => demandIndex([goal]).get(node.id), [goal, node.id]);
  const goalOrContainerTitle = useMemo(() => {
    // The nearest TAGGED ancestor, walking up from the node's own containers
    // to the goal. The note must name where the value was actually SET, not
    // the nearest container in general — a leaf indented under an untagged
    // group inside a `deep` goal inherited from the goal, and saying "from the
    // group" would name a container that never made the claim.
    const idPath = findNodePath([goal], node.id);
    if (!idPath) return '';
    for (let i = idPath.length - 2; i >= 0; i--) {
      const ancestor = findNode(goal.nodes, idPath[i]);
      if (ancestor && ancestor.demand !== undefined) return ancestor.title;
    }
    return goal.demand !== undefined ? goal.title : '';
  }, [goal, node.id]);
  const menuGroups = taskPageActionGroups({
    canIndent: parent !== null && parent.index > 0,
    canOutdent: path !== null && path.length > 1,
  });

  function runAction(id: RowActionId): void {
    switch (id) {
      case 'rename': setEditingTitle(true); return;
      case 'breakdown': setProposing(true); return;
      case 'indent': actions.indentNode(node.id); return;
      case 'outdent': actions.outdentNode(node.id); return;
      // `removeNode` nulls `openStepId` when the open node is inside what it
      // deleted, so this unmounts the page and lands back on the tree without
      // this component arranging anything.
      case 'delete': actions.removeNode(node.id); return;
      default: return;
    }
  }

  // The same sitting `scheduleCell` names on the tree row — NOT `sittings[0]`,
  // which is the earliest chronologically and would show a past sitting after
  // a task got booked again. No deadline fallback here: the Dates chip above
  // already states the deadline, so repeating it in this chip would be the
  // same fact twice under two different labels.
  const today = todayStr();
  // Priced against the first day that actually has room, so "add four steps"
  // can be weighed against somewhere to put them. Null when no day inside the
  // horizon has a run long enough — the panel then says nothing rather than
  // inventing a day.
  const freeDay = useMemo(
    () => nextFreeDay(today, [], (date) => spansOn(goals, tasks, date), allDayBlocks,
      { date: today, minute: nowMinute }),
    [today, goals, tasks, allDayBlocks, nowMinute],
  );
  const next = nextSitting(node, today);
  const whenValue = next
    ? `${dayLabel(next.date, today)} · ${clockLabel(next.startMin)}${
        sittings.length > 1 ? ` +${sittings.length - 1}` : ''
      }`
    : node.plannedWeek
      ? `Week of ${fmtD(node.plannedWeek)}`
      : null;

  return (
    /*
      One centred column, breadcrumb included. The body used to be a 720px block
      pinned to the LEFT of the 1100px container, so at 1440px the document sat
      in 170px of left margin and 550px of right — a page that looked like it
      had lost a sidebar. Centring is also what makes the title, the property
      labels and the note's first line share one left edge.
    */
    <div className="max-w-[720px] mx-auto">
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

      <div>
        <div className="flex items-start gap-[10px] mt-[10px] mb-[14px]">
          <h1 className="m-0 min-w-0 flex-1">
            {editingTitle ? (
              <InlineEdit
                value={node.title}
                className="font-disp text-page font-semibold tracking-[-0.01em]"
                onCommit={(title) => {
                  if (title !== node.title) actions.renameNode(node.id, title);
                  setEditingTitle(false);
                }}
                onCancel={() => setEditingTitle(false)}
              />
            ) : (
              <button
                type="button"
                className="font-disp text-page font-semibold tracking-[-0.01em] cursor-text hover:text-ink-hover w-full text-left rounded-[6px] leading-[1.2]"
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

        {/* Every line opens the SAME control the docked inspector opens, so the
            page and the panel cannot drift about what a property offers. Only
            the layout differs: a column of quiet labels here, a narrow stack of
            bare values there. */}
        <div className="flex flex-col -ml-[6px] max-w-[520px]">
          {/* A plain circle in the LABEL column: it names the property, which
              never changes. The live `StatusMark` belongs beside the VALUE —
              drawing the tick in both columns stated the same thing twice
              across 140px of the same row. */}
          <PropertyLine
            label="Status"
            icon={<IconCircle size={13} />}
            valueMark={<StatusMark status={status} />}
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
          </PropertyLine>

          {/* Focus needed, NOT "Focus". The dial reads `Low / Medium / High`
              and means how much focus you HAVE; this reads `Light / Moderate /
              Deep` and means how much the work WANTS. One word cannot mean
              both on one product, and the differing value words are not enough
              on their own. The state column states the RESOLVED value — a
              `deep` goal painting `Deep` on every leaf is fine here, where the
              page states the fact in full and names the ancestor it came from
              — unlike the tree row, which draws a chip only where a value was
              SET (demand.ts). */}
          <PropertyLine
            label="Focus needed"
            icon={<IconCircle size={13} />}
            value={resolved ? DEMAND_WORD[resolved.level] : null}
            placeholder="Not set"
            panelWidth={188}
          >
            {(close) => (
              <>
                {DEMANDS.map((d) => (
                  <PropertyOption
                    key={d}
                    close={close}
                    current={resolved?.source === 'own' && resolved.level === d}
                    onSelect={() => actions.setNodeDemand(node.id, d)}
                  >
                    {DEMAND_WORD[d]}
                  </PropertyOption>
                ))}
                <PropertyOption
                  close={close}
                  current={node.demand === undefined}
                  onSelect={() => actions.setNodeDemand(node.id, null)}
                >
                  Not set
                </PropertyOption>
              </>
            )}
          </PropertyLine>
          {resolved?.source === 'inherited' && (
            <p className="text-meta text-muted">Inherited from {goalOrContainerTitle}</p>
          )}

          <PropertyLine
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
          </PropertyLine>

          <PropertyLine
            label="Schedule"
            icon={<IconCalendar size={13} />}
            value={whenValue}
            placeholder="Not scheduled"
            panelWidth={188}
          >
            {(close) => <ScheduleMenu goalId={goal.id} node={node} close={close} />}
          </PropertyLine>

          <PropertyLineInline name="Estimate" icon={<IconClock size={13} />}>
            <EstimateControl
              minutes={node.estimateMin}
              label={node.title}
              alwaysShow
              onChange={(minutes) => actions.setNodeEstimate(node.id, minutes)}
            />
          </PropertyLineInline>

          {/* The time ledger, which used to be a titled section behind a rule at
              the foot of the page. It is a fact about this task stated as a
              value, which is what every other line here is — and folding it in
              took a section header, a horizontal rule and 60px of scroll out of
              a page that was mostly empty. */}
          <PropertyLineInline name="Time logged" icon={<IconRotate size={13} />}>
            <LogTimeControl
              loggedMin={logged}
              estimateMin={node.estimateMin}
              label={node.title}
              alwaysShow
              onLog={(minutes) => actions.logSession('step', node.id, minutes)}
              onClear={() => actions.clearSessionsFor('step', node.id)}
            />
          </PropertyLineInline>

          <PropertyLineToggle
            name="Milestone"
            label={
              node.checkpoint
                ? `Stop treating "${node.title}" as a milestone`
                : `Make "${node.title}" a milestone`
            }
            icon={<IconDiamond size={13} filled={!!node.checkpoint} />}
            on={!!node.checkpoint}
            onToggle={() => actions.toggleCheckpoint(node.id)}
          >
            {node.checkpoint ? 'Yes' : 'No'}
          </PropertyLineToggle>

          {/* The reason stays OUT of the status popover. It is what makes a
              blocked task actionable, and hiding it behind the control that set
              the status would let the page say "Blocked" without ever saying
              what by. As a line it is visible AND labelled, which the bare
              full-width input under the chips never was. */}
          {status === 'blocked' && (
            <PropertyLineField
              name="Blocked on"
              /* Not `StatusMark status="blocked"`: that mark IS `IconDiamond`,
                 which is also Milestone's icon — the two lines came out with
                 the same glyph in the same column, two rows apart. */
              icon={<IconWarning size={13} />}
              value={draftBlockedOn}
              onChange={(e) => setDraftBlockedOn(e.target.value)}
              onBlur={() => {
                if (draftBlockedOn.trim() === (node.blockedOn ?? '').trim()) return;
                actions.setNodeStatus(node.id, 'blocked', draftBlockedOn);
              }}
              placeholder="What is it waiting on?"
              aria-label="Blocked on"
            />
          )}
        </div>

        {sittings.length > 0 && (
          <div className="mt-[6px] ml-[134px] max-w-[386px] flex flex-col gap-[4px]">
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
                onClick={() => actions.scheduleNode(goal.id, node.id, todayStr(), sitAgainAim, { mode: 'add' })}
                title="Another sitting for the same task, leaving the others where they are"
                className="text-meta font-medium text-muted px-[8px] py-[4px] rounded-[6px] hover:bg-hover hover:text-ink"
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

        {/* The breakdown proposal, which used to live under the tree. It is
            leaf-only, and a leaf no longer opens in the tree — so it comes here,
            beside its subject. Accepting one gives this node children, and the
            caller's render-time branch turns the page into the container
            inspector on the next paint.

            ABOVE the note, not below it. The invitation is a remark about the
            ESTIMATE, which is four lines up in the property list — under the
            note it sat past 220px of blank document, arguing with the one thing
            the page is for and pointing at something off the top of the reader's
            eye. The document stays last, which is what makes it the document. */}
        {proposing ? (
          <div className="mt-[14px]">
            <ProposalPanel
              goal={goal}
              node={node}
              actions={actions}
              {...(freeDay ? { freeDay } : {})}
              onClose={() => setProposing(false)}
            />
          </div>
        ) : looksOversized(node) ? (
          /* An invitation, not a button — the ONLY inline route left. It appears
             when the estimate says this will not fit one sitting, and a sentence
             saying so has earned the room. The rest of the time the same verb
             waits in the `⋯` menu, where it used to be a standing button
             stranded under 220px of blank document. */
          <div className="mt-[22px]">
            <p className="text-ui text-ink-soft">
              This looks larger than one focused work session.
            </p>
            <button
              type="button"
              onClick={() => setProposing(true)}
              className="mt-[4px] inline-flex items-center gap-[6px] text-ui font-medium text-ink-soft hover:bg-hover hover:text-ink px-[8px] py-[5px] rounded-[6px] -ml-[8px]"
            >
              <IconSparkle size={12} />
              Break into smaller steps
            </button>
          </div>
        ) : null}

        {/* No rule above the note. Two hairlines used to cut a mostly-empty
            page into three thin strips; the space between the last property and
            the first line of the document says the same thing without drawing
            anything. */}
        <div className="mt-[22px]" onBlur={noteDraft.onBlur}>
          <NoteEditor
            docKey={node.id}
            value={noteDraft.value}
            onChange={noteDraft.onChange}
            placeholder="What actually happened?"
            ariaLabel="Task notes"
            className="note-page"
          />
        </div>

        {/* The page ends at the document. What sat below — a rule, a "Time"
            header and one control — is the `Time logged` line in the property
            list now: the same fact, stated where every other fact about this
            task is stated, instead of 60px past the fold. */}
      </div>
    </div>
  );
}
