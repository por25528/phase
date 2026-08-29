import type { CalendarCache } from '../db/types';

/** Current reality, to be compared against what the cache recorded. */
export interface CalendarProvenance {
  accountId: string;
  calendarIds: string[];
  timeZone: string;
}

/**
 * Compare as multisets: order is presentation, but a duplicate is a real
 * difference. Sorting copies rather than the arguments — `calendarIds` on a
 * live cache row must not be reordered underneath its owner.
 */
function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((id, i) => id === y[i]);
}

/**
 * The cache if it may be believed, otherwise `null`.
 *
 * Without this, an account switch, a changed calendar selection or a machine
 * timezone change leaves stale blocks rendering as current fact — the one
 * failure this feature must never produce, because a block that is not really
 * there reads as free time that is not really free.
 *
 * `current` is `null` when nothing is connected, which discards everything.
 *
 * A mismatch does NOT delete the row. `status()` crosses an IPC boundary and
 * can fail for reasons unrelated to the account — a keychain still unlocking,
 * a handler throwing, the app mid-quit — and deleting on a transient failure
 * would silently lose a fetched fortnight and render every day as free. The
 * row stays and the next boot re-evaluates it; an undisplayed row is inert.
 *
 * `allDayBlocks` is deliberately absent: all-day blocks are always cached and
 * the preference is applied at read time, so toggling it never refetches.
 */
export function usableCache(
  cache: CalendarCache | undefined,
  current: CalendarProvenance | null,
): CalendarCache | null {
  if (!cache || !current) return null;
  if (cache.accountId !== current.accountId) return null;
  if (cache.timeZone !== current.timeZone) return null;
  if (!sameIds(cache.calendarIds, current.calendarIds)) return null;
  return cache;
}
