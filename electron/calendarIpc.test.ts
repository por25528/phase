import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import type { HandlerDeps } from './calendarIpc.cjs';

// calendarIpc.cjs loads its error classes with native require; use the same
// loader so Vitest exercises instanceof rather than a duplicate CJS identity.
const nativeRequire = createRequire(import.meta.url);
const { createCalendarHandlers, registerCalendarIpc, CHANNEL_PREFIX } =
  nativeRequire('./calendarIpc.cjs') as typeof import('./calendarIpc.cjs');
const { CorruptSecretStoreError } = nativeRequire('./secrets.cjs') as typeof import('./secrets.cjs');
const { NotConnectedError, ReauthRequiredError } = nativeRequire('./oauth.cjs') as typeof import('./oauth.cjs');

const CLIENT = { clientId: 'cid', clientSecret: 'sec' };
const RANGE = { rangeStart: '2026-08-03', rangeEnd: '2026-08-10', calendarIds: ['primary'] };
const GOOGLE_ERROR = 'Google Calendar request failed: Bearer ya29.SECRET rejected';
const EVENT = {
  status: 'confirmed', summary: 'standup',
  start: { dateTime: '2026-08-04T09:00:00-04:00' },
  end: { dateTime: '2026-08-04T10:00:00-04:00' },
};

function fakeSecrets(seed: Record<string, unknown> = {}) {
  const bag: Record<string, unknown> = { ...seed };
  return {
    available: () => true,
    get: (k: string) => bag[k],
    set: (k: string, v: unknown) => { bag[k] = v; },
    remove: (k: string) => { delete bag[k]; },
    reset: () => { for (const k of Object.keys(bag)) delete bag[k]; },
    _bag: bag,
  };
}

function handlers(over: Partial<HandlerDeps> = {}) {
  const calls: string[] = [];
  const secrets = (over.secrets as ReturnType<typeof fakeSecrets>) ?? fakeSecrets({ client: CLIENT });
  const deps = {
    secrets,
    oauth: {
      isConnected: () => true,
      connect: async () => { calls.push('connect'); },
      disconnect: async () => { calls.push('disconnect'); },
      getAccessToken: async () => 'A',
    },
    googleClient: {
      listCalendars: async () => [{ id: 'me@example.com', summary: 'Me', primary: true }],
      fetchEvents: async () => [EVENT],
    },
    normalizeEvents: (events: unknown[], options: { rangeStart: string; rangeEnd: string; timeZone: string }) =>
      [{ date: options.rangeStart, startMin: 540, endMin: 600, title: `n=${events.length}`, allDay: false }],
    timeZone: () => 'America/New_York',
    nowIso: () => '2026-08-04T13:41:00.000Z',
    ...over,
  } as HandlerDeps;
  return Object.assign(createCalendarHandlers(deps), { _calls: calls, _secrets: secrets, _deps: deps });
}

async function rejection(promise: Promise<unknown>) {
  const settled = await Promise.allSettled([promise]);
  if (settled[0].status !== 'rejected') throw new Error('Expected the promise to reject');
  return settled[0].reason as Error;
}

function serializedError(err: unknown) {
  if (!(err instanceof Error)) return JSON.stringify(err);
  return JSON.stringify({ name: err.name, message: err.message, stack: err.stack, cause: err.cause });
}

function silenceErrors() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('status', () => {
  it('reports configured and connected with the account and zone', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'me@example.com' } }) });
    expect(await h.status()).toEqual({
      configured: true, connected: true, corrupt: false,
      accountId: 'me@example.com', timeZone: 'America/New_York',
    });
  });

  it('reports not configured before credentials are saved', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    expect(await h.status()).toMatchObject({ configured: false, connected: false, accountId: null });
  });

  it('reports a corrupt store instead of throwing at boot', async () => {
    const secrets = fakeSecrets({});
    secrets.get = () => { throw new CorruptSecretStoreError(new Error('bad key')); };
    const h = handlers({ secrets });
    expect(await h.status()).toMatchObject({ configured: false, connected: false, corrupt: true });
  });

  // The whole point of the seam. A leaked secret here would reach the renderer.
  it('never returns a credential', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, token: { refreshToken: 'R' }, account: { accountId: 'me@example.com' } }) });
    const json = JSON.stringify(await h.status());
    expect(json).not.toContain('sec');
    expect(json).not.toContain('R');
  });
});

describe('configure', () => {
  it('stores the pasted credentials', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    await h.configure({ clientId: ' cid ', clientSecret: ' sec ' });
    expect(h._secrets._bag.client).toEqual({ clientId: 'cid', clientSecret: 'sec' });
  });

  it('rejects empty input rather than storing a broken credential', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    await expect(h.configure({ clientId: '', clientSecret: 'sec' })).rejects.toThrow(/client id/i);
    await expect(h.configure({ clientId: 'cid', clientSecret: '  ' })).rejects.toThrow(/client secret/i);
    expect(h._secrets._bag.client).toBeUndefined();
  });

  it('rejects a missing input object at the boundary', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    await expect(h.configure(null as never)).rejects.toThrow(/credentials/i);
    await expect(h.configure(undefined as never)).rejects.toThrow(/credentials/i);
  });

  it('rejects overlong credentials', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    const tooLong = 'x'.repeat(1025);
    await expect(h.configure({ clientId: tooLong, clientSecret: 'sec' })).rejects.toThrow(/too long/i);
    await expect(h.configure({ clientId: 'cid', clientSecret: tooLong })).rejects.toThrow(/too long/i);
  });

  it('sanitizes a Google error from the secret store and preserves it in the main-process log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secrets = fakeSecrets({});
    secrets.remove = () => { throw new Error(GOOGLE_ERROR); };
    const h = handlers({ secrets });
    const err = await rejection(h.configure({ clientId: 'cid', clientSecret: 'sec' }));
    expect(err.message).toBe('Unable to save Google Calendar configuration');
    expect(serializedError(err)).not.toContain('ya29.SECRET');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('configure failed'), expect.any(Error));
    log.mockRestore();
  });

  // Reconfiguring means a different Cloud project, so the old token is
  // meaningless — and leaving it would make status() claim a connection the
  // new credentials cannot use.
  it('clears any existing token and account', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, token: { refreshToken: 'R' }, account: { accountId: 'x' } }) });
    await h.configure({ clientId: 'new', clientSecret: 'new' });
    expect(h._secrets._bag.token).toBeUndefined();
    expect(h._secrets._bag.account).toBeUndefined();
  });
});

describe('connect', () => {
  it('runs the flow then records the primary calendar as the account', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT }) });
    expect(await h.connect()).toEqual({ ok: true });
    expect(h._calls).toContain('connect');
    expect(h._secrets._bag.account).toEqual({ accountId: 'me@example.com' });
  });

  it('leaves no account recorded when there is no primary calendar', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [{ id: 'x', summary: 'X', primary: false }], fetchEvents: async () => [] },
    });
    expect(await h.connect()).toEqual({ ok: true });
    expect(h._secrets._bag.account).toBeUndefined();
  });

  it('returns not-configured without opening consent when credentials are incomplete', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: { clientId: 'cid' } }) });
    expect(await h.connect()).toEqual({ ok: false, reason: 'not-configured' });
    expect(h._calls).not.toContain('connect');
  });

  it('maps a reauthentication failure to a typed result', async () => {
    const log = silenceErrors();
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      oauth: {
        isConnected: () => false,
        connect: async () => { throw new ReauthRequiredError(); },
        disconnect: async () => {},
        getAccessToken: async () => 'A',
      },
    });
    expect(await h.connect()).toEqual({ ok: false, reason: 'reauth-required' });
    log.mockRestore();
  });

  it.each([
    ['consent denial', 'Google authorization failed: access_denied'],
    ['state mismatch', 'Authorization state did not match; aborting'],
    ['timeout', 'Authorization timed out; no response from the browser'],
  ])('maps %s to cancelled without leaking the message', async (_label, message) => {
    const log = silenceErrors();
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      oauth: {
        isConnected: () => false,
        connect: async () => { throw new Error(message); },
        disconnect: async () => {},
        getAccessToken: async () => 'A',
      },
    });
    expect(await h.connect()).toEqual({ ok: false, reason: 'cancelled' });
    log.mockRestore();
  });

  it('returns request-failed and logs a Google error without exposing it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      oauth: {
        isConnected: () => false,
        connect: async () => { throw new Error(GOOGLE_ERROR); },
        disconnect: async () => {},
        getAccessToken: async () => 'A',
      },
    });
    const result = await h.connect();
    expect(result).toEqual({ ok: false, reason: 'request-failed' });
    expect(JSON.stringify(result)).not.toContain('ya29.SECRET');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('connect failed'), expect.any(Error));
    log.mockRestore();
  });
});

describe('disconnect', () => {
  it('revokes and forgets the account too', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'me@example.com' } }) });
    await h.disconnect();
    expect(h._calls).toContain('disconnect');
    expect(h._secrets._bag.account).toBeUndefined();
  });

  it('sanitizes an underlying Google error while keeping the rejection contract', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      oauth: {
        isConnected: () => true,
        connect: async () => {},
        disconnect: async () => { throw new Error(GOOGLE_ERROR); },
        getAccessToken: async () => 'A',
      },
    });
    const err = await rejection(h.disconnect());
    expect(err.message).toBe('Unable to disconnect Google Calendar');
    expect(serializedError(err)).not.toContain('ya29.SECRET');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('disconnect failed'), expect.any(Error));
    log.mockRestore();
  });
});

describe('listCalendars', () => {
  it('returns the picker summaries from Google', async () => {
    const calendars = [
      { id: 'primary', summary: 'Me', primary: true },
      { id: 'team', summary: 'Team', primary: false },
    ];
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => calendars, fetchEvents: async () => [] },
    });
    expect(await h.listCalendars()).toEqual(calendars);
  });

  it('sanitizes a Google error while logging the main-process detail', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => { throw new Error(GOOGLE_ERROR); }, fetchEvents: async () => [] },
    });
    const err = await rejection(h.listCalendars());
    expect(err.message).toBe('Unable to load Google calendars');
    expect(serializedError(err)).not.toContain('ya29.SECRET');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('listCalendars failed'), expect.any(Error));
    log.mockRestore();
  });
});

describe('reset', () => {
  it('resets the secret store without invoking another dependency', async () => {
    const secrets = fakeSecrets({ client: CLIENT, token: { refreshToken: 'R' } });
    let resets = 0;
    const originalReset = secrets.reset;
    secrets.reset = () => { resets += 1; originalReset(); };
    const h = handlers({ secrets });
    await h.reset();
    expect(resets).toBe(1);
    expect(h._calls).toEqual([]);
    expect(h._secrets._bag).toEqual({});
  });
});

describe('fetch', () => {
  it('normalizes what Google returned and stamps provenance', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'me@example.com' } }) });
    expect(await h.fetch(RANGE)).toEqual({
      ok: true,
      blocks: [{ date: '2026-08-03', startMin: 540, endMin: 600, title: 'n=1', allDay: false }],
      fetchedAt: '2026-08-04T13:41:00.000Z',
      accountId: 'me@example.com',
      timeZone: 'America/New_York',
    });
  });

  it('passes the requested range and the machine zone to the normalizer', async () => {
    const seen: unknown[] = [];
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'a' } }),
      normalizeEvents: (_e: unknown[], o: unknown) => { seen.push(o); return []; },
    });
    await h.fetch(RANGE);
    expect(seen[0]).toEqual({ rangeStart: '2026-08-03', rangeEnd: '2026-08-10', timeZone: 'America/New_York' });
  });

  it.each([
    ['a non-date start', { ...RANGE, rangeStart: '2026-8-3' }],
    ['a non-date end', { ...RANGE, rangeEnd: 'tomorrow' }],
    ['an impossible February date', { ...RANGE, rangeStart: '2026-02-31' }],
    ['an impossible month and day', { ...RANGE, rangeStart: '2026-13-45' }],
    ['a reversed range', { ...RANGE, rangeStart: '2026-08-10', rangeEnd: '2026-08-03' }],
    ['an empty range', { ...RANGE, rangeStart: '2026-08-03', rangeEnd: '2026-08-03' }],
    ['calendarIds that is not an array', { ...RANGE, calendarIds: 'primary' as unknown as string[] }],
    ['a non-string calendar id', { ...RANGE, calendarIds: [42] as unknown as string[] }],
  ])('refuses %s', async (_label, input) => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT }) });
    expect(await h.fetch(input)).toEqual({ ok: false, reason: 'invalid-range' });
  });

  it('reports an empty selection as no-calendars without contacting Google', async () => {
    let fetches = 0;
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: {
        listCalendars: async () => [],
        fetchEvents: async () => { fetches += 1; return []; },
      },
    });
    expect(await h.fetch({ ...RANGE, calendarIds: [] })).toEqual({ ok: false, reason: 'no-calendars' });
    expect(fetches).toBe(0);
  });

  it('rejects an overlong calendar id before building a Google request', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT }) });
    expect(await h.fetch({ ...RANGE, calendarIds: ['x'.repeat(1025)] }))
      .toEqual({ ok: false, reason: 'invalid-range' });
  });

  it('reports not-configured before credentials exist', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('uses the complete credential predicate shared with status', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: { clientId: 'cid' } }) });
    expect((await h.status()).configured).toBe(false);
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('reports a corrupt secret store as corrupt', async () => {
    const log = silenceErrors();
    const secrets = fakeSecrets({});
    secrets.get = () => { throw new CorruptSecretStoreError(new Error('decrypt failed')); };
    const h = handlers({ secrets });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'corrupt' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('fetch failed'), expect.any(Error));
    log.mockRestore();
  });

  it('reports an invalid machine time zone separately from malformed calendar data', async () => {
    const log = silenceErrors();
    let fetches = 0;
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      timeZone: () => 'Not/AZone',
      googleClient: {
        listCalendars: async () => [],
        fetchEvents: async () => { fetches += 1; return []; },
      },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'invalid-time-zone' });
    expect(fetches).toBe(0);
    log.mockRestore();
  });

  it('does not let a timeZone failure escape the FetchResult boundary', async () => {
    const log = silenceErrors();
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      timeZone: () => { throw new Error('machine zone unavailable'); },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'request-failed' });
    log.mockRestore();
  });

  it('maps NotConnectedError to not-connected', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new NotConnectedError(); } },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'not-connected' });
  });

  // Distinct because spec §10 keeps the cached blocks and prompts to
  // re-connect, rather than offering a first-time connect.
  it('maps ReauthRequiredError to reauth-required', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new ReauthRequiredError(); } },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'reauth-required' });
  });

  // normalizeEvents throws RangeError on unparseable calendar data, and that
  // must surface as a failure rather than an empty — i.e. free — day.
  it('maps a RangeError from the normalizer to malformed-data', async () => {
    const log = silenceErrors();
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      normalizeEvents: () => { throw new RangeError('Invalid all-day end.date: 2026-8-6'); },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'malformed-data' });
    log.mockRestore();
  });

  it('maps anything else to request-failed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new Error('socket hang up'); } },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'request-failed' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('fetch failed'), expect.any(Error));
    log.mockRestore();
  });

  it('never leaks a Google message or a stack to the renderer', async () => {
    const log = silenceErrors();
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new Error('Bearer ya29.SECRET rejected'); } },
    });
    expect(JSON.stringify(await h.fetch(RANGE))).not.toContain('ya29');
    log.mockRestore();
  });
});

describe('registerCalendarIpc', () => {
  it('registers exactly the seven channels under one prefix', () => {
    const registered: string[] = [];
    registerCalendarIpc({ handle: (channel: string) => registered.push(channel) }, handlers());
    expect(registered.sort()).toEqual([
      `${CHANNEL_PREFIX}:configure`,
      `${CHANNEL_PREFIX}:connect`,
      `${CHANNEL_PREFIX}:disconnect`,
      `${CHANNEL_PREFIX}:fetch`,
      `${CHANNEL_PREFIX}:listCalendars`,
      `${CHANNEL_PREFIX}:reset`,
      `${CHANNEL_PREFIX}:status`,
    ].sort());
  });

  it('drops the IPC event argument before calling the handler', async () => {
    const impls: Record<string, (...a: unknown[]) => unknown> = {};
    registerCalendarIpc({ handle: (c: string, fn: (...a: unknown[]) => unknown) => { impls[c] = fn; } }, handlers({
      secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'a' } }),
    }));
    // A handler that forwarded the event object would treat it as the input.
    const out = await impls[`${CHANNEL_PREFIX}:fetch`]({ sender: 'ipc-event' }, RANGE);
    expect(out).toMatchObject({ ok: true });
  });
});

/**
 * A sandboxed preload cannot `require` a local module, so preload.cjs writes
 * the channel names out by hand. This is the only thing stopping the two
 * lists drifting apart — and drift would be a silent "function is not a
 * function" in the renderer, not a build error.
 */
describe('preload channel names', () => {
  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('./main.cjs', import.meta.url), 'utf8');

  it('uses the same prefix the handlers register under', () => {
    expect(preload).toContain(CHANNEL_PREFIX);
  });

  it('exposes every registered channel and no others', () => {
    const registered: string[] = [];
    registerCalendarIpc({ handle: (channel: string) => registered.push(channel) }, handlers());
    const method = (channel: string) => channel.slice(CHANNEL_PREFIX.length + 1);
    for (const channel of registered) {
      expect(preload, channel).toContain(`${CHANNEL_PREFIX}:${method(channel)}`);
    }
    const invoked = [...preload.matchAll(new RegExp(`${CHANNEL_PREFIX}:(\\w+)`, 'g'))].map((m) => m[1]);
    expect([...new Set(invoked)].sort()).toEqual(registered.map(method).sort());
  });

  it('exposes the bridge under the name the renderer looks for', () => {
    expect(preload).toContain('phaseCalendar');
  });

  it('keeps the Electron window wired to the sandboxed preload', () => {
    expect(main).toContain("preload: path.join(__dirname, 'preload.cjs')");
  });
});
