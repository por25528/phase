# GitHub Release Distribution — Design

**Date:** 2026-08-28
**Scope:** Make PhaseApp downloadable by anyone via GitHub Releases. Mac only.

## Goal

People visit the repo's Releases page, download a DMG, and run Phase.
Releases are built by CI, not by hand. Installed apps learn about new
versions via a lightweight in-app check.

## Decisions (settled with user)

- **Platforms:** macOS only (arm64 + Intel). Windows/Linux deferred.
- **Signing:** ad-hoc (free). No Apple Developer enrollment. Users do a
  one-time "Open Anyway" in System Settings; instructions ship in the
  release notes and README.
- **Build flow:** GitHub Actions triggered by pushing a `v*` tag.
- **Updates:** in-app check against the GitHub Releases API with a
  dismissible notice. No electron-updater (requires paid signing on Mac).

## Components

### 1. electron-builder config (`PhaseApp/package.json`)

- `mac.identity`: remove `null` so electron-builder falls back to ad-hoc
  signing (`-`), avoiding the "damaged" error on Apple Silicon.
- Targets: `dmg` for both `arm64` and `x64` — two separate DMGs
  (`Phase-x.y.z-arm64.dmg`, `Phase-x.y.z.dmg`), not a universal binary,
  to halve download size.
- Version bumped `0.0.0` → `0.1.0`. The package version is the source of
  truth; tags mirror it (`v0.1.0`).

### 2. Release workflow (`.github/workflows/release.yml`)

- Trigger: push of tag matching `v*`.
- Runner: `macos-latest`, working directory `PhaseApp/`.
- Steps: checkout → setup Node → `npm ci` → `npm test` → `npm run build`
  (includes `tsc -b`) → `npx electron-builder --mac --arm64 --x64 --publish never`
  → create GitHub Release for the tag with both DMGs attached and a
  release-notes body that includes the Gatekeeper "Open Anyway" steps.
- Uses the built-in `GITHUB_TOKEN`; no extra secrets.

### 3. Update check (Electron main process)

- New module `PhaseApp/electron/updateCheck.cjs`.
- On app launch, throttled to at most once per 24h (timestamp persisted
  in `userData`), fetch
  `https://api.github.com/repos/por25528/phase/releases/latest`.
- Compare the release tag (strip `v`) to `app.getVersion()` with a
  numeric semver compare.
- If newer: send an IPC event to the renderer; the renderer shows a
  small dismissible banner linking to the releases page (opened via
  `shell.openExternal`). Dismissing hides it until the next newer
  version.
- Network errors, rate limits, offline: fail silently. Never block
  launch.

### 4. README

- Add a Download section to the repo README: link to latest release,
  which DMG to pick (Apple Silicon vs Intel), install steps, and the
  System Settings → Privacy & Security → "Open Anyway" walkthrough.

## Error handling

- CI: test or typecheck failure aborts the release — no DMG published.
- Update check: any failure (network, JSON shape, rate limit) is
  swallowed; the app behaves as if no update exists.

## Testing

- Unit tests for the version-compare and "should we check now" throttle
  logic (pure functions, vitest).
- Renderer banner: component test for show/dismiss behavior.
- Manual: run the tag workflow once, download the DMG on this Mac,
  verify Gatekeeper flow matches the documented steps.

## Out of scope

- Windows/Linux builds, notarization, true auto-update, download
  counts/analytics.
