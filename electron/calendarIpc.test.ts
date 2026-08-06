import { describe, it, expect } from 'vitest';
import { createCalendarHandlers, registerCalendarIpc, CHANNEL_PREFIX, type HandlerDeps } from './calendarIpc.cjs';
import { CorruptSecretStoreError } from './secrets.cjs';
import { NotConnectedError, ReauthRequiredError } from './oauth.cjs';

const CLIENT = { clientId: 'cid', clientSecret: 'sec' };
const RANGE = { rangeStart: '2026-08-03', rangeEnd: '2026-08-10', calendarIds: ['primary'] };
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
    await h.connect();
    expect(h._calls).toContain('connect');
    expect(h._secrets._bag.account).toEqual({ accountId: 'me@example.com' });
  });

  it('leaves no account recorded when there is no primary calendar', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [{ id: 'x', summary: 'X', primary: false }], fetchEvents: async () => [] },
    });
    await h.connect();
    expect(h._secrets._bag.account).toBeUndefined();
  });
});

describe('disconnect', () => {
  it('revokes and forgets the account too', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'me@example.com' } }) });
    await h.disconnect();
    expect(h._calls).toContain('disconnect');
    expect(h._secrets._bag.account).toBeUndefined();
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
    ['a reversed range', { ...RANGE, rangeStart: '2026-08-10', rangeEnd: '2026-08-03' }],
    ['an empty range', { ...RANGE, rangeStart: '2026-08-03', rangeEnd: '2026-08-03' }],
    ['calendarIds that is not an array', { ...RANGE, calendarIds: 'primary' as unknown as string[] }],
    ['a non-string calendar id', { ...RANGE, calendarIds: [42] as unknown as string[] }],
  ])('refuses %s', async (_label, input) => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT }) });
    expect(await h.fetch(input)).toEqual({ ok: false, reason: 'invalid-range' });
  });

  it('reports not-configured before credentials exist', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'not-configured' });
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
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      normalizeEvents: () => { throw new RangeError('Invalid all-day end.date: 2026-8-6'); },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'malformed-data' });
  });

  it('maps anything else to request-failed', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new Error('socket hang up'); } },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'request-failed' });
  });

  it('never leaks a Google message or a stack to the renderer', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new Error('Bearer ya29.SECRET rejected'); } },
    });
    expect(JSON.stringify(await h.fetch(RANGE))).not.toContain('ya29');
  });
});

describe('registerCalendarIpc', () => {
  it('registers exactly the six channels under one prefix', () => {
    const registered: string[] = [];
    registerCalendarIpc({ handle: (channel: string) => registered.push(channel) }, handlers());
    expect(registered.sort()).toEqual([
      `${CHANNEL_PREFIX}:configure`,
      `${CHANNEL_PREFIX}:connect`,
      `${CHANNEL_PREFIX}:disconnect`,
      `${CHANNEL_PREFIX}:fetch`,
      `${CHANNEL_PREFIX}:listCalendars`,
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
