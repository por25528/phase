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

/** True when every day of the week beginning `monday` is inside `range`. */
export function coversWeek(range: DateRange, monday: string): boolean {
  return monday >= range.rangeStart && addDays(monday, 7) <= range.rangeEnd;
}
