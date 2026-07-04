import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '../../state/store';
import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import { TodayCheckbox } from './TodayCheckbox';
import { GripIcon } from './GripIcon';
import { useReducedMotion } from './useReducedMotion';
import { todayStr, addDays, fmtD, parseD } from '../../lib/dates';
import type { Task } from '../../db/types';

function relLabel(selDate: string, today: string): string {
  if (selDate === today) return 'Today';
  if (selDate === addDays(today, 1)) return 'Tomorrow';
  if (selDate === addDays(today, -1)) return 'Yesterday';
  return parseD(selDate).toLocaleDateString('en-US', { weekday: 'long' });
}

function SortableTaskRow({
  t,
  goal,
  onToggle,
  onRemove,
  reducedMotion,
}: {
  t: Task;
  goal: { id: string; title: string } | null | undefined;
  onToggle: () => void;
  onRemove: () => void;
  reducedMotion: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });

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
      className="group flex items-center gap-[12px] py-[6px] px-[8px] -mx-[8px] rounded-field hover:bg-hover"
    >
      <button
        type="button"
        className="text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab active:cursor-grabbing touch-none flex-shrink-0 transition-opacity"
        aria-label={`Drag to reorder "${t.title}"`}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <TodayCheckbox checked={t.done} onToggle={onToggle} ariaLabel={`Mark "${t.title}" done`} />
      <span
        className={`flex-1 min-w-0 truncate text-[.9rem] transition-colors duration-150 ${
          t.done ? 'line-through text-faint' : 'text-ink-soft'
        }`}
      >
        {t.title}
      </span>
      {goal && <Tag label={goal.title} />}
      <button
        type="button"
        className="text-faint text-[.8rem] hover:text-[#B4453A] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        onClick={onRemove}
        aria-label={`Remove task "${t.title}"`}
      >
        ✕
      </button>
    </div>
  );
}

export function TasksCard() {
  const { tasks, goals, selDate, actions } = useAppStore();
  const today = todayStr();
  const isToday = selDate === today;
  const rel = relLabel(selDate, today);
  const reducedMotion = useReducedMotion();
  const [taskGoalId, setTaskGoalId] = useState('');

  const dayTasks = tasks.filter((t) => t.date === selDate);
  const overdue = tasks.filter((t) => !t.done && t.date < today);
  const doneCount = dayTasks.filter((t) => t.done).length;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      actions.reorderTasks(String(active.id), String(over.id));
    }
  }

  function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const input = e.target as HTMLInputElement;
      const val = input.value.trim();
      if (val) {
        actions.addTask(val, selDate, taskGoalId || null);
        input.value = '';
      }
    }
  }

  const navBtn =
    'w-[26px] h-[26px] rounded-[7px] border border-line-2 text-[.86rem] text-chip-ink hover:bg-hover grid place-items-center';

  return (
    <CardSection
      label="Tasks"
      meta={
        <span className="font-mono text-[.72rem] text-faint">
          {doneCount} OF {dayTasks.length} DONE
        </span>
      }
      right={
        <div className="flex items-center gap-[6px]">
            <button type="button" className={navBtn} onClick={() => actions.shiftDay(-1)} aria-label="Previous day">
              ‹
            </button>
            <span className="font-disp text-[.94rem] font-semibold">
              {rel}{' '}
              <span className="font-mono text-[.66rem] font-normal text-muted tracking-[.04em]">
                {fmtD(selDate).toUpperCase()}
              </span>
            </span>
            <button type="button" className={navBtn} onClick={() => actions.shiftDay(1)} aria-label="Next day">
              ›
            </button>
            {!isToday && (
              <button
                type="button"
                className="px-[9px] h-[26px] rounded-[7px] border border-line-2 text-[.76rem] text-chip-ink hover:bg-hover"
                onClick={() => actions.goToToday()}
              >
                Today
              </button>
            )}
          </div>
      }
    >
      {isToday && overdue.length > 0 && (
        <div className="mb-[10px] border border-line-soft rounded-[10px] px-[10px] py-[8px] bg-panel-bright">
          <div className="font-mono text-[.66rem] font-semibold tracking-[.12em] uppercase text-warn mb-[4px]">
            Overdue
          </div>
          {overdue.map((t) => {
            const goal = t.goalId ? goals.find((g) => g.id === t.goalId) : null;
            return (
              <div key={t.id} className="flex items-center gap-[10px] py-[4px] group">
                <TodayCheckbox checked={t.done} onToggle={() => actions.toggleTask(t.id)} ariaLabel={`Mark "${t.title}" done`} />
                <span className="flex-1 min-w-0 truncate text-[.88rem] text-ink-soft">{t.title}</span>
                <span className="font-mono text-[.66rem] text-muted tabular-nums">{fmtD(t.date).toUpperCase()}</span>
                {goal && <Tag label={goal.title} />}
                <button
                  type="button"
                  onClick={() => actions.moveTaskToDate(t.id, today)}
                  className="text-[.76rem] text-ink-soft px-[7px] py-[2px] rounded-[5px] border border-line-2 hover:bg-hover"
                >
                  → today
                </button>
                <button
                  type="button"
                  onClick={() => actions.removeTask(t.id)}
                  aria-label={`Remove task "${t.title}"`}
                  className="text-faint text-[.8rem] hover:text-[#B4453A] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {dayTasks.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">
          Nothing planned for {rel.toLowerCase()}. Add a task to fill it in.
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={dayTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {dayTasks.map((t) => (
            <SortableTaskRow
              key={t.id}
              t={t}
              goal={t.goalId ? goals.find((g) => g.id === t.goalId) : null}
              onToggle={() => actions.toggleTask(t.id)}
              onRemove={() => actions.removeTask(t.id)}
              reducedMotion={reducedMotion}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div className="flex gap-[8px] mt-[10px]">
        <input
          className="flex-1 min-w-0 bg-field border border-line-2 rounded-field px-[12px] py-[8px] text-[.88rem] text-ink outline-none placeholder:text-faint"
          placeholder={`Plan a task for ${rel.toLowerCase()}…`}
          onKeyDown={handleAddKeyDown}
          aria-label={`Add a task for ${rel.toLowerCase()}`}
        />
        <select
          className="bg-field border border-line-2 rounded-field px-[8px] text-[.78rem] text-chip-ink outline-none"
          value={taskGoalId}
          onChange={(e) => setTaskGoalId(e.target.value)}
          aria-label="Tag new task to a goal"
        >
          <option value="">no goal</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </div>
    </CardSection>
  );
}
