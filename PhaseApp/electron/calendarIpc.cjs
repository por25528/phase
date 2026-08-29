// The renderer-facing surface. Every argument the renderer supplies is
// validated here, and every failure becomes either a typed result or a fixed
// authored rejection — a Google error message can carry a bearer token.

const { CorruptSecretStoreError } = require('./secrets.cjs');
const {
  ConsentAbandonedError,
  CredentialsNotConfiguredError,
  NotConnectedError,
  ReauthRequiredError,
} = require('./oauth.cjs');

const CHANNEL_PREFIX = 'phase-calendar';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CALENDARS = 50;
const MAX_INPUT_STRING_LENGTH = 1024;
const MAX_RANGE_DAYS = 400;

function createCalendarHandlers(deps) {
  const { secrets, oauth, googleClient, normalizeEvents, timeZone, nowIso, managedClient } = deps;

  /**
   * The OAuth client the build ships, or null when it ships none.
   *
   * Resolved on every call rather than captured once: it is read from a file
   * in the bundle, so a release that rotates it takes effect on next launch
   * with nothing stale held in a closure.
   */
  function managed() {
    if (!managedClient) return null;
    try {
      const pair = managedClient();
      return hasClientCredentials(pair) ? pair : null;
    } catch {
      // A credential source that throws is the same as one that ships
      // nothing. It must never take `status()` down at boot.
      return null;
    }
  }

  /** Reading a corrupt store must not throw out of `status`. */
  function safeGet(key) {
    try {
      return { ok: true, value: secrets.get(key) };
    } catch (err) {
      if (err instanceof CorruptSecretStoreError) {
        return { ok: false, value: undefined, error: err };
      }
      throw err;
    }
  }

  function validDate(value) {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function hasClientCredentials(client) {
    return !!(
      client
      && typeof client === 'object'
      && typeof client.clientId === 'string'
      && client.clientId.length > 0
      && typeof client.clientSecret === 'string'
      && client.clientSecret.length > 0
    );
  }

  function validTimeZone(zone) {
    if (typeof zone !== 'string' || zone.length === 0) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
      return true;
    } catch {
      return false;
    }
  }

  function logFailure(operation, err) {
    console.error(`[phase-calendar] ${operation} failed`, err);
  }

  function validFetchInput(input) {
    if (!input || typeof input !== 'object') return false;
    const { rangeStart, rangeEnd, calendarIds } = input;
    if (!validDate(rangeStart) || !validDate(rangeEnd)) return false;
    if (!(rangeEnd > rangeStart)) return false;
    const rangeWidthMs = new Date(`${rangeEnd}T00:00:00.000Z`).getTime()
      - new Date(`${rangeStart}T00:00:00.000Z`).getTime();
    if (rangeWidthMs > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) return false;
    if (!Array.isArray(calendarIds) || calendarIds.length === 0 || calendarIds.length > MAX_CALENDARS) return false;
    return calendarIds.every((id) => (
      typeof id === 'string'
      && id.length > 0
      && id.length <= MAX_INPUT_STRING_LENGTH
    ));
  }

  async function status() {
    const available = secrets.available();
    // Reported even from the corrupt branches: a reset is only worth offering
    // if there is a working configuration on the other side of it, and the
    // renderer cannot know that unless this says so.
    const hasManaged = managed() !== null;
    const client = safeGet('client');
    if (!client.ok) {
      return {
        configured: false, connected: false, corrupt: true, available,
        managed: hasManaged, custom: false, accountId: null, timeZone: timeZone(),
      };
    }
    const account = safeGet('account');
    if (!account.ok) {
      return {
        configured: false, connected: false, corrupt: true, available,
        managed: hasManaged, custom: hasClientCredentials(client.value),
        accountId: null, timeZone: timeZone(),
      };
    }
    const custom = hasClientCredentials(client.value);
    // Either source configures the app. `custom` and `managed` are reported
    // SEPARATELY so the settings surface can tell "you saved your own" from
    // "the build shipped one" — the first has something to revert, the second
    // does not.
    const configured = custom || hasManaged;
    return {
      configured,
      connected: configured && oauth.isConnected(),
      corrupt: false,
      available,
      managed: hasManaged,
      custom,
      accountId: account.value ? account.value.accountId : null,
      timeZone: timeZone(),
    };
  }

  async function configure(input) {
    if (!input || typeof input !== 'object') throw new Error('Google OAuth credentials are required');
    const { clientId, clientSecret } = input;
    const id = typeof clientId === 'string' ? clientId.trim() : '';
    const secret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
    if (!id) throw new Error('A Google OAuth client id is required');
    if (!secret) throw new Error('A Google OAuth client secret is required');
    if (id.length > MAX_INPUT_STRING_LENGTH) throw new Error('The Google OAuth client id is too long');
    if (secret.length > MAX_INPUT_STRING_LENGTH) throw new Error('The Google OAuth client secret is too long');
    try {
      // Reconfiguration changes the Cloud project. Revoke the old grant before
      // replacing the client, while OAuth owns the best-effort revoke policy.
      await oauth.disconnect();
      secrets.remove('account');
      secrets.set('client', { clientId: id, clientSecret: secret });
    } catch (err) {
      if (err instanceof CorruptSecretStoreError) {
        try {
          // The store is unreadable by definition, so resetting it loses no
          // recoverable state and lets the new configuration proceed.
          secrets.reset();
          secrets.set('client', { clientId: id, clientSecret: secret });
          return;
        } catch (recoveryErr) {
          logFailure('configure', recoveryErr);
          throw new Error('Unable to save Google Calendar configuration');
        }
      }
      logFailure('configure', err);
      throw new Error('Unable to save Google Calendar configuration');
    }
  }

  async function connect() {
    try {
      const client = safeGet('client');
      if (!client.ok) {
        logFailure('connect', client.error);
        return { ok: false, reason: 'request-failed' };
      }
      if (!hasClientCredentials(client.value) && !managed()) return { ok: false, reason: 'not-configured' };
      await oauth.connect();
      try {
        // The account id is provenance, and the primary calendar's id IS the
        // user's address — so no extra scope is needed to learn it. This
        // refetchable metadata must not turn a stored connection into failure.
        const primary = (await googleClient.listCalendars()).find((c) => c.primary);
        if (primary) secrets.set('account', { accountId: primary.id });
      } catch (err) {
        logFailure('connect account capture', err);
      }
      return { ok: true };
    } catch (err) {
      logFailure('connect', err);
      if (err instanceof ReauthRequiredError) return { ok: false, reason: 'reauth-required' };
      if (err instanceof NotConnectedError || err instanceof CredentialsNotConfiguredError) {
        return { ok: false, reason: 'not-configured' };
      }
      if (err instanceof ConsentAbandonedError) {
        return { ok: false, reason: 'cancelled' };
      }
      return { ok: false, reason: 'request-failed' };
    }
  }

  async function disconnect() {
    try {
      await oauth.disconnect();
      secrets.remove('account');
    } catch (err) {
      logFailure('disconnect', err);
      throw new Error('Unable to disconnect Google Calendar');
    }
  }

  async function listCalendars() {
    try {
      return await googleClient.listCalendars();
    } catch (err) {
      logFailure('listCalendars', err);
      throw new Error('Unable to load Google calendars');
    }
  }

  async function reset() {
    try {
      secrets.reset();
    } catch (err) {
      logFailure('reset', err);
      throw new Error('Unable to reset Google Calendar configuration');
    }
  }

  async function fetchBlocks(input) {
    if (input && typeof input === 'object' && Array.isArray(input.calendarIds) && input.calendarIds.length === 0) {
      return { ok: false, reason: 'no-calendars' };
    }
    if (!validFetchInput(input)) return { ok: false, reason: 'invalid-range' };
    const client = safeGet('client');
    if (!client.ok) {
      logFailure('fetch', client.error);
      return { ok: false, reason: 'corrupt' };
    }
    if (!hasClientCredentials(client.value) && !managed()) return { ok: false, reason: 'not-configured' };

    let zone;
    try {
      zone = timeZone();
    } catch (err) {
      logFailure('fetch', err);
      return { ok: false, reason: 'request-failed' };
    }
    if (!validTimeZone(zone)) {
      const err = new Error('The machine time zone is invalid');
      logFailure('fetch', err);
      return { ok: false, reason: 'invalid-time-zone' };
    }

    try {
      const events = await googleClient.fetchEvents({
        rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, calendarIds: input.calendarIds,
      });
      let blocks;
      try {
        blocks = normalizeEvents(events, {
          rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, timeZone: zone,
        });
      } catch (err) {
        // normalizeEvents throws RangeError on unparseable calendar data. It
        // must surface as a failure: an empty result would read as a free day.
        if (err instanceof RangeError) {
          logFailure('fetch', err);
          return { ok: false, reason: 'malformed-data' };
        }
        throw err;
      }
      const account = safeGet('account');
      if (!account.ok) {
        logFailure('fetch', account.error);
        return { ok: false, reason: 'corrupt' };
      }
      return {
        ok: true,
        blocks,
        fetchedAt: nowIso(),
        accountId: account.value ? account.value.accountId : null,
        timeZone: zone,
      };
    } catch (err) {
      if (err instanceof NotConnectedError) {
        return { ok: false, reason: 'not-connected' };
      }
      if (err instanceof ReauthRequiredError) {
        return { ok: false, reason: 'reauth-required' };
      }
      logFailure('fetch', err);
      // Deliberately does NOT forward the message. A Google error can quote
      // the Authorization header back at you.
      return { ok: false, reason: 'request-failed' };
    }
  }

  return { status, configure, connect, disconnect, listCalendars, reset, fetch: fetchBlocks };
}

function registerCalendarIpc(ipcMain, handlers) {
  // The leading IPC event argument is dropped: forwarding it would let the
  // handler mistake it for the caller's input.
  ipcMain.handle(`${CHANNEL_PREFIX}:status`, () => handlers.status());
  ipcMain.handle(`${CHANNEL_PREFIX}:configure`, (_event, input) => handlers.configure(input));
  ipcMain.handle(`${CHANNEL_PREFIX}:connect`, () => handlers.connect());
  ipcMain.handle(`${CHANNEL_PREFIX}:disconnect`, () => handlers.disconnect());
  ipcMain.handle(`${CHANNEL_PREFIX}:listCalendars`, () => handlers.listCalendars());
  ipcMain.handle(`${CHANNEL_PREFIX}:reset`, () => handlers.reset());
  ipcMain.handle(`${CHANNEL_PREFIX}:fetch`, (_event, input) => handlers.fetch(input));
}

module.exports = { CHANNEL_PREFIX, createCalendarHandlers, registerCalendarIpc };
