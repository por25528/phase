import { describe, it, expect } from 'vitest';
import { expandToLocalDays, shouldSkipEvent, type GoogleEvent } from './busyBlocks.cjs';

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
