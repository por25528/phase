import { useEffect, useRef } from 'react';
import { useAppStore, VIEW_LABELS, type ProjectTab } from '../state/store';
import { ProjectHeader } from './project/ProjectHeader';
import { StepsTab } from './project/StepsTab';
import { NotesTab } from './project/NotesTab';

const TABS: ReadonlyArray<readonly [ProjectTab, string]> = [
  ['steps', 'Work'],
  ['notes', 'Notes'],
];

/**
 * A project's own page.
 *
 * This replaced a centred `role="dialog"` that hand-rolled a focus trap, a body
 * scroll lock and Tab cycling — all of which existed only because it was a
 * modal. A page needs none of them, so none of them are here.
 */
export function Project() {
  const { goals, openGoalId, projectReturnView, projectTab, focusNodeId, openStepId, actions } = useAppStore();
  const tabRefs = useRef<Record<ProjectTab, HTMLButtonElement | null>>({ steps: null, notes: null });
  const goal = openGoalId ? goals.find((g) => g.id === openGoalId) : null;
  const returnView = projectReturnView === 'project' ? 'goals' : projectReturnView;
  const returnLabel = VIEW_LABELS[returnView];

  // A project deleted while its page is open (undo toast, another surface)
  // leaves nothing to render. Go back rather than showing an empty shell.
  useEffect(() => {
    if (openGoalId && !goal) actions.closeProject();
  }, [openGoalId, goal, actions]);

  // Scroll a focused row into view and pulse it. Done through the DOM so the
  // shared GoalTree needs no focus-aware prop, exactly as the drawer did.
  useEffect(() => {
    if (!focusNodeId || projectTab !== 'steps') return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => {
      const row = document.querySelector<HTMLElement>(
        `#projectBody [data-node-id="${CSS.escape(focusNodeId)}"]`,
      );
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        if (!reduced && typeof row.animate === 'function') {
          row.animate(
            [
              { boxShadow: '0 0 0 2px rgb(var(--c-accent))', borderRadius: '6px' },
              { boxShadow: '0 0 0 2px rgba(0,0,0,0)', borderRadius: '6px' },
            ],
            { duration: 1400, easing: 'ease-out' },
          );
        }
      }
      actions.clearFocusNode();
    }, 70); // let expand/fade-in settle before measuring
    return () => clearTimeout(t);
  }, [focusNodeId, projectTab, actions]);

  if (!goal) return null;

  return (
    <div className="max-w-[1100px] mx-auto">
      <ProjectHeader
        goal={goal}
        actions={actions}
        backLabel={returnLabel}
        onBack={() => actions.closeProject()}
      />

      <div
        role="tablist"
        aria-label="Goal sections"
        className="flex gap-[2px] mt-[6px] border-b border-line"
        onKeyDown={(e) => {
          const index = TABS.findIndex(([key]) => key === projectTab);
          let nextIndex: number | null = null;
          if (e.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
          if (e.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
          if (e.key === 'Home') nextIndex = 0;
          if (e.key === 'End') nextIndex = TABS.length - 1;
          if (nextIndex === null) return;

          e.preventDefault();
          const nextKey = TABS[nextIndex][0];
          actions.setProjectTab(nextKey);
          tabRefs.current[nextKey]?.focus();
        }}
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            id={`project-tab-${key}`}
            role="tab"
            aria-selected={projectTab === key}
            aria-controls="projectBody"
            tabIndex={projectTab === key ? 0 : -1}
            ref={(element) => { tabRefs.current[key] = element; }}
            onClick={() => actions.setProjectTab(key)}
            className={`text-ui px-[12px] py-[6px] -mb-px border-b-2 ${
              projectTab === key
                ? 'text-ink font-semibold border-accent'
                : 'text-muted font-medium border-transparent hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        id="projectBody"
        role="tabpanel"
        aria-labelledby={`project-tab-${projectTab}`}
        className="pt-[14px] pb-[60px]"
      >
        {projectTab === 'steps' ? (
          <StepsTab
            goal={goal}
            actions={actions}
            focusNodeId={focusNodeId}
            openStepId={openStepId}
          />
        ) : (
          <NotesTab goal={goal} actions={actions} />
        )}
      </div>
    </div>
  );
}
