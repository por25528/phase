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
import { useAppStore } from '../../../state/store';
import { Tag } from '../../../components/Tag';
import { TodayCheckbox } from '../../../components/TodayCheckbox';
import { IconGrip, IconPencil, IconX } from '../../../components/Icons';
import { HabitDots } from './HabitDots';
import { useReducedMotion } from '../../../components/useReducedMotion';
import { todayStr, addDays, weekDates, streak } from '../../../lib/dates';
import { revealDomId, type RevealTarget } from '../../../lib/reveal';
import type { Cadence, Habit } from '../../../db/types';

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
        className="ghost-in text-lead"
        aria-label="New habit name"
      />
      <div className="flex items-center gap-[8px] flex-wrap">
        <div className="flex border border-line-2 rounded-field overflow-hidden text-ui font-medium">
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
              className="w-[22px] h-[22px] rounded-[4px] border border-line-2 text-lead text-ink-soft hover:bg-hover grid place-items-center"
            >
              −
            </button>
            <span className="text-body tabular-nums w-[14px] text-center font-medium text-ink">{target}</span>
            <button
              type="button"
              onClick={() => setTarget((t) => Math.min(7, t + 1))}
              aria-label="Increase weekly target"
              className="w-[22px] h-[22px] rounded-[4px] border border-line-2 text-lead text-ink-soft hover:bg-hover grid place-items-center"
            >
              +
            </button>
            <span className="text-compact text-muted">× per week</span>
          </div>
        )}
      </div>
      <div className="flex gap-[8px]">
        <button
          type="button"
          onClick={submit}
          className="px-[13px] py-[5px] rounded-field bg-ink text-paper text-ui font-semibold hover:bg-ink-hover"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-[12px] py-[5px] rounded-field border border-line-2 text-ui text-ink-soft hover:bg-hover"
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
  onToggleDay,
  onRemove,
  onRename,
  reducedMotion,
  revealed,
}: {
  hb: Habit;
  today: string;
  goal: { id: string; title: string } | null | undefined;
  onToggle: () => void;
  onToggleDay: (date: string) => void;
  onRemove: () => void;
  onRename: (title: string) => void;
  reducedMotion: boolean;
  /** The palette sent the user to this habit — mark it so the search has an answer. */
  revealed: boolean;
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
          className="ghost-in flex-1 min-w-0 text-lead font-medium"
          aria-label={`Rename habit "${hb.title}"`}
        />
        <button
          type="button"
          onClick={commitRename}
          className="px-[12px] py-[4px] rounded-field bg-ink text-paper text-ui font-semibold hover:bg-ink-hover flex-none"
        >
          Save
        </button>
        <button
          type="button"
          onClick={cancelRename}
          className="px-[11px] py-[4px] rounded-field border border-line-2 text-ui text-ink-soft hover:bg-hover flex-none"
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
      id={revealDomId('habit', hb.id)}
      style={style}
      className={`group flex flex-wrap items-center gap-x-[12px] gap-y-[4px] py-[6px] px-[8px] -mx-[8px] rounded-field cursor-grab active:cursor-grabbing touch-none hover:bg-hover ${
        revealed ? 'ring-2 ring-accent bg-accent-tint' : ''
      }`}
      onPointerDownCapture={(e) => { downPos.current = { x: e.clientX, y: e.clientY }; }}
      onClick={handleRowClick}
      {...attributes}
      {...listeners}
    >
      <span className="text-faint opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity pointer-events-none">
        <IconGrip size={13} />
      </span>
      <span
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="flex-none"
      >
        <TodayCheckbox checked={done} onToggle={onToggle} ariaLabel={`Mark "${hb.title}" done today`} />
      </span>
      <span className={`flex-1 min-w-[90px] truncate text-lead font-medium ${done ? 'text-muted' : 'text-ink'}`}>
        {hb.title}
      </span>
      {missed && (
        <span className="text-meta font-semibold px-[8px] py-[2px] rounded-full bg-warn-tint text-warn whitespace-nowrap">
          2 missed
        </span>
      )}
      {goal && <Tag label={goal.title} />}
      {/*
        The 15-day trail and its stat, as ONE wrappable group.

        They are ~216px of fixed width in a rail that is 254px wide at every
        viewport from 768px up (`272px` grid column less the `18px` gutter), so
        they have never fitted beside a title. The old rule hid them below a
        1000px VIEWPORT, which is the wrong box: above 1000px the row simply
        overflowed into the sidebar's scroller and pushed the rename and delete
        controls out of reach. `@container` measures the rail itself, and the
        answer is to give the trail its own line rather than delete the only
        route to backfilling a missed day.
      */}
      <span className="hb-trail flex items-center gap-[12px] ml-auto flex-none">
        <HabitDots hb={hb} today={today} onToggleDay={onToggleDay} />
        <span className="hb-stat font-mono text-meta text-muted w-[76px] text-right flex-none tabular-nums">{stat}</span>
      </span>

      <button
        type="button"
        className="quiet-control text-faint hover:text-ink flex-none"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); startEdit(); }}
        aria-label={`Rename habit "${hb.title}"`}
      >
        <IconPencil size={13} />
      </button>
      <button
        type="button"
        className="quiet-control text-faint hover:text-warn flex-none"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label={`Delete habit "${hb.title}"`}
      >
        <IconX size={13} />
      </button>
    </div>
  );
}

/**
 * The habits panel body — deliberately bare.
 *
 * The title and the done-count live on `SidebarSection`'s own header, which
 * wraps this in `Plan.tsx`; rendering a `CardSection` here as well printed both
 * twice inside a bordered, filled, shadowed box, in the one rail whose rule is
 * that the resting state is text and controls appear on hover. The panel body
 * is now flat, exactly like the sibling `Stats` panel.
 */
export function Habits({ reveal }: { reveal?: RevealTarget | null }) {
  const { habits, goals, actions } = useAppStore();
  const today = todayStr();
  const reducedMotion = useReducedMotion();
  const [adding, setAdding] = useState(false);

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
    <div className="hb-rail">
      {habits.length === 0 && !adding && (
        <div className="text-muted text-body italic py-[6px]">No habits yet. Add one to start a streak.</div>
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
              onToggleDay={(date) => actions.toggleHabitOn(hb.id, date)}
              onRemove={() => actions.removeHabit(hb.id)}
              onRename={(title) => actions.renameHabit(hb.id, title)}
              reducedMotion={reducedMotion}
              revealed={reveal?.kind === 'habit' && reveal.id === hb.id}
            />
          ))}
        </SortableContext>
      </DndContext>
      {/*
        The add affordance used to be `CardSection`'s `right` slot. With the
        card gone it follows the rows instead; its own styling is untouched.
      */}
      {adding ? (
        <AddHabitForm onAdd={(n, c, t) => { actions.addHabit(n, c, t); setAdding(false); }} onCancel={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-[8px] px-[13px] py-[6px] rounded-field bg-ink text-paper text-ui font-semibold hover:bg-ink-hover"
        >
          + Habit
        </button>
      )}
    </div>
  );
}
