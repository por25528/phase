// The renderer-facing surface. Every argument the renderer supplies is
// validated here, and every failure becomes a typed reason rather than a
// thrown stack — a Google error message can carry a bearer token.

const { CorruptSecretStoreError } = require('./secrets.cjs');
const { NotConnectedError, ReauthRequiredError } = require('./oauth.cjs');

const CHANNEL_PREFIX = 'phase-calendar';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CALENDARS = 50;

function createCalendarHandlers(deps) {
  const { secrets, oauth, googleClient, normalizeEvents, timeZone, nowIso } = deps;

  /** Reading a corrupt store must not throw out of `status`. */
  function safeGet(key) {
    try {
      return { ok: true, value: secrets.get(key) };
    } catch (err) {
      if (err instanceof CorruptSecretStoreError || err?.name === 'CorruptSecretStoreError') {
        return { ok: false, value: undefined };
      }
      throw err;
    }
  }

  function validFetchInput(input) {
    if (!input || typeof input !== 'object') return false;
    const { rangeStart, rangeEnd, calendarIds } = input;
    if (!DATE_RE.test(rangeStart) || !DATE_RE.test(rangeEnd)) return false;
    if (!(rangeEnd > rangeStart)) return false;
    if (!Array.isArray(calendarIds) || calendarIds.length > MAX_CALENDARS) return false;
    return calendarIds.every((id) => typeof id === 'string' && id.length > 0);
  }

  async function status() {
    const client = safeGet('client');
    if (!client.ok) {
      return { configured: false, connected: false, corrupt: true, accountId: null, timeZone: timeZone() };
    }
    const account = safeGet('account').value;
    const configured = !!(client.value && client.value.clientId && client.value.clientSecret);
    return {
      configured,
      connected: configured && oauth.isConnected(),
      corrupt: false,
      accountId: account ? account.accountId : null,
      timeZone: timeZone(),
    };
  }

  async function configure({ clientId, clientSecret }) {
    const id = typeof clientId === 'string' ? clientId.trim() : '';
    const secret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
    if (!id) throw new Error('A Google OAuth client id is required');
    if (!secret) throw new Error('A Google OAuth client secret is required');
    // A different Cloud project means the stored token is meaningless, and
    // leaving it would make status() claim a connection the new credentials
    // cannot use.
    secrets.remove('token');
    secrets.remove('account');
    secrets.set('client', { clientId: id, clientSecret: secret });
  }

  async function connect() {
    await oauth.connect();
    // The account id is provenance, and the primary calendar's id IS the
    // user's address — so no extra scope is needed to learn it.
    const primary = (await googleClient.listCalendars()).find((c) => c.primary);
    if (primary) secrets.set('account', { accountId: primary.id });
  }

  async function disconnect() {
    await oauth.disconnect();
    secrets.remove('account');
  }

  async function listCalendars() {
    return googleClient.listCalendars();
  }

  async function fetchBlocks(input) {
    if (!validFetchInput(input)) return { ok: false, reason: 'invalid-range' };
    const client = safeGet('client');
    if (!client.ok) return { ok: false, reason: 'not-configured' };
    if (!client.value || !client.value.clientId) return { ok: false, reason: 'not-configured' };

    const zone = timeZone();
    try {
      const events = await googleClient.fetchEvents({
        rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, calendarIds: input.calendarIds,
      });
      const blocks = normalizeEvents(events, {
        rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, timeZone: zone,
      });
      const account = safeGet('account').value;
      return {
        ok: true,
        blocks,
        fetchedAt: nowIso(),
        accountId: account ? account.accountId : null,
        timeZone: zone,
      };
    } catch (err) {
      if (err instanceof NotConnectedError || err?.name === 'NotConnectedError') {
        return { ok: false, reason: 'not-connected' };
      }
      if (err instanceof ReauthRequiredError || err?.name === 'ReauthRequiredError') {
        return { ok: false, reason: 'reauth-required' };
      }
      // normalizeEvents throws RangeError on unparseable calendar data. It
      // must surface as a failure: an empty result would read as a free day.
      if (err instanceof RangeError) return { ok: false, reason: 'malformed-data' };
      // Deliberately does NOT forward the message. A Google error can quote
      // the Authorization header back at you.
      return { ok: false, reason: 'request-failed' };
    }
  }

  return { status, configure, connect, disconnect, listCalendars, fetch: fetchBlocks };
}

function registerCalendarIpc(ipcMain, handlers) {
  // The leading IPC event argument is dropped: forwarding it would let the
  // handler mistake it for the caller's input.
  ipcMain.handle(`${CHANNEL_PREFIX}:status`, () => handlers.status());
  ipcMain.handle(`${CHANNEL_PREFIX}:configure`, (_event, input) => handlers.configure(input));
  ipcMain.handle(`${CHANNEL_PREFIX}:connect`, () => handlers.connect());
  ipcMain.handle(`${CHANNEL_PREFIX}:disconnect`, () => handlers.disconnect());
  ipcMain.handle(`${CHANNEL_PREFIX}:listCalendars`, () => handlers.listCalendars());
  ipcMain.handle(`${CHANNEL_PREFIX}:fetch`, (_event, input) => handlers.fetch(input));
}

module.exports = { CHANNEL_PREFIX, createCalendarHandlers, registerCalendarIpc };
