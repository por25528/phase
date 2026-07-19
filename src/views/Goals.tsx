import { useState, useRef, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { useAppStore } from '../state/store';
import { groupByColumn } from '../lib/board';
import { focusSummary } from '../lib/plan';
import { fmtD } from '../lib/dates';
import { useLocalDate } from '../hooks/useLocalDate';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { NewGoalModal } from './goals/NewGoalModal';
import { ImportGoalModal } from './goals/ImportGoalModal';
import { GoalCardVisual, BoardCard } from './goals/BoardCard';
import { FocusSummary, type FocusFilter } from './goals/FocusSummary';
import { Column } from './goals/Column';
import { HORIZON_LABELS } from './goals/styles';
import { PlanWeekOverlay } from './plan/PlanWeekOverlay';
import type { Goal } from '../db/types';

// Commitment horizons, left → right = Now … Someday. Column order IS the model:
// a project's column is its horizon; height within a column is rank in-horizon.
const COLUMNS = HORIZON_LABELS.map((label, i) => ({ id: `col-${i}`, label }));
const COL_COUNT = COLUMNS.length;

// ── Goals view ────────────────────────────────────────────────────────────────

export function Goals() {
  const { goals, actions } = useAppStore();
  const [modal, setModal] = useState<null | 'new' | 'import'>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planFocusId, setPlanFocusId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FocusFilter | null>(null);
  const currentDate = useLocalDate();

  // Below ~920px the four columns fold into a horizon switcher — one horizon at a
  // time — rather than compressing (spec §2.1/§6). Cross-horizon moves then go
  // through the card's ⋯ menu instead of a drag.
  const wide = useMediaQuery('(min-width: 920px)');
  const [activeHorizon, setActiveHorizon] = useState(0);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);
  const active = useMemo(() => goals.filter((g) => !g.completedAt), [goals]);
  const completed = useMemo(
    () => goals.filter((g) => g.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [goals],
  );

  // Board columns are built from active projects only; completed projects live
  // in their own section. setGoalBoard weaves the hidden ones back into place.
  const [columns, setColumns] = useState<string[][]>(() => groupByColumn(active, COL_COUNT));
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const [activeId, setActiveId] = useState<string | null>(null);

  // Re-sync from the store whenever goals change and we're NOT mid-drag
  // (covers add / delete / complete / drawer edits from elsewhere).
  useEffect(() => {
    if (activeId) return;
    setColumns(groupByColumn(active, COL_COUNT));
  }, [active, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function colIndexOf(id: string): number | null {
    if (id.startsWith('col-')) return Number(id.slice(4));
    const idx = columnsRef.current.findIndex((c) => c.includes(id));
    return idx === -1 ? null : idx;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  // Live cross-column movement so cards part to show the drop target.
  function handleDragOver({ active: a, over }: DragOverEvent) {
    if (!over) return;
    const activeIdStr = String(a.id);
    const overIdStr = String(over.id);
    const from = colIndexOf(activeIdStr);
    const to = colIndexOf(overIdStr);
    if (from == null || to == null || from === to) return;

    setColumns((prev) => {
      const next = prev.map((c) => [...c]);
      const activeIndex = next[from].indexOf(activeIdStr);
      if (activeIndex === -1) return prev;
      next[from].splice(activeIndex, 1);

      const overIsColumn = overIdStr.startsWith('col-');
      const overIndex = overIsColumn ? -1 : next[to].indexOf(overIdStr);
      const insertAt = overIndex === -1 ? next[to].length : overIndex;
      next[to].splice(insertAt, 0, activeIdStr);
      return next;
    });
  }

  function handleDragEnd({ active: a, over }: DragEndEvent) {
    const activeIdStr = String(a.id);
    const current = columnsRef.current; // already reflects cross-column moves from dragOver
    let next = current;

    if (over) {
      const overIdStr = String(over.id);
      const from = colIndexOf(activeIdStr);
      const to = colIndexOf(overIdStr);
      // Same-column reorder is the only case dragOver left untouched.
      if (from != null && to != null && from === to && !overIdStr.startsWith('col-')) {
        const col = current[from];
        const oldIndex = col.indexOf(activeIdStr);
        const newIndex = col.indexOf(overIdStr);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          next = current.map((c, i) => (i === from ? arrayMove(col, oldIndex, newIndex) : c));
        }
      }
    }

    setActiveId(null);
    setColumns(next);
    actions.setGoalBoard(next);
  }

  function handleDragCancel() {
    setActiveId(null);
    setColumns(groupByColumn(active, COL_COUNT));
  }

  const isEmpty = goals.length === 0;
  const activeGoal = activeId ? goalById.get(activeId) : null;

  // Focus summary + spotlight filter. Buttons expose their goalId match sets, so
  // dimming is a pure set membership check — no attention predicate re-derived.
  const summary = useMemo(() => focusSummary(goals, currentDate), [goals, currentDate]);
  const matchIds = useMemo(() => {
    if (!filter) return null;
    const src = {
      slots: summary.slots.goalIds,
      'needs-step': summary.needsFirstStep.goalIds,
      behind: summary.behind.goalIds,
      planned: summary.plannedRemaining.goalIds,
    }[filter];
    return new Set(src);
  }, [filter, summary]);
  const filtering = matchIds != null && matchIds.size > 0;

  // Board "Plan next step" opens the planner focused on this project (T9): the
  // planner jumps to planning, scrolls to the project's rail group, and pulses it.
  function onPlan(id: string) {
    setPlanFocusId(id);
    setPlanOpen(true);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-[16px] mb-[6px]">
        <div>
          <h1 className="font-disp text-[1.4rem] font-semibold tracking-[-0.015em]">Goals</h1>
          <p className="text-[.8rem] text-muted mt-[3px]">
            Drag a project between horizons to recommit it — Now is what you're actively pushing on, capped at {summary.slots.limit} to keep focus honest.
          </p>
        </div>
        <div className="flex-none flex items-center gap-[8px]">
          <button
            className="text-[.82rem] font-medium text-ink-soft border border-line-2 px-[12px] py-[7px] rounded-field hover:bg-hover"
            onClick={() => setModal('import')}
          >
            Import project
          </button>
          <button
            className="text-[.82rem] font-semibold text-paper bg-ink px-[13px] py-[7px] rounded-field hover:bg-ink-hover"
            onClick={() => setModal('new')}
          >
            + New project
          </button>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="mt-[18px] grid place-items-center rounded-card border border-dashed border-line-2 py-[44px] px-[20px] text-center">
          <p className="text-muted text-[.9rem] mb-[14px]">
            No projects yet — create one by hand, or import a plan an AI made for you.
          </p>
          <div className="flex items-center gap-[10px]">
            <button
              className="text-[.84rem] font-semibold text-paper bg-ink px-[14px] py-[8px] rounded-field hover:bg-ink-hover"
              onClick={() => setModal('new')}
            >
              + New project
            </button>
            <button
              className="text-[.84rem] font-medium text-ink-soft border border-line-2 px-[13px] py-[8px] rounded-field hover:bg-hover"
              onClick={() => setModal('import')}
            >
              Import project
            </button>
          </div>
        </div>
      )}

      {/* Focus summary — the board's four attention signals */}
      {!isEmpty && (
        <FocusSummary
          summary={summary}
          active={filtering ? filter : null}
          onToggle={(f) => setFilter((cur) => (cur === f ? null : f))}
          onClear={() => setFilter(null)}
        />
      )}

      {/* Narrow horizon switcher — one horizon at a time under ~920px */}
      {!isEmpty && !wide && (
        <div role="group" aria-label="Show horizon" className="mt-[16px] flex gap-[4px] p-[4px] bg-hover rounded-[11px]">
          {COLUMNS.map((col, i) => (
            <button
              key={col.id}
              type="button"
              aria-pressed={i === activeHorizon}
              aria-label={`Show ${col.label} — ${(columns[i] ?? []).length} project${(columns[i] ?? []).length === 1 ? '' : 's'}`}
              onClick={() => setActiveHorizon(i)}
              className={`flex-1 text-[.78rem] font-medium px-[6px] py-[7px] rounded-[8px] transition-colors ${
                i === activeHorizon ? 'bg-panel text-ink shadow-card' : 'text-muted hover:text-ink'
              }`}
            >
              {col.label}
              <span className="tabular-nums text-faint"> · {(columns[i] ?? []).length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Commitment-horizon board */}
      {!isEmpty && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="mt-[20px] flex gap-[18px] items-start overflow-x-auto pb-[8px]">
            {COLUMNS.map((col, i) => {
              if (!wide && i !== activeHorizon) return null;
              return (
              <Column key={col.id} col={col} index={i} ids={columns[i] ?? []} solo={!wide}>
                {(columns[i] ?? []).map((id) => {
                  const g = goalById.get(id);
                  if (!g) return null;
                  return (
                    <BoardCard
                      key={id}
                      goal={g}
                      today={currentDate}
                      onOpen={actions.openDrawer}
                      onPlan={onPlan}
                      onDefine={actions.openDrawer}
                      onComplete={actions.completeGoal}
                      onMove={actions.moveGoalToColumn}
                      onDelete={actions.removeGoal}
                      reducedMotion={reducedMotion}
                      dimmed={filtering && !matchIds!.has(id)}
                      matched={filtering && matchIds!.has(id)}
                    />
                  );
                })}
              </Column>
              );
            })}
          </div>

          <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
            {activeGoal ? (
              <div className="w-[240px]">
                <GoalCardVisual goal={activeGoal} today={currentDate} overlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Completed projects */}
      {completed.length > 0 && <CompletedSection goals={completed} onReopen={actions.reopenGoal} />}

      <NewGoalModal
        open={modal === 'new'}
        onClose={() => setModal(null)}
        onAdd={(goal) => {
          actions.addGoals([goal]);
          actions.showToast('Project added');
          setModal(null);
        }}
        columns={COLUMNS}
      />
      <ImportGoalModal
        open={modal === 'import'}
        onClose={() => setModal(null)}
        onImport={(imported) => {
          actions.addGoals(imported);
          actions.showToast(`Imported ${imported.length} project${imported.length === 1 ? '' : 's'}`);
          setModal(null);
        }}
      />

      <PlanWeekOverlay
        open={planOpen}
        onClose={() => {
          setPlanOpen(false);
          setPlanFocusId(null);
        }}
        focusGoalId={planFocusId}
      />
    </div>
  );
}

// ── Completed section ─────────────────────────────────────────────────────────
// Collapsed by default, newest-completed first; each project offers Reopen. Now
// capacity already excludes these (they carry `completedAt`), spec §2.5.
function CompletedSection({ goals, onReopen }: { goals: Goal[]; onReopen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-[22px] border-t border-line pt-[16px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-[9px] w-full text-left px-[2px] py-[4px]"
      >
        <span
          className="text-faint text-[.7rem] transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          aria-hidden="true"
        >
          ▶
        </span>
        <span className="font-mono text-[.62rem] tracking-[.11em] uppercase text-muted font-semibold">Completed</span>
        <span className="font-mono text-[.66rem] text-faint tabular-nums">{goals.length}</span>
      </button>
      {open && (
        <div className="mt-[13px] grid gap-[11px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {goals.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-[10px] px-[13px] py-[11px] border border-line rounded-card bg-panel opacity-[.86]"
            >
              <span className="text-accent text-[.82rem]" aria-hidden="true">✓</span>
              <span className="font-disp text-[.9rem] font-semibold flex-1 min-w-0 truncate">{g.title}</span>
              {g.completedAt && <span className="font-mono text-[.6rem] text-faint whitespace-nowrap">{fmtD(g.completedAt)}</span>}
              <button
                type="button"
                onClick={() => onReopen(g.id)}
                className="text-[.72rem] text-muted px-[9px] py-[4px] rounded-[8px] border border-line-2 hover:bg-hover hover:text-ink"
              >
                Reopen
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
