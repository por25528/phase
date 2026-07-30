import { useState, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDraggable,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useAppStore, actions } from '../state/store';
import { todayStr, addDays, weekDates } from '../lib/dates';
import { weekOf, attentionRank, unplannedOpenLeaves, plannedLeaves } from '../lib/plan';
import { visibleRange, type LaneSpan } from '../lib/grid';
import { spansOn } from '../lib/scheduled';
import { weekCapacity, type Now } from '../lib/capacity';
import { tasksForWeek } from '../lib/dailyWork';
import { WeekGrid, GRID_HEIGHT_PX } from './plan/WeekGrid';
import { DayBlocks } from './plan/DayBlocks';
import { WeekHeader } from './plan/WeekHeader';
import { PlanSidebar } from './plan/PlanSidebar';
import { aimMinuteFor, type PlanDragData } from './plan/dropTarget';

/**
 * Resolve the drop target against the pointer when there is one, falling
 * back to rect intersection when there isn't.
 *
 * `pointerWithin` returns `[]` whenever `pointerCoordinates` is null — and
 * that's exactly what happens under `KeyboardSensor`: the activator is a
 * `KeyboardEvent`, `getEventCoordinates` has no `clientX`/`clientY` to read
 * from it, and the resulting null propagates all the way to `over`. A bare
 * `pointerWithin` therefore makes `handleDragEnd`'s `if (!data || !e.over...)`
 * guard bail on every keyboard-driven drag, silently turning keyboard
 * dragging inert. `rectIntersection` doesn't need pointer coordinates — it
 * compares the dragging node's own (translated) rect against droppable
 * rects — so it resolves correctly for the keyboard case, where arrow keys
 * move the dragging node itself rather than a pointer. Pointer-based drags
 * still resolve via the precise pointer basis first; this is dnd-kit's own
 * documented composite pattern for mixing sensor types under one
 * `collisionDetection`. Defined at module scope: it's pure, and passing an
 * inline arrow to `DndContext` would hand it a new function identity every
 * render. Do not simplify this back to bare `pointerWithin` — that
 * regresses keyboard drops.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);
};

/**
 * The week calendar. Owns which week is shown; everything else is derived.
 *
 * The backlog list below is SCAFFOLDING — plan 2 replaces it with the sidebar
 * accordion. It exists so there is something to drag from.
 */
export function Plan() {
  const { goals, tasks, hydration, availability, allDayBlocks } = useAppStore();
  const today = todayStr();
  const [weekStart, setWeekStart] = useState(() => weekOf(today));
  const days = weekDates(weekStart);
  const scheduledSpans: LaneSpan[] = days.flatMap((date) => spansOn(goals, tasks, date));
  const range = visibleRange(days, availability, [], scheduledSpans);
  const isPast = weekStart < weekOf(today);

  // Re-render each minute so the now-line moves.
  const [nowMinute, setNowMinute] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinute(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const now: Now = { date: today, minute: nowMinute };
  const capacity = weekCapacity({
    week: weekStart,
    windows: availability,
    blocks: [],
    leaves: plannedLeaves(goals, weekStart),
    tasks: tasksForWeek(tasks, weekStart),
    now,
    allDayBlocks,
    hasData: false, // slice 2 flips this when a calendar is connected
  });

  const [dragTitle, setDragTitle] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(e: DragStartEvent) {
    setDragTitle((e.active.data.current as PlanDragData | undefined)?.title ?? null);
  }

  function handleDragCancel() {
    setDragTitle(null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragTitle(null);
    const data = e.active.data.current as PlanDragData | undefined;
    const overId = typeof e.over?.id === 'string' ? e.over.id : null;
    if (!data || !e.over || !overId?.startsWith('day:')) return;
    const date = overId.slice('day:'.length);

    // e.over.rect is measured at drag START, and dnd-kit's e.delta is already
    // scroll-adjusted (translate + any scroll since drag start) to pair with
    // that same start-of-drag measurement. Re-reading the column's rect live
    // from the DOM here would apply the scroll offset a second time — auto-scroll
    // is on by default, so that drifts the aim by roughly a minute per pixel
    // scrolled mid-drag. Do not "fix" this by swapping in a live rect.
    const rect = e.over.rect;

    // The top edge of the thing being dragged — not the pointer — is the aim
    // basis, so a block grabbed by its middle still lands where its ghost is
    // shown, not offset by half its own height. This basis is well-defined
    // for both sensors: `active.rect.current.initial` is measured at drag
    // start, exactly like `e.over.rect`, and `e.delta` is dnd-kit's
    // scroll-adjusted translate, which `KeyboardSensor` populates via its
    // coordinate getter just as `PointerSensor` does via pointer movement.
    // Neither reads `clientY`/pointer coordinates, so there is no keyboard
    // special case here — that's handled instead by falling back to
    // `rectIntersection` in `collisionDetection` above.
    const initialTop = e.active.rect.current.initial?.top ?? rect.top;
    const draggedTop = initialTop + e.delta.y;
    const aim = aimMinuteFor(draggedTop, rect.top, rect.height, range);

    if (data.kind === 'task') actions.scheduleTask(data.id, date, aim);
    else if (data.goalId) actions.scheduleNode(data.goalId, data.id, date, aim);
  }

  if (hydration !== 'ready') {
    return <div className="text-muted text-[.85rem] py-[40px]">Loading…</div>;
  }

  const backlog = attentionRank(goals, today)
    .map((goal) => ({ goal, leaves: unplannedOpenLeaves(goal, weekStart) }))
    .filter((g) => g.leaves.length > 0);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="grid grid-cols-1 md:grid-cols-[272px_1fr] gap-[18px] md:gap-0">
        <PlanSidebar>
          <h3 className="font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold mb-[8px]">
            To plan
          </h3>
          {backlog.length === 0 ? (
            <div className="text-faint text-[.82rem] italic">Nothing left to plan.</div>
          ) : (
            backlog.map(({ goal, leaves }) => (
              <div key={goal.id} className="mb-[10px]">
                <div className="font-disp text-[.86rem] font-semibold truncate">{goal.title}</div>
                {leaves.map((leaf) => (
                  <BacklogRow key={leaf.id} goalId={goal.id} nodeId={leaf.id} title={leaf.title} />
                ))}
              </div>
            ))
          )}
        </PlanSidebar>

        <div className="min-w-0 md:pl-[18px]">
          <WeekHeader
            weekStart={weekStart}
            isPast={isPast}
            capacity={capacity}
            onPrev={() => setWeekStart(addDays(weekStart, -7))}
            onNext={() => setWeekStart(addDays(weekStart, 7))}
            onToday={() => setWeekStart(weekOf(today))}
          />

          {availability.length === 0 && (
            <div className="mb-[10px] px-[10px] py-[8px] rounded-[9px] border border-line-2 bg-panel text-[.82rem] text-ink-soft">
              No working hours set — every day is off, so nothing can be scheduled.{' '}
              <button
                type="button"
                onClick={() => actions.openPlan()}
                className="font-semibold text-accent hover:text-accent-deep"
              >
                Set your availability
              </button>
            </div>
          )}

          <WeekGrid
            days={days}
            today={today}
            nowMinute={nowMinute}
            windows={availability}
            range={range}
            readOnly={isPast}
          >
            {(date) => (
              <DayBlocks
                date={date}
                goals={goals}
                tasks={tasks}
                blocks={[]}
                range={range}
                allDayBlocks={allDayBlocks}
                readOnly={isPast}
                gridHeightPx={GRID_HEIGHT_PX}
                onRemove={(kind, id, goalId) => {
                  if (kind === 'task') actions.unscheduleTask(id);
                  else if (goalId) actions.unscheduleNode(goalId, id);
                }}
                onResize={(kind, id, minutes) => {
                  if (kind === 'task') actions.resizeTask(id, minutes);
                  else actions.resizeNode(id, minutes);
                }}
              />
            )}
          </WeekGrid>
        </div>
      </div>

      <DragOverlay>
        {dragTitle != null ? (
          <div className="px-[9px] py-[6px] rounded-[9px] bg-panel border border-accent shadow-today text-[.8rem] text-ink cursor-grabbing max-w-[220px] truncate">
            {dragTitle}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** One backlog row — the drag source for a not-yet-planned step. */
function BacklogRow({ goalId, nodeId, title }: { goalId: string; nodeId: string; title: string }) {
  const drag: PlanDragData = { kind: 'step', id: nodeId, goalId, title };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `step:${nodeId}`,
    data: drag,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`text-[.78rem] text-ink-soft truncate px-[6px] py-[4px] rounded-[6px] border border-line-2 bg-panel mt-[3px] cursor-grab touch-none ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      {title}
    </div>
  );
}
