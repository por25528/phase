import { useState, useEffect, useRef, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useAppStore, actions } from '../state/store';
import { todayStr, addDays, weekDates } from '../lib/dates';
import { weekOf, plannedLeaves } from '../lib/plan';
import { visibleRange, type LaneSpan } from '../lib/grid';
import { scheduledByDate } from '../lib/scheduled';
import { weekCapacity, type Now } from '../lib/capacity';
import { unestimatedCommitments } from '../lib/unestimated';
import { tasksForWeek } from '../lib/dailyWork';
import { resolvePlanKey } from '../lib/planKeyboard';
import { showPlanHint } from '../lib/planHint';
import { revealDomId, weekForReveal, REVEAL_MS } from '../lib/reveal';
import { useReducedMotion } from '../components/useReducedMotion';
import { WeekGrid, GRID_HEIGHT_PX } from './plan/WeekGrid';
import { DayBlocks } from './plan/DayBlocks';
import { WeekHeader } from './plan/WeekHeader';
import { UnestimatedPanel } from './plan/UnestimatedPanel';
import { PlanSidebar, SidebarSection } from './plan/PlanSidebar';
import { RecapPanel } from './plan/RecapPanel';
import { AvailabilitySettings } from './plan/AvailabilitySettings';
import { Backlog } from './plan/sidebar/Backlog';
import { Habits } from './plan/sidebar/Habits';
import { Stats } from './plan/sidebar/Stats';
import { aimMinuteInRange, type PlanDragData } from './plan/dropTarget';
import type { BacklogItem } from '../lib/backlog';

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
 * The week the user was last looking at, remembered across unmounts.
 *
 * `App` renders the three views conditionally, so switching to Projects
 * UNMOUNTS Plan and `useState(() => weekOf(today))` runs again on the way back.
 * Planning next week, stepping over to check a project, and returning put you
 * silently back on this week with no indication the view had moved. Module
 * scope rather than store state because this is genuinely ephemeral: it is not
 * data, it should not persist to disk, and a fresh launch opening on the
 * current week is the right default.
 */
let lastViewedWeek: string | null = null;

/**
 * The week calendar. Owns which week is shown; everything else is derived.
 */
export function Plan() {
  const { goals, tasks, habits, hydration, availability, allDayBlocks, sidebarPanels, revealItem } = useAppStore();
  const today = todayStr();
  const reducedMotion = useReducedMotion();
  const habitsDone = habits.filter((h) => h.checkins.includes(today)).length;
  const [weekStart, setWeekStart] = useState(() => lastViewedWeek ?? weekOf(today));
  useEffect(() => {
    lastViewedWeek = weekStart;
  }, [weekStart]);
  /*
   * Everything derived from the week's data is memoised on the data, NOT
   * recomputed per render — because the now-line ticks every 60 seconds and
   * re-renders this whole subtree for a single CSS `top`. Before this, each of
   * those ticks re-walked every goal's leaf tree fourteen times: seven for
   * `scheduledSpans` here, and seven more inside the `DayBlocks` children,
   * which each called `scheduledOn` again for their own day. `scheduledByDate`
   * makes it one pass, and the memo makes it one pass per edit rather than per
   * render.
   *
   * `days` is memoised for a second reason: `weekDates` returns a fresh array
   * every call, and two effects downstream key off its identity.
   */
  const days = useMemo(() => weekDates(weekStart), [weekStart]);
  const scheduledByDay = useMemo(
    () => scheduledByDate(goals, tasks, days),
    [goals, tasks, days],
  );
  const scheduledSpans: LaneSpan[] = useMemo(
    () => [...scheduledByDay.values()].flat(),
    [scheduledByDay],
  );
  const range = useMemo(
    () => visibleRange(days, availability, [], scheduledSpans),
    [days, availability, scheduledSpans],
  );
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
  // The two commitment scans are memoised on the data; `weekCapacity` itself
  // genuinely depends on the minute (today's free time shrinks as the day goes
  // on) and is seven days of arithmetic, so it is left to recompute.
  const weekLeaves = useMemo(() => plannedLeaves(goals, weekStart), [goals, weekStart]);
  const weekTasks = useMemo(() => tasksForWeek(tasks, weekStart), [tasks, weekStart]);
  // Memoised for the same reason as everything above it: this is another walk
  // of every goal's leaf tree, and it was being redone on every render — the
  // 60-second now-line tick included — two hundred lines below the note
  // claiming those scans had been eliminated.
  const planHint = useMemo(
    () => showPlanHint(goals, tasks, availability.length > 0),
    [goals, tasks, availability],
  );
  const capacity = weekCapacity({
    week: weekStart,
    windows: availability,
    blocks: [],
    leaves: weekLeaves,
    tasks: weekTasks,
    now,
    allDayBlocks,
    hasData: false, // slice 2 flips this when a calendar is connected
  });

  /**
   * Reveal a task/habit chosen in the command palette.
   *
   * Keyed on the nonce alone, deliberately. Depending on `tasks` would re-run
   * the week jump on every task edit for as long as the highlight is up, so
   * dragging the just-revealed task onto a different week would immediately
   * yank the view back to where it came from. The task list is read through a
   * ref for the same reason: it's an input to a one-shot decision, not a
   * trigger.
   *
   * Opening whatever hides the row is NOT done here — the backlog derives its
   * expansion from `revealItem` (see Backlog) and the habits panel is opened by
   * the store action. Both are therefore already correct in the commit this
   * effect's rAF observes, so there is one paint to wait for rather than a
   * chain of them.
   */
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const revealRef = useRef(revealItem);
  revealRef.current = revealItem;
  const revealNonce = revealItem?.nonce ?? null;
  useEffect(() => {
    if (!revealItem) return;
    setWeekStart((current) => weekForReveal(revealItem, tasksRef.current, current));
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(revealDomId(revealItem.kind, revealItem.id))
        ?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    const timer = setTimeout(() => actions.clearReveal(), REVEAL_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      /*
       * Retire the reveal if this view is going away while one is still armed.
       *
       * `App` renders the views conditionally, so switching to Projects inside
       * the 2.6s window unmounted Plan and cancelled the only timer that ever
       * calls `clearReveal` — leaving `revealItem` set in the store forever.
       * That permanently force-expanded the revealed row's capped backlog group,
       * and coming back to Plan re-ran this effect on the same nonce: the week
       * jumped and the row was re-highlighted, minutes later, unprompted.
       *
       * The nonce comparison distinguishes the two reasons this cleanup runs.
       * On a NEW reveal, React has already re-rendered (so `revealRef.current`
       * holds the new target) before cleanup — nonces differ, and the incoming
       * reveal is left alone. On unmount there is no such render, the nonces
       * match, and it is retired.
       */
      if (revealRef.current?.nonce === revealItem.nonce) actions.clearReveal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shot per reveal; see above
  }, [revealNonce]);

  const [dragTitle, setDragTitle] = useState<string | null>(null);
  const [focusedItem, setFocusedItem] = useState<BacklogItem | null>(null);
  const [showUnestimated, setShowUnestimated] = useState(false);
  /*
   * The items behind the header's count. Derived from the SAME week sets
   * `weekCapacity` was handed, so the list and the number cannot disagree —
   * see unestimated.ts, which asserts that against `workloadOf` directly.
   */
  const goalTitleById = useMemo(
    () => new Map(goals.map((g) => [g.id, g.title])),
    [goals],
  );
  const unestimatedItems = useMemo(
    () => unestimatedCommitments(weekLeaves, weekTasks, goalTitleById),
    [weekLeaves, weekTasks, goalTitleById],
  );
  /*
   * Retire the panel once its work is done.
   *
   * The flag alone would survive the list emptying, so pricing everything hid
   * the panel (it renders only when there are items) while leaving it armed —
   * and the next unestimated step to appear, or a step over on next week, would
   * pop it open again unprompted. A panel the user never asked for reopening
   * itself reads as a bug, so the flag retires with the last row.
   */
  useEffect(() => {
    if (unestimatedItems.length === 0) setShowUnestimated(false);
  }, [unestimatedItems.length]);
  // Scoped to the rail so the placement handler can focus the successor row
  // without querying the whole document.
  const railRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Keyboard placement. The aim is the start of the visible range, so the
  // store snaps to that day's earliest fitting gap — the same semantic the
  // data migration uses. Refusals surface the store's own toast.
  //
  // Registered on the capture phase: App.tsx's own `keydown` listener is also
  // on `window`, and `stopPropagation` on a bubble-phase listener would not
  // stop a sibling bubble-phase listener on the same node — it only stops
  // propagation to other nodes. A capture-phase listener on `window` always
  // runs before any bubble-phase listener on `window`, regardless of mount
  // order, so calling `stopPropagation` here reliably keeps App's handler
  // from ever seeing a key this view has consumed.
  //
  // Depends on `weekStart` rather than `days`: `weekDates(weekStart)` builds
  // a new array every render, so depending on `days` would tear down and
  // re-register this listener on every render instead of only when the week
  // actually changes. The target date is derived from `weekStart` inside the
  // handler instead.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const command = resolvePlanKey(e);
      if (!command) return;

      if (command.kind === 'week') {
        e.preventDefault();
        e.stopPropagation();
        setWeekStart((current) => addDays(current, command.delta * 7));
        return;
      }
      if (command.kind === 'today') {
        e.preventDefault();
        e.stopPropagation();
        setWeekStart(weekOf(todayStr()));
        return;
      }
      // command.kind === 'place'
      if (!focusedItem) return; // nothing selected — let the digit fall through (e.g. view switching)
      e.preventDefault();
      e.stopPropagation();
      // The grid refuses drops on a past week via disabled droppables, but this
      // path never asked. Pressing `3` on last week ran the placement anyway and
      // answered with "no free time left that day" — a refusal about capacity,
      // for something that is actually about the week being history.
      if (isPast) {
        actions.showToast('That week has already happened — it’s read-only.');
        return;
      }
      const date = weekDates(weekStart)[command.dow];
      const placed = focusedItem.kind === 'task'
        ? actions.scheduleTask(focusedItem.id, date, range.startMin)
        : focusedItem.goalId
          ? actions.scheduleNode(focusedItem.goalId, focusedItem.id, date, range.startMin)
          : false;

      /*
       * Keep the keyboard in the rail.
       *
       * A placed item leaves the backlog immediately, so its row unmounts and
       * focus fell to `document.body` — after every single placement. Planning
       * twelve items meant tabbing in from the top of the page twelve times,
       * which is the whole reason to have `1`-`7` in the first place. The next
       * row has by then slid into the vacated slot, so that is where focus
       * belongs; the rAF waits for the commit that removes the old row.
       */
      if (!placed) return;
      const rail = railRef.current;
      const index = rail
        ? Array.from(rail.querySelectorAll<HTMLElement>('[data-backlog-row]'))
          .findIndex((el) => el.id === revealDomId(focusedItem.kind, focusedItem.id))
        : -1;
      requestAnimationFrame(() => {
        const rows = rail?.querySelectorAll<HTMLElement>('[data-backlog-row]');
        if (!rows || rows.length === 0) return;
        (rows[Math.min(Math.max(index, 0), rows.length - 1)]).focus();
      });
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusedItem, weekStart, range.startMin, isPast]);

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
    // from the DOM here would apply any scroll offset a second time and drift
    // the aim by roughly a minute per pixel scrolled mid-drag. Do not "fix"
    // this by swapping in a live rect. (Auto-scroll is disabled on the
    // DndContext below for the mirror-image reason.)
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
    const aim = aimMinuteInRange(draggedTop, rect.top, rect.height, range);

    if (data.kind === 'task') actions.scheduleTask(data.id, date, aim);
    else if (data.goalId) actions.scheduleNode(data.goalId, data.id, date, aim);
  }

  if (hydration !== 'ready') {
    return <div className="text-muted text-body py-[40px]">Loading…</div>;
  }

  return (
    <DndContext
      sensors={sensors}
      // Auto-scroll OFF, and it must stay off. `handleDragEnd` pairs
      // `e.over.rect` (measured at drag start) with `e.delta` (scroll-adjusted
      // over the DRAGGABLE's scrollable ancestors). The backlog rail is now a
      // scroller, so an auto-scroll of the rail mid-drag adds its offset to
      // `delta.y` while the day column's start-of-drag `rect.top` stays put —
      // the aim minute drifts by that many pixels' worth of grid and the block
      // lands away from its ghost. Nothing here needs auto-scroll: the grid is
      // a fixed GRID_HEIGHT_PX and the sidebar is bounded to it, so there is
      // no scrolling a drag has to do. Re-enabling this means re-deriving the
      // aim arithmetic against a live rect first. That replacement arithmetic
      // already exists as `aimMinuteFor` in `plan/dropTarget.ts` — it is not
      // wired in here yet because this grid isn't a real scroller yet; Task 7
      // switches this call site over and re-enables auto-scroll together.
      autoScroll={false}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <RecapPanel />

      <div className="grid grid-cols-1 md:grid-cols-[272px_1fr] gap-[18px] md:gap-0">
        <PlanSidebar railRef={railRef}>
          <Backlog weekStart={weekStart} today={today} onFocusItem={setFocusedItem} reveal={revealItem} />
          <SidebarSection panel="habits" title="Habits" count={`${habitsDone}/${habits.length} today`}>
            <Habits reveal={revealItem} />
          </SidebarSection>
          <SidebarSection panel="stats" title="This week">
            <Stats />
          </SidebarSection>
          <SidebarSection panel="availability" title="Working hours">
            <AvailabilitySettings />
          </SidebarSection>
        </PlanSidebar>

        <div className="min-w-0 md:pl-[18px]">
          <WeekHeader
            weekStart={weekStart}
            isPast={isPast}
            capacity={capacity}
            onPrev={() => setWeekStart(addDays(weekStart, -7))}
            onNext={() => setWeekStart(addDays(weekStart, 7))}
            onToday={() => setWeekStart(weekOf(today))}
            unestimatedOpen={showUnestimated}
            onToggleUnestimated={() => setShowUnestimated((was) => !was)}
          />

          {/* Opened from the header's count. Closes itself once nothing is
              left unestimated, so the panel and the number it explains retire
              together — a list that stays up empty reads as a failed action. */}
          {showUnestimated && unestimatedItems.length > 0 && (
            <UnestimatedPanel
              items={unestimatedItems}
              onClose={() => setShowUnestimated(false)}
            />
          )}

          {availability.length === 0 && (
            <div className="mb-[10px] px-[10px] py-[8px] rounded-field border border-line-2 bg-panel text-body text-ink-soft">
              No working hours set — every day is off, so nothing can be scheduled.{' '}
              <button
                type="button"
                // Expands the sidebar's "Working hours" panel rather than
                // navigating: the editor is already on this page, beside the
                // banner. Guarded against re-adding an already-open panel so a
                // second click can't duplicate the entry.
                onClick={() => {
                  if (sidebarPanels.includes('availability')) return;
                  actions.setSidebarPanels([...sidebarPanels, 'availability']);
                }}
                className="font-semibold text-accent hover:text-accent-deep"
              >
                Set your availability
              </button>
            </div>
          )}

          {/*
            First-run hint. Both routes onto the grid are invisible affordances
            — the rail rows carry no grip glyph, and `1`-`7` is announced
            nowhere — so a new user can sit in front of a full backlog and an
            empty week with no idea the two are connected.

            No dismiss control and no persisted flag: `showPlanHint` retires it
            the moment anything is placed, which is the exact moment the lesson
            has landed. A ✕ here would only let someone dismiss the answer to
            the question they still have.
          */}
          {planHint && (
            <div className="mb-[10px] px-[10px] py-[8px] rounded-field border border-dashed border-line-2 bg-panel text-body text-ink-soft">
              Drag anything from <span className="font-semibold text-ink">To plan</span> onto a day
              to schedule it — or click a row and press{' '}
              <kbd className="font-mono text-kbd border border-line-2 rounded-[4px] px-[4px] py-[1px] text-muted">1</kbd>
              –
              <kbd className="font-mono text-kbd border border-line-2 rounded-[4px] px-[4px] py-[1px] text-muted">7</kbd>{' '}
              for Mon–Sun.
            </div>
          )}

          <WeekGrid
            days={days}
            today={today}
            nowMinute={nowMinute}
            windows={availability}
            range={range}
            readOnly={isPast}
            dayCapacity={capacity.days}
          >
            {(date) => (
              <DayBlocks
                date={date}
                items={scheduledByDay.get(date) ?? []}
                blocks={[]}
                range={range}
                allDayBlocks={allDayBlocks}
                readOnly={isPast}
                gridHeightPx={GRID_HEIGHT_PX}
                reveal={revealItem}
                onRemove={(kind, id, goalId) => {
                  if (kind === 'task') actions.unscheduleTask(id);
                  else if (goalId) actions.unscheduleNode(goalId, id);
                }}
                // Fires on past weeks too: `readOnly` above stops history being
                // rescheduled, not recorded. See DayBlocks' `readOnly` note.
                onComplete={(kind, id) => {
                  if (kind === 'task') actions.toggleTask(id);
                  else actions.toggleLeaf(id);
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
          <div className="px-[9px] py-[6px] rounded-field bg-panel border border-accent shadow-today text-ui text-ink cursor-grabbing max-w-[220px] truncate">
            {dragTitle}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
