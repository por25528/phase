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
import { NewGoalModal } from './goals/NewGoalModal';
import { ImportGoalModal } from './goals/ImportGoalModal';
import { GoalCardVisual, BoardCard } from './goals/BoardCard';
import { Column } from './goals/Column';

// Priority columns, left → right = highest → lowest. Order IS the priority model:
// a goal's column sets its tier, its height within the column sets rank in-tier.
const COLUMNS = [
  { id: 'col-0', label: 'Highest' },
  { id: 'col-1', label: 'High' },
  { id: 'col-2', label: 'Medium' },
  { id: 'col-3', label: 'Later' },
] as const;
const COL_COUNT = COLUMNS.length;

// ── Goals view ────────────────────────────────────────────────────────────────

export function Goals() {
  const { goals, actions } = useAppStore();
  const [modal, setModal] = useState<null | 'new' | 'import'>(null);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  const [columns, setColumns] = useState<string[][]>(() => groupByColumn(goals, COL_COUNT));
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const [activeId, setActiveId] = useState<string | null>(null);

  // Re-sync from the store whenever goals change and we're NOT mid-drag
  // (covers add / delete / drawer edits from elsewhere).
  useEffect(() => {
    if (activeId) return;
    setColumns(groupByColumn(goals, COL_COUNT));
  }, [goals, activeId]);

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
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeIdStr = String(active.id);
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

  function handleDragEnd({ active, over }: DragEndEvent) {
    const activeIdStr = String(active.id);
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
    setColumns(groupByColumn(goals, COL_COUNT));
  }

  const isEmpty = goals.length === 0;
  const activeGoal = activeId ? goalById.get(activeId) : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-[16px] mb-[6px]">
        <div>
          <h1 className="font-disp text-[1.4rem] font-semibold tracking-[-0.015em]">Goals</h1>
          <p className="text-[.8rem] text-muted mt-[3px]">
            Drag goals between columns to set priority — leftmost is highest, and higher within a column outranks lower.
          </p>
        </div>
        <div className="flex-none flex items-center gap-[8px]">
          <button
            className="text-[.82rem] font-medium text-ink-soft border border-line-2 px-[12px] py-[7px] rounded-field hover:bg-hover"
            onClick={() => setModal('import')}
          >
            Import goal
          </button>
          <button
            className="text-[.82rem] font-semibold text-paper bg-ink px-[13px] py-[7px] rounded-field hover:bg-ink-hover"
            onClick={() => setModal('new')}
          >
            + New goal
          </button>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="mt-[18px] grid place-items-center rounded-card border border-dashed border-line-2 py-[44px] px-[20px] text-center">
          <p className="text-muted text-[.9rem] mb-[14px]">
            No goals yet — create one by hand, or import a plan an AI made for you.
          </p>
          <div className="flex items-center gap-[10px]">
            <button
              className="text-[.84rem] font-semibold text-paper bg-ink px-[14px] py-[8px] rounded-field hover:bg-ink-hover"
              onClick={() => setModal('new')}
            >
              + New goal
            </button>
            <button
              className="text-[.84rem] font-medium text-ink-soft border border-line-2 px-[13px] py-[8px] rounded-field hover:bg-hover"
              onClick={() => setModal('import')}
            >
              Import goal
            </button>
          </div>
        </div>
      )}

      {/* Priority board */}
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
            {COLUMNS.map((col, i) => (
              <Column key={col.id} col={col} index={i} ids={columns[i] ?? []}>
                {(columns[i] ?? []).map((id) => {
                  const g = goalById.get(id);
                  if (!g) return null;
                  return (
                    <BoardCard
                      key={id}
                      goal={g}
                      onOpen={actions.openDrawer}
                      onDelete={actions.removeGoal}
                      reducedMotion={reducedMotion}
                    />
                  );
                })}
              </Column>
            ))}
          </div>

          <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
            {activeGoal ? (
              <div className="w-[240px]">
                <GoalCardVisual goal={activeGoal} overlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <NewGoalModal
        open={modal === 'new'}
        onClose={() => setModal(null)}
        onAdd={(goal) => {
          actions.addGoals([goal]);
          actions.showToast('Goal added');
          setModal(null);
        }}
        columns={COLUMNS}
      />
      <ImportGoalModal
        open={modal === 'import'}
        onClose={() => setModal(null)}
        onImport={(imported) => {
          actions.addGoals(imported);
          actions.showToast(`Imported ${imported.length} goal${imported.length === 1 ? '' : 's'}`);
          setModal(null);
        }}
      />
    </div>
  );
}
