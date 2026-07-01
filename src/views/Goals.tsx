import { useState, useRef, useEffect } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Goal, GoalNode } from '../db/types';
import { useAppStore } from '../state/store';
import { ProgressBar } from '../components/ProgressBar';
import { GoalTree } from '../components/GoalTree';
import { goalPct } from '../lib/pct';
import { fmtD, todayStr, parseD } from '../lib/dates';

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

function daysLeft(deadline: string): number {
  const today = parseD(todayStr());
  const dl = parseD(deadline);
  return Math.ceil((dl.getTime() - today.getTime()) / 86_400_000);
}

function InlineEdit({
  value,
  className,
  onCommit,
  onCancel,
}: {
  value: string;
  className: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function commit() {
    const v = draft.trim();
    if (v) onCommit(v);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className={`${className} bg-transparent outline-none p-0 min-w-0`}
      style={{ border: 'none', borderBottom: '1px solid #5D6B82' }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          escaped.current = false;
          commit();
        }
        if (e.key === 'Escape') {
          escaped.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!escaped.current) commit();
      }}
    />
  );
}

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
    <div className="mt-[22px] p-[12px] rounded-[7px] border border-line-2 bg-panel flex flex-col gap-[8px]">
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Goal name"
        className="w-full bg-transparent border-none outline-none text-[.9rem] text-ink placeholder:text-faint"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
      />
      <input
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
        className="w-full rounded-[6px] border border-line-2 px-[8px] py-[4px] text-[.78rem] text-ink bg-transparent outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
      />
      <div className="flex items-center gap-[8px]">
        <button
          className="text-[.82rem] text-ink px-[9px] py-[5px] rounded-[6px] border border-line-2 hover:bg-hover"
          onClick={submit}
        >
          Add
        </button>
        {onCancel && (
          <button
            className="text-[.82rem] text-muted px-[9px] py-[5px] rounded-[6px] hover:bg-hover"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function SortableGoalCard({
  goal,
  editingGoalId,
  setEditingGoalId,
  onDelete,
  onRename,
  onAddRoot,
  reducedMotion,
}: {
  goal: Goal;
  editingGoalId: string | null;
  setEditingGoalId: (id: string | null) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onAddRoot: (goalId: string, title: string) => void;
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
    opacity: isDragging ? 0.45 : undefined,
    position: 'relative',
    zIndex: isDragging ? 1 : undefined,
  };

  const pct = Math.round(goalPct(goal));
  const leaves = leafCount(goal.nodes);
  const days = daysLeft(goal.deadline);

  return (
    <div ref={setNodeRef} style={style} className="py-[18px] pb-[8px] border-b border-line group">
      {/* Header row */}
      <div className="flex items-center gap-[8px]">
        {/* Drag handle — only handle is draggable, rest stays clickable */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder goal"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-faint text-[13px] cursor-grab active:cursor-grabbing select-none px-[2px] touch-none transition-opacity flex-shrink-0"
        >
          ⠿
        </button>

        {/* Title — click to rename */}
        <div className="flex-1 min-w-0">
          {editingGoalId === goal.id ? (
            <InlineEdit
              value={goal.title}
              className="font-disp text-[1.18rem] font-semibold tracking-[-0.01em] w-full"
              onCommit={(v) => { onRename(goal.id, v); setEditingGoalId(null); }}
              onCancel={() => setEditingGoalId(null)}
            />
          ) : (
            <span
              className="font-disp text-[1.18rem] font-semibold tracking-[-0.01em] cursor-default"
              onClick={() => setEditingGoalId(goal.id)}
            >
              {goal.title}
            </span>
          )}
        </div>

        {/* Dates + days left */}
        <div className="flex items-center gap-[5px] text-[.76rem] text-muted whitespace-nowrap flex-shrink-0">
          <span>{fmtD(goal.start)} → {fmtD(goal.deadline)}</span>
          <span className="text-[.72rem] opacity-70">
            · {days < 0 ? 'overdue' : `${days}d left`}
          </span>
        </div>

        {/* Delete — single click, undo via App shell toast */}
        <button
          type="button"
          aria-label={`Delete goal: ${goal.title}`}
          className="text-faint text-[.8rem] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-500 transition-opacity ml-[4px] flex-shrink-0"
          onClick={() => onDelete(goal.id)}
        >
          ✕
        </button>
      </div>

      {/* Progress row */}
      <div className="flex items-center gap-[11px] mt-[10px] mb-[6px]">
        <span className="font-disp text-[1.05rem] font-semibold tabular-nums min-w-[46px]">
          {pct}%
        </span>
        <span className="text-[.76rem] text-muted tabular-nums whitespace-nowrap">
          {leaves.done}/{leaves.total} done
        </span>
        <ProgressBar pct={pct} />
      </div>

      <GoalTree nodes={goal.nodes} />
      <AddRootInput onAdd={(title) => onAddRoot(goal.id, title)} />
    </div>
  );
}

export function Goals() {
  const { goals, actions } = useAppStore();
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [showNewGoal, setShowNewGoal] = useState(false);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const goalIds = goals.map((g) => g.id);

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) {
      actions.reorderGoals(String(active.id), String(over.id));
    }
  }

  const isEmpty = goals.length === 0;

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Goals</h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        Each goal is a tree. Tick the leaves; the percentage rolls up on its own.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={goalIds} strategy={verticalListSortingStrategy}>
          {goals.map((g) => (
            <SortableGoalCard
              key={g.id}
              goal={g}
              editingGoalId={editingGoalId}
              setEditingGoalId={setEditingGoalId}
              onDelete={actions.removeGoal}
              onRename={actions.renameGoal}
              onAddRoot={actions.addRootNode}
              reducedMotion={reducedMotion}
            />
          ))}
        </SortableContext>
      </DndContext>

      {isEmpty && (
        <p className="text-muted text-[.84rem] mb-[4px]">
          No goals yet — name your first one and pick a deadline.
        </p>
      )}

      {showNewGoal || isEmpty ? (
        <NewGoalForm
          onAdd={(title, deadline) => {
            actions.addGoal(title, deadline);
            setShowNewGoal(false);
          }}
          onCancel={isEmpty ? undefined : () => setShowNewGoal(false)}
        />
      ) : (
        <button
          className="text-[.82rem] text-muted px-[9px] py-[5px] rounded-[6px] border border-line-2 hover:bg-hover mt-[22px]"
          onClick={() => setShowNewGoal(true)}
        >
          + new goal
        </button>
      )}
    </div>
  );
}

function AddRootInput({ onAdd }: { onAdd: (title: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="px-[6px] py-[2px]">
      <input
        ref={ref}
        className="ghost-in w-full text-[.85rem]"
        placeholder="+ add sub-goal…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ref.current) {
            const v = ref.current.value.trim();
            if (v) {
              onAdd(v);
              ref.current.value = '';
            }
          }
        }}
      />
    </div>
  );
}
