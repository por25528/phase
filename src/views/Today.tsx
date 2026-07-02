import { useState, useRef } from 'react';
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
import { Hero } from './today/Hero';
import { WeekStrip } from './today/WeekStrip';
import { HabitsCard } from './today/HabitsCard';
import { QuickAdd } from './today/QuickAdd';
import type { QuickType } from './today/QuickAdd';
import { TodayCheckbox } from './today/TodayCheckbox';
import { GripIcon } from './today/GripIcon';
import { useReducedMotion } from './today/useReducedMotion';
import { todayStr, addDays, fmtD, parseD } from '../lib/dates';
import { minutesOn, minutesThisWeek, fmtMinutes } from '../lib/sessions';

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
  const { goals, tasks, sessions, selDate, actions } = useAppStore();
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

  const [taskGoalId, setTaskGoalId] = useState('');
  const [logMins, setLogMins] = useState('30');
  const [logGoalId, setLogGoalId] = useState('');
  const reducedMotion = useReducedMotion();

  const quickRef = useRef<HTMLInputElement>(null);
  const [quickType, setQuickType] = useState<QuickType>('task');
  function focusQuick(t: QuickType) {
    setQuickType(t);
    quickRef.current?.focus();
  }
  void focusQuick; // wired up in Task 10 (GoalsCard)

  const dayTasks = tasks.filter(t => t.date === selDate);
  const overdue = tasks.filter(t => !t.done && t.date < today);
  const taskIds = dayTasks.map(t => t.id);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  function handleTaskDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      actions.reorderTasks(String(active.id), String(over.id));
    }
  }

  return (
    <div className="pt-[26px]">
      {/* Hero + quick add */}
      <div className="today-hero grid gap-[28px] items-end mb-[20px]">
        <Hero />
        <QuickAdd type={quickType} onType={setQuickType} inputRef={quickRef} />
      </div>

      <WeekStrip />

      {/* Main grid */}
      <div className="today-main grid gap-[22px] items-start mt-[20px]">
        <div className="flex flex-col gap-[18px] min-w-0">
      <HabitsCard />

      {/* ── Study log ───────────────────────────────────── */}
      <SectionLabel>Study log</SectionLabel>
      {(() => {
        const daySessions = sessions.filter(s => s.date === selDate);
        return (
          <>
            {daySessions.length === 0 && (
              <div className="text-faint text-[.85rem] italic py-[6px]">
                Nothing logged for {rel.toLowerCase()} yet.
              </div>
            )}
            {daySessions.map(s => {
              const goal = s.goalId ? goals.find(g => g.id === s.goalId) : null;
              return (
                <div key={s.id} className="flex items-center gap-[10px] p-[6px] rounded-[6px] hover:bg-hover group">
                  <span className="text-[.8rem] font-semibold tabular-nums text-ink min-w-[52px]">{fmtMinutes(s.minutes)}</span>
                  <span className="flex-1 text-[.88rem] text-ink-soft">{s.note || 'Session'}</span>
                  {goal && <Tag label={goal.title} />}
                  <button type="button" onClick={() => actions.removeSession(s.id)} aria-label="Remove session"
                    className="text-faint text-[.8rem] hover:text-[#b4453a] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                </div>
              );
            })}
            {daySessions.length > 0 && (
              <div className="text-[.74rem] text-muted mt-[4px] px-[6px] tabular-nums">
                {fmtMinutes(minutesOn(sessions, selDate))} total · {fmtMinutes(minutesThisWeek(sessions, today))} this week
              </div>
            )}
            {/* add row: minutes number input + note + goal select, Enter submits */}
            <div className="flex items-center gap-[8px] mt-[8px]">
              <input type="number" min={1} max={600} value={logMins} onChange={e => setLogMins(e.target.value)}
                aria-label="Minutes" placeholder="min"
                className="w-[64px] border border-line-2 rounded-[6px] px-[6px] py-[4px] text-[.82rem] bg-panel text-ink tabular-nums" />
              <input className="ghost-in" placeholder="What did you work on?" aria-label="Session note"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const mins = parseInt(logMins, 10);
                    if (mins > 0) {
                      actions.addSession(logGoalId || null, selDate, mins, (e.target as HTMLInputElement).value.trim());
                      (e.target as HTMLInputElement).value = '';
                    }
                  }
                }} />
              <select className="border border-line-2 rounded-[6px] px-[6px] py-[4px] text-[.78rem] bg-panel text-ink-soft"
                value={logGoalId} onChange={e => setLogGoalId(e.target.value)} aria-label="Tag session to a goal">
                <option value="">no goal</option>
                {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </div>
          </>
        );
      })()}

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

      {isToday && overdue.length > 0 && (
        <div className="mb-[14px] border border-line rounded-[7px] px-[10px] py-[8px] bg-panel">
          <div className="text-[.72rem] font-[550] uppercase tracking-[.07em] text-muted mb-[4px]">Overdue</div>
          {overdue.map(t => {
            const goal = t.goalId ? goals.find(g => g.id === t.goalId) : null;
            return (
              <div key={t.id} className="flex items-center gap-[10px] py-[4px] group">
                <TodayCheckbox checked={t.done} onToggle={() => actions.toggleTask(t.id)}
                  ariaLabel={`Mark "${t.title}" done`} />
                <span className="flex-1 text-[.88rem] text-ink-soft">{t.title}</span>
                <span className="text-[.72rem] text-muted tabular-nums">{fmtD(t.date)}</span>
                {goal && <Tag label={goal.title} />}
                <button type="button" onClick={() => actions.moveTaskToDate(t.id, today)}
                  className="text-[.76rem] text-ink-soft px-[7px] py-[2px] rounded-[5px] border border-line-2 hover:bg-hover">
                  → today
                </button>
                <button type="button" onClick={() => actions.removeTask(t.id)}
                  aria-label={`Remove task "${t.title}"`}
                  className="text-faint text-[.8rem] hover:text-[#b4453a] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
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
        <div className="flex flex-col gap-[18px] min-w-0">
          {/* GoalsCard (Task 10) and MiniCalendar (Task 11) mount here */}
        </div>
      </div>

      {/* FooterStats mounts here in Task 12 */}
    </div>
  );
}
