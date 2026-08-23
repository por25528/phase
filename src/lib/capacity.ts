import type { BusyBlock, Task } from '../db/types';
import type { PlannedLeaf } from './plan';
import { weekDates } from './dates';
import { blocksOn } from './blocks';

/** A day, in minutes. A fact about a day, not about anyone's working hours. */
export const MINUTES_PER_DAY = 1440;

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
 * A sentinel `Now` far enough in the past that it never clamps. Passing it to
 * `remainingSpan` (and so to `freeIntervals`/`resolveSlot`) disables
 * past-clamping for any real date — the whole region is treated as still
 * ahead, whatever the wall clock says.
 *
 * It reads like part of the free-minutes tense rule, and it was, but that is
 * not why it survives that rule's removal. It is the clock every MANUAL
 * placement passes, because a manual placement is not asking "what is left of
 * this day": a drag onto this morning is how you record what actually
 * happened, and resizing a block that started an hour ago is an ADJUSTMENT
 * rather than a new booking. The migration re-homing old data passes it for
 * the same reason.
 *
 * Lives here rather than in `slot` so it sits beside `Now`; `slot` re-exports
 * it for its callers.
 */
export const NO_PAST_LIMIT: Now = { date: '1970-01-01', minute: 0 };

/**
 * The part of `span` on `date` that is still ahead of `now`.
 *
 * Split out of a `remainingWindow` that priced availability, back when
 * availability was a fence. Both are gone; what is left is this, the clamp
 * `freeIntervals` applies to whatever region a placement is allowed to search
 * — `WHOLE_DAY` for a manual placement, `ORDINARY_DAY` for an automatic one.
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
  // calendar is connected. It suppresses no figure: everything here is a
  // commitment, which is known whatever the calendar cache holds. The caveat
  // is surfaced separately via `capacityNote` (capacityLabel.ts).
  hasData: boolean;
}

export interface WeekCapacity {
  days: DayCapacity[];
  plannedMin: number;
  /** See `DayCapacity.backlogMin` — committed to the week, not on the grid. */
  backlogMin: number;
  unestimated: number;
  hasData: boolean;
}

export interface CapacityInput {
  week: string;                   // Monday
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
  const { week, blocks, leaves, tasks, allDayBlocks, hasData } = input;
  const dates = weekDates(week);

  /*
   * Every figure here is a COMMITMENT, so tense does not enter into it: a
   * Monday you have already spent still had two hours of work planned onto it,
   * and that stays true on Thursday.
   *
   * The free figure this used to carry was the one tense-sensitive number in
   * the app, and it was the source of a real bug — a past day reported zero
   * free, which against `plannedMin > 0` read as over-committed, so a whole
   * elapsed week rendered in warning red. Both the figure and the verdict went
   * with the availability windows that priced them. What survives is the rule
   * they taught: two numbers that get compared to each other have to cover the
   * same days.
   *
   * `input.now` is therefore unused. It stays on `CapacityInput` because every
   * caller already threads a clock through for its other reads, and dropping
   * it would churn five call sites to delete one field.
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

    return {
      date,
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
    plannedMin: days.reduce((sum, d) => sum + d.plannedMin, 0),
    backlogMin: weekWaiting.plannedMin,
    // Placed work no longer counts as unestimated: a sitting states its own
    // length, so capacity can always price it. What remains unpriceable is
    // committed work with no estimate and nowhere to be.
    unestimated: weekWaiting.unestimated,
    hasData,
  };
}
