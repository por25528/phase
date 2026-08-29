import { describe, it, expect } from 'vitest';
import type { CalendarCache } from '../db/types';
import { usableCache, type CalendarProvenance } from './calendarCacheState';

const CACHE: CalendarCache = {
  rangeStart: '2026-07-27',
  rangeEnd: '2026-09-28',
  blocks: [{ date: '2026-08-03', startMin: 540, endMin: 600, title: 'standup', allDay: false }],
  fetchedAt: '2026-08-03T13:00:00.000Z',
  accountId: 'me@example.com',
  calendarIds: ['primary', 'work@example.com'],
  timeZone: 'America/New_York',
};

const NOW: CalendarProvenance = {
  accountId: 'me@example.com',
  calendarIds: ['primary', 'work@example.com'],
  timeZone: 'America/New_York',
};

describe('usableCache', () => {
  it('believes a cache whose provenance matches', () => {
    expect(usableCache(CACHE, NOW)).toBe(CACHE);
  });

  it('discards a cache from a different account', () => {
    expect(usableCache(CACHE, { ...NOW, accountId: 'other@example.com' })).toBeNull();
  });

  it('discards a cache flattened against a different timezone', () => {
    expect(usableCache(CACHE, { ...NOW, timeZone: 'Europe/London' })).toBeNull();
  });

  it('discards a cache when a calendar was added to the selection', () => {
    expect(usableCache(CACHE, { ...NOW, calendarIds: ['primary', 'work@example.com', 'gym'] })).toBeNull();
  });

  it('discards a cache when a calendar was removed from the selection', () => {
    expect(usableCache(CACHE, { ...NOW, calendarIds: ['primary'] })).toBeNull();
  });

  // Order is presentation, not identity. Re-ordering the picker must not throw
  // away a good fortnight of data and trigger a refetch for nothing.
  it('ignores the order of the calendar ids', () => {
    expect(usableCache(CACHE, { ...NOW, calendarIds: ['work@example.com', 'primary'] })).toBe(CACHE);
  });

  it('discards everything when disconnected', () => {
    expect(usableCache(CACHE, null)).toBeNull();
  });

  it('has nothing to believe when no cache was ever written', () => {
    expect(usableCache(undefined, NOW)).toBeNull();
  });

  // A duplicate must not make two different selections compare equal.
  it('does not confuse a duplicated id with a distinct one', () => {
    const dup = { ...CACHE, calendarIds: ['primary', 'primary'] };
    expect(usableCache(dup, { ...NOW, calendarIds: ['primary', 'work@example.com'] })).toBeNull();
  });

  // The cache row is the owner's, not this function's. Sorting the argument in
  // place would silently reorder a live row underneath whoever holds it.
  it('does not reorder the ids it was handed', () => {
    const ids = ['work@example.com', 'primary'];
    usableCache({ ...CACHE, calendarIds: ids }, NOW);
    expect(ids).toEqual(['work@example.com', 'primary']);
  });
});
