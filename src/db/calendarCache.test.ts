import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { loadCalendarCache, saveCalendarCache, clearCalendarCache } from './calendarCache';
import type { CalendarCache } from './types';

const CACHE: CalendarCache = {
  rangeStart: '2026-07-27',
  rangeEnd: '2026-09-28',
  blocks: [{ date: '2026-08-04', startMin: 540, endMin: 600, title: 'standup', allDay: false }],
  fetchedAt: '2026-08-04T13:41:00.000Z',
  accountId: 'me@example.com',
  calendarIds: ['primary'],
  timeZone: 'America/New_York',
};

beforeEach(async () => {
  await db.calendarCache.clear();
});

describe('calendarCache', () => {
  it('is absent before anything is written', async () => {
    expect(await loadCalendarCache()).toBeUndefined();
  });

  it('round-trips a cache', async () => {
    await saveCalendarCache(CACHE);
    expect(await loadCalendarCache()).toEqual(CACHE);
  });

  // The whole point of the fixed key. A second cache row would let a stale
  // range be read back as current.
  it('replaces the previous cache rather than adding a second row', async () => {
    await saveCalendarCache(CACHE);
    await saveCalendarCache({ ...CACHE, accountId: 'other@example.com' });
    expect(await db.calendarCache.count()).toBe(1);
    expect((await loadCalendarCache())?.accountId).toBe('other@example.com');
  });

  it('clears the cache', async () => {
    await saveCalendarCache(CACHE);
    await clearCalendarCache();
    expect(await loadCalendarCache()).toBeUndefined();
    expect(await db.calendarCache.count()).toBe(0);
  });

  it('does not leak its storage key back to callers', async () => {
    await saveCalendarCache(CACHE);
    expect(Object.keys((await loadCalendarCache())!)).not.toContain('key');
  });
});
