// Where electron-builder actually put the app.
//
// The output directory is named after the architecture — `release/mac` for
// x64, `release/mac-arm64` for arm64 — so a hard-coded path verifies nothing on
// half the Macs that could run the build. Nothing here knows the app's name
// either: `productName` can change, and a verifier that silently finds no
// bundle is worse than one that says so.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RELEASE_DIR = 'release';

/**
 * Every app bundle one level under `releaseDir`, sorted for a stable order.
 *
 * One level exactly: an app bundle contains the Electron helper bundles under
 * `Contents/Frameworks`, and a recursive search would return four "apps" per
 * build and verify the helpers as though they were the product.
 */
function findAppBundles(releaseDir = DEFAULT_RELEASE_DIR) {
  let archDirs;
  try {
    archDirs = fs.readdirSync(releaseDir, { withFileTypes: true });
  } catch {
    archDirs = [];
  }

  const bundles = [];
  for (const archDir of archDirs) {
    if (!archDir.isDirectory()) continue;
    const dir = path.join(releaseDir, archDir.name);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        bundles.push(path.join(dir, entry.name));
      }
    }
  }

  if (bundles.length === 0) {
    throw new Error(
      `No .app bundle under ${releaseDir}. Run \`npm run build:mac\` first — ` +
        `it writes release/mac (Intel) and release/mac-arm64 (Apple Silicon), ` +
        `and which of those exists depends on the architectures that were built.`,
    );
  }
  return bundles.sort();
}

/**
 * The disk images, which sit directly in `releaseDir` beside the arch folders.
 *
 * `.dmg` exactly, not a prefix match: electron-builder writes a
 * `Phase-x.y.z.dmg.blockmap` next to every image, and handing one of those to
 * `notarytool` or `stapler` fails in a way that reads like a signing problem.
 */
function findDiskImages(releaseDir = DEFAULT_RELEASE_DIR) {
  let entries;
  try {
    entries = fs.readdirSync(releaseDir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const images = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.dmg'))
    .map((entry) => path.join(releaseDir, entry.name))
    .sort();

  if (images.length === 0) {
    throw new Error(
      `No .dmg under ${releaseDir}. Run \`npm run build:mac\` first — the ` +
        `images are written beside the mac/ and mac-arm64/ folders, not inside them.`,
    );
  }
  return images;
}

module.exports = { DEFAULT_RELEASE_DIR, findAppBundles, findDiskImages };
