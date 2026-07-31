import type { AvailabilityWindow, BusyBlock, Task } from '../db/types';
import { windowForDate } from './availability';
import type { PlannedLeaf } from './plan';
import { weekDates } from './dates';

/**
 * The current moment, injected. Capacity is measured from here forward, so this
 * module stays pure and every result is deterministic in tests.
 */
export interface Now {
  date: string;   // 'YYYY-MM-DD' local
  minute: number; // minutes from local midnight
}

export interface Interval {
  startMin: number;
  endMin: number;
}

/**
 * Collapse intervals into a disjoint, ascending set. Two overlapping meetings
 * must contribute their UNION — summing their durations would deduct the
 * overlap twice and understate free time.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, cur.endMin);
    } else {
      out.push({ startMin: cur.startMin, endMin: cur.endMin });
    }
  }
  return out;
}

/**
 * A sentinel `Now` far enough in the past that it never clamps. Passing this
 * to `remainingWindow` (and so to `freeIntervals`/`resolveSlot`/`freeMinutes`)
 * disables past-clamping for any real date — the whole day's window is treated
 * as still ahead, whatever the wall clock says.
 *
 * For everything whose question is NOT "what is left of this day": re-deriving
 * or adjusting a commitment the user already made (the migration re-homing old
 * data; moving or resizing something already on the grid — a 09:00 block must
 * stay editable at 14:00), and reporting what a PAST day's capacity was.
 *
 * Lives here rather than in `slot` so `weekCapacity` can use it without a
 * circular import; `slot` re-exports it for its existing callers.
 */
export const NO_PAST_LIMIT: Now = { date: '1970-01-01', minute: 0 };

/**
 * The part of `date`'s availability window that is still ahead of `now`.
 * Returns null when the day is off, already past, or its window has closed.
 */
export function remainingWindow(
  date: string,
  windows: AvailabilityWindow[],
  now: Now,
): Interval | null {
  if (date < now.date) return null; // the past is not capacity
  const w = windowForDate(date, windows);
  if (!w) return null;
  const startMin = date === now.date ? Math.max(w.startMin, now.minute) : w.startMin;
  return startMin < w.endMin ? { startMin, endMin: w.endMin } : null;
}

/**
 * Minutes still available on `date`: the remaining availability window minus
 * the merged busy time intersecting it.
 *
 * `allDayBlocks` is applied HERE, at read time, rather than at fetch time — so
 * toggling the preference never requires a refetch (spec §3.2).
 */
export function freeMinutes(
  date: string,
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  now: Now,
  allDayBlocks: boolean,
): number {
  const win = remainingWindow(date, windows, now);
  if (!win) return 0;

  const today = blocks.filter((b) => b.date === date && (allDayBlocks || !b.allDay));
  if (today.some((b) => b.allDay)) return 0; // an all-day event consumes the day

  const busy = mergeIntervals(today).reduce((sum, b) => {
    const start = Math.max(b.startMin, win.startMin);
    const end = Math.min(b.endMin, win.endMin);
    return sum + Math.max(0, end - start);
  }, 0);

  return Math.max(0, (win.endMin - win.startMin) - busy);
}

export interface Workload {
  plannedMin: number;  // Σ estimateMin over unfinished commitments
  unestimated: number; // unfinished commitments carrying no usable estimate
}

/** The one definition of a usable estimate, shared by the store and the math. */
export function normalizeEstimate(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.round(v)
    : undefined;
}

function usableEstimate(v: number | undefined): number | null {
  return normalizeEstimate(v) ?? null;
}

/**
 * The week's (or day's) unfinished workload, across BOTH kinds of commitment
 * the planner displays: planned goal leaves and dated tasks. Mirrors
 * `plannerOpenCount` in views/plan/planner.ts — capacity must not use a
 * narrower definition of "open work" than the count rendered beside it.
 *
 * Unestimated work is counted, never assigned a phantom duration: a blended
 * number would look authoritative while being partly invented.
 */
export function workloadOf(leaves: PlannedLeaf[], tasks: Task[]): Workload {
  let plannedMin = 0;
  let unestimated = 0;

  for (const l of leaves) {
    if (l.done) continue;
    const est = usableEstimate(l.estimateMin);
    if (est === null) unestimated++;
    else plannedMin += est;
  }
  for (const t of tasks) {
    if (t.done) continue;
    const est = usableEstimate(t.estimateMin);
    if (est === null) unestimated++;
    else plannedMin += est;
  }

  return { plannedMin, unestimated };
}

/**
 * Work that is genuinely ON the grid: a day AND a start minute. The exact
 * predicate `scheduledOn` and `backlogGroups` already partition on, so
 * "planned" here means the same thing it means everywhere else in the app.
 */
export function isPlacedLeaf(l: PlannedLeaf): boolean {
  return l.plannedDay !== undefined && l.plannedStartMin !== undefined;
}
export function isPlacedTask(t: Task): boolean {
  return t.date !== undefined && t.startMin !== undefined;
}

export interface DayCapacity {
  date: string;
  freeMin: number;
  /** Estimated minutes actually on the calendar. */
  plannedMin: number;
  /**
   * Estimated minutes committed but NOT on the calendar — a task captured with
   * `⌘N` (which always sets a date and never a start minute), or a step pushed
   * to a week without a day.
   *
   * Counted separately because folding it into `plannedMin` made the capacity
   * readout contradict the rail beside it: every captured task was billed to a
   * day as "planned" while that day sat empty and the same item was listed
   * under "To plan". Two numbers you plan against cannot disagree on one
   * screen.
   */
  backlogMin: number;
  unestimated: number;
  blockedBy: string[]; // event titles, in start order, deduplicated
  // Whether the cached calendar data covers this range — NOT whether a
  // calendar is connected. The free figure is always rendered (it's derived
  // from the availability windows the user typed, an upper bound until
  // meetings are known); `hasData: false` no longer suppresses it. The
  // caveat is surfaced separately via `capacityNote` (capacityLabel.ts).
  hasData: boolean;
}

export interface WeekCapacity {
  days: DayCapacity[];
  freeMin: number;
  plannedMin: number;
  /** See `DayCapacity.backlogMin` — committed to the week, not on the grid. */
  backlogMin: number;
  unestimated: number;
  hasData: boolean;
}

export interface CapacityInput {
  week: string;                   // Monday
  windows: AvailabilityWindow[];
  blocks: BusyBlock[];
  leaves: PlannedLeaf[];          // already filtered to this week
  tasks: Task[];                  // already filtered to this week
  now: Now;
  allDayBlocks: boolean;
  hasData: boolean;               // does the cache cover this range?
}

function blockedBy(date: string, blocks: BusyBlock[], allDayBlocks: boolean): string[] {
  const sorted = blocks
    .filter((b) => b.date === date && (allDayBlocks || !b.allDay))
    .sort((a, b) => a.startMin - b.startMin);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of sorted) {
    const key = `${b.title}\u0000${b.startMin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b.title);
  }
  return out;
}

/**
 * Per-day and whole-week capacity for `week`.
 *
 * Day-pinned leaves and dated tasks are charged to their day AND the week.
 * "Anyday" leaves — plannedWeek set, no plannedDay — are charged to the week
 * ONLY: they are not on a day, so they cannot be billed to one.
 */
export function weekCapacity(input: CapacityInput): WeekCapacity {
  const { week, windows, blocks, leaves, tasks, now, allDayBlocks, hasData } = input;
  const dates = weekDates(week);

  /*
   * "Free" is two different questions depending on tense, and answering the
   * forward-looking one about a past day produces a falsehood.
   *
   * `remainingWindow` returns null for any date before `now.date`, so every
   * past day reported 0 free. With `plannedMin > 0` that is `isOverCommitted`,
   * so a whole past week rendered in warning red — "0m free · 6h planned" —
   * and on a Thursday, Monday through Wednesday of the CURRENT week did the
   * same. The honest reading of a day that has been and gone is "you had six
   * hours and planned two", not "you have nothing left".
   *
   * The WEEK total is the sum of those day figures, so the header and the day
   * headings beneath it describe the same span.
   *
   * Answering "how much can I still plan into" at week level instead — clamping
   * away the elapsed days — sounds more actionable but breaks against
   * `plannedMin`, which counts the WHOLE week's commitments including the days
   * already spent. `isOverCommitted` compares the two, so a normal Thursday
   * with Monday's work still on the board read as over-committed and the header
   * went red above a grid of perfectly healthy day chips. Two numbers that get
   * compared to each other have to cover the same days.
   */
  const days: DayCapacity[] = dates.map((date) => {
    const dayLeaves = leaves.filter((l) => l.plannedDay === date);
    const dayTasks = tasks.filter((t) => t.date === date);
    const placed = workloadOf(dayLeaves.filter(isPlacedLeaf), dayTasks.filter(isPlacedTask));
    const waiting = workloadOf(
      dayLeaves.filter((l) => !isPlacedLeaf(l)),
      dayTasks.filter((t) => !isPlacedTask(t)),
    );
    const asOf = date < now.date ? NO_PAST_LIMIT : now;
    return {
      date,
      freeMin: freeMinutes(date, windows, blocks, asOf, allDayBlocks),
      plannedMin: placed.plannedMin,
      backlogMin: waiting.plannedMin,
      unestimated: placed.unestimated + waiting.unestimated,
      blockedBy: blockedBy(date, blocks, allDayBlocks),
      hasData,
    };
  });

  // Week totals come from the FULL commitment set, not the sum of day figures,
  // so anyday leaves and leaves pinned outside the week are still counted.
  const weekPlaced = workloadOf(leaves.filter(isPlacedLeaf), tasks.filter(isPlacedTask));
  const weekWaiting = workloadOf(
    leaves.filter((l) => !isPlacedLeaf(l)),
    tasks.filter((t) => !isPlacedTask(t)),
  );

  return {
    days,
    freeMin: days.reduce((sum, d) => sum + d.freeMin, 0),
    plannedMin: weekPlaced.plannedMin,
    backlogMin: weekWaiting.plannedMin,
    unestimated: weekPlaced.unestimated + weekWaiting.unestimated,
    hasData,
  };
}
