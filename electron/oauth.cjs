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
  const { secrets, httpPost, now, createServer, setTimer } = deps;

  function client() {
    const stored = secrets.get('client');
    if (!stored || !stored.clientId || !stored.clientSecret) {
      throw new Error('Google client credentials are not configured');
    }
    return stored;
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
    };
  }

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
          settle(reject, new Error('Authorization state did not match; aborting'));
          return;
        }
        const error = parsed.searchParams.get('error');
        if (error) {
          respond(400, 'Authorization failed. You can close this tab.');
          settle(reject, new Error(`Google authorization failed: ${error}`));
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
        settle(reject, new Error('Authorization timed out; no response from the browser'));
      }, timeoutMs);

      Promise.resolve()
        .then(() => server.listen())
        .then((port) => onReady(`http://127.0.0.1:${port}${CALLBACK_PATH}`))
        .catch((err) => settle(reject, err));
    });
  }

  return { exchangeCode, listenForCode };
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
};
