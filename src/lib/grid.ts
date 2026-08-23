import { MINUTES_PER_DAY } from './capacity';
import type { Interval } from './capacity';
import { ORDINARY_DAY, type PlacedSpan } from './slot';

const MINUTES_PER_HOUR = 60;

/**
 * The grid shows all 24 hours regardless. These only floor the INITIAL scroll
 * window (see `initialScrollWindow`) at 08:00–20:00, so an empty week doesn't
 * open scrolled to a sliver of empty morning.
 *
 * They are `ORDINARY_DAY` restated, and deliberately not imported from it:
 * that constant is the region an automatic PLACEMENT aims inside, and this is
 * where a scroller starts. The two agree today and there is no rule that says
 * they must — a change to one is not a reason to change the other.
 */
export const MIN_VISIBLE_START = ORDINARY_DAY.startMin;
export const MIN_VISIBLE_END = ORDINARY_DAY.endMin;

function floorToHour(minute: number): number {
  return Math.floor(minute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}
function ceilToHour(minute: number): number {
  return Math.ceil(minute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}

/** Every whole hour of the day, both ends inclusive. 25 marks. */
export function hourMarks(): number[] {
  const out: number[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += MINUTES_PER_HOUR) out.push(m);
  return out;
}

/**
 * The half-hour midpoints, drawn fainter than the hour rules.
 *
 * Not decoration: with hour rules alone the only reference for a block's
 * position is a line an hour away, so a 09:30 start and a 09:45 start look
 * identical. Every calendar this is measured against rules the half hour.
 * Excludes the final midnight, which has no midpoint after it.
 */
export function halfHourMarks(): number[] {
  const out: number[] = [];
  for (let m = DAY_START_MIN + 30; m < DAY_END_MIN; m += MINUTES_PER_HOUR) out.push(m);
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

/**
 * How tall the calendar region is — the window onto the time, not the time.
 *
 * On the week grid this is the scroller's own height: the sticky day headings
 * live INSIDE this box, eating into it, exactly as they do in every calendar,
 * so the visible hour grid is shorter than 720px by whatever the heading row
 * costs. The content behind them is `DAY_HEIGHT_PX` tall and reachable by
 * scrolling. The sidebar bounds itself to this region, whatever it nets out to
 * — see the rail note in CLAUDE.md.
 *
 * The MONTH grid takes the same figure, and must: its rows are `1fr` of an
 * `flex-1` box, so with no height to divide, every cell collapses to the height
 * of its date number and the month reads as a table of numbers rather than a
 * calendar. One constant so the two modes occupy the same rectangle and the
 * page does not jump when the toggle is thrown.
 */
export const GRID_VIEWPORT_PX = 720;

/** Vertical offset of `minute` within the day's content box, in pixels. */
export function minuteToPx(minute: number): number {
  return (minute - DAY_START_MIN) * PX_PER_MINUTE;
}

/**
 * Inverse of `minuteToPx`. Unlike the range-relative percentage mapping it
 * replaces, this has no precondition and cannot divide by zero — the scale
 * is a constant, not a range whose width depends on the week's contents.
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
 * Where to scroll the grid on mount: the ordinary day, widened to whole hours
 * around anything already placed in the week.
 *
 * This is NOT geometry. Nothing positions against it, and every minute of the
 * day is reachable by scrolling regardless.
 *
 * It used to open on the union of the week's availability windows. With none,
 * the honest starting point is the span the app itself aims at — opened out
 * far enough that a 06:55 sitting is not above the fold on a grid that appears
 * to start at eight. This is a RETURN of something that was deliberately
 * removed: a `spans` parameter existed once, and was dropped on the reasoning
 * that a block off-screen is still reachable by scrolling. That reasoning is
 * still true; what changed is that the windows were the only other thing
 * shaping this, so without them an early sitting has nothing at all pointing
 * at it.
 *
 * `endMin` currently has no consumer — `WeekGrid` reads only `startMin` — and
 * is retained for the all-day lane and gutter planned later, so it is
 * deliberately kept computed rather than dropped as dead.
 */
export function initialScrollWindow(
  dates: string[],
  spansFor: (date: string) => PlacedSpan[],
): Interval {
  let startMin = MIN_VISIBLE_START;
  let endMin = MIN_VISIBLE_END;

  for (const date of dates) {
    for (const span of spansFor(date)) {
      startMin = Math.min(startMin, span.startMin);
      endMin = Math.max(endMin, span.endMin);
    }
  }

  return {
    startMin: Math.max(DAY_START_MIN, floorToHour(startMin)),
    endMin: Math.min(DAY_END_MIN, ceilToHour(endMin)),
  };
}
