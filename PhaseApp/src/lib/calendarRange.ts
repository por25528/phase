import { addDays } from './dates';

/** Half-open: `rangeEnd` is EXCLUSIVE, matching CalendarCache and NormalizeOptions. */
export interface DateRange {
  rangeStart: string;
  rangeEnd: string;
}

/** One week back, so the RecapPanel week is covered — a past day reports what it HELD. */
export const BASE_BACK_DAYS = 7;
/** Eight weeks forward covers ordinary planning without a refetch. */
export const BASE_FORWARD_DAYS = 56;
/** 26 weeks; beyond it a visited week does not extend, while prior range grounds still clamp here. */
export const MAX_FORWARD_DAYS = 182;

/**
 * The range a fetch should cover.
 *
 * ONE contiguous range, never a union of disjoint ones: the cache is replaced
 * only if every calendar and every page succeeds, because a half-fetch renders
 * the missing calendar's meetings as FREE TIME. A patchwork cache would
 * destroy that guarantee.
 *
 * Every bound is anchored to `mondayOfCurrentWeek`, not to the previous range,
 * so the arithmetic is stable across refetches and the window rolls forward on
 * its own when the app is left open past a Sunday midnight.
 *
 * The end grows and never shrinks within one anchor, so bouncing between this
 * week and week +10 refetches once rather than thrashing. It never grows
 * backward: history is not planning input.
 */
export function fetchRange(
  mondayOfCurrentWeek: string,
  visitedMonday: string,
  previousEnd?: string,
): DateRange {
  const rangeStart = addDays(mondayOfCurrentWeek, -BASE_BACK_DAYS);
  const cap = addDays(mondayOfCurrentWeek, MAX_FORWARD_DAYS);
  const baseEnd = addDays(mondayOfCurrentWeek, BASE_FORWARD_DAYS);
  const previousWanted = previousEnd && previousEnd > baseEnd ? previousEnd : baseEnd;

  // The visited week must be covered COMPLETELY — +7, not +0, or Tue..Sun of
  // the week you navigated to would read as unknown.
  const visitedEnd = addDays(visitedMonday, 7);
  const wanted = visitedEnd <= cap && visitedEnd > previousWanted
    ? visitedEnd
    : previousWanted;

  return { rangeStart, rangeEnd: wanted > cap ? cap : wanted };
}

/**
 * Which side of the fetchable window a week fell out of. `'before'` is the
 * fixed back edge — `BASE_BACK_DAYS`, one week — and `'after'` is the forward
 * cap at `MAX_FORWARD_DAYS`.
 */
export type HorizonMiss = 'before' | 'after';

/** True when every day of the week beginning `monday` is inside `range`. */
export function coversWeek(range: DateRange, monday: string): boolean {
  return monday >= range.rangeStart && addDays(monday, 7) <= range.rangeEnd;
}

/**
 * Which edge a week falls outside of, or `null` when a fetch could cover it.
 *
 * `fetchRange` clamps forward at `MAX_FORWARD_DAYS` and never grows backward —
 * history is not planning input — so a week outside either edge comes back
 * uncovered however many times it is asked for. Without this, paging out fires
 * one fetch per week navigated, each returning the identical clamped range,
 * and every one of them spends a Google quota to re-learn that the answer is
 * no.
 *
 * The DIRECTION is returned rather than a bare boolean because the two edges
 * are nothing alike. One is six months out; the other is the week before last.
 * A single flag made the header say "calendar reaches six months out" about
 * last month, which is not merely unhelpful — it is false.
 *
 * Defined against `fetchRange`'s own arithmetic rather than restating it, and
 * `calendarRange.test.ts` walks every week across both edges asserting the two
 * agree — a guard that suppressed a fetch which WOULD have worked is the one
 * failure this must not have.
 */
export function outsideHorizon(
  mondayOfCurrentWeek: string,
  monday: string,
): HorizonMiss | null {
  const range = fetchRange(mondayOfCurrentWeek, monday);
  if (coversWeek(range, monday)) return null;
  return monday < range.rangeStart ? 'before' : 'after';
}
