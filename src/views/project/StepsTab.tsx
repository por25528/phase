import { useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { GoalTree } from '../../components/GoalTree';
import { IconSparkle } from '../../components/Icons';
import { ProposalPanel } from './ProposalPanel';
import { findNode } from '../../lib/tree';
import { TEMPLATES, inferGoalType } from '../../lib/goalType';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { StepPanel } from './StepPanel';

// ── Work (the working area) ───────────────────────────────────────────────────
export function StepsTab({
  goal: g,
  actions,
  openStepId,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
  focusNodeId?: string | null;
  openStepId?: string | null;
}) {
  const addRootRef = useRef<HTMLInputElement>(null);
  const [proposing, setProposing] = useState(false);
  const isCompleted = !!g.completedAt;
  const hasSteps = g.nodes.length > 0;
  const wide = useMediaQuery('(min-width: 768px)');
  const openNode = openStepId ? findNode(g.nodes, openStepId) : null;
  const goalType = g.type ?? inferGoalType(g.title);

  return (
    <section>
      {/* No "TASKS" eyebrow and no counter. The tab above already says Work,
          the header states `8 of 14 tasks`, and a label that repeats its own
          tab is a line of chrome between the reader and the first row.

          The empty state is one sentence and one offer, not a dashed bordered
          card with three buttons: a dashed border is the app's drop-target
          signal, and spending it on "there is nothing here yet" is how it stops
          meaning anything. The template is a SUGGESTION with its contents named
          in the button, so accepting it is not a leap of faith — and typing in
          the field below it is always the other route. */}
      {!hasSteps && !isCompleted && (
        <div className="mb-[8px] px-[6px] flex flex-wrap items-center gap-[10px]">
          <p className="text-ui text-muted">
            Break this goal into the actions that move it forward.
          </p>
          <button
            type="button"
            onClick={() => actions.addRootNodes(g.id, TEMPLATES[goalType].areas)}
            title={TEMPLATES[goalType].areas.join(' · ')}
            className="text-ui font-semibold text-accent-deep px-[9px] py-[4px] rounded-field hover:bg-accent-tint"
          >
            Start with {TEMPLATES[goalType].areas.join(' · ')}
          </button>
        </div>
      )}

      {proposing && openNode && (
        <ProposalPanel
          goal={g}
          node={openNode}
          actions={actions}
          onClose={() => setProposing(false)}
        />
      )}

      <div className={isCompleted ? 'opacity-70 pointer-events-none' : ''} aria-disabled={isCompleted}>
        <div className={openNode ? (wide ? 'flex items-start' : 'flex flex-col') : undefined}>
          <div className="min-w-0 flex-1">
            <GoalTree nodes={g.nodes} />
          </div>
          {openNode && (
            <div
              className={wide
                ? 'w-[340px] flex-none border-l border-line'
                : 'w-full border-t border-line'}
            >
              <StepPanel goal={g} node={openNode} actions={actions} />
            </div>
          )}
        </div>
      </div>

      {!isCompleted && (
        <div className="mt-[4px] px-[6px] py-[2px]">
          <input
            ref={addRootRef}
            className="ghost-in w-full text-body"
            placeholder={hasSteps ? '+ add task…' : '+ add the first task…'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && addRootRef.current) {
                const v = addRootRef.current.value.trim();
                if (v) {
                  actions.addRootNode(g.id, v);
                  addRootRef.current.value = '';
                }
              }
            }}
          />
          {/* Attached to the SELECTED task, and absent without one.
              The dialog this replaced opened from here with a dropdown asking
              which task you meant — about a task you had usually just clicked.
              A proposal has a subject; the control for it belongs beside the
              subject. */}
          {openNode && !openNode.children?.length && !proposing && (
            <button
              type="button"
              onClick={() => setProposing(true)}
              className="mt-[8px] inline-flex items-center gap-[6px] text-ui font-medium text-accent-deep hover:bg-accent-tint px-[8px] py-[5px] rounded-[6px] -ml-[1px]"
            >
              <IconSparkle size={12} />
              Break “{openNode.title}” into subtasks
            </button>
          )}
        </div>
      )}

    </section>
  );
}
