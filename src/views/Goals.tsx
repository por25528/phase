import { useState, useRef, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Goal, GoalNode } from '../db/types';
import { useAppStore } from '../state/store';
import { ProgressBar } from '../components/ProgressBar';
import { goalPct } from '../lib/pct';
import { firstOpenLeaf } from '../lib/tree';
import { todayStr } from '../lib/dates';
import { deadlineChip } from '../lib/today';
import { behindPaceBy, expectedPct } from '../lib/timeline';
import { BehindChip } from '../components/BehindChip';

// Priority columns, left → right = highest → lowest. Order IS the priority model:
// a goal's column sets its tier, its height within the column sets rank in-tier.
const COLUMNS = [
  { id: 'col-0', label: 'Highest' },
  { id: 'col-1', label: 'High' },
  { id: 'col-2', label: 'Medium' },
  { id: 'col-3', label: 'Later' },
] as const;
const COL_COUNT = COLUMNS.length;

function leafCount(nodes: GoalNode[]): { total: number; done: number } {
  let total = 0, done = 0;
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      const sub = leafCount(n.children);
      total += sub.total;
      done += sub.done;
    } else {
      total++;
      if (n.done) done++;
    }
  }
  return { total, done };
}

function groupByColumn(goals: Goal[], n: number): string[][] {
  const cols: string[][] = Array.from({ length: n }, () => []);
  for (const g of goals) {
    const c = Math.min(Math.max(g.column ?? 0, 0), n - 1);
    cols[c].push(g.id);
  }
  return cols;
}

// ── New goal form ─────────────────────────────────────────────────────────────

function NewGoalForm({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string, deadline: string) => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('2026-12-31');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function submit() {
    const t = title.trim();
    if (!t) return;
    onAdd(t, deadline);
  }

  return (
    <div className="p-[14px] rounded-card border border-line-2 bg-panel shadow-card flex flex-col gap-[9px] w-full max-w-[440px]">
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What do you want to make progress on?"
        className="w-full bg-transparent border-none outline-none font-disp text-[1.02rem] font-semibold text-ink placeholder:text-faint placeholder:font-normal placeholder:font-ui"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
      />
      <div className="flex items-center gap-[9px]">
        <label className="text-[.72rem] text-muted whitespace-nowrap">Deadline</label>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="rounded-field border border-line-2 px-[8px] py-[4px] text-[.78rem] text-ink bg-transparent outline-none focus-visible:border-accent"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape' && onCancel) onCancel();
          }}
        />
      </div>
      <div className="flex items-center gap-[8px] mt-[2px]">
        <button
          className="text-[.82rem] font-semibold text-paper bg-ink px-[12px] py-[6px] rounded-field hover:bg-ink-hover disabled:opacity-40"
          onClick={submit}
          disabled={!title.trim()}
        >
          Add to Highest
        </button>
        {onCancel && (
          <button
            className="text-[.82rem] text-muted px-[9px] py-[6px] rounded-field hover:bg-hover"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Card visual (shared by sortable card + drag overlay) ──────────────────────

function GoalCardVisual({ goal, overlay }: { goal: Goal; overlay?: boolean }) {
  const pct = Math.round(goalPct(goal));
  const leaves = leafCount(goal.nodes);
  const next = firstOpenLeaf(goal.nodes);
  const behind = Math.round(behindPaceBy(pct, goal.start, goal.deadline, todayStr()));
  const expected = Math.round(expectedPct(goal.start, goal.deadline, todayStr()));

  return (
    <div
      className={`flex flex-col gap-[9px] p-[13px] rounded-card bg-panel border border-line ${
        overlay ? 'shadow-today rotate-[1.5deg] cursor-grabbing' : 'shadow-card'
      }`}
    >
      <span className="font-disp text-[.96rem] font-semibold tracking-[-0.01em] leading-[1.25] line-clamp-2 pr-[2px]">
        {goal.title}
      </span>
      <div className="flex items-center gap-[9px]">
        <span className="font-disp text-[.9rem] font-semibold tabular-nums min-w-[36px]">{pct}%</span>
        <ProgressBar pct={pct} />
      </div>
      <div className="flex items-center gap-[7px] flex-wrap">
        <span className="text-[.72rem] text-muted tabular-nums">{leaves.done}/{leaves.total}</span>
        <span className="text-faint text-[.66rem]">·</span>
        <span className="font-mono text-[.6rem] tracking-[.04em] text-muted tabular-nums">
          {deadlineChip(goal.deadline, todayStr())}
        </span>
        {expected > 0 && expected < 100 && (
          <span className="text-[.72rem] text-muted tabular-nums">exp {expected}%</span>
        )}
        {behind >= 10 && <BehindChip pts={behind} />}
      </div>
      <div className="text-[.72rem] text-muted truncate">
        Next: <span className="text-ink-soft">{next ? next.title : 'Define the first step'}</span>
      </div>
    </div>
  );
}

// ── Sortable card ─────────────────────────────────────────────────────────────

function BoardCard({
  goal,
  onOpen,
  onDelete,
  reducedMotion,
}: {
  goal: Goal;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  reducedMotion: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: goal.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.35 : undefined,
  };

  // Whole card is the drag activator. The PointerSensor's 5px activation
  // distance lets a plain click through to onClick (open drawer) while any
  // real drag picks the card up. onKeyDown is overridden after {...listeners}
  // so keyboard focus + Enter/Space opens the goal (pointer handles reorder).
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-label={`${goal.title} — open, or drag to re-rank`}
      onClick={() => onOpen(goal.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(goal.id); }
      }}
      className="group relative select-none cursor-grab active:cursor-grabbing rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-shadow hover:shadow-today"
    >
      <GoalCardVisual goal={goal} />

      {/* Delete — stop pointer/click from starting a drag or opening the goal */}
      <button
        type="button"
        aria-label={`Delete goal: ${goal.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(goal.id); }}
        className="absolute top-[9px] right-[8px] text-faint text-[.78rem] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[#b4453a] transition-opacity"
      >
        ✕
      </button>
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

function Column({
  col,
  index,
  ids,
  children,
}: {
  col: (typeof COLUMNS)[number];
  index: number;
  ids: string[];
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const isTop = index === 0;

  return (
    <section className={`flex-1 min-w-[236px] ${index > 0 ? 'border-l border-line pl-[18px]' : ''}`}>
      <header className="flex items-baseline gap-[8px] mb-[12px] px-[2px]">
        <span
          className={`font-disp leading-none tabular-nums ${
            isTop ? 'text-accent text-[1.15rem] font-semibold' : 'text-faint-2 text-[1.05rem]'
          }`}
        >
          {index + 1}
        </span>
        <span className={`text-[.74rem] font-medium ${isTop ? 'text-ink-soft' : 'text-muted'}`}>
          {col.label}
        </span>
        <span className="text-[.7rem] text-faint tabular-nums ml-auto">{ids.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex flex-col gap-[12px] min-h-[140px] rounded-card p-[6px] -m-[6px] transition-colors ${
            isOver ? 'bg-hover' : ''
          }`}
        >
          {children}
          {ids.length === 0 && (
            <div className="grid place-items-center min-h-[110px] rounded-card border border-dashed border-line-2 text-faint text-[.74rem] px-[10px] text-center">
              Drop a goal here
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

// ── Goals view ────────────────────────────────────────────────────────────────

export function Goals() {
  const { goals, actions } = useAppStore();
  const [showNewGoal, setShowNewGoal] = useState(false);

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
        {!isEmpty && !showNewGoal && (
          <button
            className="flex-none text-[.82rem] font-semibold text-paper bg-ink px-[13px] py-[7px] rounded-field hover:bg-ink-hover"
            onClick={() => setShowNewGoal(true)}
          >
            + New goal
          </button>
        )}
      </div>

      {/* Add form (top, not buried at the bottom) */}
      {(showNewGoal || isEmpty) && (
        <div className="mb-[22px] mt-[10px]">
          {isEmpty && (
            <p className="text-muted text-[.84rem] mb-[10px]">
              No goals yet — name your first one and pick a deadline.
            </p>
          )}
          <NewGoalForm
            onAdd={(title, deadline) => {
              actions.addGoal(title, deadline);
              setShowNewGoal(false);
            }}
            onCancel={isEmpty ? undefined : () => setShowNewGoal(false)}
          />
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
    </div>
  );
}
