import { useEffect, useRef } from 'react';
import { actions } from '../../state/store';
import { beyondHorizon, coversWeek, type DateRange } from '../../lib/calendarRange';
import { CALENDAR_STALE_MS } from '../../lib/calendarHealth';
import { weekOf } from '../../lib/plan';
import { todayStr } from '../../lib/dates';

/**
 * Whether asking for `weekStart` again could change anything.
 *
 * Two ways it cannot: the cache already covers the week, or the week is past
 * what `fetchRange` will ever return. The second is the one worth a guard —
 * without it, paging out to next year fires one fetch per week navigated, each
 * returning the identical clamped range, and every one of them spends a Google
 * quota to re-learn that the answer is no.
 */
function worthFetching(weekStart: string, range: DateRange | null): boolean {
  if (range && coversWeek(range, weekStart)) return false;
  return !beyondHorizon(weekOf(todayStr()), weekStart);
}

/**
 * The three automatic fetch triggers: the planner opening, navigation to a
 * week the cache does not cover, and a window focus onto a stale cache. The
 * fourth — an explicit Refresh — calls `actions.refreshCalendar()` directly
 * from Settings, which reaches the same week through the store.
 *
 * Nothing runs while the app is unfocused or idle. A week INSIDE the cached
 * range never triggers a fetch: paging back and forth within the window is the
 * commonest action on this screen, and refetching each step would spend a
 * Google quota to learn nothing.
 *
 * The week on screen is published to the store on every change. That is what
 * lets a refresh started from somewhere else — Connect, or Settings' Refresh
 * button — reach the week the user is actually looking at. Without it, a
 * connect made while parked on week +30 fetched only the base window and left
 * that week caveated with no trigger that would ever clear it.
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

  // Tell the store which week a fetch should make sure of. Its own effect, and
  // first, so a refresh triggered below already sees the current week.
  useEffect(() => {
    actions.setCalendarWeek(weekStart);
  }, [weekStart]);

  /*
   * Planner open, and any navigation to a week the cache does not cover.
   *
   * `range` IS a dependency, deliberately. It was left out originally to avoid
   * a fetch loop, and the loop was real: a refresh replaces the range, which
   * re-runs the effect. What stops it now is `worthFetching` — a range that
   * came back covering the week ends the cycle, and one that came back short
   * because the week is past the horizon ends it too. Leaving `range` out
   * instead meant a week that failed to load once was never retried, so a
   * connect from Settings could not repair the view that was already open.
   */
  useEffect(() => {
    if (!worthFetching(weekStart, range)) return;
    void actions.refreshCalendar(weekStart);
  }, [weekStart, range]);

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
