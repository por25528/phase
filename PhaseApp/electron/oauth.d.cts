/** The contract for `oauth.cjs`. */
import type { SecretStore } from './secrets.d.cts';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json?: Record<string, unknown>;
}

/** A one-shot loopback HTTP listener. See Task 4. */
export interface LoopbackServer {
  /** Resolves with the port actually bound. */
  listen(): Promise<number>;
  close(): void;
  /** Called with the raw request target of every inbound request. */
  onRequest(handler: (url: string, respond: (status: number, body: string) => void) => void): void;
}

export interface OAuthDeps {
  secrets: SecretStore;
  /**
   * The OAuth client this build ships, consulted only when the user has saved
   * none of their own. Absent in tests that do not care; `null` when the build
   * manages no credentials.
   */
  managedClient?: () => { clientId: string; clientSecret: string } | null;
  httpPost(url: string, body: URLSearchParams): Promise<HttpResponse>;
  createServer(): LoopbackServer;
  openExternal(url: string): Promise<void>;
  /** Injected so `connect` is deterministic under test. */
  createPkce(): { verifier: string; challenge: string; state: string };
  /** Injected clock — the module never reads the real one. */
  now(): number;
  /**
   * Injected so the consent timeout is testable without fake timers.
   * Returns a cancel function.
   */
  setTimer(fn: () => void, ms: number): () => void;
}

export interface Tokens {
  refreshToken: string;
  accessToken: string;
  /** Absolute epoch-ms expiry, derived from `now()` + `expires_in`. */
  expiresAt: number;
  /**
   * The OAuth client id this token was issued for. Not a secret — the id is
   * public in every consent URL — and it is what lets a ROTATED client be told
   * from a revoked grant, so the user is asked to reconnect rather than shown
   * an opaque refresh failure that never clears.
   *
   * Absent on a token stored before this field existed; such a token is
   * trusted and stamped on its next refresh.
   */
  clientId?: string;
}

export interface OAuth {
  exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<Tokens>;
  /** Full flow: PKCE, loopback, consent, exchange, store. */
  connect(): Promise<void>;
  /** Revoke with Google and forget the token locally even when revocation fails. */
  disconnect(): Promise<void>;
  /**
   * Returns a valid access token, refreshing when stale.
   *
   * Throws `NotConnectedError` when none is stored. Throws
   * `ReauthRequiredError` in three cases, all of which mean a reconnect is the
   * only cure: the stored token belongs to a different OAuth client (caught
   * before the request), Google answers `invalid_grant` (the grant is revoked
   * or expired), or Google answers `invalid_client` / `unauthorized_client` /
   * a bare 401 (the client is gone or its secret was rotated). The last of
   * those is the only way to discover a rotation under a token stored before
   * `Tokens.clientId` existed. Plain `Error` for everything else, which is
   * transient by elimination and must not prompt for reauth.
   */
  getAccessToken(): Promise<string>;
  isConnected(): boolean;
  /**
   * Start the one-shot loopback listener and resolve with the authorization
   * code.
   *
   * `onReady` is called once the port is bound, with the redirect URI the
   * caller must put in the consent URL — the port is chosen by the OS, so it
   * cannot be known before listening.
   *
   * The socket is closed on EVERY outcome: success, state mismatch, denial,
   * malformed callback, timeout, and an `onReady` that throws. A leaked
   * listening socket is a security defect.
   */
  listenForCode(input: {
    state: string;
    timeoutMs?: number;
    onReady(redirectUri: string): void | Promise<void>;
  }): Promise<string>;
}

export declare const AUTH_ENDPOINT: string;
export declare const TOKEN_ENDPOINT: string;
export declare const REVOKE_ENDPOINT: string;
/** The only path the listener accepts. Everything else 404s. */
export declare const CALLBACK_PATH: string;
export declare const DEFAULT_TIMEOUT_MS: number;
/** No token stored at all — offer "Connect". */
export declare class NotConnectedError extends Error {}
/** The refresh token was rejected — keep cached blocks, prompt to re-connect. */
export declare class ReauthRequiredError extends Error {}
/** Consent was denied, callback state mismatched, or the browser timed out. */
export declare class ConsentAbandonedError extends Error {
  constructor(message?: string);
}
/** OAuth client id or secret has not been configured. */
export declare class CredentialsNotConfiguredError extends Error {}
/** Refresh this far before nominal expiry, so a request cannot expire mid-flight. */
export declare const REFRESH_SKEW_MS: number;
/**
 * Exactly two read-only scopes. `events.readonly` alone does NOT authorize
 * `calendarList.list`, and the broader `calendar.readonly` grants more than
 * this feature needs.
 */
export declare const SCOPES: readonly string[];

export declare function authUrl(input: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string;

export declare function createOAuth(deps: OAuthDeps): OAuth;
