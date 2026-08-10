import { useEffect, useRef } from 'react';
import { useAppStore, VIEW_LABELS, type ProjectTab } from '../state/store';
import { ProjectHeader } from './project/ProjectHeader';
import { OverviewTab } from './project/OverviewTab';
import { StepsTab } from './project/StepsTab';
import { BoardTab } from './project/BoardTab';
import { CalendarTab } from './project/CalendarTab';
import { NotesTab } from './project/NotesTab';
import { AreaPage } from './project/AreaPage';
import { TaskPage } from './project/TaskPage';
import { findNode, isLeafNode } from '../lib/tree';

/**
 * Five views over one task store.
 *
 * `steps` keeps its stored key and is labelled Tasks — the noun the rest of the
 * product uses for a leaf. Renaming the key as well would be a migration for a
 * caption.
 */
const TABS: ReadonlyArray<readonly [ProjectTab, string]> = [
  ['overview', 'Overview'],
  ['steps', 'Tasks'],
  ['board', 'Board'],
  ['calendar', 'Calendar'],
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
  const { goals, openGoalId, openAreaId, projectReturnView, projectTab, focusNodeId, openStepId, actions } = useAppStore();
  const tabRefs = useRef<Record<ProjectTab, HTMLButtonElement | null>>({
    overview: null, steps: null, board: null, calendar: null, notes: null,
  });
  const goal = openGoalId ? goals.find((g) => g.id === openGoalId) : null;
  // The milestone workspace, when one is open. Resolved here rather than
  // inside it so a container deleted underneath falls back to the goal page
  // instead of rendering an empty shell.
  const area = goal && openAreaId ? findNode(goal.nodes, openAreaId) : null;
  const returnView = projectReturnView === 'project' ? 'goals' : projectReturnView;
  const returnLabel = VIEW_LABELS[returnView];

  // A leaf opens as its own page — the second lens on the goal, beside the
  // milestone workspace above. Computed at render, so a task that gains
  // children (indent, an accepted breakdown) becomes a container on the very
  // next paint with no special case here. Hoisted above the effects (rather
  // than left by the `if (!goal)` guard below, where it used to live) because
  // the focus effect below needs it: `#projectBody` only exists on the tabs
  // branch, so a focus arriving while a leaf's page is open must wait rather
  // than fire into an element that was never rendered.
  const openNode = goal && openStepId ? findNode(goal.nodes, openStepId) : null;
  const openLeaf = openNode && isLeafNode(openNode) ? openNode : null;

  // A project deleted while its page is open (undo toast, another surface)
  // leaves nothing to render. Go back rather than showing an empty shell.
  useEffect(() => {
    if (openGoalId && !goal) actions.closeProject();
  }, [openGoalId, goal, actions]);

  // Scroll a focused row into view and pulse it. Done through the DOM so the
  // shared GoalTree needs no focus-aware prop, exactly as the drawer did.
  //
  // While a leaf's own page is open, `#projectBody` (the tabs branch below)
  // isn't rendered at all — querying for the row would find nothing and still
  // consume `focusNodeId` via `clearFocusNode()`, so Back would land on a tree
  // with nothing pointing at the row the user came from. Waiting for the page
  // to close (`openLeaf` in the dependency array) lets the pulse fire then,
  // instead of being silently swallowed while it is open.
  useEffect(() => {
    if (openLeaf) return;
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
  }, [focusNodeId, projectTab, openLeaf, actions]);

  // A container that stopped being one — deleted, or emptied by an undo —
  // cannot host a workspace. Fall back to the goal rather than to nothing.
  useEffect(() => {
    if (openAreaId && !area) actions.closeArea();
  }, [openAreaId, area, actions]);

  if (!goal) return null;

  if (area) {
    return (
      <div className="max-w-[1100px] mx-auto">
        <AreaPage goal={goal} node={area} />
      </div>
    );
  }

  if (openLeaf) {
    return (
      <div className="max-w-[1100px] mx-auto">
        <TaskPage
          goal={goal}
          node={openLeaf}
          backLabel={goal.title}
          onBack={() => actions.closeStep()}
        />
      </div>
    );
  }

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
        {projectTab === 'overview' ? (
          <OverviewTab goal={goal} />
        ) : projectTab === 'steps' ? (
          <StepsTab
            goal={goal}
            actions={actions}
            focusNodeId={focusNodeId}
            openStepId={openStepId}
          />
        ) : projectTab === 'board' ? (
          <BoardTab goal={goal} actions={actions} onUseWork={() => actions.setProjectTab('steps')} />
        ) : projectTab === 'calendar' ? (
          <CalendarTab goal={goal} />
        ) : (
          <NotesTab goal={goal} actions={actions} />
        )}
      </div>
    </div>
  );
}
