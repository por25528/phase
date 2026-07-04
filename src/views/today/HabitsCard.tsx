import { useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
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
import { HabitDots } from './HabitDots';
import { useReducedMotion } from './useReducedMotion';
import { todayStr, addDays, weekDates, streak } from '../../lib/dates';
import type { Cadence, Habit } from '../../db/types';

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

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
    <div className="border border-line-2 rounded-field p-[12px] mt-[8px] flex flex-col gap-[10px] bg-field">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Habit name"
        className="ghost-in text-[.9rem]"
        aria-label="New habit name"
      />
      <div className="flex items-center gap-[8px] flex-wrap">
        <div className="flex border border-line-2 rounded-field overflow-hidden text-[.78rem] font-medium">
          {(['daily', 'weekly'] as Cadence[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCadence(c)}
              aria-pressed={cadence === c}
              className={`px-[12px] py-[4px] transition-colors duration-100 ${
                cadence === c ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-hover'
              }`}
            >
              {c === 'daily' ? 'Daily' : 'Weekly'}
            </button>
          ))}
        </div>
        {cadence === 'weekly' && (
          <div className="flex items-center gap-[6px]">
            <button
              type="button"
              onClick={() => setTarget((t) => Math.max(1, t - 1))}
              aria-label="Decrease weekly target"
              className="w-[22px] h-[22px] rounded-[4px] border border-line-2 text-[.9rem] text-ink-soft hover:bg-hover grid place-items-center"
            >
              −
            </button>
            <span className="text-[.82rem] tabular-nums w-[14px] text-center font-medium text-ink">{target}</span>
            <button
              type="button"
              onClick={() => setTarget((t) => Math.min(7, t + 1))}
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
          className="px-[13px] py-[5px] rounded-field bg-ink text-paper text-[.8rem] font-semibold hover:bg-ink-hover"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-[12px] py-[5px] rounded-field border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SortableHabitRow({
  hb,
  today,
  goal,
  onToggle,
  onRemove,
  onRename,
  reducedMotion,
}: {
  hb: Habit;
  today: string;
  goal: { id: string; title: string } | null | undefined;
  onToggle: () => void;
  onRemove: () => void;
  onRename: (title: string) => void;
  reducedMotion: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: hb.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(hb.title);
  // Where the pointer went down, so a click that was really a drag doesn't also toggle.
  const downPos = useRef<{ x: number; y: number } | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const done = hb.checkins.includes(today);
  // A day only counts as "missed" if the habit already existed on it —
  // otherwise a brand-new habit would show "2 missed" for days before it began.
  const created = hb.createdAt ?? '0000-00-00';
  const twoDaysAgo = addDays(today, -2);
  const missed =
    hb.cadence === 'daily' &&
    twoDaysAgo >= created &&
    !hb.checkins.includes(addDays(today, -1)) &&
    !hb.checkins.includes(twoDaysAgo);
  const stat =
    hb.cadence === 'weekly'
      ? `${weekDates(today).filter((d) => hb.checkins.includes(d)).length}/${hb.weeklyTarget} this wk`
      : `${streak(hb)}d streak`;

  function startEdit() {
    setDraft(hb.title);
    setEditing(true);
  }
  function commitRename() {
    const v = draft.trim();
    if (v && v !== hb.title) onRename(v);
    setEditing(false);
  }
  function cancelRename() {
    setEditing(false);
  }
  function handleRenameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  if (editing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-[8px] py-[6px] px-[8px] -mx-[8px] rounded-field bg-field"
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleRenameKey}
          className="ghost-in flex-1 min-w-0 text-[.9rem] font-medium"
          aria-label={`Rename habit "${hb.title}"`}
        />
        <button
          type="button"
          onClick={commitRename}
          className="px-[12px] py-[4px] rounded-field bg-ink text-paper text-[.78rem] font-semibold hover:bg-ink-hover flex-none"
        >
          Save
        </button>
        <button
          type="button"
          onClick={cancelRename}
          className="px-[11px] py-[4px] rounded-field border border-line-2 text-[.78rem] text-ink-soft hover:bg-hover flex-none"
        >
          Cancel
        </button>
      </div>
    );
  }

  function handleRowClick(e: ReactMouseEvent<HTMLDivElement>) {
    const d = downPos.current;
    downPos.current = null;
    // If the pointer travelled, this "click" was the tail of a drag — don't toggle.
    if (isDragging) return;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    onToggle();
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-[12px] py-[6px] px-[8px] -mx-[8px] rounded-field cursor-grab active:cursor-grabbing touch-none hover:bg-hover"
      onPointerDownCapture={(e) => { downPos.current = { x: e.clientX, y: e.clientY }; }}
      onClick={handleRowClick}
      {...attributes}
      {...listeners}
    >
      <span className="text-faint opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity pointer-events-none">
        <GripIcon />
      </span>
      <span
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="flex-none"
      >
        <TodayCheckbox checked={done} onToggle={onToggle} ariaLabel={`Mark "${hb.title}" done today`} />
      </span>
      <span className={`flex-1 min-w-[90px] truncate text-[.9rem] font-medium ${done ? 'text-muted' : 'text-ink'}`}>
        {hb.title}
      </span>
      {missed && (
        <span className="text-[.7rem] font-semibold px-[8px] py-[2px] rounded-full bg-warn-tint text-warn whitespace-nowrap">
          2 missed
        </span>
      )}
      {goal && <Tag label={goal.title} />}
      <HabitDots hb={hb} today={today} />
      <span className="font-mono text-[.7rem] text-muted w-[76px] text-right flex-none tabular-nums">{stat}</span>
      <button
        type="button"
        className="text-faint hover:text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex-none"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); startEdit(); }}
        aria-label={`Rename habit "${hb.title}"`}
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        className="text-faint text-[.8rem] hover:text-[#B4453A] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex-none"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label={`Remove habit "${hb.title}"`}
      >
        ✕
      </button>
    </div>
  );
}

export function HabitsCard() {
  const { habits, goals, actions } = useAppStore();
  const today = todayStr();
  const reducedMotion = useReducedMotion();
  const [adding, setAdding] = useState(false);
  const done = habits.filter((h) => h.checkins.includes(today)).length;

  const sensors = useSensors(
    // Require a small drag before the whole-row handle activates, so a plain
    // click falls through to the row's toggle instead of being eaten as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      actions.reorderHabits(String(active.id), String(over.id));
    }
  }

  return (
    <CardSection
      label="Habits — today"
      meta={
        <span className="font-mono text-[.72rem] text-faint">
          {done} OF {habits.length} DONE
        </span>
      }
      right={
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="px-[13px] py-[6px] rounded-field bg-ink text-paper text-[.8rem] font-semibold hover:bg-ink-hover"
        >
          + Habit
        </button>
      }
    >
      {habits.length === 0 && !adding && (
        <div className="text-faint text-[.85rem] italic py-[6px]">No habits yet. Add one to start a streak.</div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={habits.map((h) => h.id)} strategy={verticalListSortingStrategy}>
          {habits.map((hb) => (
            <SortableHabitRow
              key={hb.id}
              hb={hb}
              today={today}
              goal={hb.goalId ? goals.find((g) => g.id === hb.goalId) : null}
              onToggle={() => actions.toggleHabit(hb.id)}
              onRemove={() => actions.removeHabit(hb.id)}
              onRename={(title) => actions.renameHabit(hb.id, title)}
              reducedMotion={reducedMotion}
            />
          ))}
        </SortableContext>
      </DndContext>
      {adding && <AddHabitForm onAdd={(n, c, t) => { actions.addHabit(n, c, t); setAdding(false); }} onCancel={() => setAdding(false)} />}
    </CardSection>
  );
}
