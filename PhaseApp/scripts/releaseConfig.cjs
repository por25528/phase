// The whole macOS packaging decision, as one pure function of the environment.
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
// No value read here is ever put in a message. Only names.

const RELEASE_SIGNING_ENV = 'PHASE_RELEASE_SIGNING';
const NOTARY_METHOD_ENV = 'PHASE_NOTARY_METHOD';

/** The Apple-account seam: how `xcrun notarytool` is asked to authenticate. */
const NOTARY_METHODS = ['api-key', 'apple-id'];
const DEFAULT_NOTARY_METHOD = 'api-key';

/** Needed for the Developer ID Application certificate, whichever method. */
const SIGNING_SECRETS = ['CSC_LINK', 'CSC_KEY_PASSWORD'];

/** Needed for notarization, per method. The names electron-builder reads. */
const NOTARY_SECRETS = {
  'api-key': ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  'apple-id': ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
};

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

/** The secret names this build needs. Empty for a developer build. */
function requiredReleaseSecrets(env) {
  if (signingMode(env) !== 'developer-id') return [];
  return [...SIGNING_SECRETS, ...NOTARY_SECRETS[notaryMethod(env)]];
}

function missingReleaseSecrets(env) {
  return requiredReleaseSecrets(env).filter((name) => !isSet(env[name]));
}

/**
 * The names from the method NOT chosen that are nonetheless set.
 *
 * electron-builder checks `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD` before it
 * looks at the API key, so a stray Apple ID variable silently overrides an
 * api-key release. Refusing the mixture is cheaper than debugging it.
 */
function conflictingReleaseSecrets(env) {
  if (signingMode(env) !== 'developer-id') return [];
  const chosen = notaryMethod(env);
  const other = NOTARY_METHODS.filter((m) => m !== chosen);
  return other
    .flatMap((m) => NOTARY_SECRETS[m])
    .filter((name) => isSet(env[name]));
}

/** Throws with names only — never a value — or returns silently. */
function assertReleaseCredentials(env) {
  if (signingMode(env) !== 'developer-id') return;
  const method = notaryMethod(env);
  const missing = missingReleaseSecrets(env);
  if (missing.length > 0) {
    throw new Error(
      `Release signing is on (${RELEASE_SIGNING_ENV}) but these secrets are ` +
        `missing or blank: ${missing.join(', ')}. ` +
        `Notarization method is "${method}" (${NOTARY_METHOD_ENV}); set every ` +
        `name above as a repository secret, or unset ${RELEASE_SIGNING_ENV} ` +
        `for an ad-hoc developer build.`,
    );
  }
  const conflicting = conflictingReleaseSecrets(env);
  if (conflicting.length > 0) {
    throw new Error(
      `Notarization method is "${method}" (${NOTARY_METHOD_ENV}) but these ` +
        `variables from the other method are also set: ${conflicting.join(', ')}. ` +
        `electron-builder prefers APPLE_ID over the API key, so the build ` +
        `would not use the method you chose. Export only one method's variables.`,
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
    // `spctl` cannot accept an app that has not been notarized yet, and
    // notarization happens after signing. Assessing here only ever fails.
    gatekeeperAssess: false,
    notarize: release,
  };
  // A release takes its identity from the certificate electron-builder imports
  // from CSC_LINK. Naming one here would only be a second place to be wrong.
  if (!release) mac.identity = '-';
  return mac;
}

function buildConfig(env) {
  assertReleaseCredentials(env);
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
  NOTARY_SECRETS,
  signingMode,
  notaryMethod,
  requiredReleaseSecrets,
  missingReleaseSecrets,
  conflictingReleaseSecrets,
  assertReleaseCredentials,
  macConfig,
  buildConfig,
};
