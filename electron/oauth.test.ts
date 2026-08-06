import { describe, it, expect } from 'vitest';
import {
  authUrl, createOAuth, AUTH_ENDPOINT, TOKEN_ENDPOINT, SCOPES, CALLBACK_PATH, DEFAULT_TIMEOUT_MS,
  type OAuthDeps,
} from './oauth.cjs';

const CLIENT = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'csecret' };

/** A secret store backed by a plain object — Task 1's module is not under test here. */
function fakeSecrets(seed: Record<string, unknown> = { client: CLIENT }) {
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

function deps(over: Partial<OAuthDeps> = {}): OAuthDeps & { _posts: Array<{ url: string; body: URLSearchParams }> } {
  const posts: Array<{ url: string; body: URLSearchParams }> = [];
  const base: OAuthDeps = {
    secrets: fakeSecrets(),
    httpPost: async (url: string, body: URLSearchParams) => {
      posts.push({ url, body });
      return { ok: true, status: 200, json: { refresh_token: 'REFRESH', access_token: 'ACCESS', expires_in: 3599 } };
    },
    createServer: () => { throw new Error('not used in this task'); },
    openExternal: async () => {},
    now: () => 1_000_000,
    setTimer: () => () => {},
  };
  const d: OAuthDeps = { ...base, ...over };
  return Object.assign(d, { _posts: posts });
}

describe('authUrl', () => {
  const url = () => new URL(authUrl({
    clientId: CLIENT.clientId, redirectUri: 'http://127.0.0.1:51234/callback',
    challenge: 'CHALLENGE', state: 'STATE',
  }));

  it('points at Google’s consent endpoint', () => {
    expect(authUrl({ clientId: 'c', redirectUri: 'r', challenge: 'x', state: 's' }))
      .toContain(AUTH_ENDPOINT);
  });

  it('requests exactly the two read-only scopes, and no broader one', () => {
    const scope = url().searchParams.get('scope')!.split(' ');
    expect(scope.sort()).toEqual([...SCOPES].sort());
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.events.readonly');
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.calendarlist.readonly');
    // The broad scope grants write access we never want.
    expect(scope).not.toContain('https://www.googleapis.com/auth/calendar');
  });

  it('uses the S256 challenge method, never plain', () => {
    expect(url().searchParams.get('code_challenge_method')).toBe('S256');
    expect(url().searchParams.get('code_challenge')).toBe('CHALLENGE');
  });

  it('carries the state and the loopback redirect', () => {
    expect(url().searchParams.get('state')).toBe('STATE');
    expect(url().searchParams.get('redirect_uri')).toBe('http://127.0.0.1:51234/callback');
  });

  // Without these two Google returns no refresh token on a repeat consent,
  // and the connection silently dies an hour later.
  it('asks for offline access and forces the consent screen', () => {
    expect(url().searchParams.get('access_type')).toBe('offline');
    expect(url().searchParams.get('prompt')).toBe('consent');
  });

  it('requests an authorization code', () => {
    expect(url().searchParams.get('response_type')).toBe('code');
  });

  it('percent-encodes values rather than concatenating them raw', () => {
    const raw = authUrl({ clientId: 'a b&c', redirectUri: 'http://127.0.0.1:1/cb', challenge: 'x', state: 's' });
    expect(raw).not.toContain('a b&c');
    expect(new URL(raw).searchParams.get('client_id')).toBe('a b&c');
  });
});

describe('exchangeCode', () => {
  it('posts to the token endpoint with the verifier, not the challenge', async () => {
    const d = deps();
    await createOAuth(d).exchangeCode({ code: 'CODE', verifier: 'VERIFIER', redirectUri: 'http://127.0.0.1:1/cb' });
    expect(d._posts).toHaveLength(1);
    expect(d._posts[0].url).toBe(TOKEN_ENDPOINT);
    expect(d._posts[0].body.get('code_verifier')).toBe('VERIFIER');
    expect(d._posts[0].body.get('grant_type')).toBe('authorization_code');
    expect(d._posts[0].body.get('code')).toBe('CODE');
    expect(d._posts[0].body.get('redirect_uri')).toBe('http://127.0.0.1:1/cb');
  });

  it('sends the stored client credentials', async () => {
    const d = deps();
    await createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' });
    expect(d._posts[0].body.get('client_id')).toBe(CLIENT.clientId);
    expect(d._posts[0].body.get('client_secret')).toBe(CLIENT.clientSecret);
  });

  it('returns the tokens with an absolute expiry derived from the injected clock', async () => {
    const d = deps({ now: () => 5_000_000 });
    const out = await createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' });
    expect(out.refreshToken).toBe('REFRESH');
    expect(out.accessToken).toBe('ACCESS');
    expect(out.expiresAt).toBe(5_000_000 + 3599 * 1000);
  });

  it('fails when the client credentials are not configured', async () => {
    const d = deps({ secrets: fakeSecrets({}) });
    await expect(createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' }))
      .rejects.toThrow(/not configured/i);
  });

  // Google returns a refresh token only when it feels like it. Treating its
  // absence as success would leave a connection that dies within the hour.
  it('fails when Google returns no refresh token', async () => {
    const d = deps({
      httpPost: async () => ({ ok: true, status: 200, json: { access_token: 'A', expires_in: 3599 } }),
    });
    await expect(createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' }))
      .rejects.toThrow(/refresh token/i);
  });

  it('fails when Google returns no access token', async () => {
    const d = deps({
      httpPost: async () => ({ ok: true, status: 200, json: { refresh_token: 'R', expires_in: 3599 } }),
    });
    await expect(createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' }))
      .rejects.toThrow(/incomplete token response/i);
  });

  it('fails when Google omits expires_in', async () => {
    const d = deps({
      httpPost: async () => ({ ok: true, status: 200, json: { refresh_token: 'R', access_token: 'A' } }),
    });
    await expect(createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' }))
      .rejects.toThrow(/incomplete token response/i);
  });

  it.each([
    ['both fields', { error: 'invalid_grant', error_description: 'Bad code' }, 'invalid_grant — Bad code'],
    ['code only', { error: 'invalid_grant' }, 'invalid_grant'],
    ['description only', { error_description: 'Bad code' }, 'Bad code'],
    ['an empty code', { error: '', error_description: 'Bad code' }, 'Bad code'],
    ['nothing at all', {}, 'HTTP 503'],
  ])('reports %s', async (_label, json, expected) => {
    const d = deps({ httpPost: async () => ({ ok: false, status: 503, json }) });
    const rejection = createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' });
    await expect(rejection).rejects.toThrow(expected);
    await expect(rejection).rejects.not.toThrow(CLIENT.clientSecret);
  });
});

/**
 * A fake loopback server. `hit(path)` plays the role of the browser
 * arriving on the redirect; `closed` and `listening` let a test assert the
 * socket's lifecycle, which is the security property this task exists for.
 */
type FakeServerHandler = (url: string, respond: (status: number, body: string) => void) => void;
type FakeServer = {
  port: number;
  listening: boolean;
  closed: boolean;
  handler: null | FakeServerHandler;
  responses: Array<{ status: number; body: string }>;
  listen: () => Promise<number>;
  close: () => void;
  onRequest: (h: FakeServer['handler']) => void;
  hit: (url: string) => void;
};

function fakeServer(port = 51234): FakeServer {
  const s: FakeServer = {
    port,
    listening: false,
    closed: false,
    handler: null as null | ((url: string, respond: (status: number, body: string) => void) => void),
    responses: [] as Array<{ status: number; body: string }>,
    listen: async () => { s.listening = true; return port; },
    close: () => { s.listening = false; s.closed = true; },
    onRequest: (h: typeof s.handler) => { s.handler = h; },
    hit(url: string) {
      s.handler!(url, (status, body) => s.responses.push({ status, body }));
    },
  };
  return s;
}

function loopbackDeps(server: ReturnType<typeof fakeServer>, over: Partial<OAuthDeps> = {}) {
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const d = deps({
    createServer: () => server,
    setTimer: (fn: () => void, ms: number) => {
      const entry = { fn, ms, cancelled: false };
      timers.push(entry);
      return () => { entry.cancelled = true; };
    },
    ...over,
  });
  return Object.assign(d, { _timers: timers });
}

describe('listenForCode', () => {
  it('reports the redirect URI with the bound port before opening the browser', async () => {
    const server = fakeServer(51999);
    const d = loopbackDeps(server);
    const seen: string[] = [];
    const pending = createOAuth(d).listenForCode({
      state: 'S', onReady: (uri) => { seen.push(uri); server.hit(`${CALLBACK_PATH}?code=C&state=S`); },
    });
    await expect(pending).resolves.toBe('C');
    expect(seen).toEqual([`http://127.0.0.1:51999${CALLBACK_PATH}`]);
  });

  it('resolves with the code and closes the socket', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?code=CODE&state=S`),
    })).resolves.toBe('CODE');
    expect(server.closed).toBe(true);
    expect(server.listening).toBe(false);
  });

  it('shows the user something readable in the browser on success', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?code=C&state=S`),
    });
    expect(server.responses[0].status).toBe(200);
    expect(server.responses[0].body).toMatch(/Phase/i);
  });

  // The CSRF guard. Accepting a mismatched state would let any page that can
  // reach the loopback port inject an authorization code.
  it('rejects a state mismatch and still closes the socket', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'EXPECTED', onReady: () => server.hit(`${CALLBACK_PATH}?code=C&state=ATTACKER`),
    })).rejects.toThrow(/state/i);
    expect(server.closed).toBe(true);
    expect(server.responses[0].status).toBe(400);
  });

  it('404s any other path and keeps waiting for the real one', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({
      state: 'S',
      onReady: () => {
        server.hit('/');
        server.hit('/favicon.ico');
        server.hit(`${CALLBACK_PATH}/extra?code=C&state=S`);
        server.hit(`${CALLBACK_PATH}?code=REAL&state=S`);
      },
    });
    await expect(pending).resolves.toBe('REAL');
    expect(server.responses.slice(0, 3).map((r) => r.status)).toEqual([404, 404, 404]);
  });

  it('rejects when the user denies consent', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?error=access_denied&state=S`),
    })).rejects.toThrow(/access_denied/);
    expect(server.closed).toBe(true);
  });

  it('rejects when the callback carries neither a code nor an error', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?state=S`),
    })).rejects.toThrow(/no authorization code/i);
    expect(server.closed).toBe(true);
  });

  // Without this the socket stays open forever when the user closes the
  // consent tab and walks away.
  it('times out and closes the socket', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({ state: 'S', timeoutMs: 5000, onReady: () => {} });
    expect(d._timers[0].ms).toBe(5000);
    d._timers[0].fn();
    await expect(pending).rejects.toThrow(/timed out/i);
    expect(server.closed).toBe(true);
  });

  it('defaults the timeout rather than waiting forever', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({ state: 'S', onReady: () => {} });
    expect(d._timers[0].ms).toBe(DEFAULT_TIMEOUT_MS);
    d._timers[0].fn();
    await expect(pending).rejects.toThrow(/timed out/i);
  });

  it('cancels the timeout once the code arrives', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?code=C&state=S`),
    });
    expect(d._timers[0].cancelled).toBe(true);
  });

  it('closes the socket when onReady itself throws', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: () => { throw new Error('browser would not open'); },
    })).rejects.toThrow(/browser would not open/);
    expect(server.closed).toBe(true);
  });

  it('ignores a second callback after the first has settled', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({
      state: 'S',
      onReady: () => {
        server.hit(`${CALLBACK_PATH}?code=FIRST&state=S`);
        server.hit(`${CALLBACK_PATH}?code=SECOND&state=S`);
      },
    });
    await expect(pending).resolves.toBe('FIRST');
  });
});
