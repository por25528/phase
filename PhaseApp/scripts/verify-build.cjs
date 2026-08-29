#!/usr/bin/env node
// The one driver for artifact verification, local and CI alike.
//
//   node scripts/verify-build.cjs dev       what `npm run verify:mac` runs
//   node scripts/verify-build.cjs release   the workflow's publication gate
//
// It exists because nothing that names a path can do this job: electron-builder
// writes release/mac for x64 and release/mac-arm64 for arm64, so a hard-coded
// bundle path checks nothing on half the Macs that could produce the build —
// and worse, a check that finds no artifact reads exactly like a check that
// passed. The filesystem is asked, every bundle found is verified, and finding
// none is itself a failure.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { DEFAULT_RELEASE_DIR, findAppBundles, findDiskImages } = require('./appBundles.cjs');

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'release') {
  console.error('usage: verify-build.cjs <dev|release>');
  process.exit(2);
}

const releaseDir = process.env.PHASE_RELEASE_DIR || DEFAULT_RELEASE_DIR;
const verifier = path.join(__dirname, 'verify-macos-artifacts.sh');

function run(args) {
  const result = spawnSync('bash', [verifier, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  const bundles = findAppBundles(releaseDir);
  // A release is published as disk images, so their absence is a failure too;
  // a developer build is checked for what it is, and the images are incidental.
  const images = mode === 'release' ? findDiskImages(releaseDir) : [];
  console.log(
    `Verifying ${bundles.length} app bundle(s)` +
      (mode === 'release' ? ` and ${images.length} disk image(s)` : '') +
      ` under ${releaseDir}/\n`,
  );
  for (const bundle of bundles) run([mode, bundle]);
  if (images.length > 0) run(['dmg', ...images]);
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exit(1);
}

console.log(`\n==> every artifact under ${releaseDir}/ passed (${mode})`);
