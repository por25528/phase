import { describe, it, expect, afterEach } from 'vitest';
import { calendarBridge } from './calendarBridge';

function fakeBridge() {
  return {
    status: async () => ({
      configured: true, connected: true, available: true, corrupt: false,
      managed: true, custom: false,
      accountId: 'a@example.com', timeZone: 'America/New_York',
    }),
    configure: async () => {},
    connect: async () => ({ ok: true as const }),
    disconnect: async () => {},
    listCalendars: async () => [],
    reset: async () => {},
    fetch: async () => ({ ok: false as const, reason: 'not-connected' as const }),
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).phaseCalendar;
});

describe('calendarBridge', () => {
  it('is null in a browser, where the preload never ran', () => {
    expect(calendarBridge()).toBeNull();
  });

  it('returns the bridge the preload exposed', () => {
    const fake = fakeBridge();
    (globalThis as Record<string, unknown>).phaseCalendar = fake;
    expect(calendarBridge()).toBe(fake);
  });

  // The discriminating test. A half-built bridge must be rejected HERE, not at
  // the first `await bridge.fetch(...)` deep inside a refresh, where the
  // failure would surface as an unhandled rejection with no useful message.
  it('rejects a partial bridge rather than failing at the first call', () => {
    (globalThis as Record<string, unknown>).phaseCalendar = { status: async () => ({}) };
    expect(calendarBridge()).toBeNull();
  });

  it('rejects a non-object', () => {
    (globalThis as Record<string, unknown>).phaseCalendar = 'nope';
    expect(calendarBridge()).toBeNull();
  });
});
