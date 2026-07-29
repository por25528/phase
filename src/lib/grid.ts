import type { AvailabilityWindow, BusyBlock } from '../db/types';
import { windowForDate } from './availability';
import type { Interval } from './capacity';

const MINUTES_PER_HOUR = 60;

/** The grid always shows at least 08:00–20:00, so it never collapses to a sliver. */
export const MIN_VISIBLE_START = 480;
export const MIN_VISIBLE_END = 1200;

function floorToHour(minute: number): number {
  return Math.floor(minute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}
function ceilToHour(minute: number): number {
  return Math.ceil(minute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}

/**
 * The hours the grid draws: the union of the week's availability windows and
 * its TIMED calendar events, expanded outward to whole hours, then expanded
 * again if needed to include 08:00–20:00.
 *
 * All-day events are excluded on purpose: they typically span 0..1440, so
 * including them would stretch every week containing one to a full 24 hours.
 * Whether all-day events consume capacity is a separate question, already
 * handled by `freeIntervals` — this function is only about visible geometry.
 */
export function visibleRange(
  dates: string[],
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
): Interval {
  let startMin = MIN_VISIBLE_START;
  let endMin = MIN_VISIBLE_END;

  for (const date of dates) {
    const w = windowForDate(date, windows);
    if (!w) continue;
    startMin = Math.min(startMin, w.startMin);
    endMin = Math.max(endMin, w.endMin);
  }

  const dateSet = new Set(dates);
  for (const b of blocks) {
    if (!dateSet.has(b.date)) continue;
    if (b.allDay) continue; // see doc comment — never widens the grid
    startMin = Math.min(startMin, b.startMin);
    endMin = Math.max(endMin, b.endMin);
  }

  return { startMin: floorToHour(startMin), endMin: ceilToHour(endMin) };
}

/**
 * Vertical position of `minute` within `range`, as a percentage.
 *
 * Precondition: `range.endMin > range.startMin`. A zero-width range divides
 * by zero, producing `Infinity`/`NaN` — which as a CSS percentage renders as
 * nothing, a silent failure. This is not guarded against here: the only
 * producer of `Interval` in this codebase is `visibleRange`, which always
 * returns a positive-width range (it seeds at `MIN_VISIBLE_START`/
 * `MIN_VISIBLE_END`, `MIN_VISIBLE_END > MIN_VISIBLE_START`, and every
 * subsequent update only widens the range outward via `Math.min`/`Math.max`).
 * A degenerate range reaching this function would mean a caller bug; a
 * guard here would mask it instead of surfacing it.
 */
export function minuteToPct(minute: number, range: Interval): number {
  return ((minute - range.startMin) / (range.endMin - range.startMin)) * 100;
}

/**
 * Inverse of `minuteToPct` — used to turn a drop position into a time.
 *
 * Same precondition as `minuteToPct`: `range.endMin > range.startMin`, which
 * always holds for ranges produced by `visibleRange` (see that function's
 * doc comment for why).
 */
export function pctToMinute(pct: number, range: Interval): number {
  return range.startMin + (pct / 100) * (range.endMin - range.startMin);
}

/**
 * Every whole hour the axis should label, inclusive of both ends.
 *
 * Precondition: `range.startMin` must be hour-aligned. This function starts
 * its walk at `ceilToHour(range.startMin)`, so on an unaligned range the
 * first mark would not equal the range start. The precondition holds for
 * every range `visibleRange` returns, since it always floors `startMin` (and
 * ceils `endMin`) to the hour before returning.
 */
export function hourMarks(range: Interval): number[] {
  const out: number[] = [];
  for (let m = ceilToHour(range.startMin); m <= range.endMin; m += MINUTES_PER_HOUR) out.push(m);
  return out;
}

export interface LaneSpan {
  startMin: number;
  endMin: number;
}

export interface Laid<T> {
  item: T;
  lane: number;      // 0-based column within its cluster
  laneCount: number; // how many columns that cluster needs
}

/**
 * Pack overlapping spans into side-by-side lanes, Google-Calendar style.
 *
 * `laneCount` is scoped to the CLUSTER — a maximal run of spans connected by
 * overlap — rather than to the day, so one 09:00 conflict does not halve the
 * width of an unrelated 16:00 block.
 *
 * Ends are exclusive: 09:00–10:00 and 10:00–11:00 do not overlap.
 *
 * Returns entries in start order (ties broken by end order), not input order
 * — the function sorts internally, so callers must not assume the input
 * order is preserved.
 */
export function assignLanes<T extends LaneSpan>(items: T[]): Laid<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Laid<T>[] = [];

  let cluster: Laid<T>[] = [];
  let laneEnds: number[] = []; // laneEnds[i] = when lane i next becomes free
  let clusterEnd = -Infinity;

  function closeCluster() {
    const laneCount = laneEnds.length;
    for (const entry of cluster) out.push({ ...entry, laneCount });
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  }

  for (const item of sorted) {
    if (item.startMin >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }

    // laneCount is filled in by closeCluster once the cluster's true width is known.
    cluster.push({ item, lane, laneCount: 0 });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  closeCluster();

  return out;
}
