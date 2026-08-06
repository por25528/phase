/** The contract for `oauth.cjs`. */
import type { SecretStore } from './secrets.d.cts';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}

/** A one-shot loopback HTTP listener. See Task 4. */
export interface LoopbackServer {
  /** Resolves with the port actually bound. */
  listen(): Promise<number>;
  close(): void;
  /** Called with the request path+query of every inbound request. */
  onRequest(handler: (url: string, respond: (status: number, body: string) => void) => void): void;
}

export interface OAuthDeps {
  secrets: SecretStore;
  httpPost(url: string, body: URLSearchParams): Promise<HttpResponse>;
  createServer(): LoopbackServer;
  openExternal(url: string): Promise<void>;
  /** Injected clock — the module never reads the real one. */
  now(): number;
}

export interface Tokens {
  refreshToken: string;
  accessToken: string;
  /** Absolute epoch-ms expiry, derived from `now()` + `expires_in`. */
  expiresAt: number;
}

export interface OAuth {
  exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<Tokens>;
}

export declare const AUTH_ENDPOINT: string;
export declare const TOKEN_ENDPOINT: string;
export declare const REVOKE_ENDPOINT: string;
/**
 * Exactly two read-only scopes. `events.readonly` alone does NOT authorize
 * `calendarList.list`, and the broader `calendar.readonly` grants more than
 * this feature needs.
 */
export declare const SCOPES: string[];

export declare function authUrl(input: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string;

export declare function createOAuth(deps: OAuthDeps): OAuth;
