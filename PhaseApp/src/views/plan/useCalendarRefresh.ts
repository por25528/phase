import { useEffect, useRef } from 'react';
import { actions } from '../../state/store';
import { coversWeek, type DateRange } from '../../lib/calendarRange';

/**
 * How old a cache may get before a window focus is worth a refetch.
 *
 * This is NOT a poll interval — nothing runs on a timer. Meetings move on
 * human timescales, and a quarter of an hour is short enough that a meeting
 * added on a phone shows up by the time you look at the planner again.
 */
export const CALENDAR_STALE_MS = 15 * 60 * 1000;

/**
 * The three automatic fetch triggers: the planner opening, navigation to a
 * week the cache does not cover, and a window focus onto a stale cache. The
 * fourth — an explicit Refresh — calls `actions.refreshCalendar()` directly
 * from Settings.
 *
 * Nothing runs while the app is unfocused or idle. A week INSIDE the cached
 * range never triggers a fetch: paging back and forth within the window is the
 * commonest action on this screen, and refetching each step would spend a
 * Google quota to learn nothing. The range only ever grows forward, so a
 * covered week stays covered.
 */
export function useCalendarRefresh(
  weekStart: string,
  range: DateRange | null,
  fetchedAt: string | null,
): void {
  // Read through a ref so the focus listener is registered once and still sees
  // current values. Re-registering on every render would drop the listener
  // between the removeEventListener and the next paint.
  const latest = useRef({ weekStart, range, fetchedAt });
  latest.current = { weekStart, range, fetchedAt };

  // Planner open, and any navigation to a week the cache does not cover.
  useEffect(() => {
    const held = latest.current.range;
    if (held && coversWeek(held, weekStart)) return;
    void actions.refreshCalendar(weekStart);
    // `range` is deliberately absent from the deps: a refresh REPLACES it, and
    // depending on it would re-run this effect with the new range and risk a
    // fetch loop. It is read through the ref instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  // Window focus, when what we hold has gone stale.
  useEffect(() => {
    function onFocus() {
      const { fetchedAt: at, weekStart: week } = latest.current;
      // Never fetched is not stale — the open/navigate effect above owns that
      // case, and firing here too would double the first request.
      if (!at) return;
      const age = Date.now() - new Date(at).getTime();
      if (!Number.isFinite(age) || age < CALENDAR_STALE_MS) return;
      void actions.refreshCalendar(week);
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
}
