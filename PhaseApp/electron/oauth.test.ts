import { describe, it, expect } from 'vitest';
import {
  authUrl, createOAuth, AUTH_ENDPOINT, TOKEN_ENDPOINT, REVOKE_ENDPOINT, SCOPES, CALLBACK_PATH, DEFAULT_TIMEOUT_MS,
  ConsentAbandonedError, CredentialsNotConfiguredError,
  NotConnectedError, ReauthRequiredError, REFRESH_SKEW_MS,
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
    httpPost: async () => ({ ok: true, status: 200, json: { refresh_token: 'REFRESH', access_token: 'ACCESS', expires_in: 3599 } }),
    createServer: () => { throw new Error('not used in this task'); },
    openExternal: async () => {},
    createPkce: () => ({ verifier: 'V', challenge: 'CH', state: 'ST' }),
    now: () => 1_000_000,
    setTimer: () => { throw new Error('setTimer not stubbed'); },
  };
  const d: OAuthDeps = { ...base, ...over };
  const configuredHttpPost = d.httpPost;
  // Overrides must go through deps({ httpPost }) if _posts is to be asserted.
  d.httpPost = async (url: string, body: URLSearchParams) => {
    posts.push({ url, body });
    return configuredHttpPost(url, body);
  };
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
      .rejects.toBeInstanceOf(CredentialsNotConfiguredError);
  });

  // The build can ship its own OAuth client so nobody has to create a Google
  // Cloud project before planning a week. Nothing is stored in that case —
  // there is no user-supplied pair to store — so the fallback has to be
  // consulted at every use, not once at setup.
  it("falls back to the build's managed credentials when none are stored", async () => {
    const d = deps({
      secrets: fakeSecrets({}),
      managedClient: () => ({ clientId: 'managed-id', clientSecret: 'managed-secret' }),
    });
    await createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' });
    expect(d._posts[0].body.get('client_id')).toBe('managed-id');
    expect(d._posts[0].body.get('client_secret')).toBe('managed-secret');
  });

  // The discriminating test. Saving your own client is a deliberate act, and
  // silently authenticating against the shipped one instead would send the
  // consent screen to the wrong Cloud project with no way to tell.
  it("prefers a stored pair over the build's managed one", async () => {
    const d = deps({
      managedClient: () => ({ clientId: 'managed-id', clientSecret: 'managed-secret' }),
    });
    await createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' });
    expect(d._posts[0].body.get('client_id')).toBe(CLIENT.clientId);
  });

  it('still refuses when neither a stored nor a managed pair exists', async () => {
    const d = deps({ secrets: fakeSecrets({}), managedClient: () => null });
    await expect(createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' }))
      .rejects.toBeInstanceOf(CredentialsNotConfiguredError);
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
  onRequest: (h: FakeServerHandler) => void;
  hit: (url: string) => void;
  closeCount: number;
};

function fakeServer(port = 51234): FakeServer {
  const s: FakeServer = {
    port,
    listening: false,
    closed: false,
    handler: null,
    responses: [],
    closeCount: 0,
    listen: async () => { s.listening = true; return port; },
    close: () => { s.listening = false; s.closed = true; s.closeCount += 1; },
    onRequest: (h: FakeServerHandler) => { s.handler = h; },
    hit(url: string) {
      if (!s.handler) throw new Error('handler not registered');
      s.handler(url, (status, body) => s.responses.push({ status, body }));
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
    })).rejects.toBeInstanceOf(ConsentAbandonedError);
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

  it('404s a malformed request target and keeps waiting for the real one', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({
      state: 'S',
      onReady: () => {
        server.hit('//[');
        server.hit(`${CALLBACK_PATH}?code=REAL&state=S`);
      },
    });
    await expect(pending).resolves.toBe('REAL');
    expect(server.responses.map((r) => r.status)).toEqual([404, 200]);
  });

  it('404s a callback target aimed at another authority', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({
      state: 'S',
      onReady: () => {
        server.hit(`http://evil.com${CALLBACK_PATH}?code=EVIL&state=S`);
        server.hit(`//evil.com${CALLBACK_PATH}?code=EVIL&state=S`);
        server.hit(`${CALLBACK_PATH}?code=REAL&state=S`);
      },
    });
    await expect(pending).resolves.toBe('REAL');
    expect(server.responses.map((r) => r.status)).toEqual([404, 404, 200]);
  });

  it('rejects when the user denies consent', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?error=access_denied&state=S`),
    })).rejects.toBeInstanceOf(ConsentAbandonedError);
    expect(server.closed).toBe(true);
  });

  it('checks state before handling an error response', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'EXPECTED', onReady: () => server.hit(`${CALLBACK_PATH}?error=access_denied`),
    })).rejects.toThrow(/state/i);
    expect(server.responses[0].status).toBe(400);
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
    await expect(pending).rejects.toBeInstanceOf(ConsentAbandonedError);
    expect(server.closed).toBe(true);
  });

  it('defaults the timeout rather than waiting forever', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({ state: 'S', onReady: () => {} });
    expect(d._timers[0].ms).toBe(DEFAULT_TIMEOUT_MS);
    d._timers[0].fn();
    await expect(pending).rejects.toBeInstanceOf(ConsentAbandonedError);
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

  it('closes the socket when onReady returns a rejected promise', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: async () => { throw new Error('browser rejected asynchronously'); },
    })).rejects.toThrow(/browser rejected asynchronously/);
    expect(server.closed).toBe(true);
  });

  it('rejects when the server cannot listen and closes the socket', async () => {
    const server = fakeServer();
    server.listen = async () => { throw new Error('EADDRINUSE'); };
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({ state: 'S', onReady: () => {} }))
      .rejects.toThrow(/EADDRINUSE/);
    expect(server.closed).toBe(true);
  });

  it('turns a synchronous createServer failure into a rejected promise', async () => {
    const d = deps({ createServer: () => { throw new Error('create server failed'); } });
    await expect(createOAuth(d).listenForCode({ state: 'S', onReady: () => {} }))
      .rejects.toThrow(/create server failed/);
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
    expect(server.closeCount).toBe(1);
    expect(server.responses.map((r) => r.status)).toEqual([200, 200]);
    expect(server.responses[1].body).toMatch(/Phase/i);
  });
});

const TOKEN = { refreshToken: 'R', accessToken: 'A', expiresAt: 2_000_000 };

describe('getAccessToken', () => {
  it('reuses a token that is still comfortably valid', async () => {
    const d = deps({ secrets: fakeSecrets({ client: CLIENT, token: TOKEN }), now: () => 1_000_000 });
    expect(await createOAuth(d).getAccessToken()).toBe('A');
    expect(d._posts).toHaveLength(0);
  });

  it('refreshes once the token has expired', async () => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }),
      now: () => 3_000_000,
      httpPost: async () => ({ ok: true, status: 200, json: { access_token: 'FRESH', expires_in: 3599 } }),
    });
    expect(await createOAuth(d).getAccessToken()).toBe('FRESH');
    expect(d._posts[0].body.get('grant_type')).toBe('refresh_token');
    expect(d._posts[0].body.get('refresh_token')).toBe('R');
  });

  // Without the skew, a token that expires mid-flight produces a 401 on a
  // request that had a valid token when it was chosen.
  it('refreshes early, inside the skew window', async () => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }),
      now: () => TOKEN.expiresAt - REFRESH_SKEW_MS + 1,
      httpPost: async () => ({ ok: true, status: 200, json: { access_token: 'FRESH', expires_in: 3599 } }),
    });
    expect(await createOAuth(d).getAccessToken()).toBe('FRESH');
  });

  it.each([
    ['no access token', { expires_in: 3599 }],
    ['no expiry', { access_token: 'FRESH' }],
    ['non-numeric expiry', { access_token: 'FRESH', expires_in: 'not-a-number' }],
    ['no response body', undefined],
  ])('rejects a refresh response with %s', async (_label, json) => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }),
      now: () => 3_000_000,
      httpPost: async () => ({ ok: true, status: 200, json }),
    });
    await expect(createOAuth(d).getAccessToken()).rejects.toThrow(/incomplete token response/i);
  });

  // Google normally omits the refresh token on refresh. Overwriting the
  // stored record wholesale would drop it and silently disconnect.
  it('keeps the refresh token across a refresh', async () => {
    const secrets = fakeSecrets({ client: CLIENT, token: TOKEN });
    const d = deps({
      secrets, now: () => 3_000_000,
      httpPost: async () => ({ ok: true, status: 200, json: { access_token: 'FRESH', expires_in: 3599 } }),
    });
    await createOAuth(d).getAccessToken();
    expect((secrets._bag.token as typeof TOKEN).refreshToken).toBe('R');
    expect((secrets._bag.token as typeof TOKEN).accessToken).toBe('FRESH');
    expect((secrets._bag.token as typeof TOKEN).expiresAt).toBe(3_000_000 + 3599 * 1000);
  });

  it('stores a rotated refresh token when Google returns one', async () => {
    const secrets = fakeSecrets({ client: CLIENT, token: TOKEN });
    const d = deps({
      secrets, now: () => 3_000_000,
      httpPost: async () => ({
        ok: true, status: 200,
        json: { refresh_token: 'ROTATED', access_token: 'FRESH', expires_in: 3599 },
      }),
    });
    await createOAuth(d).getAccessToken();
    expect((secrets._bag.token as typeof TOKEN).refreshToken).toBe('ROTATED');
  });

  it('throws NotConnectedError when there is no stored token', async () => {
    const d = deps({ secrets: fakeSecrets({ client: CLIENT }) });
    await expect(createOAuth(d).getAccessToken()).rejects.toThrow(NotConnectedError);
  });

  // Distinct from NotConnectedError because spec §10 renders them
  // differently: one offers "Connect", the other keeps the cached blocks and
  // prompts to re-connect.
  it('throws ReauthRequiredError when the refresh token has been revoked', async () => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }), now: () => 3_000_000,
      httpPost: async () => ({ ok: false, status: 400, json: { error: 'invalid_grant' } }),
    });
    await expect(createOAuth(d).getAccessToken()).rejects.toThrow(ReauthRequiredError);
  });

  it('does not turn an ordinary network failure into a reauth prompt', async () => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }), now: () => 3_000_000,
      httpPost: async () => ({ ok: false, status: 503, json: { error: 'backendError' } }),
    });
    const err = await createOAuth(d).getAccessToken().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ReauthRequiredError);
  });

  it('propagates a raw refresh httpPost error', async () => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }),
      now: () => 3_000_000,
      httpPost: async () => { throw new Error('refresh transport failed'); },
    });
    await expect(createOAuth(d).getAccessToken()).rejects.toThrow('refresh transport failed');
  });

  it('does not resurrect a token when disconnect finishes during refresh', async () => {
    const secrets = fakeSecrets({ client: CLIENT, token: TOKEN });
    let refreshStarted!: () => void;
    const refreshStartedPromise = new Promise<void>((resolve) => { refreshStarted = resolve; });
    let finishRefresh!: () => void;
    const refreshFinished = new Promise<void>((resolve) => { finishRefresh = resolve; });
    const d = deps({
      secrets,
      now: () => 3_000_000,
      httpPost: async (url) => {
        if (url === TOKEN_ENDPOINT) {
          refreshStarted();
          await refreshFinished;
          return { ok: true, status: 200, json: { access_token: 'FRESH', expires_in: 3599 } };
        }
        return { ok: true, status: 200, json: {} };
      },
    });
    const oauth = createOAuth(d);
    const refreshing = oauth.getAccessToken();
    await refreshStartedPromise;
    await oauth.disconnect();
    finishRefresh();
    await expect(refreshing).resolves.toBe('FRESH');
    expect(secrets._bag.token).toBeUndefined();
  });
});

describe('isConnected', () => {
  it('is false with no token and true with one', () => {
    expect(createOAuth(deps({ secrets: fakeSecrets({ client: CLIENT }) })).isConnected()).toBe(false);
    expect(createOAuth(deps({ secrets: fakeSecrets({ client: CLIENT, token: TOKEN }) })).isConnected()).toBe(true);
  });
});

describe('disconnect', () => {
  it('revokes the refresh token with Google and forgets it', async () => {
    const secrets = fakeSecrets({ client: CLIENT, token: TOKEN });
    const d = deps({ secrets });
    await createOAuth(d).disconnect();
    expect(d._posts[0].url).toBe(REVOKE_ENDPOINT);
    expect(d._posts[0].body.get('token')).toBe('R');
    expect(secrets._bag.token).toBeUndefined();
  });

  // Otherwise you can never disconnect while offline, and the credential
  // stays on disk exactly when the user is trying to remove it.
  it('forgets the token even when the revoke call fails', async () => {
    const secrets = fakeSecrets({ client: CLIENT, token: TOKEN });
    const d = deps({ secrets, httpPost: async () => { throw new Error('offline'); } });
    await expect(createOAuth(d).disconnect()).resolves.toBeUndefined();
    expect(secrets._bag.token).toBeUndefined();
  });

  it('is harmless when nothing is connected', async () => {
    const d = deps({ secrets: fakeSecrets({ client: CLIENT }) });
    await expect(createOAuth(d).disconnect()).resolves.toBeUndefined();
    expect(d._posts).toHaveLength(0);
  });
});

describe('connect', () => {
  function connectDeps() {
    const server = fakeServer(51500);
    const secrets = fakeSecrets({ client: CLIENT });
    const opened: string[] = [];
    const d = loopbackDeps(server, {
      secrets,
      createPkce: () => ({ verifier: 'V', challenge: 'CH', state: 'ST' }),
      openExternal: async (url: string) => {
        opened.push(url);
        server.hit(`${CALLBACK_PATH}?code=CODE&state=ST`);
      },
    });
    return { d, server, secrets, opened };
  }

  it('opens the consent URL built from the PKCE challenge and the bound port', async () => {
    const { d, opened } = connectDeps();
    await createOAuth(d).connect();
    const url = new URL(opened[0]);
    expect(url.searchParams.get('code_challenge')).toBe('CH');
    expect(url.searchParams.get('state')).toBe('ST');
    expect(url.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:51500${CALLBACK_PATH}`);
  });

  it('exchanges the code with the verifier and stores the token', async () => {
    const { d, secrets } = connectDeps();
    await createOAuth(d).connect();
    const exchange = d._posts.find((p) => p.body.get('grant_type') === 'authorization_code')!;
    expect(exchange.body.get('code_verifier')).toBe('V');
    expect((secrets._bag.token as typeof TOKEN).refreshToken).toBe('REFRESH');
  });

  it('stores nothing when the exchange fails', async () => {
    const { d, server, secrets } = connectDeps();
    d.httpPost = async () => ({ ok: false, status: 400, json: { error: 'invalid_grant' } });
    await expect(createOAuth(d).connect()).rejects.toThrow(/invalid_grant/);
    expect(secrets._bag.token).toBeUndefined();
    expect(server.closeCount).toBe(1);
  });

  it('propagates consent denial', async () => {
    const { d, server, secrets } = connectDeps();
    d.openExternal = async () => { server.hit(`${CALLBACK_PATH}?error=access_denied&state=ST`); };
    const pending = createOAuth(d).connect();
    await expect(pending).rejects.toThrow(/access_denied/);
    expect(server.closeCount).toBe(1);
    expect(secrets._bag.token).toBeUndefined();
  });

  it('refuses before the client credentials are configured', async () => {
    const { d } = connectDeps();
    d.secrets = fakeSecrets({});
    await expect(createOAuth(d).connect()).rejects.toBeInstanceOf(CredentialsNotConfiguredError);
  });
});
