import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Goal } from '../../db/types';
import { useAppStore } from '../../state/store';
import { WeekGrid } from '../plan/WeekGrid';
import { DayBlocks } from '../plan/DayBlocks';
import { WeekHeader } from '../plan/WeekHeader';
import { aimMinuteFor, type PlanDragData } from '../plan/dropTarget';
import { scheduledByDate, type ScheduledItem } from '../../lib/scheduled';
import { weekCapacity } from '../../lib/capacity';
import { plannedLeaves, walkLeaves, weekOf } from '../../lib/plan';
import { tasksForWeek } from '../../lib/dailyWork';
import { isPlaced } from '../../lib/blocks';
import { initialScrollWindow } from '../../lib/grid';
import { addDays, todayStr, weekDates } from '../../lib/dates';
import { isDone } from '../../lib/status';
import { fmtMinutes } from '../../lib/effort';
import { formatEstimateValue } from '../../lib/estimateInput';
import { sectionLabel } from '../../components/sectionLabel';

/**
 * This goal's week.
 *
 * It waited for `WorkBlock`. A calendar built while a task could hold one
 * placement would have had to be rebuilt the moment it could hold several, and
 * two calendars rendering the same week from two code paths is how they start
 * disagreeing about a Tuesday.
 *
 * Everything spatial is the SAME code Plan uses — `WeekGrid` for the chrome,
 * `DayBlocks` for the bars, `aimMinuteFor` for the drop. What differs is one
 * thing: the goal's own sittings are drawn at full contrast and every other
 * goal's are dimmed. They are still drawn, because a plan that hides the rest
 * of your week is not a plan, it is a wish — and capacity is computed from the
 * WHOLE dataset for the same reason. A goal-scoped free figure would be a lie
 * the size of everything else you committed to.
 */
export function CalendarTab({ goal }: { goal: Goal }) {
  const { goals, tasks, availability, allDayBlocks, actions } = useAppStore();
  const today = todayStr();
  const [weekStart, setWeekStart] = useState(() => weekOf(today));
  const [dragTitle, setDragTitle] = useState<string | null>(null);
  const [dragDuration, setDragDuration] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => weekDates(weekStart), [weekStart]);
  const scheduled = useMemo(() => scheduledByDate(goals, tasks, days), [goals, tasks, days]);

  // The whole dataset, not this goal's slice: free time is free time.
  const capacity = useMemo(() => weekCapacity({
    week: weekStart,
    windows: availability,
    blocks: [],
    leaves: plannedLeaves(goals, weekStart),
    tasks: tasksForWeek(tasks, weekStart),
    now: { date: today, minute: 0 },
    allDayBlocks,
    hasData: false,
  }), [goals, tasks, weekStart, availability, allDayBlocks, today]);

  /** This goal's open work with nothing on the calendar — the tab's own rail. */
  const unplaced = useMemo(() => {
    const out: { id: string; title: string; estimateMin?: number }[] = [];
    walkLeaves(goal, (n) => {
      if (isDone(n) || isPlaced(n)) return;
      out.push({ id: n.id, title: n.title, estimateMin: n.estimateMin });
    });
    return out;
  }, [goal]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    setDragTitle(null);
    setDragDuration(null);
    const data = e.active.data.current as PlanDragData | undefined;
    const overId = typeof e.over?.id === 'string' ? e.over.id : null;
    if (!data || !overId?.startsWith('day:')) return;
    const date = overId.slice('day:'.length);

    const scroller = scrollerRef.current;
    const translated = e.active.rect.current.translated;
    if (!scroller || !translated) return;
    const scrollerRect = scroller.getBoundingClientRect();
    // Same guard as Plan: a day column's rect is not clipped by the scroller's
    // overflow, so a release well above or below the grid still reports `over`.
    if (translated.top < scrollerRect.top || translated.top > scrollerRect.bottom) return;

    const aim = aimMinuteFor({
      draggedTopViewport: translated.top,
      scrollerTopViewport: scrollerRect.top,
      scrollTop: scroller.scrollTop,
      gridOffsetPx: gridRef.current?.offsetTop ?? 0,
    });
    if (data.kind === 'task') actions.scheduleTask(data.id, date, aim, { blockId: data.blockId });
    else if (data.goalId) actions.scheduleNode(data.goalId, data.id, date, aim, { blockId: data.blockId });
  }

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as PlanDragData | undefined;
    setDragTitle(data?.title ?? null);
    setDragDuration(data?.durationMin ?? null);
  }

  /** Everything not belonging to this goal, drawn subdued. */
  const dim = (items: ScheduledItem[]): ScheduledItem[] =>
    items.map((i) => (i.goalId === goal.id ? i : { ...i, done: true }));

  return (
    <section>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          const hits = pointerWithin(args);
          return hits.length > 0 ? hits : rectIntersection(args);
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => { setDragTitle(null); setDragDuration(null); }}
      >
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-[16px]">
          <aside className="min-w-0">
            <h3 className={`mb-[6px] ${sectionLabel}`}>To place</h3>
            {unplaced.length === 0 ? (
              <p className="text-meta text-faint">Everything in this goal has a time.</p>
            ) : (
              <ul className="flex flex-col gap-[2px]">
                {unplaced.map((item) => (
                  <li key={item.id}>
                    <div className="flex items-center gap-[6px] px-[6px] py-[5px] rounded-field hover:bg-hover group">
                      <span className="flex-1 min-w-0 truncate text-ui text-ink-soft">{item.title}</span>
                      {item.estimateMin !== undefined && (
                        <span className="flex-none text-meta text-muted tabular-nums">
                          {formatEstimateValue(item.estimateMin)}
                        </span>
                      )}
                      {/* Buttons, not a drag handle. Dragging out of a list into
                          a grid is Plan's gesture and Plan does it properly;
                          duplicating the pointer maths for a secondary surface
                          is how two calendars start disagreeing. */}
                      <button
                        type="button"
                        onClick={() => actions.scheduleNode(goal.id, item.id, today, 0)}
                        aria-label={`Schedule "${item.title}" today`}
                        className="quiet-control flex-none text-meta font-semibold text-accent-deep px-[5px] rounded-[4px] hover:bg-accent-tint"
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        onClick={() => actions.scheduleNode(goal.id, item.id, addDays(today, 1), 0)}
                        aria-label={`Schedule "${item.title}" tomorrow`}
                        className="quiet-control flex-none text-meta text-muted px-[5px] rounded-[4px] hover:bg-hover hover:text-ink"
                      >
                        Tmw
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <div className="min-w-0">
            <WeekHeader
              weekStart={weekStart}
              today={today}
              isPast={false}
              capacity={capacity}
              onPrev={() => setWeekStart(addDays(weekStart, -7))}
              onNext={() => setWeekStart(addDays(weekStart, 7))}
              onToday={() => setWeekStart(weekOf(today))}
            />
            <WeekGrid
              days={days}
              today={today}
              nowMinute={null}
              windows={availability}
              scrollWindow={initialScrollWindow(days, availability)}
              dayCapacity={capacity.days}
              dragDurationMin={dragDuration}
              scrollerRef={scrollerRef}
              gridRef={gridRef}
            >
              {(date) => (
                <DayBlocks
                  date={date}
                  items={dim(scheduled.get(date) ?? [])}
                  blocks={[]}
                  allDayBlocks={allDayBlocks}
                  onRemove={(kind, id, goalId, blockId) => {
                    if (kind === 'task') actions.unscheduleTask(id, blockId);
                    else if (goalId) actions.unscheduleNode(goalId, id, blockId);
                  }}
                  onComplete={(kind, id) => {
                    if (kind === 'task') actions.toggleTask(id);
                    else actions.toggleLeaf(id);
                  }}
                  onResize={(kind, id, blockId, minutes) => {
                    if (kind === 'task') actions.resizeTask(id, blockId, minutes);
                    else actions.resizeNode(id, blockId, minutes);
                  }}
                />
              )}
            </WeekGrid>
          </div>
        </div>

        <DragOverlay>
          {dragTitle ? (
            <div className="px-[8px] py-[4px] rounded-[6px] bg-panel border border-line-2 text-ui text-ink-soft shadow-card">
              {dragTitle}
              {dragDuration !== null && (
                <span className="text-muted"> · {fmtMinutes(dragDuration)}</span>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
