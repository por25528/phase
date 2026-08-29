#!/usr/bin/env node
// Write the OAuth client this build ships into the bundle.
//
// Run before `npm run build:mac` on a machine (or CI runner) that has the two
// variables set:
//
//   PHASE_GOOGLE_CLIENT_ID=... PHASE_GOOGLE_CLIENT_SECRET=... \
//     npm run calendar:credentials
//
// The file it writes is git-ignored on purpose. Nothing in this repository
// carries a credential, so the client is rotatable without a code change and a
// fork does not inherit somebody else's Cloud project. Skipping this step is a
// supported outcome, not a failure: a build without it simply has no managed
// credentials, and Phase then asks for the user's own OAuth client in
// Settings → Calendar → "Use my own Google OAuth client".
//
// A desktop OAuth client's secret is not confidential — a desktop app cannot
// keep one, which is why PKCE rather than the secret is what protects the
// authorization-code flow.

const fs = require('node:fs');
const path = require('node:path');
const {
  CREDENTIALS_FILE, CLIENT_ID_ENV, CLIENT_SECRET_ENV,
} = require('../electron/calendarCredentials.cjs');

const clientId = (process.env[CLIENT_ID_ENV] ?? '').trim();
const clientSecret = (process.env[CLIENT_SECRET_ENV] ?? '').trim();
const target = path.join(__dirname, '..', 'electron', CREDENTIALS_FILE);

if (!clientId || !clientSecret) {
  // Both or neither. Half a pair cannot authenticate, and writing it would
  // make the app claim to be configured and then fail at consent.
  console.error(
    `[phase-calendar] ${CLIENT_ID_ENV} and ${CLIENT_SECRET_ENV} must both be set.\n`
    + '                 Nothing written; this build will ask for the user\'s own OAuth client.',
  );
  process.exit(1);
}

fs.writeFileSync(target, `${JSON.stringify({ clientId, clientSecret }, null, 2)}\n`, { mode: 0o600 });
console.log(`[phase-calendar] wrote ${path.relative(process.cwd(), target)}`);
