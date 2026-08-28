# Phase

Local goal, habit and task planner for macOS. All data stays on your machine.

This repo holds the desktop app (`PhaseApp/`, React + Vite + Electron) and the
marketing site (`PhaseWeb/`).

## Download

Grab the latest DMG from the [releases page](https://github.com/por25528/phase/releases/latest):

- **Apple Silicon** (M1/M2/M3/M4): `Phase-x.y.z-arm64.dmg`
- **Intel**: `Phase-x.y.z.dmg`

Open the DMG and drag **Phase** into **Applications**.

### "Phase can't be opened" on first launch

Phase is ad-hoc signed, not notarized (no Apple Developer subscription), so
macOS blocks the first launch:

1. Open **System Settings → Privacy & Security**.
2. Scroll down — you'll see *"Phase" was blocked…*
3. Click **Open Anyway** and confirm.

This is a one-time approval per machine.

## Development

```bash
cd PhaseApp
npm install
npm run dev        # web dev server
npm run app:dev    # Electron against the dev server (needs npm run dev running)
npm test
npm run build:mac  # local DMG into PhaseApp/release/
```

## Releasing

1. Bump `version` in `PhaseApp/package.json`, commit.
2. Tag and push: `git tag v<version> && git push origin main --tags`.
3. The `Release` workflow builds both DMGs and publishes the GitHub release.
