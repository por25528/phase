import { useState, useEffect, useRef, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useAppStore, actions, previewPlacement } from '../state/store';
import { todayStr, addDays, weekDates, fmtD } from '../lib/dates';
import { weekOf, plannedLeaves } from '../lib/plan';
import { initialScrollWindow } from '../lib/grid';
/*
 * Named for the Goals board it was written for; it is not board-specific, and
 * the calendar carried a byte-for-byte copy of it — plus a second copy of its
 * keyboard-sensor rationale — until they were merged. The one comment lives at
 * the definition. It is not renamed because `views/Goals.tsx` imports it too.
 */
import { boardCollision } from '../lib/boardCollision';

import { scheduledByDate, spansOn } from '../lib/scheduled';
import { aimFor, longestFreeGap, DEFAULT_SLOT_MIN, WHOLE_DAY, NO_PAST_LIMIT } from '../lib/slot';
import { weekCapacity, type Now } from '../lib/capacity';
import { coversWeek } from '../lib/calendarRange';
import { calendarHealth, calendarCaveat } from '../lib/calendarHealth';
import { unestimatedCommitments } from '../lib/unestimated';
import { tasksForWeek } from '../lib/dailyWork';
import { resolvePlanKey } from '../lib/planKeyboard';
import { showPlanHint } from '../lib/planHint';
import { revealDomId, weekForReveal, REVEAL_MS } from '../lib/reveal';
import { useReducedMotion } from '../components/useReducedMotion';
import { WeekGrid } from './plan/WeekGrid';
import { DayBlocks } from './plan/DayBlocks';
import { BlockComposer } from './plan/BlockComposer';
import { BlockGhost } from './plan/BlockGhost';
import { LandingOutline } from './plan/LandingOutline';
import { MonthGrid } from './plan/MonthGrid';
import { monthCapacity } from './plan/monthCapacity';
import { ymOfWeek, weekShowingMonth, shiftYm, monthGrid } from '../lib/calendar';
import type { CanvasSpan } from '../lib/canvasCreate';
import { WeekHeader } from './plan/WeekHeader';
import { UnestimatedPanel } from './plan/UnestimatedPanel';
import { PlanSidebar, SidebarSection } from './plan/PlanSidebar';
import { RecapPanel } from './plan/RecapPanel';
import { PlanNotice } from './plan/PlanNotice';
import { PlanSkeleton } from './plan/PlanSkeleton';
import { useCalendarRefresh } from './plan/useCalendarRefresh';
import { Backlog } from './plan/sidebar/Backlog';
import { Habits } from './plan/sidebar/Habits';
import { aimFromDrag, type PlanDragData } from './plan/dropTarget';
import { makePreviewCache } from './plan/previewCache';
import type { BacklogItem } from '../lib/backlog';

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
/**
 * The wall clock, read fresh.
 *
 * `nowMinute` below is the RENDER's copy of the same reading, and it is what
 * the now-line and the capacity figures are drawn from. An aim resolved inside
 * the long-lived keydown listener cannot use it: that effect re-subscribes on
 * `focusedItem`/`weekStart`, not on the minute, so its closure would hold
 * whatever the clock said when the row was last focused. `aimFor` only cares
 * about the clock on TODAY, where a stale minute is exactly the case that
 * matters.
 */
function liveNow(): Now {
  const d = new Date();
  return { date: todayStr(), minute: d.getHours() * 60 + d.getMinutes() };
}

export function Plan() {
  const {
    goals, tasks, habits, hydration, allDayBlocks, revealItem, planMode,
    busyBlocks, calendarRange, calendarFetchedAt, calendarStatus, calendarError,
  } = useAppStore();
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
   * those ticks re-walked every goal's leaf tree seven times over, once inside
   * each `DayBlocks` child, which each called `scheduledOn` again for their
   * own day. `scheduledByDate` makes it one pass, and the memo makes it one
   * pass per edit rather than per render.
   *
   * `days` is memoised for a second reason: `weekDates` returns a fresh array
   * every call, and two effects downstream key off its identity.
   */
  const days = useMemo(() => weekDates(weekStart), [weekStart]);
  /*
   * The month is DERIVED from the week cursor, not stored beside it. One
   * cursor means switching to month shows the month containing the week you
   * were on, and switching back shows the week you left — which is only true
   * because neither is recorded twice.
   */
  const ym = ymOfWeek(weekStart);
  /*
   * Month mode needs every day the grid draws, including the neighbouring
   * months' edge days. Deriving this from `days` alone renders an empty month
   * silently — the cells are there, the work simply is not.
   */
  const visibleDays = useMemo(
    () => (planMode === 'month' ? monthGrid(ym).flat() : days),
    [planMode, ym, days],
  );
  const scheduledByDay = useMemo(
    () => scheduledByDate(goals, tasks, visibleDays),
    [goals, tasks, visibleDays],
  );
  const scrollWindow = useMemo(
    () => initialScrollWindow(days, (date) => spansOn(goals, tasks, date)),
    [days, goals, tasks],
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
  const planHint = useMemo(() => showPlanHint(goals, tasks), [goals, tasks]);
  /*
   * Whether the cached calendar actually reaches this week. It is not "is a
   * calendar connected" — a connected account whose fetched range stops eight
   * weeks out says nothing about week twelve, and claiming otherwise would
   * present an unknown week as a clear one.
   */
  const weekIsCovered = calendarRange !== null && coversWeek(calendarRange, weekStart);
  const capacity = weekCapacity({
    week: weekStart,
    blocks: busyBlocks,
    leaves: weekLeaves,
    tasks: weekTasks,
    now,
    allDayBlocks,
    hasData: weekIsCovered,
  });

  /*
   * Fetch triggers: the planner opening, navigation past the cached range, and
   * a focus onto a stale cache. Not a poll — see `useCalendarRefresh`.
   */
  useCalendarRefresh(weekStart, calendarRange, calendarFetchedAt);

  /*
   * What is wrong with the calendar, said as the thing to do about it. The
   * decision is a tested pure function; the header only renders the sentence.
   * `nowMs` is read from `nowMinute` rather than from `Date.now()` at memo
   * time so the staleness verdict actually re-evaluates on the now-line tick.
   */
  const caveat = useMemo(
    () => calendarCaveat(calendarHealth({
      status: calendarStatus,
      lastError: calendarError,
      coversWeek: weekIsCovered,
      fetchedAt: calendarFetchedAt,
      nowMs: Date.now(),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarStatus, calendarError, weekIsCovered, calendarFetchedAt, nowMinute],
  );

  /*
   * Month mode's figures. Memoised so this does not recompute on every
   * unrelated re-render — it is six `weekCapacity` calls plus six leaf-tree
   * walks. `nowMinute` IS in the dependency array, so it genuinely does
   * recompute on the 60-second now-line tick: today's remaining window really
   * does move as the minute changes, and that cost is the same order as the
   * un-memoised week `capacity` computed alongside it. The memo's job is
   * narrower than "never recompute" — it is "recompute only when the inputs
   * that matter change", and the minute is one of them.
   *
   * `now` itself is rebuilt every render (it closes over `nowMinute`), so it
   * cannot be a dependency; `today` and `nowMinute` are listed instead, which
   * is the same pair it is built from.
   */
  const monthCap = useMemo(
    () => (planMode === 'month'
      ? monthCapacity({
        ym, goals, tasks, blocks: busyBlocks,
        now: { date: today, minute: nowMinute }, allDayBlocks,
        // The month draws six week rows and the cache is one contiguous range,
        // so a month is covered only if the LAST row it draws is.
        hasData: calendarRange !== null && coversWeek(calendarRange, weekOf(monthGrid(ym).at(-1)!.at(-1)!)),
      })
      : null),
    [planMode, ym, goals, tasks, today, nowMinute, allDayBlocks, busyBlocks, calendarRange],
  );

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

  /*
   * What is currently in the air, and where it would land.
   *
   * `data` is live for the length of the drag so the day headings can answer
   * "does this fit" while the block is still moving rather than refusing it
   * after the drop. `landing` is the resolved slot `previewPlacement` returns
   * — the minute the WRITE will choose, not the minute the pointer is over —
   * and it feeds three things at once: the outline drawn in the target column,
   * the ghost's own time line, and nothing else. One record rather than three
   * `useState`s because they are one fact and must change together; a ghost
   * showing a time the outline had already moved off would be the same
   * disagreement this whole path exists to close.
   */
  const [drag, setDrag] = useState<{
    data: PlanDragData;
    landing: { date: string; startMin: number; durationMin: number } | null;
  } | null>(null);
  /*
   * The last answer `previewPlacement` gave, so the drag stops asking the same
   * question hundreds of times. Held in a ref rather than in `drag` because it
   * is not state — nothing renders from it, and a `setState` per pointermove is
   * the cost `handleDragMove`'s identity check already exists to avoid. See
   * `plan/previewCache.ts` for what the walk costs and what the memo saves.
   */
  /*
   * The longest unbooked run on each day, for the heading's `fits` / `full`
   * chip. Computed only while something is in the air — it is seven passes
   * over the week's placements, and at rest nothing reads it.
   *
   * `WHOLE_DAY`, not `ORDINARY_DAY`: this answers a question about a MANUAL
   * drop, and a manual drop lands wherever it is aimed. Measuring it against
   * the region the app aims at on its own would call a day full while 21:00
   * sat empty under the cursor.
   *
   * `NO_PAST_LIMIT` for the same reason every manual path passes it: dropping
   * onto this morning is allowed, so the elapsed part of today is not clipped
   * away before the gaps are measured.
   */
  const dayGapMin = useMemo(
    () => (drag
      ? days.map((date) => longestFreeGap(
        date, WHOLE_DAY, [], spansOn(goals, tasks, date), NO_PAST_LIMIT, allDayBlocks,
      ))
      : undefined),
    [drag, days, goals, tasks, allDayBlocks],
  );

  const previewCache = useRef(makePreviewCache());
  const [focusedItem, setFocusedItem] = useState<BacklogItem | null>(null);
  const [showUnestimated, setShowUnestimated] = useState(false);
  /*
   * The block being drawn: a gesture that has landed but not yet been named.
   * Ephemeral view state, like `lastViewedWeek` — never in the store.
   */
  const [draft, setDraft] = useState<{ date: string; span: CanvasSpan } | null>(null);
  /*
   * The day a month cell is composing on. Separate from `draft` because a
   * month cell carries no span — there is no time axis to draw one against, so
   * the hour is chosen by `resolveSlot` rather than by the gesture.
   */
  const [monthDraft, setMonthDraft] = useState<string | null>(null);

  /*
   * A draft is anchored to a date in the visible week; navigating away would
   * otherwise leave a composer mounted on a day that is no longer rendered.
   */
  useEffect(() => { setDraft(null); setMonthDraft(null); }, [weekStart]);

  /**
   * Commit a month cell's composer.
   *
   * Aims at the day's working start, exactly as the `1`–`7` keyboard placement
   * does; `createTaskAt` resolves that against the day's real gaps, so this
   * lands at the first free slot rather than on top of existing work. A month
   * click and a month drop therefore mean the same thing.
   *
   * `aimFor` rather than `windowForDate`, and no refusal: a day with no window
   * is no longer a day you cannot use, so there is nothing to refuse and the
   * only open question is which hour to point at.
   */
  function commitMonthDraft(title: string): void {
    const date = monthDraft;
    setMonthDraft(null);
    if (!date) return;
    actions.createTaskAt(title, date, aimFor(date, liveNow()), DEFAULT_SLOT_MIN);
  }

  /**
   * One step of the view's own unit — a week in week mode, a month in month
   * mode — moving the single `weekStart` cursor either way.
   *
   * `weekShowingMonth` and `ymOfWeek` are exact inverses (asserted over three
   * years in calendar.test.ts), which is what makes paging land on the month
   * asked for. Neither is `ymOf(weekStart)`/`weekOf(1st)`: a month starting
   * mid-week belongs to a Monday in the previous month, and paging with the
   * naive pair sticks — February 2026 never advances.
   */
  function shiftCursor(delta: number): void {
    if (planMode === 'month') {
      setWeekStart(weekShowingMonth(shiftYm(ym, delta)));
      return;
    }
    setWeekStart(addDays(weekStart, delta * 7));
  }
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
  // Owned here because `handleDragEnd` needs both live at drop time — see the
  // coordinate-space note in dropTarget.ts.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Keyboard placement. The aim is the day's working start, so the store
  // snaps to that day's earliest fitting gap — the same semantic the data
  // migration uses. Refusals surface the store's own toast.
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
      /*
       * The composer owns the keyboard while it is open.
       *
       * This listener is capture-phase on `window`, so it sees every key
       * before the field does and a `stopPropagation` inside the field cannot
       * hold it off. Without this bail, typing a digit into a title places a
       * backlog row on that weekday and an arrow key navigates the week out
       * from under the field.
       */
      if (draft) return;

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
      /*
       * Aim at the day's working start, not the grid's.
       *
       * This was `range.startMin`, which under the old stretching grid was
       * roughly 08:00. The grid now begins at 00:00, so the same expression
       * would aim every keyboard placement at midnight and let `resolveSlot`
       * walk forward from there — which is exactly what it would do again now
       * that nothing fences the search, so the aim is the only thing carrying
       * the intent. A day with no window aims at a sensible hour instead of
       * refusing: the column is droppable now, so a keypress that refused
       * where a drag succeeded would be the two gestures disagreeing.
       */
      const aim = aimFor(date, liveNow());
      const placed = focusedItem.kind === 'task'
        ? actions.scheduleTask(focusedItem.id, date, aim)
        : focusedItem.goalId
          ? actions.scheduleNode(focusedItem.goalId, focusedItem.id, date, aim)
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
  }, [focusedItem, weekStart, isPast, draft]);

  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as PlanDragData | undefined;
    // Never across drags: the world the last one was keyed on is the world the
    // drop it served has just written to.
    previewCache.current.clear();
    setDrag(data ? { data, landing: null } : null);
  }

  /*
   * The landing outline, resolved while the block is still in the air.
   *
   * This is the whole of "say where it will land before the release". It runs
   * the SAME search the drop will (`previewPlacement` → `resolvePlacement` →
   * `resolveSlot`), so the outline names the minute the write chooses even
   * when that is not the minute under the pointer — which is every drag over
   * a day with anything on it.
   *
   * Month mode is skipped deliberately: a month cell has no time axis, so
   * there is no slot to outline. `handleDragEnd` aims those drops at
   * `aimFor(date, ...)` and lets `resolveSlot` pick the hour, and the column
   * tint is the whole feedback there — as it was.
   */
  function handleDragMove(e: DragMoveEvent) {
    const data = e.active.data.current as PlanDragData | undefined;
    if (!data) return;
    const overId = typeof e.over?.id === 'string' ? e.over.id : null;
    if (!overId?.startsWith('day:') || planMode === 'month') {
      setDrag((was) => (was && was.landing ? { ...was, landing: null } : was));
      return;
    }
    const date = overId.slice('day:'.length);
    const aim = aimFromDrag({
      rect: e.active.rect.current.translated,
      scroller: scrollerRef.current,
      grid: gridRef.current,
    });
    /*
     * Memoised, because this is the heaviest thing on the drag path and the
     * answer almost never changes between two events. `previewPlacement` walks
     * every goal's leaves and every task through `spansOn` and then rebuilds
     * the day's free intervals; dnd-kit fires this handler on every pointermove
     * AND on every autoscroll frame, and `setDrag`'s identity check below saves
     * only the re-render, never the walk that produced the identical answer.
     *
     * The cache is keyed on the world (`goals`/`tasks`/`allDayBlocks`, by
     * identity, so a write from the agent socket mid-drag invalidates it) and
     * on the drag (`date`, the aim bucketed to the 5 minutes `resolveSlot`
     * snaps to anyway, and `blockId`). The RAW aim is still what gets passed —
     * the bucket decides whether to ask, not what the answer is.
     */
    const slot = aim === null
      ? null
      : previewCache.current.read(
        {
          goals,
          tasks,
          allDayBlocks,
          date,
          aimMin: aim,
          // Composite, so the key cannot collide across the three things that
          // pick out an item. One drag carries one of them, and the cache is
          // cleared between drags — but a key that only holds while something
          // else is true is a key the next reader has to re-derive.
          itemId: `${data.kind}:${data.goalId ?? ''}:${data.id}`,
          blockId: data.blockId,
        },
        () => previewPlacement(
          { kind: data.kind, id: data.id, goalId: data.goalId },
          date,
          aim,
          { blockId: data.blockId },
        ),
      );
    setDrag((was) => {
      if (!was) return was;
      const next = slot === null ? null : { date, ...slot };
      // Same slot, same object identity — a `setState` per pointermove that
      // changes nothing still re-renders the whole grid, and the grid is
      // seven columns of blocks.
      if (was.landing?.date === next?.date
        && was.landing?.startMin === next?.startMin
        && was.landing?.durationMin === next?.durationMin) return was;
      return { ...was, landing: next };
    });
  }

  function handleDragCancel() {
    previewCache.current.clear();
    setDrag(null);
  }

  function handleDragEnd(e: DragEndEvent) {
    previewCache.current.clear();
    setDrag(null);
    const data = e.active.data.current as PlanDragData | undefined;
    const overId = typeof e.over?.id === 'string' ? e.over.id : null;
    if (!data || !e.over || !overId?.startsWith('day:')) return;
    const date = overId.slice('day:'.length);

    /*
     * Month cells share the `day:` droppable id but have no time axis, so
     * everything below — which resolves an aim from the scroller's content
     * coordinates — does not apply. It would also fail silently: there is no
     * scroller in month mode, so `scrollerRef.current` is null and the guard
     * below swallows every drop with no error at all.
     *
     * Aim at the day's working start, the same aim the `1`–`7` keyboard
     * placement uses. `resolveSlot` walks forward from there, so a busy day
     * still takes the drop at its first free gap.
     */
    if (planMode === 'month') {
      const aim = aimFor(date, liveNow());
      if (data.kind === 'task') actions.scheduleTask(data.id, date, aim, { blockId: data.blockId });
      else if (data.goalId) actions.scheduleNode(data.goalId, data.id, date, aim, { blockId: data.blockId });
      return;
    }

    /*
     * The aim, from the same helper `handleDragMove` spends — which is the
     * point. The outline the user was watching and the write they just
     * committed have to be resolved from one reading of where the pointer is;
     * two copies of this arithmetic would drift by a few minutes and look like
     * rounding rather than a bug.
     *
     * `aimFromDrag` returns null for a release that is not actually over the
     * calendar. A day column is a grid item of a 1440px-tall grid inside a
     * 720px scroller and `getBoundingClientRect` is not clipped by an
     * ancestor's overflow, so `over` is set well above and below the visible
     * grid; the guard lives in that helper now, with the note explaining why.
     */
    const aim = aimFromDrag({
      rect: e.active.rect.current.translated,
      scroller: scrollerRef.current,
      grid: gridRef.current,
    });
    if (aim === null) return;

    /*
     * `blockId` is set only when an existing bar is being dragged, so the drop
     * MOVES that sitting. A row from the rail has none, and placing it replaces
     * whatever the task had — "put this here", not "and also here".
     */
    if (data.kind === 'task') actions.scheduleTask(data.id, date, aim, { blockId: data.blockId });
    else if (data.goalId) actions.scheduleNode(data.goalId, data.id, date, aim, { blockId: data.blockId });
  }

  if (hydration !== 'ready') return <PlanSkeleton />;

  return (
    <DndContext
      sensors={sensors}
      /*
       * On, and it needs to be: the grid is a full day tall, so dragging from
       * 09:00 to 18:00 requires the view to follow. The arithmetic this used to
       * be unsafe for is gone — `handleDragEnd` now resolves the aim in the
       * scroller's own content coordinates, which are invariant under scroll.
       * See dropTarget.ts.
       */
      autoScroll
      collisionDetection={boardCollision}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
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
        </PlanSidebar>

        <div className="min-w-0 md:pl-[18px]">
          <WeekHeader
            weekStart={weekStart}
            isPast={isPast}
            capacity={capacity}
            caveat={caveat}
            mode={planMode}
            onModeChange={actions.setPlanMode}
            onPrev={() => shiftCursor(-1)}
            onNext={() => shiftCursor(1)}
            onToday={() => setWeekStart(weekOf(today))}
            unestimatedOpen={showUnestimated}
            onToggleUnestimated={() => setShowUnestimated((was) => !was)}
            monthCapacity={monthCap?.total}
            monthSpanLabel={monthCap?.spanLabel}
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

          <PlanNotice showHint={planHint} />

          {planMode === 'month' && monthDraft && (
            <BlockComposer
              variant="bar"
              label={fmtD(monthDraft)}
              startMin={0}
              durationMin={DEFAULT_SLOT_MIN}
              onCommit={commitMonthDraft}
              onCancel={() => setMonthDraft(null)}
            />
          )}
          {planMode === 'month' ? (
            <MonthGrid
              ym={ym}
              today={today}
              itemsByDay={scheduledByDay}
              isPastDay={(date) => date < today}
              onCreate={setMonthDraft}
              onOpenDay={(date) => { actions.setPlanMode('week'); setWeekStart(weekOf(date)); }}
              capacity={monthCap ?? undefined}
              onOpenWeek={(week) => { actions.setPlanMode('week'); setWeekStart(week); }}
            />
          ) : (
          <WeekGrid
            days={days}
            today={today}
            nowMinute={nowMinute}
            scrollWindow={scrollWindow}
            readOnly={isPast}
            dayCapacity={capacity.days}
            dragDurationMin={drag?.data.durationMin ?? null}
            dayGapMin={dayGapMin}
            onCreate={(date, span) => setDraft({ date, span })}
            scrollerRef={scrollerRef}
            gridRef={gridRef}
          >
            {(date) => (
              <>
              {/* Only in the column the drop is currently aimed at.

                  Drawn BEFORE the blocks, but that does NOT put it behind
                  them: it carries an explicit `Z_BLOCK_REVEALED` and a block
                  carries `Z_BLOCK`, so the outline paints over the bar it is
                  landing on — deliberately, and `pointer-events-none` is what
                  keeps that bar's controls reachable. DOM order still decides
                  the ties: the composer below and a revealed block both share
                  `Z_BLOCK_REVEALED` and both render after this, so both sit
                  above it. See the z-index note in `LandingOutline`. */}
              {drag?.landing?.date === date && (
                <LandingOutline
                  startMin={drag.landing.startMin}
                  durationMin={drag.landing.durationMin}
                />
              )}
              <DayBlocks
                date={date}
                items={scheduledByDay.get(date) ?? []}
                blocks={busyBlocks}
                allDayBlocks={allDayBlocks}
                readOnly={isPast}
                reveal={revealItem}
                onRemove={(kind, id, goalId, blockId) => {
                  // The SITTING comes off, not the task: a four-hour task sat
                  // twice must not lose Thursday because Tuesday was cancelled.
                  if (kind === 'task') actions.unscheduleTask(id, blockId);
                  else if (goalId) actions.unscheduleNode(goalId, id, blockId);
                }}
                // Fires on past weeks too: `readOnly` above stops history being
                // rescheduled, not recorded. See DayBlocks' `readOnly` note.
                onComplete={(kind, id) => {
                  if (kind === 'task') actions.toggleTask(id);
                  else actions.toggleLeaf(id);
                }}
                onResize={(kind, id, blockId, minutes) => {
                  // Resizing a bar changes THAT sitting's length, never the
                  // task's estimate — which is what it used to write.
                  if (kind === 'task') actions.resizeTask(id, blockId, minutes);
                  else actions.resizeNode(id, blockId, minutes);
                }}
              />
              {draft?.date === date && (
                <BlockComposer
                  startMin={draft.span.startMin}
                  durationMin={draft.span.durationMin}
                  onCommit={(title) => {
                    /*
                     * The draft clears either way. On refusal `createTaskAt`
                     * has already shown a toast naming the day's longest free
                     * stretch and created nothing, so leaving the composer
                     * open would just re-offer a span that cannot fit.
                     */
                    actions.createTaskAt(title, draft.date, draft.span.startMin, draft.span.durationMin);
                    setDraft(null);
                  }}
                  onCancel={() => setDraft(null)}
                />
              )}
              </>
            )}
          </WeekGrid>
          )}
        </div>
      </div>

      {/*
        The ghost is the BAR, not a label of it.
        `dropAnimation={null}`: dnd-kit's default flies the overlay back to the
        ACTIVE node's rect, which is where the bar CAME FROM — so every
        successful drop played a 250ms animation of the block returning to its
        old slot, immediately contradicted by the re-render putting it in the
        new one. With the landing outline already sitting at the destination
        under the cursor, the eye has accepted where it is going before the
        release; the honest thing is to end there rather than to animate a lie.
      */}
      <DragOverlay dropAnimation={null}>
        {drag ? (
          <BlockGhost
            title={drag.data.title}
            durationMin={drag.data.durationMin}
            goalId={drag.data.goalId}
            startMin={drag.landing?.startMin ?? null}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
