# Integrating `phase-icloud`

Post-merge steps for the coordinator. Everything here is outside track C's file
ownership — this plugin package is self-contained, and wiring it up touches
`PhasePhone/` files that track B owns and an Xcode project that does not exist
yet.

Worked example uses the bundle id **`com.phaseapp.phone`** throughout. The one
value that cannot be written down here is your **Apple Developer Team ID** (a
10-character string like `A1B2C3D4E5`); it comes from
<https://developer.apple.com/account> → Membership. Everywhere below it is
written `<TEAMID>`.

---

## 1. Add the plugin to PhasePhone

In `PhasePhone/package.json`:

```json
"dependencies": {
  "@capacitor/core": "^7.6.8",
  "phase-icloud": "file:./plugin-icloud"
},
"devDependencies": {
  "@capacitor/cli": "^7.6.8",
  "@capacitor/ios": "^7.6.8"
}
```

Then, from `PhasePhone/`:

```sh
npm install
```

The plugin's `prepare` script runs `tsc -b` on install, so `dist/esm/` (which
is gitignored) is built for you. If your npm ever skips `prepare` for a `file:`
dependency, build it by hand:

```sh
npm --prefix plugin-icloud install
npm --prefix plugin-icloud run build
```

npm symlinks `file:` dependencies. CocoaPods resolves `:path` through the
symlink fine in the normal case; if `pod install` later complains that it
cannot find `PhaseICloud.podspec`, reinstall with copies instead:

```sh
npm install --install-links
```

## 2. Capacitor config

`PhasePhone/capacitor.config.ts` (create it — Capacitor reads it at `cap add`
time):

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.phaseapp.phone',
  appName: 'Phase',
  webDir: 'dist',
  ios: { contentInset: 'always' },
};

export default config;
```

`webDir: 'dist'` must match PhasePhone's Vite `build.outDir`. Build the web
assets before every sync — `cap sync` copies whatever is in `dist/`, it does not
run your bundler:

```sh
npm run build
npx cap add ios      # once
npx cap sync ios     # after every web build or dependency change
```

`cap add ios` creates `PhasePhone/ios/`. `cap sync` regenerates the plugin block
in `ios/App/Podfile` — you should see this line appear, which is how you know
Capacitor found the podspec:

```ruby
pod 'PhaseICloud', :path => '../../node_modules/phase-icloud'
```

## 3. Xcode: signing

```sh
npx cap open ios
```

In the **App** target → **Signing & Capabilities**:

1. **Team**: your Apple Developer team. This step is what the $99/yr enrollment
   buys — iCloud containers are not available to a personal free team.
2. **Bundle Identifier**: `com.phaseapp.phone`.
3. **Automatically manage signing**: on.
4. Deployment target: **iOS 14.0** or later (Capacitor 7's floor, and the
   podspec's).

## 4. Xcode: the iCloud capability

Still in **Signing & Capabilities**: **+ Capability** → **iCloud** → tick
**iCloud Documents** → **+** under Containers → `iCloud.com.phaseapp.phone`.

That writes `ios/App/App/App.entitlements`. The complete file, spelled out:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.icloud-container-identifiers</key>
	<array>
		<string>iCloud.com.phaseapp.phone</string>
	</array>
	<key>com.apple.developer.icloud-services</key>
	<array>
		<string>CloudDocuments</string>
	</array>
	<key>com.apple.developer.ubiquity-container-identifiers</key>
	<array>
		<string>iCloud.com.phaseapp.phone</string>
	</array>
</dict>
</plist>
```

All three keys are required. `icloud-container-identifiers` and
`ubiquity-container-identifiers` must hold the same array — the second is the
older key and `url(forUbiquityContainerIdentifier:)` still consults it.

### Make the container visible in Files and Finder

The plugin passes `nil` to `url(forUbiquityContainerIdentifier:)`, which
resolves to the first container above. By default its `Documents/` is private.
To surface it as a folder in the Files app and in Finder's iCloud Drive — which
is what lets you look at `state.json` with your own eyes during the smoke test —
add to `ios/App/App/Info.plist`:

```xml
<key>NSUbiquitousContainers</key>
<dict>
	<key>iCloud.com.phaseapp.phone</key>
	<dict>
		<key>NSUbiquitousContainerIsDocumentScopePublic</key>
		<true/>
		<key>NSUbiquitousContainerName</key>
		<string>Phase</string>
		<key>NSUbiquitousContainerSupportedFolderLevels</key>
		<string>Any</string>
	</dict>
</dict>
```

Apple caches this dictionary per build: **bump `CFBundleVersion` whenever you
change it**, or the change silently does nothing.

## 5. Point the Mac at the same folder

Two options. Take **A** now; **B** is the production shape.

### Option A — Mac reads the phone's container directly (recommended first)

The phone owns `iCloud.com.phaseapp.phone`. On the Mac that container lives at a
path derived from the identifier by replacing every `.` with `~`:

```
~/Library/Mobile Documents/iCloud~com~phaseapp~phone/Documents/Phase
```

The desktop app is unsigned and unsandboxed, so it can simply read and write
that path. No Mac-side entitlement, no Mac-side signing, and the unsigned `.dmg`
ritual is untouched. Set track A's env var:

```sh
export PHASE_SYNC_DIR="$HOME/Library/Mobile Documents/iCloud~com~phaseapp~phone/Documents/Phase"
```

Put it in the launchd plist / wrapper you use to start the app, or in your
shell profile when running `npm run app:dev`.

Note the folder only appears on the Mac after the phone app has launched once
with the capability in place — the container is created on first use.

Why not just use `~/Library/Mobile Documents/com~apple~CloudDocs/Phase` (track
A's built-in default)? Because an iOS app cannot reach the general iCloud Drive
folder at all. `com~apple~CloudDocs` is not addressable from
`url(forUbiquityContainerIdentifier:)`; the phone only ever gets its own
container. That is why `PHASE_SYNC_DIR` exists.

### Option B — one shared container both apps declare

Both apps declare the same container, e.g. `iCloud.com.phaseapp.sync`:

- Phone: add `iCloud.com.phaseapp.sync` to the two identifier arrays in §4
  (keep it **first** in the array, since the plugin passes `nil`).
- Mac: the desktop app must then be signed with a provisioning profile carrying
  the same entitlements —

```xml
	<key>com.apple.developer.icloud-container-identifiers</key>
	<array>
		<string>iCloud.com.phaseapp.sync</string>
	</array>
	<key>com.apple.developer.icloud-services</key>
	<array>
		<string>CloudDocuments</string>
	</array>
	<key>com.apple.developer.ubiquity-container-identifiers</key>
	<array>
		<string>iCloud.com.phaseapp.sync</string>
	</array>
```

  plus, if the Mac app is sandboxed, `com.apple.security.app-sandbox` and
  `com.apple.security.network.client`.

The cost is real: signing the Mac app ends the "unsigned `.dmg`, right-click →
Open" distribution the project deliberately kept. Option A buys the same
behaviour for free. Only take B if a second desktop or a Mac App Store build
ever needs it.

## 6. The bridge adapter

Create `PhasePhone/src/bridge/icloudBridge.ts`. It maps the plugin onto track
B's `FileBridge`, quoted here verbatim from the plan:

```ts
export interface FileBridge {
  readStateFile(): Promise<string | null>;          // null: never synced yet
  readJournal(): Promise<string>;                   // '' when absent
  appendOp(line: string): Promise<void>;            // durable append
  rewriteJournal(text: string): Promise<void>;      // compaction
  onChange(cb: () => void): () => void;             // files changed externally
}
```

The adapter, in full:

```ts
import { PhaseICloud } from 'phase-icloud';

import type { FileBridge } from './FileBridge';

/** The plugin already speaks this shape; only the option-object wrapping differs. */
export const icloudBridge: FileBridge = {
  async readStateFile() {
    return (await PhaseICloud.readStateFile()).text;
  },
  async readJournal() {
    return (await PhaseICloud.readJournal()).text;
  },
  async appendOp(line) {
    await PhaseICloud.appendOp({ line });
  },
  async rewriteJournal(text) {
    await PhaseICloud.rewriteJournal({ text });
  },
  onChange(cb) {
    // addListener is async; the unsubscribe closes over the pending handle.
    const handle = PhaseICloud.addListener('filesChanged', cb);
    return () => {
      void handle.then((h) => h.remove());
    };
  },
};
```

Bridge selection, in whatever module builds the store (track B's `main.tsx`):

```ts
import { Capacitor } from '@capacitor/core';

import { icloudBridge } from './bridge/icloudBridge';
import { localBridge } from './bridge/localBridge';

const bridge = Capacitor.isNativePlatform() ? icloudBridge : localBridge;
```

`localBridge` keeps `npm run dev` working in a desktop browser. (The plugin
ships its own localStorage web fallback under the same two keys —
`phase-sync-state`, `phase-sync-journal` — so `icloudBridge` is also safe to use
in the browser if you ever want one code path.)

## 7. Device smoke checklist

Prerequisites: iPhone and Mac signed into the **same** iCloud account, iCloud
Drive on for both, phone off Low Data Mode, Mac app running with
`PHASE_SYNC_DIR` set per §5.

Run in order and confirm each before moving on:

- [ ] `npm run build && npx cap sync ios && npx cap open ios`, then Run on a
      real device (not the simulator — the simulator's iCloud sync is
      unreliable and will make you chase a bug that is not yours).
- [ ] On the Mac, tick anything in Phase. Confirm
      `state.json` appears at `$PHASE_SYNC_DIR` and its `meta.generation`
      increments on each subsequent edit:
      `cat "$PHASE_SYNC_DIR/state.json" | python3 -m json.tool | head -20`
- [ ] Launch the phone app. Today shows real work, and the "as of" stamp is
      recent. This proves `readStateFile` + the download wait.
- [ ] In Finder, `~/Library/Mobile Documents/iCloud~com~phaseapp~phone/Documents/`
      shows a `Phase` folder (the §4 Info.plist block working).
- [ ] Tick a row on the phone. Confirm `ops-phone.jsonl` gains one line:
      `tail -3 "$PHASE_SYNC_DIR/ops-phone.jsonl"`
- [ ] Within seconds the Mac toasts `Phone: 1 change applied`, the task
      completes there, and `state.json` regenerates with that op's `id` as
      `meta.ingestedThroughOpId`.
- [ ] The phone re-renders from canonical and `ops-phone.jsonl` gets compacted
      back down (the ingested line disappears on the phone's next append).
- [ ] **Offline:** put the phone in Airplane Mode, tick two more rows, confirm
      they show as done locally. Turn Airplane Mode off — both land on the Mac,
      in order, and neither double-applies.
- [ ] **Cold container:** delete the app from the phone and reinstall. First
      launch should reach "ready", not "never synced" — that is the
      `startDownloadingUbiquitousItem` wait doing its job. If it lands on
      "never synced" and then flips to ready a moment later, that is the
      `filesChanged` metadata query catching up; acceptable, but worth noting
      in the log.
- [ ] **Conflict:** delete a task on the Mac that the phone still shows, then
      tick it on the phone. The Mac must toast
      `Phone: 0 changes applied, 1 couldn't` and stay unbroken.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `readStateFile` always `null` on device | Container not created — the iCloud capability is missing, or the device is signed out of iCloud. Check Settings → [name] → iCloud → Apps Using iCloud. |
| Container folder never appears in Finder | The `NSUbiquitousContainers` block is missing, or `CFBundleVersion` was not bumped after adding it. |
| `pod install` cannot find `PhaseICloud.podspec` | npm symlinked the `file:` dep somewhere CocoaPods will not follow — reinstall with `npm install --install-links`. |
| Ops appear in the journal but the Mac never reacts | `PHASE_SYNC_DIR` is not set in the environment the desktop app actually launched from (a GUI launch does not read your shell profile). |
| `filesChanged` never fires | `NSMetadataQuery` only reports the app's own container's `Documents` scope. If you moved to Option B, confirm the shared container is **first** in the entitlement array, since the plugin passes `nil`. |
