/**
 * The ONLY module that touches the `calendarCache` table.
 *
 * Mirrors the rule for db/assets.ts, and for the same reason: these writes are
 * surgical and must never be folded into persist(), which is a full clear +
 * bulkPut of the four app-data tables.
 *
 * Every caller in the renderer MUST wrap these writes in the store's `ifOwner`
 * — a tab that does not hold the Web Lock never writes at all. Refreshing is
 * gated on ownership too, not merely the write.
 */
import type { CalendarCache } from './types';
import { db, CALENDAR_CACHE_KEY } from './db';

export async function loadCalendarCache(): Promise<CalendarCache | undefined> {
  const row = await db.calendarCache.get(CALENDAR_CACHE_KEY);
  if (!row) return undefined;
  const { key: _key, ...cache } = row;
  return cache;
}

/** Clear stray-key rows first; the fixed-key put already replaces the current row. */
export async function saveCalendarCache(cache: CalendarCache): Promise<void> {
  await db.transaction('rw', db.calendarCache, async () => {
    await db.calendarCache.clear();
    await db.calendarCache.put({ ...cache, key: CALENDAR_CACHE_KEY });
  });
}

export async function clearCalendarCache(): Promise<void> {
  await db.calendarCache.clear();
}
