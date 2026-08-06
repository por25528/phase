// The installed-app OAuth flow, entirely in the main process.
//
// Every dependency is injected — HTTP, the loopback server, the browser
// opener, the clock — so the whole flow is exercised offline with no mock
// server. Contract in oauth.d.cts.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// `events.readonly` alone does not authorize calendarList.list, and the
// broader `calendar.readonly` grants more than this feature requires.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

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

function createOAuth(deps) {
  const { secrets, httpPost, now } = deps;

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
      // Keep Google's machine-readable code and human-readable description for triage.
      const code = res.json?.error;
      const description = res.json?.error_description;
      const detail = [code, description].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
      throw new Error(`Google token request failed: ${detail}`);
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
    return {
      refreshToken: json.refresh_token,
      accessToken: json.access_token,
      expiresAt: now() + Number(json.expires_in) * 1000,
    };
  }

  return { exchangeCode };
}

module.exports = { AUTH_ENDPOINT, TOKEN_ENDPOINT, REVOKE_ENDPOINT, SCOPES, authUrl, createOAuth };
