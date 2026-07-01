import { useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '../state/store';
import { SectionLabel } from '../components/SectionLabel';
import { Tag } from '../components/Tag';
import { TodayHeatmap } from '../components/TodayHeatmap';
import { todayStr, addDays, fmtD, parseD, weekDates, streak } from '../lib/dates';
import type { Cadence } from '../db/types';

// Local accessible checkbox — real <button> with role + aria-checked
function TodayCheckbox({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={`w-[17px] h-[17px] border-[1.5px] rounded-[5px] flex-shrink-0 grid place-items-center transition-colors duration-100 ${
        checked ? 'bg-fill border-fill' : 'border-line-2 hover:border-muted'
      }`}
    >
      <svg
        viewBox="0 0 12 12"
        className={`w-[11px] h-[11px] stroke-white fill-none transition-opacity duration-100 ${
          checked ? 'opacity-100' : 'opacity-0'
        }`}
        strokeWidth={2.4}
      >
        <path d="M2 6.2 4.6 9 10 3" />
      </svg>
    </button>
  );
}

// Segmented cadence toggle + weekly target stepper, shown inline when adding a habit
function AddHabitForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, cadence: Cadence, target: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<Cadence>('daily');
  const [target, setTarget] = useState(4);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, cadence, target);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div className="border border-line rounded-[7px] p-[12px] mt-[8px] flex flex-col gap-[10px] bg-panel">
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Habit name"
        className="ghost-in text-[.9rem]"
        aria-label="New habit name"
      />
      <div className="flex items-center gap-[8px] flex-wrap">
        {/* Segmented daily / weekly toggle */}
        <div className="flex border border-line-2 rounded-[6px] overflow-hidden text-[.78rem] font-medium">
          {(['daily', 'weekly'] as Cadence[]).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setCadence(c)}
              aria-pressed={cadence === c}
              className={`px-[12px] py-[4px] transition-colors duration-100 ${
                cadence === c
                  ? 'bg-accent-tint text-ink'
                  : 'text-ink-soft hover:bg-hover'
              }`}
            >
              {c === 'daily' ? 'Daily' : 'Weekly'}
            </button>
          ))}
        </div>

        {/* Weekly target stepper — only shown for weekly cadence */}
        {cadence === 'weekly' && (
          <div className="flex items-center gap-[6px]">
            <button
              type="button"
              onClick={() => setTarget(t => Math.max(1, t - 1))}
              aria-label="Decrease weekly target"
              className="w-[22px] h-[22px] rounded-[4px] border border-line-2 text-[.9rem] text-ink-soft hover:bg-hover grid place-items-center"
            >
              −
            </button>
            <span className="text-[.82rem] tabular-nums w-[14px] text-center font-medium text-ink">
              {target}
            </span>
            <button
              type="button"
              onClick={() => setTarget(t => Math.min(7, t + 1))}
              aria-label="Increase weekly target"
              className="w-[22px] h-[22px] rounded-[4px] border border-line-2 text-[.9rem] text-ink-soft hover:bg-hover grid place-items-center"
            >
              +
            </button>
            <span className="text-[.76rem] text-muted">× per week</span>
          </div>
        )}
      </div>

      <div className="flex gap-[8px]">
        <button
          type="button"
          onClick={submit}
          className="px-[12px] py-[5px] rounded-[6px] border border-line-2 text-ink text-[.8rem] font-medium hover:bg-hover"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-[12px] py-[5px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Drag handle icon
function GripIcon() {
  return (
    <svg
      viewBox="0 0 10 16"
      width="10"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="3" cy="3" r="1.2" />
      <circle cx="7" cy="3" r="1.2" />
      <circle cx="3" cy="8" r="1.2" />
      <circle cx="7" cy="8" r="1.2" />
      <circle cx="3" cy="13" r="1.2" />
      <circle cx="7" cy="13" r="1.2" />
    </svg>
  );
}

type SortableHabitRowProps = {
  hb: {
    id: string;
    title: string;
    goalId: string | null;
    cadence: 'daily' | 'weekly';
    weeklyTarget: number;
    checkins: string[];
  };
  today: string;
  goal: { id: string; title: string } | null | undefined;
  onToggle: () => void;
  onRemove: () => void;
  reducedMotion: boolean;
};

function SortableHabitRow({ hb, today, goal, onToggle, onRemove, reducedMotion }: SortableHabitRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: hb.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const done = hb.checkins.includes(today);

  const stat =
    hb.cadence === 'weekly' ? (
      <span className="text-[.74rem] text-muted tabular-nums">
        this week{' '}
        <b className="text-accent font-semibold">
          {weekDates(today).filter(d => hb.checkins.includes(d)).length}/
          {hb.weeklyTarget}
        </b>
      </span>
    ) : (
      <span className="text-[.74rem] text-muted tabular-nums">
        streak <b className="text-accent font-semibold">{streak(hb)}</b>
      </span>
    );

  const y = addDays(today, -1);
  const y2 = addDays(today, -2);
  const showNudge =
    hb.cadence === 'daily' &&
    !hb.checkins.includes(y) &&
    !hb.checkins.includes(y2);

  return (
    <div ref={setNodeRef} style={style} className="py-[11px] border-b border-line group">
      <div className="flex items-center gap-[11px]">
        {/* Drag handle — visible on hover, keyboard accessible */}
        <button
          type="button"
          className="text-faint opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing touch-none flex-shrink-0 transition-opacity"
          aria-label={`Drag to reorder "${hb.title}"`}
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>
        <TodayCheckbox
          checked={done}
          onToggle={onToggle}
          ariaLabel={`Mark "${hb.title}" done today`}
        />
        <span className="text-[.92rem] font-[450] flex-1">{hb.title}</span>
        {goal && <Tag label={goal.title} />}
        {stat}
        <button
          type="button"
          className="text-faint text-[.8rem] hover:text-[#b4453a] opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onRemove}
          aria-label={`Remove habit "${hb.title}"`}
        >
          ✕
        </button>
      </div>

      {showNudge && (
        <div
          className="text-[.74rem] mt-[5px] ml-[28px]"
          style={{ color: '#b06a4f' }}
        >
          Two days missed — don't let it become three.
        </div>
      )}

      <TodayHeatmap hb={hb} />
    </div>
  );
}

type SortableTaskRowProps = {
  t: {
    id: string;
    title: string;
    done: boolean;
    goalId: string | null;
  };
  goal: { id: string; title: string } | null | undefined;
  onToggle: () => void;
  onRemove: () => void;
  reducedMotion: boolean;
};

function SortableTaskRow({ t, goal, onToggle, onRemove, reducedMotion }: SortableTaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: t.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-[10px] p-[6px] rounded-[6px] hover:bg-hover group"
    >
      {/* Drag handle */}
      <button
        type="button"
        className="text-faint opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing touch-none flex-shrink-0 transition-opacity"
        aria-label={`Drag to reorder "${t.title}"`}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <TodayCheckbox
        checked={t.done}
        onToggle={onToggle}
        ariaLabel={`Mark "${t.title}" done`}
      />
      <span
        className={`flex-1 text-[.9rem] transition-colors duration-150 ${
          t.done ? 'line-through text-faint' : 'text-ink-soft'
        }`}
      >
        {t.title}
      </span>
      {goal && <Tag label={goal.title} />}
      <button
        type="button"
        className="text-faint text-[.8rem] hover:text-[#b4453a] opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onRemove}
        aria-label={`Remove task "${t.title}"`}
      >
        ✕
      </button>
    </div>
  );
}

export function Today() {
  const { goals, habits, tasks, selDate, actions } = useAppStore();
  const today = todayStr();
  const isToday = selDate === today;
  const wd = parseD(selDate).toLocaleDateString('en-US', { weekday: 'long' });
  const rel =
    selDate === today
      ? 'Today'
      : selDate === addDays(today, 1)
      ? 'Tomorrow'
      : selDate === addDays(today, -1)
      ? 'Yesterday'
      : wd;

  const [addingHabit, setAddingHabit] = useState(false);
  const [taskGoalId, setTaskGoalId] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const dayTasks = tasks.filter(t => t.date === selDate);
  const habitIds = habits.map(h => h.id);
  const taskIds = dayTasks.map(t => t.id);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleAddHabit(name: string, cadence: Cadence, target: number) {
    actions.addHabit(name, cadence, target);
    setAddingHabit(false);
  }

  function handleTaskKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const input = e.target as HTMLInputElement;
      const val = input.value.trim();
      if (val) {
        actions.addTask(val, selDate, taskGoalId || null);
        input.value = '';
      }
    }
  }

  function handleHabitDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      actions.reorderHabits(String(active.id), String(over.id));
    }
  }

  function handleTaskDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      actions.reorderTasks(String(active.id), String(over.id));
    }
  }

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">
        Today
      </h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        {new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}{' '}
        — check your floors, plan ahead.
      </p>

      {/* ── Habits ──────────────────────────────────────── */}
      <SectionLabel first>Habits — today</SectionLabel>

      {habits.length === 0 && !addingHabit && (
        <div className="text-faint text-[.85rem] italic py-[6px]">
          No habits yet. Add one to start a streak.
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleHabitDragEnd}
      >
        <SortableContext items={habitIds} strategy={verticalListSortingStrategy}>
          {habits.map(hb => {
            const goal = hb.goalId ? goals.find(g => g.id === hb.goalId) : null;
            return (
              <SortableHabitRow
                key={hb.id}
                hb={hb}
                today={today}
                goal={goal}
                onToggle={() => actions.toggleHabit(hb.id)}
                onRemove={() => actions.removeHabit(hb.id)}
                reducedMotion={reducedMotion}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      <div className="mt-[8px]">
        {addingHabit ? (
          <AddHabitForm
            onAdd={handleAddHabit}
            onCancel={() => setAddingHabit(false)}
          />
        ) : (
          <button
            type="button"
            className="text-[.82rem] text-muted px-[9px] py-[5px] rounded-[6px] border border-line-2 hover:bg-hover"
            onClick={() => setAddingHabit(true)}
          >
            + habit
          </button>
        )}
      </div>

      {/* ── Tasks ───────────────────────────────────────── */}
      <SectionLabel>Tasks</SectionLabel>

      {/* Day navigator */}
      <div className="flex items-center gap-[8px] mb-[10px]">
        <button
          type="button"
          className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover"
          onClick={() => actions.shiftDay(-1)}
          aria-label="Previous day"
        >
          ‹
        </button>
        <span className="font-disp text-[1.04rem] font-medium">{rel}</span>
        <span className="text-[.76rem] text-muted tabular-nums">{fmtD(selDate)}</span>
        <button
          type="button"
          className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover"
          onClick={() => actions.shiftDay(1)}
          aria-label="Next day"
        >
          ›
        </button>
        {!isToday && (
          <button
            type="button"
            className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover"
            onClick={() => actions.goToToday()}
          >
            Today
          </button>
        )}
      </div>

      {dayTasks.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">
          Nothing planned for {rel.toLowerCase()}. Add a task to fill it in.
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleTaskDragEnd}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {dayTasks.map(t => {
            const goal = t.goalId ? goals.find(g => g.id === t.goalId) : null;
            return (
              <SortableTaskRow
                key={t.id}
                t={t}
                goal={goal}
                onToggle={() => actions.toggleTask(t.id)}
                onRemove={() => actions.removeTask(t.id)}
                reducedMotion={reducedMotion}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Add-task ghost input + goal select */}
      <div className="flex items-center gap-[8px] mt-[8px]">
        <input
          className="ghost-in"
          placeholder={`Plan a task for ${rel.toLowerCase()}…`}
          onKeyDown={handleTaskKeyDown}
          aria-label={`Add a task for ${rel.toLowerCase()}`}
        />
        <select
          className="border border-line-2 rounded-[6px] px-[6px] py-[4px] text-[.78rem] bg-panel text-ink-soft"
          value={taskGoalId}
          onChange={e => setTaskGoalId(e.target.value)}
          aria-label="Tag new task to a goal"
        >
          <option value="">no goal</option>
          {goals.map(g => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
