import { useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { GoalTree } from '../../components/GoalTree';
import { IconSparkle } from '../../components/Icons';
import { SubtaskAiModal } from '../../components/SubtaskAiModal';
import { findNode } from '../../lib/tree';
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
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const isCompleted = !!g.completedAt;
  const hasSteps = g.nodes.length > 0;
  const wide = useMediaQuery('(min-width: 768px)');
  const openNode = openStepId ? findNode(g.nodes, openStepId) : null;

  return (
    <section>
      {/* No "TASKS" eyebrow and no counter. The tab above already says Work,
          the header states `8 of 14 tasks`, and a label that repeats its own
          tab is a line of chrome between the reader and the first row.

          The empty state is one sentence, not a dashed bordered card: a dashed
          border is the app's drop-target signal, and spending it on "there is
          nothing here yet" is how it stops meaning anything. */}
      {!hasSteps && (
        <p className="text-ui text-muted mb-[6px] px-[6px]">
          Break this goal into the actions that move it forward.
        </p>
      )}

      <div className={isCompleted ? 'opacity-70 pointer-events-none' : ''} aria-disabled={isCompleted}>
        <div className={openNode ? (wide ? 'flex items-start' : 'flex flex-col') : undefined}>
          <div className="min-w-0 flex-1">
            <GoalTree nodes={g.nodes} />
          </div>
          {openNode && (
            <div
              className={wide
                ? 'w-[300px] flex-none border-l border-line'
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
          <button
            type="button"
            onClick={() => setSubtaskOpen(true)}
            className="mt-[8px] inline-flex items-center gap-[6px] text-ui font-medium text-accent-deep hover:bg-accent-tint px-[8px] py-[5px] rounded-[6px] -ml-[1px]"
          >
            {/* No AI runs in Phase — the modal hands you a prompt for your own.
                "with AI" promised in-app generation the feature cannot do. */}
            <IconSparkle size={12} />
            Break a task into subtasks…
          </button>
        </div>
      )}

      <SubtaskAiModal
        open={subtaskOpen}
        onClose={() => setSubtaskOpen(false)}
        goal={g}
        defaultStepId={openStepId}
        actions={actions}
      />
    </section>
  );
}
