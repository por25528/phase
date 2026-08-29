import { describe, it, expect } from 'vitest';
import {
  calendarHealth, calendarCaveat,
  CALENDAR_STALE_MS, CALENDAR_UNREACHED_MS,
  type CalendarHealthInput,
} from './calendarHealth';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');
const FRESH = '2026-08-05T11:55:00.000Z';

/** `n` milliseconds before NOW, as the ISO instant a fetch would have stamped. */
function fetchedAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function input(over: Partial<CalendarHealthInput> = {}): CalendarHealthInput {
  return {
    status: {
      configured: true, connected: true, available: true, corrupt: false,
      managed: true, custom: false,
      accountId: 'me@example.com', timeZone: 'America/New_York',
    },
    lastError: null,
    coversWeek: true,
    beyondHorizon: false,
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

  // A week past the cap will NEVER be covered, so "no data for this week"
  // reads as a promise that more is on the way. It is not.
  it('distinguishes a week past the horizon from one merely not fetched yet', () => {
    expect(calendarHealth(input({ coversWeek: false, beyondHorizon: true }))).toBe('beyond-horizon');
  });

  it('ignores the horizon for a week that IS covered', () => {
    expect(calendarHealth(input({ beyondHorizon: true }))).toBe('ok');
  });

  it('treats a never-fetched but connected calendar as out of range', () => {
    expect(calendarHealth(input({ fetchedAt: null, coversWeek: false }))).toBe('out-of-range');
  });

  // Reauth outranks coverage: if the token is gone, "no data for this week" is
  // a symptom and reconnecting is the cure.
  it('prefers reauth-required over out-of-range', () => {
    expect(calendarHealth(input({ lastError: 'reauth-required', coversWeek: false }))).toBe('reauth-required');
  });

  it('is stale once the fetch is older than the refresh interval', () => {
    expect(calendarHealth(input({ fetchedAt: fetchedAgo(CALENDAR_STALE_MS + 1000) }))).toBe('stale');
  });

  // A timestamp that will not parse is not evidence of freshness, and it is
  // not evidence of fifteen minutes either — it is no evidence at all, which
  // is exactly what "may be out of date" says.
  it('is not misled by an unparseable fetch timestamp', () => {
    expect(calendarHealth(input({ fetchedAt: 'not a date' }))).toBe('out-of-date');
  });

  /**
   * A refresh that keeps failing has to become visible eventually.
   *
   * It stays quiet at first on purpose: a transient `request-failed` from a
   * dropped wifi association clears itself on the next trigger, and a caveat
   * that flickers on every hiccup is one people learn to ignore. What is NOT
   * acceptable is a week that has silently been wrong all afternoon.
   */
  describe('a refresh that will not land', () => {
    it('says nothing about a failure the cache is still fresh enough to survive', () => {
      expect(calendarHealth(input({ lastError: 'request-failed' }))).toBe('ok');
    });

    it('surfaces the failure once the data it left behind is stale', () => {
      expect(calendarHealth(input({
        lastError: 'request-failed',
        fetchedAt: fetchedAgo(CALENDAR_STALE_MS + 1000),
      }))).toBe('refresh-failed');
    });

    it('surfaces a failure that has left nothing to be stale', () => {
      expect(calendarHealth(input({ lastError: 'request-failed', fetchedAt: null }))).toBe('refresh-failed');
    });

    it('treats every transient reason the same way', () => {
      for (const reason of ['malformed-data', 'invalid-time-zone', 'corrupt', 'no-calendars'] as const) {
        expect(calendarHealth(input({
          lastError: reason, fetchedAt: fetchedAgo(CALENDAR_STALE_MS + 1000),
        }))).toBe('refresh-failed');
      }
    });

    // The discriminating test for the bounded age. Without it, a machine that
    // has been offline since Tuesday draws Friday's grid out of Tuesday's
    // events and says nothing at all.
    it('says the data may be out of date once it is genuinely old', () => {
      expect(calendarHealth(input({ fetchedAt: fetchedAgo(CALENDAR_UNREACHED_MS + 1000) }))).toBe('out-of-date');
    });

    it('prefers a named failure over a bare age', () => {
      expect(calendarHealth(input({
        lastError: 'request-failed',
        fetchedAt: fetchedAgo(CALENDAR_UNREACHED_MS + 1000),
      }))).toBe('refresh-failed');
    });

    it('bounds the quiet window well inside a working day', () => {
      expect(CALENDAR_UNREACHED_MS).toBeGreaterThan(CALENDAR_STALE_MS);
      expect(CALENDAR_UNREACHED_MS).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
    });
  });
});

describe('calendarCaveat', () => {
  it('names the fix rather than the diagnosis', () => {
    expect(calendarCaveat('not-configured')).toBe('calendar not set up');
    expect(calendarCaveat('not-connected')).toBe('calendar not connected');
    expect(calendarCaveat('reauth-required')).toBe('calendar needs reconnecting');
    expect(calendarCaveat('out-of-range')).toBe('no calendar data for this week');
  });

  // Not "no data for this week", which reads as a promise that more is coming.
  it('says a week past the horizon is out of reach, not merely missing', () => {
    expect(calendarCaveat('beyond-horizon')).toBe('calendar reaches six months out');
  });

  it('names a refresh that will not land, and how old what is shown is', () => {
    expect(calendarCaveat('refresh-failed')).toBe("calendar didn't refresh");
    expect(calendarCaveat('out-of-date')).toBe('calendar may be out of date');
  });

  it('says nothing when there is nothing to fix', () => {
    expect(calendarCaveat('ok')).toBeNull();
    expect(calendarCaveat('no-integration')).toBeNull();
  });

  // Fifteen minutes of staleness is not wrongness — the blocks were true
  // minutes ago, and Settings' `fetched …` line already carries the age.
  it('does not nag about a merely stale cache', () => {
    expect(calendarCaveat('stale')).toBeNull();
  });
});
