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
}

export interface OAuth {
  exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<Tokens>;
  /** Full flow: PKCE, loopback, consent, exchange, store. */
  connect(): Promise<void>;
  /** Revoke with Google, then forget the token locally. */
  disconnect(): Promise<void>;
  /** A valid access token, refreshing when stale. */
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
