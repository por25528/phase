/**
 * The contract for `calendarCredentials.cjs`. Hand-written because the module
 * is CommonJS with no build step; `allowJs` is off deliberately.
 */

export interface ManagedCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ManagedCredentialsDeps {
  /** Usually `process.env`. Injected so no test depends on the real shell. */
  env: Record<string, string | undefined>;
  /** The bundled credentials file's contents, or null when it does not exist. */
  readCredentialsFile(): string | null;
}

/** Written into the bundle at build time, beside the module. Git-ignored. */
export declare const CREDENTIALS_FILE: string;
export declare const CLIENT_ID_ENV: string;
export declare const CLIENT_SECRET_ENV: string;

/** The credentials this build manages, or `null` when it manages none. */
export declare function resolveManagedCredentials(
  deps: ManagedCredentialsDeps,
): ManagedCredentials | null;
