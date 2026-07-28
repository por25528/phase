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
 * The part of `date`'s availability window that is still ahead of `now`.
 * Returns null when the day is off, already past, or its window has closed.
 */
function remainingWindow(
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

function usableEstimate(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
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

export interface DayCapacity {
  date: string;
  freeMin: number;
  plannedMin: number;
  unestimated: number;
  blockedBy: string[]; // event titles, in start order, deduplicated
  hasData: boolean;    // false ⇒ render "no data", never "free"
}

export interface WeekCapacity {
  days: DayCapacity[];
  freeMin: number;
  plannedMin: number;
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
  const titles = blocks
    .filter((b) => b.date === date && (allDayBlocks || !b.allDay))
    .sort((a, b) => a.startMin - b.startMin)
    .map((b) => b.title);
  return [...new Set(titles)];
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

  const days: DayCapacity[] = dates.map((date) => {
    const dayLeaves = leaves.filter((l) => l.plannedDay === date);
    const dayTasks = tasks.filter((t) => t.date === date);
    const load = workloadOf(dayLeaves, dayTasks);
    return {
      date,
      freeMin: freeMinutes(date, windows, blocks, now, allDayBlocks),
      plannedMin: load.plannedMin,
      unestimated: load.unestimated,
      blockedBy: blockedBy(date, blocks, allDayBlocks),
      hasData,
    };
  });

  // Week totals come from the FULL commitment set, not the sum of day figures,
  // so anyday leaves and leaves pinned outside the week are still counted.
  const weekLoad = workloadOf(leaves, tasks);

  return {
    days,
    freeMin: days.reduce((sum, d) => sum + d.freeMin, 0),
    plannedMin: weekLoad.plannedMin,
    unestimated: weekLoad.unestimated,
    hasData,
  };
}
