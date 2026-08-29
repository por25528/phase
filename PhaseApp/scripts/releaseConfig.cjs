// The whole macOS packaging decision, as one function of the environment.
//
// There is exactly one switch: `PHASE_RELEASE_SIGNING`. Off (the default, and
// what every developer machine sees) means an ad-hoc signature and no
// notarization — a build that runs on the machine that made it and nowhere
// else. On means a Developer ID signature and a notarized, stapled app, and
// every credential must be present before electron-builder is allowed to start.
//
// That last part is the reason this module exists rather than a static `build`
// block in package.json. electron-builder only WARNS when it cannot assemble
// notarization options ("skipped macOS notarization") and then happily produces
// a DMG that Gatekeeper will reject on every user's Mac. A release must fail
// loudly at the config seam instead, before any minutes are burned.
//
// TWO CONTRACTS, not one. The workflow's preflight checks REPOSITORY SECRETS,
// where the App Store Connect key is base64 (`APPLE_API_KEY_P8_BASE64`).
// electron-builder checks its own environment, where that key is a PATH to a
// decoded file (`APPLE_API_KEY`). They are deliberately different names for
// different things at different stages; conflating them is how a build hands
// notarytool a base64 blob and gets an error that names neither.
//
// No value read here is ever put in a message. Only names.

const fs = require('node:fs');

const RELEASE_SIGNING_ENV = 'PHASE_RELEASE_SIGNING';
const NOTARY_METHOD_ENV = 'PHASE_NOTARY_METHOD';

/** The Apple-account seam: how `xcrun notarytool` is asked to authenticate. */
const NOTARY_METHODS = ['api-key', 'apple-id'];
const DEFAULT_NOTARY_METHOD = 'api-key';

/** Needed for the Developer ID Application certificate, whichever method. */
const SIGNING_SECRETS = ['CSC_LINK', 'CSC_KEY_PASSWORD'];

/** Repository secrets the preflight checks, before any file exists. */
const NOTARY_SOURCE_SECRETS = {
  'api-key': ['APPLE_API_KEY_P8_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  'apple-id': ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
};

/** What electron-builder itself reads at pack time. `APPLE_API_KEY` is a path. */
const NOTARY_BUILDER_VARS = {
  'api-key': ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  'apple-id': ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
};

/**
 * The Google OAuth client a PUBLISHED build ships, so a user does not have to
 * make a Cloud project before they can see their week.
 *
 * A third contract beside the two above, and the one with no natural failure:
 * a release built without these still signs, notarizes and verifies — it just
 * ships an app that asks every user for their own client. So the preflight has
 * to demand them, and only in `developer-id` mode: an ad-hoc developer build
 * legitimately has none and falls back, which is what keeps a contributor with
 * no Google project able to run `npm run build:mac`.
 *
 * Both or neither. Half a pair cannot authenticate, so it is not a pair.
 */
const CALENDAR_SECRETS = ['PHASE_GOOGLE_CLIENT_ID', 'PHASE_GOOGLE_CLIENT_SECRET'];

const ENTITLEMENTS = 'build/entitlements.mac.plist';
const ENTITLEMENTS_INHERIT = 'build/entitlements.mac.inherit.plist';

/** Set, non-blank. An exported-but-empty secret is an absent secret. */
function isSet(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** Only an explicit, affirmative flag turns release signing on. */
function signingMode(env) {
  const flag = (env[RELEASE_SIGNING_ENV] || '').trim().toLowerCase();
  return flag === '1' || flag === 'true' ? 'developer-id' : 'adhoc';
}

function notaryMethod(env) {
  const raw = (env[NOTARY_METHOD_ENV] || '').trim();
  if (raw === '') return DEFAULT_NOTARY_METHOD;
  if (!NOTARY_METHODS.includes(raw)) {
    throw new Error(
      `${NOTARY_METHOD_ENV} must be one of ${NOTARY_METHODS.join(', ')} ` +
        `(default ${DEFAULT_NOTARY_METHOD}).`,
    );
  }
  return raw;
}

/** Repository secrets this release needs. Empty for a developer build. */
function requiredReleaseSecrets(env) {
  if (signingMode(env) !== 'developer-id') return [];
  return [...SIGNING_SECRETS, ...NOTARY_SOURCE_SECRETS[notaryMethod(env)]];
}

/** Environment variables electron-builder needs. Empty for a developer build. */
function requiredBuilderVars(env) {
  if (signingMode(env) !== 'developer-id') return [];
  return [...SIGNING_SECRETS, ...NOTARY_BUILDER_VARS[notaryMethod(env)]];
}

function missingReleaseSecrets(env) {
  return requiredReleaseSecrets(env).filter((name) => !isSet(env[name]));
}

function missingBuilderVars(env) {
  return requiredBuilderVars(env).filter((name) => !isSet(env[name]));
}

/**
 * The names from the method NOT chosen that are nonetheless set.
 *
 * electron-builder checks `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD` before it
 * looks at the API key, so a stray Apple ID variable silently overrides an
 * api-key release. Refusing the mixture is cheaper than debugging it. Both
 * spellings of the other method count — the secret and the path alike.
 */
function conflictingReleaseSecrets(env) {
  if (signingMode(env) !== 'developer-id') return [];
  const chosen = notaryMethod(env);
  const mine = new Set([...NOTARY_SOURCE_SECRETS[chosen], ...NOTARY_BUILDER_VARS[chosen]]);
  const theirs = new Set();
  for (const method of NOTARY_METHODS) {
    if (method === chosen) continue;
    for (const name of [...NOTARY_SOURCE_SECRETS[method], ...NOTARY_BUILDER_VARS[method]]) {
      if (!mine.has(name)) theirs.add(name);
    }
  }
  return [...theirs].filter((name) => isSet(env[name]));
}

function refuseMixture(env, method) {
  const conflicting = conflictingReleaseSecrets(env);
  if (conflicting.length === 0) return;
  throw new Error(
    `Notarization method is "${method}" (${NOTARY_METHOD_ENV}) but these ` +
      `variables from the other method are also set: ${conflicting.join(', ')}. ` +
      `electron-builder prefers APPLE_ID over the API key, so the build ` +
      `would not use the method you chose. Export only one method's variables.`,
  );
}

function refuseMissing(missing, method, kind) {
  throw new Error(
    `Release signing is on (${RELEASE_SIGNING_ENV}) but these ${kind} are ` +
      `missing or blank: ${missing.join(', ')}. ` +
      `Notarization method is "${method}" (${NOTARY_METHOD_ENV}); set every ` +
      `name above, or unset ${RELEASE_SIGNING_ENV} for an ad-hoc developer build.`,
  );
}

/**
 * The PREFLIGHT's check: repository secrets, before anything has been decoded.
 * Throws with names only — never a value — or returns silently.
 */
function assertReleaseSecrets(env) {
  if (signingMode(env) !== 'developer-id') return;
  const method = notaryMethod(env);
  const missing = missingReleaseSecrets(env);
  if (missing.length > 0) refuseMissing(missing, method, 'repository secrets');
  refuseMixture(env, method);
}

/** Which halves of the calendar pair are missing; none for an ad-hoc build. */
function missingCalendarSecrets(env) {
  if (signingMode(env) !== 'developer-id') return [];
  return CALENDAR_SECRETS.filter((name) => !isSet(env[name]));
}

/**
 * The preflight's calendar check. Names only — never a value.
 *
 * It names the escape hatch as well as the failure, because "unset
 * PHASE_RELEASE_SIGNING" is a real answer here in a way it is not for a
 * certificate: an ad-hoc build with no managed client is a supported outcome,
 * not a degraded one.
 */
function assertCalendarCredentials(env) {
  const missing = missingCalendarSecrets(env);
  if (missing.length === 0) return;
  throw new Error(
    `Release signing is on (${RELEASE_SIGNING_ENV}) but these repository ` +
      `secrets for the managed Google OAuth client are missing or blank: ` +
      `${missing.join(', ')}. Both are needed — half a pair cannot ` +
      `authenticate — or the published app will ask every user for their own ` +
      `OAuth client. Set both, or unset ${RELEASE_SIGNING_ENV} for an ad-hoc ` +
      `developer build, which is allowed to ship without them. ` +
      `docs/macos-signing.md lists them and docs/google-calendar-setup.md is ` +
      `where the client itself comes from.`,
  );
}

/**
 * ELECTRON-BUILDER's check, run as its config is loaded.
 *
 * Beyond presence, the API-key path must name a file that is really there: the
 * materialise step can be skipped by a bad `if:` condition, and electron-builder
 * would answer that by warning and shipping an unnotarized DMG.
 *
 * `fileExists` is injected so the rule can be tested without a real key.
 */
function assertBuilderEnv(env, deps = {}) {
  if (signingMode(env) !== 'developer-id') return;
  const fileExists = deps.fileExists || ((p) => fs.existsSync(p));
  const method = notaryMethod(env);
  const missing = missingBuilderVars(env);
  if (missing.length > 0) refuseMissing(missing, method, 'environment variables');
  refuseMixture(env, method);

  if (method === 'api-key' && !fileExists(env.APPLE_API_KEY)) {
    throw new Error(
      `APPLE_API_KEY points at ${env.APPLE_API_KEY}, and there is no file there. ` +
        `It must be a PATH to the decoded .p8 — not the base64 secret, which is ` +
        `APPLE_API_KEY_P8_BASE64. Run scripts/write-apple-api-key.cjs first.`,
    );
  }
}

/**
 * The `mac` block. Hardened runtime and the repo's entitlements apply in both
 * modes deliberately: the developer build then exercises the exact runtime
 * restrictions the shipped app runs under, so an entitlement mistake surfaces
 * on a laptop rather than in a user's Console.
 */
function macConfig(env) {
  const release = signingMode(env) === 'developer-id';
  const mac = {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.productivity',
    icon: 'build/icon.icns',
    hardenedRuntime: true,
    entitlements: ENTITLEMENTS,
    entitlementsInherit: ENTITLEMENTS_INHERIT,
    notarize: release,
  };
  // A release takes its identity from the certificate electron-builder imports
  // from CSC_LINK. Naming one here would only be a second place to be wrong.
  // Ad-hoc is the opposite: electron-builder has NO ad-hoc fallback — with no
  // identity set and no certificate in the keychain it skips signing entirely,
  // and an unsigned Electron app reports as damaged on Apple Silicon.
  if (!release) mac.identity = '-';
  return mac;
}

function buildConfig(env, deps) {
  assertBuilderEnv(env, deps);
  return {
    appId: 'com.secoandhood.phase',
    productName: 'Phase',
    directories: { buildResources: 'build', output: 'release' },
    files: ['dist/**/*', 'electron/**/*'],
    mac: macConfig(env),
  };
}

module.exports = {
  RELEASE_SIGNING_ENV,
  NOTARY_METHOD_ENV,
  NOTARY_METHODS,
  DEFAULT_NOTARY_METHOD,
  SIGNING_SECRETS,
  NOTARY_SOURCE_SECRETS,
  NOTARY_BUILDER_VARS,
  CALENDAR_SECRETS,
  signingMode,
  notaryMethod,
  requiredReleaseSecrets,
  requiredBuilderVars,
  missingReleaseSecrets,
  missingBuilderVars,
  conflictingReleaseSecrets,
  assertReleaseSecrets,
  missingCalendarSecrets,
  assertCalendarCredentials,
  assertBuilderEnv,
  macConfig,
  buildConfig,
};
