# PhasePhone

The iPhone companion to Phase: tick things off, capture a thought, glance at
the week. Planning stays on the Mac.

A React + Vite + Tailwind app wrapped by Capacitor, syncing through two files
in an iCloud Drive container. Design: `docs/superpowers/specs/2026-08-25-phasephone-companion-design.md`.

## The one rule

**The Mac owns canonical state. The phone owns a journal of its own edits.**

- `state.json` — the Mac writes it, the phone only reads it.
- `ops-phone.jsonl` — the phone writes it, the Mac only reads it.

The phone renders `state.json` plus a replay of the ops the Mac has not
ingested yet. There is no merge, no Dexie, and no second writer — which is why
`src/bridge/FileBridge.ts` has no `writeStateFile` and never will. If you find
yourself wanting one, the answer is an op.

## Layout

```
src/state/phoneStore.ts   the whole state: canonical + pending replay + sync health
src/bridge/               FileBridge, and its two implementations
src/views/                Today, Capture, Week, and the shell's SyncBar
plugin-icloud/            the Capacitor plugin — the project's only Swift
ios/                      the Capacitor Xcode shell (checked in; see below)
```

`@app/*` is the one door into the desktop app, and it opens on
`PhaseApp/src/lib/**` and `PhaseApp/src/db/types.ts` only — pure logic and the
domain types. Never a view, never `state/store.ts`, never Dexie. The alias is
declared three times (`tsconfig.json`, `vite.config.ts`, `vitest.config.ts`)
and all three have to agree.

## Commands

Run everything from `PhasePhone/`.

| | |
| --- | --- |
| `npm run dev` | Vite dev server, `localBridge` in a desktop browser |
| `npm test` | the Vitest suite |
| `npm run typecheck` | `tsc -b` |
| `npm run build` | typecheck, then `vite build` into `dist/` |
| `npm run ios:sync` | build the web assets, then `cap sync ios` |
| `npm run ios:pods` | `pod install` alone — the sync step that needs no Xcode |
| `npm run ios:open` | open the workspace in Xcode |

`cap sync` **copies** `dist/`; it does not run your bundler. That is why
`ios:sync` builds first, and why it is the script to run rather than
`npx cap sync ios` on its own.

## The iOS project

`ios/` is **checked in**. Regenerating it with `cap add ios` would discard the
entitlements, the iCloud `Info.plist` block and the bundle id along with it, so
do not run `cap add` again — run `npm run ios:sync`.

What is checked in and what is not: `ios/.gitignore` (Capacitor's own) plus the
matching entries in `PhasePhone/.gitignore` keep out `App/Pods`,
`App/App/public` (a copy of `dist/`), the generated `capacitor.config.json` and
`config.xml`, build output and `xcuserdata`. All of it is reproduced by
`npm run ios:sync`. `Podfile.lock` **is** checked in, as it should be.

Already wired, so you do not have to:

- **Bundle id `com.phaseapp.phone`** — set in `capacitor.config.ts`, and from
  there in `PRODUCT_BUNDLE_IDENTIFIER` for both configurations. The iCloud
  container is `iCloud.com.phaseapp.phone`.
- **The plugin** — `phase-icloud` is a `file:` dependency, `cap sync` finds its
  podspec, and `ios/App/Podfile` carries
  `pod 'PhaseIcloud', :path => '../../plugin-icloud'`. The pod's name is
  `PhaseIcloud`, not `PhaseICloud`: Capacitor derives it from the npm package
  name and CocoaPods refuses a podspec that disagrees. The Swift class is still
  `PhaseICloud`.
- **`ios/App/App/App.entitlements`** — iCloud Documents, the container in all
  three required keys, referenced from `CODE_SIGN_ENTITLEMENTS` in both
  configurations.
- **`NSUbiquitousContainers` in `Info.plist`** — what makes the container show
  up as a `Phase` folder in the Files app and in Finder. iOS caches this
  dictionary per build: **bump `CURRENT_PROJECT_VERSION` whenever you change
  it** or the change silently does nothing.

### What you have to supply

Two things, both per-developer, neither of which can live in the repo:

1. **Xcode.** Not the Command Line Tools — the full app. `pod install` runs
   fine without it, but `cap sync` ends with `xcodebuild … clean` and that
   needs a real Xcode. On a Command-Line-Tools-only machine `npm run ios:sync`
   reports `xcode-select: error: tool 'xcodebuild' requires Xcode` **after**
   the copy, the plugin update and `pod install` have all already succeeded;
   `npm run ios:pods` is the same work without the failing last step. You
   cannot build or run on a device either way.
2. **An Apple Developer team** ($99/yr). iCloud containers are not available to
   a personal free team. In Xcode → the **App** target → **Signing &
   Capabilities**, set **Team** and leave **Automatically manage signing** on.
   That writes a `DEVELOPMENT_TEAM` into your local `project.pbxproj` diff —
   deliberately not committed, since it is your team and not the project's.

The **iCloud capability** should already read as present, since the
entitlements file is in the project. If Xcode shows it missing, add
**+ Capability → iCloud → iCloud Documents** and confirm the container
is `iCloud.com.phaseapp.phone`; that rewrites the same file.

## Pointing the Mac at the same folder

The phone owns the container, and on the Mac it lives at a path derived from
the identifier by replacing every `.` with `~`:

```sh
export PHASE_SYNC_DIR="$HOME/Library/Mobile Documents/iCloud~com~phaseapp~phone/Documents/Phase"
```

Set it in whatever starts the desktop app — a GUI launch does **not** read your
shell profile, which is the single most common reason the Mac never reacts to a
phone op. The folder appears only after the phone app has launched once with
the capability in place.

Why not the general iCloud Drive folder? An iOS app cannot reach it.
`com~apple~CloudDocs` is not addressable from
`url(forUbiquityContainerIdentifier:)`; the phone only ever gets its own
container. That is what `PHASE_SYNC_DIR` exists for.
`plugin-icloud/INTEGRATION.md` §5 has the alternative — one shared container
both apps declare — and what it costs.

## Device smoke checklist

The suite covers the projection, the ops and the screens. What it cannot cover
is iCloud, so this runs on a **real device** — not the simulator, whose iCloud
sync is unreliable enough to make you chase a bug that is not yours.

Prerequisites: iPhone and Mac signed into the **same** iCloud account, iCloud
Drive on for both, phone off Low Data Mode, desktop app running with
`PHASE_SYNC_DIR` set.

Run in order. Confirm each before moving on — a failure here is almost always
the step before it.

- [ ] `npm run ios:sync && npm run ios:open`, then Run on the device.
- [ ] **The Mac publishes.** Tick anything in Phase on the Mac. `state.json`
      appears at `$PHASE_SYNC_DIR`, and `meta.generation` increments on each
      later edit:
      `python3 -m json.tool < "$PHASE_SYNC_DIR/state.json" | head -20`
- [ ] **The phone reads.** Launch the app. Today shows real work and the sync
      bar is silent. This proves `readStateFile` and the download wait.
- [ ] **The container is visible.** In Finder,
      `~/Library/Mobile Documents/iCloud~com~phaseapp~phone/Documents/` shows a
      `Phase` folder. If not, the `NSUbiquitousContainers` block is missing or
      `CURRENT_PROJECT_VERSION` was not bumped after it was added.
- [ ] **The phone writes.** Tick a row on the phone. The sync bar reads
      `1 change waiting for your Mac`, and the journal gains one line:
      `tail -3 "$PHASE_SYNC_DIR/ops-phone.jsonl"`
- [ ] **The Mac ingests.** Within seconds the Mac toasts
      `Phone: 1 change applied`, the task completes there, and `state.json`
      regenerates carrying that op's `id` as `meta.ingestedThroughOpId`.
- [ ] **The loop closes.** The phone re-renders from canonical, the sync bar
      goes silent again, and the ingested line disappears from the journal on
      the phone's next append (compaction rides on the write).
- [ ] **Offline.** Airplane Mode on. Tick two more rows — they show as done
      locally and the bar counts two. Airplane Mode off: both land on the Mac,
      in order, and neither double-applies.
- [ ] **A tick after midnight.** Between local midnight and your UTC offset,
      tick something on the phone. It must appear under `Done today` and stay
      there — that is the local-day stamp in `replay.ts`, and slicing the op's
      UTC timestamp instead is the bug that used to put it under yesterday.
- [ ] **Cold container.** Delete the app and reinstall. First launch reaches
      Today with real work, not `Nothing synced yet` — that is
      `startDownloadingUbiquitousItem` doing its job. Landing on "never synced"
      and flipping to ready a moment later is the `filesChanged` metadata query
      catching up: acceptable, worth noting.
- [ ] **A read that fails.** Sign the phone out of iCloud (Settings → your name
      → iCloud), then force-quit and relaunch the app — the read happens on
      mount and on `filesChanged`, so a foreground alone need not trigger one.
      The sync bar reads `Can’t reach iCloud`, the last good day is **still on
      screen**, and **Try again** re-reads. Sign back in, tap **Try again**,
      and confirm the bar goes silent.
- [ ] **Conflict.** Delete a task on the Mac that the phone still shows, then
      tick it on the phone. The Mac toasts `1 phone change couldn’t apply` and
      stays unbroken. (A round that applied nothing states the failure alone —
      see `ingestToast` in `PhaseApp/src/App.tsx`.)

## Known limitations

- **The phone re-reads on mount and on `filesChanged`, and not on resume.** A
  phone left in the background for hours can come back to a canonical file
  older than the one on disk, until iCloud's metadata query fires. It is
  honest about it — Today's `as of` stamp is exactly this case — but a
  `resume` listener would close the window, and would want `@capacitor/app`.
- **Nothing retries a failed write.** A tick that could not reach the journal
  is reported and dropped, not queued; the person taps it again. Queueing it
  would mean a second durable store on the phone, which is the design's
  `no Dexie here` rule.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `npm run ios:sync` ends on `xcodebuild requires Xcode` | Command Line Tools only. Everything up to and including `pod install` already ran; install Xcode, or use `npm run ios:pods`. |
| `readStateFile` always `null` on device | The container was never created — the iCloud capability is missing, or the device is signed out. Settings → your name → iCloud → Apps Using iCloud. |
| The container folder never appears in Finder | The `NSUbiquitousContainers` block is missing, or `CURRENT_PROJECT_VERSION` was not bumped after it changed. |
| `pod install` cannot find `PhaseIcloud.podspec` | npm symlinked the `file:` dep somewhere CocoaPods will not follow. Reinstall with `npm install --install-links`. |
| Ops reach the journal but the Mac never reacts | `PHASE_SYNC_DIR` is not set in the environment the desktop app actually launched from. |
| `filesChanged` never fires | `NSMetadataQuery` reports the app's own container's `Documents` scope only. On a shared container it must be **first** in the entitlement array, since the plugin passes `nil`. |
