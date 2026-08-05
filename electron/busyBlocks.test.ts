import { describe, it, expect } from 'vitest';
import { shouldSkipEvent, type GoogleEvent } from './busyBlocks.cjs';

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
