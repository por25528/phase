import { describe, it, expect } from 'vitest';
import {
  authUrl, createOAuth, AUTH_ENDPOINT, TOKEN_ENDPOINT, SCOPES,
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
  const base = {
    secrets: fakeSecrets(),
    httpPost: async (url: string, body: URLSearchParams) => {
      posts.push({ url, body });
      return { ok: true, status: 200, json: { refresh_token: 'REFRESH', access_token: 'ACCESS', expires_in: 3599 } };
    },
    createServer: () => { throw new Error('not used in this task'); },
    openExternal: async () => {},
    now: () => 1_000_000,
    ...over,
  } satisfies OAuthDeps;
  return Object.assign(base, { _posts: posts });
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
