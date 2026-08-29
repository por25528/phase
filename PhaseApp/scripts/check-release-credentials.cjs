#!/usr/bin/env node
// Release preflight: refuse to start a build that cannot finish.
//
// electron-builder only WARNS when it cannot assemble notarization options and
// then produces a DMG every user's Gatekeeper will reject. This runs first, in
// its own step, so a missing secret costs seconds instead of a bad release.
//
// It prints names. It never prints, logs or writes a value.

const {
  RELEASE_SIGNING_ENV,
  NOTARY_METHOD_ENV,
  signingMode,
  notaryMethod,
  requiredReleaseSecrets,
  assertReleaseCredentials,
} = require('./releaseConfig.cjs');

const env = process.env;

if (signingMode(env) !== 'developer-id') {
  console.log(
    `${RELEASE_SIGNING_ENV} is not set: ad-hoc developer build, no credentials required.`,
  );
  process.exit(0);
}

try {
  const method = notaryMethod(env);
  assertReleaseCredentials(env);
  console.log(`Release signing on, notarization method "${method}".`);
  for (const name of requiredReleaseSecrets(env)) console.log(`  ${name}: present`);
} catch (err) {
  console.error(`\nRelease credentials are not usable.\n\n${err.message}\n`);
  console.error(
    `Set them as repository secrets (Settings → Secrets and variables → Actions),\n` +
      `or change ${NOTARY_METHOD_ENV} in .github/workflows/release.yml.\n` +
      `docs/macos-signing.md lists what each one is and where Apple issues it.\n`,
  );
  process.exit(1);
}
