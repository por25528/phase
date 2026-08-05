import { describe, it, expect } from 'vitest';
import { expandToLocalDays, normalizeEvents, shouldSkipEvent, type GoogleEvent } from './busyBlocks.cjs';

const TIMED: GoogleEvent = {
  status: 'confirmed',
  summary: 'standup',
  start: { dateTime: '2026-08-04T09:00:00-04:00' },
  end: { dateTime: '2026-08-04T09:15:00-04:00' },
};

describe('shouldSkipEvent', () => {
  it('keeps an ordinary confirmed event', () => {
    expect(shouldSkipEvent(TIMED)).toBe(false);
  });

  it('skips a cancelled event', () => {
    expect(shouldSkipEvent({ ...TIMED, status: 'cancelled' })).toBe(true);
  });

  it('skips an event marked Free in Google', () => {
    expect(shouldSkipEvent({ ...TIMED, transparency: 'transparent' })).toBe(true);
  });

  it('keeps an event explicitly marked Busy', () => {
    expect(shouldSkipEvent({ ...TIMED, transparency: 'opaque' })).toBe(false);
  });

  it('skips an event the user declined', () => {
    expect(shouldSkipEvent({
      ...TIMED,
      attendees: [{ self: true, responseStatus: 'declined' }],
    })).toBe(true);
  });

  // The `self` flag is what makes this specific to the user. Without it, one
  // colleague declining would delete the meeting from your own capacity.
  it('keeps an event someone ELSE declined', () => {
    expect(shouldSkipEvent({
      ...TIMED,
      attendees: [{ self: false, responseStatus: 'declined' }],
    })).toBe(false);
  });

  it('keeps an event the user accepted or has not answered', () => {
    for (const responseStatus of ['accepted', 'tentative', 'needsAction']) {
      expect(shouldSkipEvent({
        ...TIMED,
        attendees: [{ self: true, responseStatus }],
      }), responseStatus).toBe(false);
    }
  });

  // All-day events reach the cache regardless; the preference is read-time.
  it('keeps an all-day event', () => {
    expect(shouldSkipEvent({
      status: 'confirmed',
      summary: 'Conference',
      start: { date: '2026-08-04' },
      end: { date: '2026-08-05' },
    })).toBe(false);
  });
});

const NY = 'America/New_York';

const RANGE = { rangeStart: '2026-08-03', rangeEnd: '2026-08-10', timeZone: NY };

function timed(summary: string, startIso: string, endIso: string): GoogleEvent {
  return { status: 'confirmed', summary, start: { dateTime: startIso }, end: { dateTime: endIso } };
}

describe('expandToLocalDays', () => {
  it('maps a timed event to minutes from local midnight', () => {
    expect(expandToLocalDays(timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T09:15:00-04:00'), NY))
      .toEqual([{ date: '2026-08-04', startMin: 540, endMin: 555, title: 'standup', allDay: false }]);
  });

  // The instant is identical; only the zone differs. If this returns the same
  // block as the test above, the timezone argument is being ignored.
  it('reads the instant in the requested zone, not the machine zone', () => {
    expect(expandToLocalDays(timed('standup', '2026-08-04T13:00:00Z', '2026-08-04T13:15:00Z'), 'Europe/London'))
      .toEqual([{ date: '2026-08-04', startMin: 840, endMin: 855, title: 'standup', allDay: false }]);
  });

  it('puts a midnight start at minute 0, not minute 1440', () => {
    expect(expandToLocalDays(timed('batch', '2026-08-04T00:00:00-04:00', '2026-08-04T01:00:00-04:00'), NY))
      .toEqual([{ date: '2026-08-04', startMin: 0, endMin: 60, title: 'batch', allDay: false }]);
  });

  it('splits an overnight event at local midnight', () => {
    expect(expandToLocalDays(timed('flight', '2026-08-04T22:00:00-04:00', '2026-08-05T02:00:00-04:00'), NY))
      .toEqual([
        { date: '2026-08-04', startMin: 1320, endMin: 1440, title: 'flight', allDay: false },
        { date: '2026-08-05', startMin: 0, endMin: 120, title: 'flight', allDay: false },
      ]);
  });

  it('gives a multi-day event a full block for each day in between', () => {
    const spans = expandToLocalDays(timed('offsite', '2026-08-04T14:00:00-04:00', '2026-08-06T11:00:00-04:00'), NY);
    expect(spans).toEqual([
      { date: '2026-08-04', startMin: 840, endMin: 1440, title: 'offsite', allDay: false },
      { date: '2026-08-05', startMin: 0, endMin: 1440, title: 'offsite', allDay: false },
      { date: '2026-08-06', startMin: 0, endMin: 660, title: 'offsite', allDay: false },
    ]);
  });

  // An event ending exactly at midnight must not produce a zero-width block
  // on the following day. `endMin > startMin` is part of BusyBlock's contract,
  // and a 0..0 block would break assignLanes' clustering.
  it('does not emit an empty block when an event ends exactly at midnight', () => {
    expect(expandToLocalDays(timed('late', '2026-08-04T22:00:00-04:00', '2026-08-05T00:00:00-04:00'), NY))
      .toEqual([{ date: '2026-08-04', startMin: 1320, endMin: 1440, title: 'late', allDay: false }]);
  });

  // Google's all-day `end.date` is EXCLUSIVE. A one-day event is
  // 08-04 -> 08-05 and must produce exactly one block.
  it('expands a one-day all-day event to a single day', () => {
    expect(expandToLocalDays({
      status: 'confirmed', summary: 'Holiday',
      start: { date: '2026-08-04' }, end: { date: '2026-08-05' },
    }, NY)).toEqual([
      { date: '2026-08-04', startMin: 0, endMin: 1440, title: 'Holiday', allDay: true },
    ]);
  });

  it('expands a multi-day all-day event up to but excluding its end date', () => {
    expect(expandToLocalDays({
      status: 'confirmed', summary: 'Conference',
      start: { date: '2026-08-04' }, end: { date: '2026-08-07' },
    }, NY).map((b) => b.date)).toEqual(['2026-08-04', '2026-08-05', '2026-08-06']);
  });

  // Wall-clock is the right model for a calendar grid: on spring-forward the
  // local day is 23 real hours, but 01:00-04:00 still reads as 60..240.
  it('uses wall-clock minutes across a DST spring-forward', () => {
    expect(expandToLocalDays(timed('early', '2026-03-08T01:00:00-05:00', '2026-03-08T04:00:00-04:00'), NY))
      .toEqual([{ date: '2026-03-08', startMin: 60, endMin: 240, title: 'early', allDay: false }]);
  });

  // The mirror of spring-forward: 2026-11-01 is the US fall-back day, so this
  // event runs five real hours but only four wall-clock ones. Wall clock is
  // what a calendar grid draws, so 60..300 is right — and pinning both
  // directions is what stops a refactor to instant-based arithmetic passing.
  it('uses wall-clock minutes across a DST fall-back', () => {
    expect(expandToLocalDays(timed('long', '2026-11-01T01:00:00-04:00', '2026-11-01T05:00:00-05:00'), NY))
      .toEqual([{ date: '2026-11-01', startMin: 60, endMin: 300, title: 'long', allDay: false }]);
  });

  it('falls back to a generic title when Google omits the summary', () => {
    const [block] = expandToLocalDays({
      status: 'confirmed',
      start: { dateTime: '2026-08-04T09:00:00-04:00' },
      end: { dateTime: '2026-08-04T10:00:00-04:00' },
    }, NY);
    expect(block.title).toBe('Busy');
  });

  it('returns nothing for an event missing either end', () => {
    expect(expandToLocalDays({ status: 'confirmed', summary: 'broken', start: {}, end: {} }, NY)).toEqual([]);
    expect(expandToLocalDays({ status: 'confirmed', summary: 'broken' }, NY)).toEqual([]);
  });
});

describe('normalizeEvents', () => {
  it('drops events the skip rules reject', () => {
    expect(normalizeEvents([
      { ...timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T09:15:00-04:00'), status: 'cancelled' },
      { ...timed('lunch', '2026-08-04T12:00:00-04:00', '2026-08-04T13:00:00-04:00'), transparency: 'transparent' },
    ], RANGE)).toEqual([]);
  });

  // THE critical case. Sum would be 120 minutes; the union is 90.
  it('merges two overlapping meetings into their union, not their sum', () => {
    const out = normalizeEvents([
      timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
      timed('1:1', '2026-08-04T09:30:00-04:00', '2026-08-04T10:30:00-04:00'),
    ], RANGE);
    expect(out).toEqual([
      { date: '2026-08-04', startMin: 540, endMin: 630, title: 'standup, 1:1', allDay: false },
    ]);
    expect(out[0].endMin - out[0].startMin).toBe(90);
  });

  it('merges a meeting wholly contained in another without shrinking it', () => {
    expect(normalizeEvents([
      timed('offsite', '2026-08-04T09:00:00-04:00', '2026-08-04T17:00:00-04:00'),
      timed('demo', '2026-08-04T11:00:00-04:00', '2026-08-04T11:30:00-04:00'),
    ], RANGE)).toEqual([
      { date: '2026-08-04', startMin: 540, endMin: 1020, title: 'offsite, demo', allDay: false },
    ]);
  });

  // Back-to-back is a touch, not an overlap. Capacity is identical either
  // way, so keeping them separate loses nothing and shows the user two
  // meetings instead of one invented three-hour block.
  it('keeps back-to-back meetings separate', () => {
    expect(normalizeEvents([
      timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
      timed('1:1', '2026-08-04T10:00:00-04:00', '2026-08-04T11:00:00-04:00'),
    ], RANGE)).toEqual([
      { date: '2026-08-04', startMin: 540, endMin: 600, title: 'standup', allDay: false },
      { date: '2026-08-04', startMin: 600, endMin: 660, title: '1:1', allDay: false },
    ]);
  });

  it('never merges an all-day event into a timed one', () => {
    const out = normalizeEvents([
      { status: 'confirmed', summary: 'Holiday', start: { date: '2026-08-04' }, end: { date: '2026-08-05' } },
      timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
    ], RANGE);
    expect(out.filter((b) => b.allDay)).toHaveLength(1);
    expect(out.filter((b) => !b.allDay)).toEqual([
      { date: '2026-08-04', startMin: 540, endMin: 600, title: 'standup', allDay: false },
    ]);
  });

  it('collapses several all-day events on one date into a single block', () => {
    const out = normalizeEvents([
      { status: 'confirmed', summary: 'Holiday', start: { date: '2026-08-04' }, end: { date: '2026-08-05' } },
      { status: 'confirmed', summary: 'Conference', start: { date: '2026-08-04' }, end: { date: '2026-08-05' } },
    ], RANGE);
    expect(out).toEqual([
      { date: '2026-08-04', startMin: 0, endMin: 1440, title: 'Holiday, Conference', allDay: true },
    ]);
  });

  it('merges across days independently', () => {
    const out = normalizeEvents([
      timed('a', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
      timed('b', '2026-08-05T09:00:00-04:00', '2026-08-05T10:00:00-04:00'),
    ], RANGE);
    expect(out.map((b) => b.date)).toEqual(['2026-08-04', '2026-08-05']);
    expect(out.map((b) => b.title)).toEqual(['a', 'b']);
  });

  it('drops a day before the range and keeps the first day of it', () => {
    const out = normalizeEvents([
      timed('before', '2026-08-02T09:00:00-04:00', '2026-08-02T10:00:00-04:00'),
      timed('first', '2026-08-03T09:00:00-04:00', '2026-08-03T10:00:00-04:00'),
    ], RANGE);
    expect(out.map((b) => b.title)).toEqual(['first']);
  });

  // rangeEnd is EXCLUSIVE, matching CalendarCache's documented contract.
  it('excludes the range end date and keeps the day before it', () => {
    const out = normalizeEvents([
      timed('last', '2026-08-09T09:00:00-04:00', '2026-08-09T10:00:00-04:00'),
      timed('after', '2026-08-10T09:00:00-04:00', '2026-08-10T10:00:00-04:00'),
    ], RANGE);
    expect(out.map((b) => b.title)).toEqual(['last']);
  });

  it('keeps only the in-range days of an event that straddles the range edge', () => {
    const out = normalizeEvents([
      timed('long', '2026-08-02T22:00:00-04:00', '2026-08-03T02:00:00-04:00'),
    ], RANGE);
    expect(out).toEqual([
      { date: '2026-08-03', startMin: 0, endMin: 120, title: 'long', allDay: false },
    ]);
  });

  it('returns blocks sorted by date then start', () => {
    const out = normalizeEvents([
      timed('later', '2026-08-05T14:00:00-04:00', '2026-08-05T15:00:00-04:00'),
      timed('earlier', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
      timed('midday', '2026-08-04T12:00:00-04:00', '2026-08-04T13:00:00-04:00'),
    ], RANGE);
    expect(out.map((b) => b.title)).toEqual(['earlier', 'midday', 'later']);
  });

  it('returns an empty array for no events, and still normalizes real input', () => {
    expect(normalizeEvents([], RANGE)).toEqual([]);
    expect(normalizeEvents([timed('one', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00')], RANGE))
      .toEqual([{ date: '2026-08-04', startMin: 540, endMin: 600, title: 'one', allDay: false }]);
  });
});
