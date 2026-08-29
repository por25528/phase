// Build tooling, not app code: this module is loaded by electron-builder and by
// the release preflight, never by the Electron main process or the renderer.

/** How `xcrun notarytool` authenticates. The Apple-account seam. */
export type NotaryMethod = 'api-key' | 'apple-id';

/** Ad-hoc for developer builds; Developer ID for published releases. */
export type SigningMode = 'adhoc' | 'developer-id';

/** A process environment, or any plain map standing in for one. */
export type Env = Record<string, string | undefined>;

/** Injectable so the key-file rule can be tested without a real key. */
export interface BuilderEnvDeps {
  fileExists?(filePath: string | undefined): boolean;
}

export interface MacConfig {
  target: Array<{ target: string; arch: string[] }>;
  category: string;
  icon: string;
  hardenedRuntime: true;
  entitlements: string;
  entitlementsInherit: string;
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
/** Repository secrets, checked by the preflight before anything is decoded. */
export declare const NOTARY_SOURCE_SECRETS: Record<NotaryMethod, string[]>;
/** What electron-builder reads at pack time; `APPLE_API_KEY` is a path. */
export declare const NOTARY_BUILDER_VARS: Record<NotaryMethod, string[]>;

export declare function signingMode(env: Env): SigningMode;
/** Throws when the method is set to something unknown. */
export declare function notaryMethod(env: Env): NotaryMethod;
/** Repository secret names this release needs; empty for an ad-hoc build. */
export declare function requiredReleaseSecrets(env: Env): string[];
/** Environment variable names electron-builder needs; empty for an ad-hoc build. */
export declare function requiredBuilderVars(env: Env): string[];
export declare function missingReleaseSecrets(env: Env): string[];
export declare function missingBuilderVars(env: Env): string[];
/** Set names belonging to the notarization method that was NOT chosen. */
export declare function conflictingReleaseSecrets(env: Env): string[];
/** The preflight's check. Throws naming only variables — never their values. */
export declare function assertReleaseSecrets(env: Env): void;
/** electron-builder's check, including that the API key file really exists. */
export declare function assertBuilderEnv(env: Env, deps?: BuilderEnvDeps): void;
export declare function macConfig(env: Env): MacConfig;
/** Asserts the builder environment first, so a bad release cannot start. */
export declare function buildConfig(env: Env, deps?: BuilderEnvDeps): BuildConfig;
