import { useEffect, useMemo, useState, type JSX } from 'react';
import type { Goal, GoalNode } from '../../db/types';
import { useAppStore } from '../../state/store';
import { DateField } from '../../components/DateField';
import { demandIndex, DEMANDS, DEMAND_WORD } from '../../lib/demand';
import {
  IconArrowRight,
  IconArrowUpRight,
  IconCalendar,
  IconCheck,
  IconCircle,
  IconPlus,
  IconX,
} from '../../components/Icons';
import { InlineEdit } from '../../components/InlineEdit';
import { NoteEditor } from '../../components/NoteEditor';
import { StatusMark } from '../../components/StatusMark';
import { useNoteDraft } from '../../components/useNoteDraft';
import { PropertyRow, PropertyStatic, PropertyOption } from '../../components/PropertyRow';
import { sectionLabel } from '../../components/sectionLabel';
import { fmtD } from '../../lib/dates';
import { containerStatus, isDone, STATUS_WORD } from '../../lib/status';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mb-[7px] ${sectionLabel}`}>
      {children}
    </div>
  );
}

/** A hairline between the inspector's stacked concerns. */
function PanelRule() {
  return <div className="my-[10px] border-t border-line" />;
}

/**
 * A CONTAINER's inspector.
 *
 * A leaf has its own page (`TaskPage`), so the leaf branches this used to carry
 * are gone rather than unreachable: a dead branch claiming otherwise is a lie
 * about what the component is for. What is left is what only a container has —
 * a derived status, a date span, a child list, and notes.
 */
export function StepPanel({ goal, node, actions }: {
  goal: Goal;
  node: GoalNode;
  actions: ReturnType<typeof useAppStore>['actions'];
}): JSX.Element {
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftStart, setDraftStart] = useState(node.start ?? '');
  const [draftDeadline, setDraftDeadline] = useState(node.deadline ?? '');
  const noteDraft = useNoteDraft(node.id, node.notes ?? '', (id, markdown) =>
    actions.setNodeNotes(id, markdown),
  );
  const children = node.children ?? [];
  // Counts DIRECT children, matching the list rendered beside it. `nodePct`
  // rolls the whole subtree up and would state a fraction whose denominator is
  // nowhere on screen.
  const childDone = children.filter((c) => isDone(c)).length;
  // The RESOLVED demand, from the nearest tagged ancestor. One pass, nothing
  // written down: a container indented under a `deep` goal re-resolves on the
  // next paint, and a subtree retagged here inherits the new value unaided.
  const resolved = useMemo(() => demandIndex([goal]).get(node.id), [goal, node.id]);

  useEffect(() => {
    setEditingTitle(false);
  }, [node.id]);

  useEffect(() => {
    setDraftStart(node.start ?? '');
    setDraftDeadline(node.deadline ?? '');
  }, [node.id, node.start, node.deadline]);

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
      {/* Header. The title carries the panel; the two verbs beside it —
          Open and Close — are icon-sized because they are the same two verbs
          on every container, and spelling them out in words would make the
          header read as a toolbar with a heading in it. */}
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
        {/* Open — the same verb the row's `O` and its double-click run. A leaf
            has its own page now, so every node reaching this panel is a
            container and this button is never conditional. */}
        <button
          type="button"
          aria-label={`Open "${node.title}" as a workspace`}
          title="Open as a workspace (O)"
          onClick={() => actions.openArea(node.id)}
          className="flex-none w-[24px] h-[24px] grid place-items-center rounded-[6px] text-muted hover:text-ink hover:bg-hover"
        >
          <IconArrowUpRight size={13} />
        </button>
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

      {/* Properties. A derived status (read-only — a container carries no
          status of its own) and a date span, in the place that used to cost
          labelled sections and ~240 vertical pixels; the span's editor is one
          click behind the value it edits. */}
      <div className="mt-[10px] -mx-[6px]">
        <PropertyStatic icon={<StatusMark status={containerStatus(node)} />}>
          {STATUS_WORD[containerStatus(node)]}
        </PropertyStatic>

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

        {/* Focus needed, NOT "Focus" — the dial says how much focus you HAVE,
            this says how much the work WANTS. A real editor, unlike the inert
            `PropertyStatic` the container's STATUS gets: status is derived
            from descendants, demand is DECLARED and flows the other way, so
            one gesture here tags the whole subtree. The row states the
            RESOLVED value — a `deep` goal painting `Deep` on every container
            is a column that says one word many times, but here it names the
            fact the subtree inherits. */}
        <PropertyRow
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
        </PropertyRow>
      </div>

      <PanelRule />

      {/* A container's children, on the panel that selected it.
          Reaching a milestone's task list used to mean leaving the inspector,
          finding the row again in the tree and expanding it — for the one
          question you open a milestone to ask. Rows are read-only markers plus
          a title that selects; completion stays on the tree's own checkbox, so
          there is exactly one place a task gets ticked. */}
      <section>
        <div className="flex items-baseline gap-[8px] mb-[7px]">
          <div className={`flex-1 ${sectionLabel}`}>Tasks</div>
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
                  isDone(child) ? 'line-through text-muted' : 'text-ink-soft'
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

      <PanelRule />

      <section>
        <SectionLabel>Notes</SectionLabel>
        <div onBlur={noteDraft.onBlur}>
          <NoteEditor
            docKey={node.id}
            value={noteDraft.value}
            onChange={noteDraft.onChange}
            placeholder="What actually happened?"
            ariaLabel="Task notes"
          />
        </div>
      </section>
    </div>
  );
}
