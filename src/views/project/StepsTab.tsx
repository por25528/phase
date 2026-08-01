import { useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { GoalTree } from '../../components/GoalTree';
import { SubtaskAiModal } from '../../components/SubtaskAiModal';
import { leafCount } from '../../lib/board';
import { findNode } from '../../lib/tree';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { StepPanel } from './StepPanel';

// ── Steps column (the working area) ───────────────────────────────────────────
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
  const { total, done } = leafCount(g.nodes);
  const wide = useMediaQuery('(min-width: 768px)');
  const openNode = openStepId ? findNode(g.nodes, openStepId) : null;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-[9px]">
        <div className="text-meta font-[550] uppercase tracking-[0.08em] text-muted">Steps</div>
        {total > 0 && (
          <span className="font-mono text-badge text-muted tabular-nums">{done}/{total} done</span>
        )}
      </div>

      {!hasSteps && (
        <div className="rounded-card border border-dashed border-line-2 px-[14px] py-[16px] text-center mb-[8px]">
          <div className="text-body text-ink-soft">No steps yet</div>
          <div className="text-compact text-muted mt-[3px] leading-[1.5]">
            Break this project into the actions that move it forward.
          </div>
        </div>
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
            placeholder={hasSteps ? '+ add step…' : '+ add the first step…'}
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
            className="mt-[8px] text-ui font-medium text-accent-deep hover:bg-accent-tint px-[8px] py-[5px] rounded-[6px] -ml-[1px]"
          >
            {/* No AI runs in Phase — the modal hands you a prompt for your own.
                "with AI" promised in-app generation the feature cannot do. */}
            ✦ Break a step into subtasks…
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
