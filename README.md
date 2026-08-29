# Phase

Local goal, habit and task planner for macOS. All data stays on your machine.

This repo holds the desktop app (`PhaseApp/`, React + Vite + Electron) and the
marketing site (`PhaseWeb/`).

## Download

Grab the latest DMG from the [releases page](https://github.com/por25528/phase/releases/latest):

- **Apple Silicon** (M1/M2/M3/M4): `Phase-x.y.z-arm64.dmg`
- **Intel**: `Phase-x.y.z.dmg`

Open the DMG and drag **Phase** into **Applications**. That's it — the published
builds are signed with a Developer ID certificate and notarized by Apple, so they
open by double-clicking with no Gatekeeper detour.

If macOS ever does refuse to open a copy of Phase, it did not come from the
releases page above. Delete it and download it again from there.

## Development

```bash
cd PhaseApp
npm install
npm run dev        # web dev server
npm run app:dev    # Electron against the dev server (needs npm run dev running)
npm test
npm run build:mac  # local DMG into PhaseApp/release/
npm run verify:mac # check what that build actually produced
```

### Local builds are ad-hoc signed, on purpose

`npm run build:mac` needs no Apple account, so it produces an **ad-hoc
signature**: valid on the Mac that built it and rejected on every other one.
That is the right trade for a build you are testing yourself.

It also means macOS will not open your own DMG without being told to. That
override is legitimate here and nowhere else — you compiled the code, so you
are not being asked to trust a stranger. The steps are in
[`docs/macos-signing.md`](docs/macos-signing.md#opening-your-own-ad-hoc-build).

Never hand that DMG to anyone else, and never publish one. Anything on the
releases page goes through the signed, notarized path below, where a user is
asked to trust nothing and to override nothing.

## Releasing

1. Bump `version` in `PhaseApp/package.json`, commit.
2. Tag and push: `git tag v<version> && git push origin main --tags`.
3. The `Release` workflow signs, notarizes, staples and verifies both DMGs, then
   publishes the GitHub release. It fails early and by name if a signing secret
   is missing, and it never publishes an artifact that fails verification.

The credentials live entirely in GitHub Actions secrets — none are in this
repository. [`docs/macos-signing.md`](docs/macos-signing.md) lists what each
secret is, where Apple issues it, and how to switch Apple accounts.
