#!/usr/bin/env node
// Release preflight: refuse to start a build that cannot finish.
//
// electron-builder only WARNS when it cannot assemble notarization options and
// then produces a DMG every user's Gatekeeper will reject. This runs first, in
// its own step, so a missing secret costs seconds instead of a bad release.
//
// It checks the REPOSITORY SECRETS, which is a different set from what
// electron-builder later reads: here the App Store Connect key is base64
// (APPLE_API_KEY_P8_BASE64), and it is decoded in memory and thrown away, so a
// truncated or mistyped secret fails now rather than inside notarytool. Nothing
// is written; the file the build uses is materialised by its own step.
//
// It prints names. It never prints, logs or writes a value.

const {
  RELEASE_SIGNING_ENV,
  NOTARY_METHOD_ENV,
  signingMode,
  notaryMethod,
  requiredReleaseSecrets,
  assertReleaseSecrets,
  CALENDAR_SECRETS,
  assertCalendarCredentials,
} = require('./releaseConfig.cjs');
const { API_KEY_BASE64_ENV, decodeApiKey } = require('./appleApiKey.cjs');

const env = process.env;

if (signingMode(env) !== 'developer-id') {
  console.log(
    `${RELEASE_SIGNING_ENV} is not set: ad-hoc developer build, no credentials required.`,
  );
  process.exit(0);
}

try {
  const method = notaryMethod(env);
  assertReleaseSecrets(env);

  if (method === 'api-key') {
    // Decoded and discarded. Proving the secret is a real PKCS#8 key here is
    // the difference between a 10-second failure and a 20-minute one.
    const bytes = decodeApiKey(env[API_KEY_BASE64_ENV]);
    console.log(`Release signing on, notarization method "${method}".`);
    console.log(`  ${API_KEY_BASE64_ENV}: decodes to a ${bytes.length}-byte PKCS#8 key`);
  } else {
    console.log(`Release signing on, notarization method "${method}".`);
  }

  for (const name of requiredReleaseSecrets(env)) {
    if (name === API_KEY_BASE64_ENV) continue; // already reported, in more detail
    console.log(`  ${name}: present`);
  }
  // The managed OAuth client the build will pack. Checked in this step, with
  // the Apple secrets, because it is the one credential whose absence breaks
  // nothing: the build would succeed, sign, notarize and verify, and ship an
  // app that asks every user for a Google Cloud project. No later step notices.
  //
  // It is checked LAST because the Apple credentials are what a failed release
  // costs twenty minutes on, and a diagnosis is worth more than a millisecond.
  assertCalendarCredentials(env);
  console.log('Managed Google OAuth client:');
  for (const name of CALENDAR_SECRETS) {
    console.log(`  ${name}: present`);
  }
} catch (err) {
  console.error(`\nRelease credentials are not usable.\n\n${err.message}\n`);
  console.error(
    `Set them as repository secrets (Settings → Secrets and variables → Actions),\n` +
      `or change ${NOTARY_METHOD_ENV} in .github/workflows/release.yml.\n` +
      `docs/macos-signing.md lists what each one is and where Apple issues it.\n`,
  );
  process.exit(1);
}
