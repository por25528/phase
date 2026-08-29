#!/usr/bin/env node
// Turn the APPLE_API_KEY_P8_BASE64 secret into the file notarytool reads.
//
// A node script rather than `printenv | base64 --decode` in the workflow,
// because `base64 --decode` accepts a corrupted secret and writes plausible
// garbage: the failure then surfaces inside notarytool, twenty minutes and one
// signed app later. scripts/appleApiKey.cjs validates the alphabet, the round
// trip and the PKCS#8 header first, and writes nothing if any of that fails.
//
// The path is an argument, never a default, so the file can only land where the
// caller asked — the runner temp, not the workspace.

const { API_KEY_BASE64_ENV, writeApiKey } = require('./appleApiKey.cjs');

const dest = process.argv[2];
if (!dest) {
  console.error('usage: write-apple-api-key.cjs <destination-path>');
  process.exit(2);
}

try {
  writeApiKey(process.env[API_KEY_BASE64_ENV], dest);
  console.log(`Wrote the App Store Connect key to ${dest} (mode 0600).`);
} catch (err) {
  console.error(`\nCould not materialise the App Store Connect key.\n\n${err.message}\n`);
  process.exit(1);
}
