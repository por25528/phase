// The installed-app OAuth flow, entirely in the main process.
//
// Every dependency is injected — HTTP, the loopback server, the browser
// opener, the clock — so the whole flow is exercised offline with no mock
// server. Contract in oauth.d.cts.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const CALLBACK_PATH = '/callback';
const DEFAULT_TIMEOUT_MS = 120_000;

class NotConnectedError extends Error {
  constructor() { super('Google Calendar is not connected'); this.name = 'NotConnectedError'; }
}
class ReauthRequiredError extends Error {
  constructor() { super('Google rejected the stored credential; reconnect required'); this.name = 'ReauthRequiredError'; }
}
class ConsentAbandonedError extends Error {
  constructor(message = 'Google authorization was abandoned') {
    super(message);
    this.name = 'ConsentAbandonedError';
  }
}
class CredentialsNotConfiguredError extends Error {
  constructor() {
    super('Google client credentials are not configured');
    this.name = 'CredentialsNotConfiguredError';
  }
}

const REFRESH_SKEW_MS = 60_000;

const SUCCESS_PAGE = '<!doctype html><meta charset="utf-8"><title>Phase</title>'
  + '<body style="font:16px system-ui;padding:3rem"><p>Phase is connected. You can close this tab.</p>';

// `events.readonly` alone does not authorize calendarList.list, and the
// broader `calendar.readonly` grants more than this feature requires.
const SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
]);

function authUrl({ clientId, redirectUri, challenge, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // Without offline+consent Google withholds the refresh token on a repeat
    // authorization, and the connection dies silently when the access token
    // expires an hour later.
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Google's `error` is what you triage from; `error_description` is what you read. Keep both. */
function tokenErrorDetail(res) {
  const code = res.json?.error;
  const description = res.json?.error_description;
  return [code, description].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
}

function createOAuth(deps) {
  const { secrets, httpPost, now, createServer, setTimer, openExternal, createPkce, managedClient } = deps;

  /**
   * The OAuth client to authenticate as: the user's own if they saved one,
   * otherwise the pair this build manages.
   *
   * Stored wins. Saving your own client is a deliberate act, and quietly
   * authenticating against the shipped one instead would send the consent
   * screen to a different Cloud project with nothing on screen to say so.
   *
   * The managed pair is consulted on every use rather than copied into the
   * secret store once: it belongs to the BUILD, so a release that rotates it
   * must take effect without a stale copy on disk overriding it.
   */
  function client() {
    const stored = secrets.get('client');
    if (stored && stored.clientId && stored.clientSecret) return stored;
    const managed = managedClient ? managedClient() : null;
    if (managed && managed.clientId && managed.clientSecret) return managed;
    throw new CredentialsNotConfiguredError();
  }

  async function postForTokens(body) {
    const res = await httpPost(TOKEN_ENDPOINT, body);
    if (!res.ok) {
      throw new Error(`Google token request failed: ${tokenErrorDetail(res)}`);
    }
    return res.json;
  }

  async function exchangeCode({ code, verifier, redirectUri }) {
    const { clientId, clientSecret } = client();
    const json = await postForTokens(new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }));
    // Google returns a refresh token only on the first consent, or when
    // prompt=consent forces one. Accepting its absence would leave a
    // connection that stops working within the hour with no way to renew.
    if (!json.refresh_token) {
      throw new Error('Google returned no refresh token; re-run consent with prompt=consent');
    }
    // A missing access token fails Task 5's truthy cache check; a NaN expiry
    // makes its time comparison false, so either malformed record refreshes
    // on every call instead of being reused.
    if (!json.access_token || !Number.isFinite(Number(json.expires_in))) {
      throw new Error('Google returned an incomplete token response');
    }
    return {
      refreshToken: json.refresh_token,
      accessToken: json.access_token,
      expiresAt: now() + Number(json.expires_in) * 1000,
      // Which OAuth client issued this. Not a secret — the id is public in
      // every consent URL — and it is what lets a rotated client be told from
      // a revoked grant. See `getAccessToken`.
      clientId,
    };
  }

  function storedToken() {
    const token = secrets.get('token');
    return token && token.refreshToken ? token : null;
  }

  async function getAccessToken() {
    const token = storedToken();
    if (!token) throw new NotConnectedError();

    const { clientId, clientSecret } = client();

    /*
     * A token issued by a different OAuth client buys nothing.
     *
     * The build's own client can rotate — a new release, a revoked Cloud
     * credential — and Google then answers the refresh with `invalid_client`
     * or a bare 400, which reaches the renderer as `request-failed`: a
     * transient-looking error the UI is right to shrug at and that will never
     * clear on its own. Caught here, before the request, it becomes the one
     * thing the user can act on.
     *
     * The token is dropped rather than kept, so nothing retries it and
     * `status()` stops claiming a connection that cannot be spent.
     *
     * A token stored before this field existed carries no client id and is
     * TRUSTED: forcing every existing installation to reconnect on upgrade
     * would be a worse bug than the one this fixes. The refresh below stamps
     * it, after which rotation is caught like any other.
     */
    if (token.clientId && token.clientId !== clientId) {
      secrets.remove('token');
      throw new ReauthRequiredError();
    }

    // Refresh a minute early: a token that expires mid-flight produces a 401
    // on a request that held a valid token when it was chosen.
    if (token.accessToken && now() < token.expiresAt - REFRESH_SKEW_MS) return token.accessToken;

    const res = await httpPost(TOKEN_ENDPOINT, new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refreshToken,
      grant_type: 'refresh_token',
    }));
    if (!res.ok) {
      // invalid_grant means the GRANT is revoked or expired — a DIFFERENT
      // user-facing state from "never connected", per spec §10. The token is
      // left in place: it is the thing the user is being asked to renew.
      if (res.json?.error === 'invalid_grant') throw new ReauthRequiredError();

      /*
       * invalid_client means the CLIENT is gone or its secret was rotated in
       * the Cloud console, and a bare 401 is the same refusal with a body that
       * would not parse. Neither is transient, and neither used to be caught:
       * they became a plain Error, which the renderer reads as
       * `request-failed` — a state the UI is right to shrug at and that will
       * never clear on its own.
       *
       * This is the ONLY way to discover a rotation under a token stored
       * before `clientId` was recorded, since there is no id on it to compare.
       * Catching it here closes that gap without forcing every existing
       * installation to reconnect on upgrade.
       *
       * The token IS dropped, unlike on invalid_grant: it is bound to a client
       * that no longer exists, so nothing can renew it and keeping it only
       * means retrying a request that cannot succeed.
       */
      if (
        res.status === 401
        || res.json?.error === 'invalid_client'
        || res.json?.error === 'unauthorized_client'
      ) {
        secrets.remove('token');
        throw new ReauthRequiredError();
      }

      // Everything else — a 503, a captive portal, a dropped association — is
      // transient. Prompting for a reconnect that would not fix it teaches
      // people to reconnect at every hiccup until the prompt means nothing.
      throw new Error(`Google token refresh failed: ${tokenErrorDetail(res)}`);
    }
    if (!res.json?.access_token || !Number.isFinite(Number(res.json?.expires_in))) {
      throw new Error('Google returned an incomplete token response');
    }
    // Google normally omits the refresh token on refresh, so carry the prior
    // one forward unless the response rotates it.
    const next = {
      refreshToken: res.json.refresh_token || token.refreshToken,
      accessToken: res.json.access_token,
      expiresAt: now() + Number(res.json.expires_in) * 1000,
      // Stamped on every refresh, which is what upgrades a token stored before
      // the field existed into one whose client can be checked.
      clientId,
    };
    // A disconnect may have landed while this refresh was in flight. Writing
    // now would restore the credential the user just asked to delete.
    const current = storedToken();
    if (!current || current.refreshToken !== token.refreshToken) return next.accessToken;
    secrets.set('token', next);
    return next.accessToken;
  }

  async function connect() {
    client(); // fail before opening a browser if unconfigured
    const pkce = createPkce();
    let redirectUri;
    const code = await listenForCode({
      state: pkce.state,
      onReady: (boundRedirectUri) => {
        redirectUri = boundRedirectUri;
        return openExternal(authUrl({
          clientId: client().clientId,
          redirectUri: boundRedirectUri,
          challenge: pkce.challenge,
          state: pkce.state,
        }));
      },
    });
    // The redirect URI must match the one the code was issued against.
    const tokens = await exchangeCode({ code, verifier: pkce.verifier, redirectUri });
    secrets.set('token', tokens);
  }

  async function disconnect() {
    const token = storedToken();
    if (!token) return;
    try {
      await httpPost(REVOKE_ENDPOINT, new URLSearchParams({ token: token.refreshToken }));
    } catch {
      // Deliberately swallowed: otherwise you could never disconnect while
      // offline, and the credential would stay on disk at exactly the moment
      // the user is asking to remove it. Local removal is what matters.
    }
    secrets.remove('token');
  }

  function isConnected() { return storedToken() !== null; }

  function listenForCode({ state, timeoutMs = DEFAULT_TIMEOUT_MS, onReady }) {
    return new Promise((resolve, reject) => {
      const server = createServer();
      let settled = false;
      let cancelTimer = () => {};

      // Every exit runs through here, so there is exactly one place that can
      // forget to close the socket — and it does not.
      function settle(fn, value) {
        if (settled) return;
        settled = true;
        // Close before injected cleanup: if timer cancellation is miswired and
        // throws, the listening socket must already be gone.
        server.close();
        try {
          cancelTimer();
        } finally {
          fn(value);
        }
      }

      server.onRequest((url, respond) => {
        // `url` is the raw request target, usually path + query. Only the
        // exact local path is accepted; a prefix match would let
        // /callback/anything through.
        let parsed;
        try {
          parsed = new URL(url, 'http://127.0.0.1');
        } catch {
          // Node delivers targets like `//[` verbatim, and an escaping throw
          // would skip respond(), settle() and close() — leaving the socket up.
          respond(404, 'Not found');
          return;
        }
        if (parsed.origin !== 'http://127.0.0.1' || parsed.pathname !== CALLBACK_PATH) {
          respond(404, 'Not found');
          return;
        }
        // Compared before the code is used at all: a mismatched state means
        // this response is not the one we asked for.
        if (parsed.searchParams.get('state') !== state) {
          respond(400, 'Authorization failed. You can close this tab.');
          settle(reject, new ConsentAbandonedError('Authorization state did not match; aborting'));
          return;
        }
        const error = parsed.searchParams.get('error');
        if (error) {
          respond(400, 'Authorization failed. You can close this tab.');
          const failure = error === 'access_denied'
            ? new ConsentAbandonedError(`Google authorization failed: ${error}`)
            : new Error(`Google authorization failed: ${error}`);
          settle(reject, failure);
          return;
        }
        const code = parsed.searchParams.get('code');
        if (!code) {
          respond(400, 'Authorization failed. You can close this tab.');
          settle(reject, new Error('Callback carried no authorization code'));
          return;
        }
        respond(200, SUCCESS_PAGE);
        settle(resolve, code);
      });

      cancelTimer = setTimer(() => {
        settle(reject, new ConsentAbandonedError('Authorization timed out; no response from the browser'));
      }, timeoutMs);

      Promise.resolve()
        .then(() => server.listen())
        .then((port) => onReady(`http://127.0.0.1:${port}${CALLBACK_PATH}`))
        .catch((err) => settle(reject, err));
    });
  }

  return { exchangeCode, listenForCode, connect, disconnect, getAccessToken, isConnected };
}

module.exports = {
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  REVOKE_ENDPOINT,
  SCOPES,
  CALLBACK_PATH,
  DEFAULT_TIMEOUT_MS,
  authUrl,
  createOAuth,
  NotConnectedError,
  ReauthRequiredError,
  ConsentAbandonedError,
  CredentialsNotConfiguredError,
  REFRESH_SKEW_MS,
};
