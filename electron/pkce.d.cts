/** The contract for `pkce.cjs`. */

export interface Pkce {
  /** Never leaves the main process. Sent only to the token endpoint. */
  verifier: string;
  /** base64url(SHA-256(verifier)) — the S256 method. Sent to the consent URL. */
  challenge: string;
  /** CSRF guard; compared against the value the loopback listener receives. */
  state: string;
}

/** base64url per RFC 4648 §5: URL-safe alphabet, no padding. */
export declare function base64url(bytes: Buffer): string;

/**
 * A fresh PKCE triple.
 *
 * `randomBytes` is injectable for tests only; production uses
 * `node:crypto`'s CSPRNG and must never pass a substitute.
 */
export declare function createPkce(randomBytes?: (n: number) => Buffer): Pkce;
