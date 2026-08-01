import { useEffect, useState, type JSX } from 'react';
import type { Goal, GoalNode } from '../../db/types';
import { useAppStore } from '../../state/store';
import { DateField } from '../../components/DateField';
import { EstimateControl } from '../../components/EstimateControl';
import { InlineEdit } from '../../components/InlineEdit';
import { LogTimeControl } from '../../components/LogTimeControl';
import { loggedForNode } from '../../lib/actuals';
import { nodePct } from '../../lib/pct';
import { fmtD } from '../../lib/dates';

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
  const { sessions } = useAppStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftStart, setDraftStart] = useState(node.start ?? '');
  const [draftDeadline, setDraftDeadline] = useState(node.deadline ?? '');
  const isLeaf = !node.children || node.children.length === 0;

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
            className={`text-meta px-[6px] py-[4px] min-h-[24px] rounded-field hover:bg-hover ${
              node.checkpoint ? 'text-accent' : 'text-muted hover:text-accent'
            }`}
          >
            {node.checkpoint ? '◆' : '◇'}
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
        <SectionLabel>Span</SectionLabel>
        <div className="flex flex-wrap items-center gap-[6px]">
          <DateField
            value={draftStart}
            ariaLabel="Span start"
            placeholder="Start"
            onCommit={(next) => commitDates(next, draftDeadline)}
          />
          <span className="text-ui text-muted" aria-hidden="true">→</span>
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
    </div>
  );
}
