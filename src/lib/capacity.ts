import type { AvailabilityWindow, BusyBlock, Task } from '../db/types';
import { windowForDate } from './availability';
import type { PlannedLeaf } from './plan';
import { addDays, weekDates } from './dates';
import { blocksOn } from './blocks';

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
 * The part of `span` on `date` that is still ahead of `now`.
 *
 * Split out of `remainingWindow` below when availability stopped being a
 * fence. Two different regions get clamped against the clock now and only one
 * of them is an availability window: capacity asks about the window, and
 * `freeIntervals` asks about whatever region a placement is allowed to search
 * — which for a manual placement is the WHOLE DAY. The clamp is the same
 * arithmetic either way, so it is written once and the caller says which
 * region it means.
 *
 * Returns null when there is no region, the date is already past, or the
 * region has closed.
 */
export function remainingSpan(date: string, span: Interval | null, now: Now): Interval | null {
  if (date < now.date) return null; // the past is not capacity
  if (!span) return null;
  const startMin = date === now.date ? Math.max(span.startMin, now.minute) : span.startMin;
  return startMin < span.endMin ? { startMin, endMin: span.endMin } : null;
}

/**
 * The part of `date`'s availability window that is still ahead of `now`.
 * Returns null when the day is off, already past, or its window has closed.
 *
 * This is the DENOMINATOR's clamp and nothing else now. It used to be the
 * fence's clamp too — `freeIntervals` called it, so every drop was gatekept by
 * the same window that priced the week. The two jobs are separated: this one
 * survives untouched, `freeIntervals` takes a region instead.
 */
export function remainingWindow(
  date: string,
  windows: AvailabilityWindow[],
  now: Now,
): Interval | null {
  return remainingSpan(date, windowForDate(date, windows), now);
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

/**
 * How much working time is left between `now` and `deadline`, inclusive.
 *
 * This is the denominator behind a goal's feasibility: remaining effort is only
 * meaningful against the hours that actually exist before the date. It is an
 * UPPER BOUND, and deliberately so — `blocks` is a device-local cache covering
 * whatever range was last fetched, so meetings beyond it are unknown and the
 * figure can only shrink as they arrive. A forecast built on it must therefore
 * be conservative in the same direction: see `goalHealth`.
 *
 * Capped at `MAX_FORECAST_DAYS`. A deadline two years out produces a capacity
 * number so large that every goal is trivially "on track", which is not a
 * forecast, it is arithmetic with no opinion; past the cap the honest answer is
 * that nobody is planning that far and health says `no-forecast`.
 */
export const MAX_FORECAST_DAYS = 180;

export function capacityBefore(
  deadline: string,
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  now: Now,
  allDayBlocks: boolean,
): number | null {
  if (deadline < now.date) return 0; // the date has been and gone
  let total = 0;
  let date = now.date;
  for (let i = 0; i <= MAX_FORECAST_DAYS; i += 1) {
    total += freeMinutes(date, windows, blocks, now, allDayBlocks);
    if (date === deadline) return total;
    date = addDays(date, 1);
  }
  return null; // past the forecast horizon
}

export interface Workload {
  plannedMin: number;  // Σ estimateMin over unfinished commitments
  unestimated: number; // unfinished commitments carrying no usable estimate
}

/**
 * The one definition of a usable estimate, shared by the store and the math.
 *
 * Rounds FIRST, then rejects — the two orders disagree on the interval
 * `0 < v < 0.5`. Testing `v > 0` before rounding let `0.4` through and returned
 * `Math.round(0.4)` = **0**, which is not `undefined`, so every caller treated
 * it as a perfectly good estimate of zero minutes:
 *
 * - `workloadOf` added 0 to `plannedMin` and did NOT count it as unestimated,
 *   so the work was invisible to capacity while claiming to be priced — and
 *   unreachable from the "N unestimated" list that exists to find exactly that.
 * - `pct.ts` uses it as a weight, so a completed step could be worth literally
 *   nothing: one done leaf at `estimateMin: 0.4` beside an open 60m leaf rolls
 *   up to 0% while `goalPctBasis` reports "weighted by estimate".
 *
 * Sub-minute values cannot come from `parseEstimateInput` — its regexes require
 * whole minutes, and fractional hours are multiplied by 60 before rounding — so
 * this only ever arrives from an imported or hand-edited file, which is
 * precisely the input that must not be trusted.
 */
export function normalizeEstimate(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const rounded = Math.round(v);
  return rounded > 0 ? rounded : undefined;
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
  return l.blocks.length > 0;
}
export function isPlacedTask(t: Task): boolean {
  return (t.blocks?.length ?? 0) > 0;
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
    /*
     * Planned time on a day is the sum of the SITTINGS on that day, by their
     * own `minutes` — not the estimate of every task pinned to it.
     *
     * That difference is the whole point of the split. A four-hour task sat as
     * two two-hour sittings used to bill all four hours to whichever day held
     * its single slot; now Tuesday is charged two and Thursday two, which is
     * both what the grid draws and what the person actually plans to do.
     */
    const plannedMin =
      leaves.reduce((n, l) => n + l.blocks.filter((b) => b.date === date).reduce((m, b) => m + b.minutes, 0), 0)
      + tasks.reduce((n, t) => n + blocksOn(t, date).reduce((m, b) => m + b.minutes, 0), 0);

    // Committed to this day and NOT placed. Leaves have no day-level
    // commitment — only a week — so this is a task-only bucket.
    const waiting = workloadOf([], tasks.filter((t) => t.date === date && !isPlacedTask(t)));

    const asOf = date < now.date ? NO_PAST_LIMIT : now;
    return {
      date,
      freeMin: freeMinutes(date, windows, blocks, asOf, allDayBlocks),
      plannedMin,
      backlogMin: waiting.plannedMin,
      unestimated: waiting.unestimated,
      blockedBy: blockedBy(date, blocks, allDayBlocks),
      hasData,
    };
  });

  /*
   * Week totals.
   *
   * `plannedMin` is the sum of the day figures, because a sitting is only ever
   * on one day and every day of the week is in `dates`. `backlogMin` cannot be:
   * a leaf committed to the week with no sitting yet belongs to no day at all,
   * which is exactly the "to place" state the rail lists.
   */
  const weekWaiting = workloadOf(
    leaves.filter((l) => !isPlacedLeaf(l)),
    tasks.filter((t) => !isPlacedTask(t)),
  );

  return {
    days,
    freeMin: days.reduce((sum, d) => sum + d.freeMin, 0),
    plannedMin: days.reduce((sum, d) => sum + d.plannedMin, 0),
    backlogMin: weekWaiting.plannedMin,
    // Placed work no longer counts as unestimated: a sitting states its own
    // length, so capacity can always price it. What remains unpriceable is
    // committed work with no estimate and nowhere to be.
    unestimated: weekWaiting.unestimated,
    hasData,
  };
}
