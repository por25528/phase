import type { AvailabilityWindow, BusyBlock } from '../db/types';
import { MINUTES_PER_DAY, windowForDate } from './availability';
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
 * The hours the grid draws: the union of the week's availability windows, its
 * TIMED calendar events, and the spans of work actually scheduled on the
 * grid — expanded outward to whole hours, then expanded again if needed to
 * include 08:00–20:00.
 *
 * `spans` MUST cover everything `minuteToPct` will be asked to place. Without
 * it, a block scheduled outside the availability/event-derived range would
 * render at a negative `top` or past 100% — invisible-work-adjacent, since
 * the work IS drawn, just off-grid over the headings or below the footer.
 * Clipping would hide it outright, which is worse; widening the range is the
 * only fix that keeps every scheduled item on screen.
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
  spans: LaneSpan[] = [],
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

  for (const s of spans) {
    startMin = Math.min(startMin, s.startMin);
    endMin = Math.max(endMin, s.endMin);
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

/** Every whole hour of the day, both ends inclusive. 25 marks. */
export function hourMarks(): number[] {
  const out: number[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += MINUTES_PER_HOUR) out.push(m);
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

/**
 * The scale. One pixel per minute.
 *
 * Not an arbitrary choice: the grid this replaces was 720px tall for a default
 * 08:00-20:00 range, which is already exactly 1px per minute. Holding the
 * constant at 1 means the remaster changes WHICH minutes are reachable — all
 * of them, by scrolling — without changing how dense any of them look. The
 * visual identity is locked; this is what keeps it locked.
 *
 * `minuteToPx` is therefore the identity function today. Do not inline it away.
 * It is the single place the scale is applied, and this constant is the only
 * thing that would change if a zoom control is ever added.
 */
export const PX_PER_MINUTE = 1;
export const DAY_START_MIN = 0;
export const DAY_END_MIN = MINUTES_PER_DAY;
export const DAY_HEIGHT_PX = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MINUTE;

/** Vertical offset of `minute` within the day's content box, in pixels. */
export function minuteToPx(minute: number): number {
  return (minute - DAY_START_MIN) * PX_PER_MINUTE;
}

/**
 * Inverse of `minuteToPx`. Unlike the `pctToMinute` it replaces, this has no
 * precondition and cannot divide by zero — the scale is a constant, not a
 * range whose width depends on the week's contents.
 */
export function pxToMinute(px: number): number {
  return DAY_START_MIN + px / PX_PER_MINUTE;
}

/**
 * The grid's stacking order, in one place because it now has real layers.
 *
 * Under the fixed grid only the axis and the now-line were stacked and a
 * revealed block could sit at z-10 harmlessly. With sticky headings that block
 * would float over them mid-scroll, so the whole order is declared together
 * rather than rediscovered per component.
 */
export const Z_RULES = 0;
export const Z_BLOCK = 1;
export const Z_BLOCK_REVEALED = 2;
export const Z_NOW_LINE = 3;
export const Z_AXIS = 4;
export const Z_HEADINGS = 5;
export const Z_CORNER = 6;

/**
 * Where to scroll the grid on mount: the union of the week's availability
 * windows, expanded to whole hours and then to at least 08:00-20:00.
 *
 * This is NOT geometry. Nothing positions against it. It was `visibleRange`,
 * which had to widen itself to cover every scheduled block or that block would
 * render off-grid — the `spans` parameter existed for exactly that, and its
 * whole justification disappears once every minute of the day is reachable by
 * scrolling. `blocks` went the same way: a calendar event is a reason to look
 * somewhere, not a reason to reshape the grid.
 */
export function initialScrollWindow(
  dates: string[],
  windows: AvailabilityWindow[],
): Interval {
  let startMin = MIN_VISIBLE_START;
  let endMin = MIN_VISIBLE_END;

  for (const date of dates) {
    const w = windowForDate(date, windows);
    if (!w) continue;
    startMin = Math.min(startMin, w.startMin);
    endMin = Math.max(endMin, w.endMin);
  }

  return {
    startMin: Math.max(DAY_START_MIN, floorToHour(startMin)),
    endMin: Math.min(DAY_END_MIN, ceilToHour(endMin)),
  };
}
