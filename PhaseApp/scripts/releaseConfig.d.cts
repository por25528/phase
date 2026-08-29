// Build tooling, not app code: this module is loaded by electron-builder and by
// the release preflight, never by the Electron main process or the renderer.

/** How `xcrun notarytool` authenticates. The Apple-account seam. */
export type NotaryMethod = 'api-key' | 'apple-id';

/** Ad-hoc for developer builds; Developer ID for published releases. */
export type SigningMode = 'adhoc' | 'developer-id';

/** A process environment, or any plain map standing in for one. */
export type Env = Record<string, string | undefined>;

export interface MacConfig {
  target: Array<{ target: string; arch: string[] }>;
  category: string;
  icon: string;
  hardenedRuntime: true;
  entitlements: string;
  entitlementsInherit: string;
  gatekeeperAssess: false;
  notarize: boolean;
  /** Present only for an ad-hoc build, where it is always `'-'`. */
  identity?: string;
}

export interface BuildConfig {
  appId: string;
  productName: string;
  directories: { buildResources: string; output: string };
  files: string[];
  mac: MacConfig;
}

export declare const RELEASE_SIGNING_ENV: 'PHASE_RELEASE_SIGNING';
export declare const NOTARY_METHOD_ENV: 'PHASE_NOTARY_METHOD';
export declare const NOTARY_METHODS: NotaryMethod[];
export declare const DEFAULT_NOTARY_METHOD: NotaryMethod;
export declare const SIGNING_SECRETS: string[];
export declare const NOTARY_SECRETS: Record<NotaryMethod, string[]>;

export declare function signingMode(env: Env): SigningMode;
/** Throws when the method is set to something unknown. */
export declare function notaryMethod(env: Env): NotaryMethod;
/** Secret names this build needs; empty for an ad-hoc developer build. */
export declare function requiredReleaseSecrets(env: Env): string[];
/** Required names that are absent or blank. */
export declare function missingReleaseSecrets(env: Env): string[];
/** Set names belonging to the notarization method that was NOT chosen. */
export declare function conflictingReleaseSecrets(env: Env): string[];
/** Throws naming only the offending variables — never their values. */
export declare function assertReleaseCredentials(env: Env): void;
export declare function macConfig(env: Env): MacConfig;
/** Asserts credentials first, so a misconfigured release cannot start. */
export declare function buildConfig(env: Env): BuildConfig;
