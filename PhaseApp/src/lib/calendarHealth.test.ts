import { describe, it, expect } from 'vitest';
import { calendarHealth, calendarCaveat, type CalendarHealthInput } from './calendarHealth';
import { CALENDAR_STALE_MS } from '../views/plan/useCalendarRefresh';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');
const FRESH = '2026-08-05T11:55:00.000Z';

function input(over: Partial<CalendarHealthInput> = {}): CalendarHealthInput {
  return {
    status: {
      configured: true, connected: true, available: true, corrupt: false,
      managed: true, custom: false,
      accountId: 'me@example.com', timeZone: 'America/New_York',
    },
    lastError: null,
    coversWeek: true,
    fetchedAt: FRESH,
    nowMs: NOW,
    ...over,
  };
}

describe('calendarHealth', () => {
  it('is ok when connected, covering the week, and recently fetched', () => {
    expect(calendarHealth(input())).toBe('ok');
  });

  it('has no integration at all in a browser', () => {
    expect(calendarHealth(input({ status: null }))).toBe('no-integration');
  });

  it('is not configured when neither the build nor the user supplied a client', () => {
    expect(calendarHealth(input({
      status: {
        configured: false, connected: false, available: true, corrupt: false,
        managed: false, custom: false, accountId: null, timeZone: 'UTC',
      },
    }))).toBe('not-configured');
  });

  it('is not connected once configured but before consent', () => {
    expect(calendarHealth(input({
      status: {
        configured: true, connected: false, available: true, corrupt: false,
        managed: true, custom: false, accountId: null, timeZone: 'UTC',
      },
    }))).toBe('not-connected');
  });

  it('needs reconnecting when the last fetch said so', () => {
    expect(calendarHealth(input({ lastError: 'reauth-required' }))).toBe('reauth-required');
  });

  // The discriminating test. A connected, freshly-fetched calendar that simply
  // does not reach this week is NOT "not connected" — telling the user to
  // connect would send them to fix something that is not broken.
  it('reports out-of-range rather than not-connected for an uncovered week', () => {
    expect(calendarHealth(input({ coversWeek: false }))).toBe('out-of-range');
  });

  it('is stale once the fetch is older than the refresh interval', () => {
    expect(calendarHealth(input({
      fetchedAt: new Date(NOW - CALENDAR_STALE_MS - 1000).toISOString(),
    }))).toBe('stale');
  });

  it('treats a never-fetched but connected calendar as out of range', () => {
    expect(calendarHealth(input({ fetchedAt: null, coversWeek: false }))).toBe('out-of-range');
  });

  // Reauth outranks coverage: if the token is gone, "no data for this week" is
  // a symptom and reconnecting is the cure.
  it('prefers reauth-required over out-of-range', () => {
    expect(calendarHealth(input({ lastError: 'reauth-required', coversWeek: false }))).toBe('reauth-required');
  });

  it('is not misled by an unparseable fetch timestamp', () => {
    expect(calendarHealth(input({ fetchedAt: 'not a date' }))).toBe('stale');
  });

  // Every other fetch failure is transient. Naming it in the header would nag
  // about a network hiccup the next refresh will clear on its own.
  it('does not escalate an ordinary request failure past staleness', () => {
    expect(calendarHealth(input({ lastError: 'request-failed' }))).toBe('ok');
  });
});

describe('calendarCaveat', () => {
  it('names the fix rather than the diagnosis', () => {
    expect(calendarCaveat('not-configured')).toBe('calendar not set up');
    expect(calendarCaveat('not-connected')).toBe('calendar not connected');
    expect(calendarCaveat('reauth-required')).toBe('calendar needs reconnecting');
    expect(calendarCaveat('out-of-range')).toBe('no calendar data for this week');
  });

  it('says nothing when there is nothing to fix', () => {
    expect(calendarCaveat('ok')).toBeNull();
    expect(calendarCaveat('no-integration')).toBeNull();
  });

  // Staleness is not wrongness — the blocks were true minutes ago, and
  // Settings' `fetched …` line already carries the age beside Refresh.
  it('does not nag about a merely stale cache', () => {
    expect(calendarCaveat('stale')).toBeNull();
  });
});
