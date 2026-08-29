// electron-builder's config entry point.
//
// The whole config is a function of the environment, so that one switch —
// PHASE_RELEASE_SIGNING — separates the ad-hoc build a developer makes on a
// laptop from the Developer ID build the Release workflow publishes. Loading
// this file with release signing on and a credential missing throws here,
// before electron-builder packs anything.
//
// See scripts/releaseConfig.cjs for the rules and docs/macos-signing.md for the
// secrets each mode needs.

const { buildConfig } = require('./scripts/releaseConfig.cjs');

module.exports = buildConfig(process.env);
