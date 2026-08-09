import { useRef } from 'react';
import type { Goal, GoalNode } from '../../db/types';
import { useAppStore, type AreaTab } from '../../state/store';
import { GoalTree } from '../../components/GoalTree';
import { StepPanel } from './StepPanel';
import { NoteEditor } from '../../components/NoteEditor';
import { InlineEdit } from '../../components/InlineEdit';
import { ProgressBar } from '../../components/ProgressBar';
import { IconCircle, IconPlus } from '../../components/Icons';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { findNode } from '../../lib/tree';
import { isDone, stepStatus } from '../../lib/status';
import { nodePct } from '../../lib/pct';
import { formatEstimateValue } from '../../lib/estimateInput';
import { useState } from 'react';

const TABS: ReadonlyArray<readonly [AreaTab, string]> = [
  ['overview', 'Overview'],
  ['steps', 'Tasks'],
  ['notes', 'Notes'],
];

/**
 * One milestone, as its own workspace.
 *
 * The second level of the interaction model the tree could not express on its
 * own: a click SELECTS a container and inspects it, and Open — `O`, a double
 * click, or the inspector's ↗ — brings you here.
 *
 * It is a lens, not a destination. `openGoalId` stays set behind it, so the
 * breadcrumb above is real navigation rather than a rendered string, and
 * leaving lands back on the goal with this milestone reselected. That is why
 * there is no `projectReturnView` equivalent here — there is only one way in
 * and one way out.
 *
 * Three tabs, not the goal's five. A Board over one container is a board with
 * one container's work in it, and a Calendar over it is the goal's calendar
 * filtered to a subset nobody asked to filter.
 */
export function AreaPage({ goal: g, node }: { goal: Goal; node: GoalNode }) {
  const { areaTab, openStepId, actions } = useAppStore();
  const tabRefs = useRef<Record<AreaTab, HTMLButtonElement | null>>({
    overview: null, steps: null, notes: null,
  });
  const [editingTitle, setEditingTitle] = useState(false);
  const wide = useMediaQuery('(min-width: 768px)');
  const openNode = openStepId ? findNode(node.children ?? [], openStepId) : null;
  const children = node.children ?? [];
  const done = children.filter((c) => isDone(c)).length;
  const pct = Math.round(nodePct(node));

  return (
    <div>
      {/* Breadcrumb. `Goals / CS:APP / Chapter 2` collapses to its middle
          segment being the only pressable one, because the goal is the only
          place Back can go from here. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-[5px] text-meta text-muted pt-[8px]">
        <button
          type="button"
          onClick={() => actions.closeArea()}
          className="px-[6px] py-[4px] -ml-[6px] min-h-[24px] inline-flex items-center gap-[5px] rounded-[6px] hover:bg-hover hover:text-ink"
        >
          <span aria-hidden="true">‹</span>
          <span className="truncate max-w-[220px]">{g.title}</span>
        </button>
      </nav>

      <div className="flex items-center gap-[10px] py-[4px] min-h-[40px]">
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
              className="text-h2 font-semibold tracking-[-0.01em] cursor-text hover:text-ink-hover w-fit text-left rounded-[6px] line-clamp-2"
              onClick={() => setEditingTitle(true)}
              aria-label={`Rename "${node.title}"`}
              title="Click to rename"
            >
              {node.title}
            </button>
          )}
        </h1>
        <span className="flex-none text-meta text-muted tabular-nums">
          {done} / {children.length}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Milestone sections"
        className="flex gap-[2px] mt-[2px] border-b border-line"
        onKeyDown={(e) => {
          const index = TABS.findIndex(([key]) => key === areaTab);
          let nextIndex: number | null = null;
          if (e.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
          if (e.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
          if (e.key === 'Home') nextIndex = 0;
          if (e.key === 'End') nextIndex = TABS.length - 1;
          if (nextIndex === null) return;
          e.preventDefault();
          const nextKey = TABS[nextIndex][0];
          actions.setAreaTab(nextKey);
          tabRefs.current[nextKey]?.focus();
        }}
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            id={`area-tab-${key}`}
            role="tab"
            aria-selected={areaTab === key}
            aria-controls="areaBody"
            tabIndex={areaTab === key ? 0 : -1}
            ref={(element) => { tabRefs.current[key] = element; }}
            onClick={() => actions.setAreaTab(key)}
            className={`text-ui px-[12px] py-[6px] -mb-px border-b-2 ${
              areaTab === key
                ? 'text-ink font-semibold border-accent'
                : 'text-muted font-medium border-transparent hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        id="areaBody"
        role="tabpanel"
        aria-labelledby={`area-tab-${areaTab}`}
        className="pt-[14px] pb-[60px]"
      >
        {areaTab === 'overview' ? (
          <div className="max-w-[620px]">
            <div className="flex items-center gap-[10px] px-[6px]">
              <ProgressBar pct={pct} />
              <span className="flex-none text-ui text-ink-soft tabular-nums">{pct}%</span>
            </div>
            <div className="mt-[16px] -mx-[6px]">
              {children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => actions.openStep(child.id)}
                  className="w-full flex items-center gap-[8px] px-[6px] py-[5px] rounded-[6px] text-left hover:bg-hover"
                >
                  <span
                    className={`flex-none inline-flex ${
                      stepStatus(child) === 'doing' ? 'text-accent' : 'text-faint'
                    }`}
                  >
                    <IconCircle size={13} />
                  </span>
                  <span
                    className={`flex-1 min-w-0 truncate text-ui ${
                      isDone(child) ? 'line-through text-faint' : 'text-ink-soft'
                    }`}
                  >
                    {child.title}
                  </span>
                  {child.estimateMin !== undefined && (
                    <span className="flex-none text-meta text-muted tabular-nums">
                      {formatEstimateValue(child.estimateMin)}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => actions.addChild(node.id)}
              className="mt-[4px] inline-flex items-center gap-[6px] text-ui text-muted hover:text-ink px-[6px] py-[4px] rounded-[6px] hover:bg-hover"
            >
              <IconPlus size={12} />
              Add task
            </button>
          </div>
        ) : areaTab === 'steps' ? (
          // The SAME tree component the goal renders, handed this container's
          // children. Not a copy: one row implementation means one set of
          // gestures, and a milestone's tasks behave identically whichever
          // level they are read at.
          <div className={openNode ? (wide ? 'flex items-start' : 'flex flex-col') : undefined}>
            <div className="min-w-0 flex-1">
              <GoalTree nodes={children} />
            </div>
            {openNode && (
              <div className={wide ? 'w-[340px] flex-none border-l border-line' : 'w-full border-t border-line'}>
                <StepPanel goal={g} node={openNode} actions={actions} />
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-[720px]">
            <NoteEditor
              docKey={node.id}
              value={node.notes ?? ''}
              onChange={(markdown) => actions.setNodeNotes(node.id, markdown)}
              placeholder="Notes for this milestone…"
              ariaLabel="Milestone notes"
            />
          </div>
        )}
      </div>
    </div>
  );
}
