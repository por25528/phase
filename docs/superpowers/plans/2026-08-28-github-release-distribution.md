# GitHub Release Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can download a Mac DMG of Phase from GitHub Releases; CI builds releases on tag push; installed apps show a dismissible in-app notice when a newer release exists.

**Architecture:** Three independent workstreams. (A) packaging config + CI workflow + README, (B) an Electron-main update-check module wired through preload, (C) a renderer bridge + banner component. The update check is pull-only: the renderer asks once on mount over one fixed IPC channel, so there is no push racing page load.

**Tech Stack:** electron-builder 26, GitHub Actions (`macos-latest`), vitest, React 19, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-28-github-release-distribution-design.md`

## Global Constraints

- Repo: `por25528/phase`, public. App lives in `PhaseApp/`; run all npm commands from `PhaseApp/`.
- Version becomes `0.1.0` in `PhaseApp/package.json`; release tags are `v<version>` (e.g. `v0.1.0`).
- IPC channel name: `phase-updates:check` (the only new channel). Preload global: `window.phaseUpdates`.
- localStorage dismissal key: `phase-update-dismissed`. Main-process stamp file: `update-check.json` in `userData`.
- `electron/updateCheck.cjs` must NOT `require('electron')` — `main.cjs` is the only module that may. Follow the existing DI pattern (see `electron/appLifecycle.cjs` + `.d.cts` + `.test.ts`).
- Update failures are silent to the user: log via injected `logError`, never throw out of `check()`, never block launch.
- Commit after every task with a conventional-commit message.

## Workstream split (for parallel workers)

- **Workstream A (Tasks 1, 2, 3):** packaging config, CI workflow, README. Touches `PhaseApp/package.json`, `.github/`, `README.md`.
- **Workstream B (Tasks 4, 5):** update-check module + preload/main wiring. Touches `PhaseApp/electron/` only.
- **Workstream C (Tasks 6, 7):** renderer bridge + banner. Touches `PhaseApp/src/` only.

No file is touched by two workstreams. Workstreams B and C meet only at the frozen interfaces below.

**Frozen cross-workstream interfaces:**
- Preload (B) exposes: `window.phaseUpdates = { check(): Promise<{version: string, url: string} | null> }` — resolves the newer release's bare version (no `v`) and its GitHub release page URL, or `null` when up to date / unknown / errored.
- Renderer (C) consumes exactly that shape via `src/lib/updateBridge.ts` and must work when `window.phaseUpdates` is absent (plain browser).

---

### Task 1: Packaging config + version bump

**Files:**
- Modify: `PhaseApp/package.json`

**Interfaces:**
- Produces: version `0.1.0` (CI tags mirror it); dmg artifacts named `Phase-0.1.0-arm64.dmg` and `Phase-0.1.0.dmg` in `PhaseApp/release/` (Task 2's workflow uploads them).

- [ ] **Step 1: Edit `package.json`**

Change `"version": "0.0.0"` to `"version": "0.1.0"`.

Replace the `"mac"` block (currently `"target": "dmg"`, `"identity": null`) with:

```json
"mac": {
  "target": [
    { "target": "dmg", "arch": ["arm64", "x64"] }
  ],
  "category": "public.app-category.productivity",
  "icon": "build/icon.icns"
}
```

Removing `"identity": null` lets electron-builder fall back to ad-hoc signing when no certificate exists (none does, locally or in CI). Ad-hoc is required: a fully unsigned app reports as "damaged" on Apple Silicon.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Build locally and verify the ad-hoc signature**

Run (from `PhaseApp/`, takes a few minutes):
```bash
npm run build && npx electron-builder --mac --arm64 --publish never
codesign -dv release/mac-arm64/Phase.app 2>&1 | grep Signature
```
Expected: `Signature=adhoc` and `release/Phase-0.1.0-arm64.dmg` exists.

If electron-builder still skips signing (no `Signature=adhoc`), set `"identity": "-"` inside the `"mac"` block instead (explicit ad-hoc) and rebuild to re-verify.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat(dist): version 0.1.0, arm64+x64 DMGs, ad-hoc signing"
```

---

### Task 2: Release workflow

**Files:**
- Create: `.github/workflows/release.yml` (repo root)
- Create: `.github/release-notes.md`

**Interfaces:**
- Consumes: Task 1's dmg config (artifact names `Phase-<version>-arm64.dmg`, `Phase-<version>.dmg`).
- Produces: a GitHub Release per `v*` tag with both DMGs attached.

- [ ] **Step 1: Write the release-notes body**

Create `.github/release-notes.md`:

```markdown
## Install

1. Download the DMG for your Mac: **Apple Silicon** (M1/M2/M3/M4) → `Phase-x.y.z-arm64.dmg`, **Intel** → `Phase-x.y.z.dmg`.
2. Open the DMG and drag **Phase** into **Applications**.
3. First launch: macOS will block the app because it isn't notarized. Open **System Settings → Privacy & Security**, scroll down to the message about "Phase", and click **Open Anyway**, then confirm.

That approval is one-time. Phase stores all data locally on your Mac.
```

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  release:
    runs-on: macos-latest
    defaults:
      run:
        working-directory: PhaseApp
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: PhaseApp/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npx electron-builder --mac --arm64 --x64 --publish never
      - name: Verify ad-hoc signature
        run: codesign -dv release/mac-arm64/Phase.app 2>&1 | grep -q 'Signature=adhoc'
      - name: Create GitHub release
        uses: softprops/action-gh-release@v2
        with:
          files: PhaseApp/release/*.dmg
          body_path: .github/release-notes.md
```

Notes: `defaults.run.working-directory` applies only to `run:` steps — the two `uses:` actions take workspace-root-relative paths, which is why `files:` and `body_path:` are prefixed differently. `npm run build` already includes `tsc -b`.

- [ ] **Step 3: Lint the workflow**

Run: `npx --yes @action-validator/cli .github/workflows/release.yml || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"`
Expected: no errors (either validator passing is sufficient; the python fallback checks YAML syntax only).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml .github/release-notes.md
git commit -m "feat(dist): release workflow builds and publishes DMGs on v* tags"
```

---

### Task 3: README download section

**Files:**
- Create: `README.md` (repo root — none exists today)

**Interfaces:**
- Consumes: release URL convention `https://github.com/por25528/phase/releases/latest`.

- [ ] **Step 1: Write the README**

Create `README.md`:

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with download, Gatekeeper walkthrough, release steps"
```

---

### Task 4: Update-check module (`updateCheck.cjs`)

**Files:**
- Create: `PhaseApp/electron/updateCheck.cjs`
- Create: `PhaseApp/electron/updateCheck.d.cts`
- Test: `PhaseApp/electron/updateCheck.test.ts`

**Interfaces:**
- Produces (consumed by Task 5's wiring in `main.cjs`):
  - `compareVersions(a: string, b: string): number` — −1/0/1, numeric per-part compare, tolerates a leading `v`, answers 0 for unparseable input.
  - `shouldCheck(checkedAt: number | null, now: number): boolean` — true when no stamp, ≥ 24h old, or in the future (clock rollback).
  - `createUpdateCheck(deps): { check(): Promise<{version, url} | null> }` — resolves the newer release or null; never rejects.

- [ ] **Step 1: Write the type declarations**

Create `PhaseApp/electron/updateCheck.d.cts`:

```ts
// Deliberately imports nothing from `electron`: main.cjs stays the only
// composition root. The checker sees the network, the clock, and the stamp
// file only through injected shapes.

/** A newer release the renderer should mention. */
export interface UpdateInfo {
  /** Bare semver, no leading v. */
  version: string;
  /** The GitHub release page to send the user to. */
  url: string;
}

/** What the stamp file remembers between launches. */
export interface UpdateCheckState {
  checkedAt: number;
  version: string | null;
  url: string | null;
}

export interface UpdateCheckDeps {
  currentVersion: string;
  /** GET releases/latest; may reject or resolve any JSON shape. */
  fetchLatest(): Promise<unknown>;
  /** Last stamp, or null when none. May throw on a corrupt file. */
  readState(): UpdateCheckState | null;
  writeState(state: UpdateCheckState): void;
  now(): number;
  logError(...args: unknown[]): void;
}

export interface UpdateCheck {
  /** Resolves the newer release, or null. Never rejects. */
  check(): Promise<UpdateInfo | null>;
}

export declare function compareVersions(a: string, b: string): number;
export declare function shouldCheck(checkedAt: number | null, now: number): boolean;
export declare function createUpdateCheck(deps: UpdateCheckDeps): UpdateCheck;
```

- [ ] **Step 2: Write the failing tests**

Create `PhaseApp/electron/updateCheck.test.ts`:

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { compareVersions, shouldCheck, createUpdateCheck } =
  nativeRequire('./updateCheck.cjs') as typeof import('./updateCheck.cjs');

const DAY = 24 * 60 * 60 * 1000;

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('tolerates a leading v and refuses garbage', () => {
    expect(compareVersions('v0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('not-a-version', '0.1.0')).toBe(0);
    expect(compareVersions('0.1.0', '')).toBe(0);
  });
});

describe('shouldCheck', () => {
  it('checks when no stamp exists', () => {
    expect(shouldCheck(null, 1000)).toBe(true);
  });
  it('holds inside 24 hours', () => {
    expect(shouldCheck(1000, 1000 + DAY - 1)).toBe(false);
  });
  it('checks again at 24 hours', () => {
    expect(shouldCheck(1000, 1000 + DAY)).toBe(true);
  });
  it('checks when the clock went backwards', () => {
    expect(shouldCheck(5000, 1000)).toBe(true);
  });
});

interface FakeDeps {
  stored: import('./updateCheck.cjs').UpdateCheckState | null;
  deps: import('./updateCheck.cjs').UpdateCheckDeps;
  fetchLatest: ReturnType<typeof vi.fn>;
  logError: ReturnType<typeof vi.fn>;
}

function fakeDeps(overrides: Partial<import('./updateCheck.cjs').UpdateCheckDeps> = {}): FakeDeps {
  const box: FakeDeps = {
    stored: null,
    fetchLatest: vi.fn(async () => ({
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
    })),
    logError: vi.fn(),
    deps: undefined as unknown as import('./updateCheck.cjs').UpdateCheckDeps,
  };
  box.deps = {
    currentVersion: '0.1.0',
    fetchLatest: box.fetchLatest,
    readState: () => box.stored,
    writeState: (s) => { box.stored = s; },
    now: () => 1_000_000,
    logError: box.logError,
    ...overrides,
  };
  return box;
}

describe('createUpdateCheck', () => {
  it('reports a newer release and stamps the check', async () => {
    const box = fakeDeps();
    const result = await createUpdateCheck(box.deps).check();
    expect(result).toEqual({
      version: '0.2.0',
      url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
    });
    expect(box.stored).toEqual({
      checkedAt: 1_000_000,
      version: '0.2.0',
      url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
    });
  });

  it('reports null when up to date, and still stamps', async () => {
    const box = fakeDeps();
    box.fetchLatest.mockResolvedValue({ tag_name: 'v0.1.0', html_url: 'https://x.test/r' });
    expect(await createUpdateCheck(box.deps).check()).toBeNull();
    expect(box.stored?.checkedAt).toBe(1_000_000);
  });

  it('answers from the stamp inside 24h without fetching', async () => {
    const box = fakeDeps();
    box.stored = { checkedAt: 999_000, version: '0.3.0', url: 'https://x.test/r3' };
    const result = await createUpdateCheck(box.deps).check();
    expect(result).toEqual({ version: '0.3.0', url: 'https://x.test/r3' });
    expect(box.fetchLatest).not.toHaveBeenCalled();
  });

  it('swallows a fetch failure, logs it, keeps the cached answer', async () => {
    const box = fakeDeps();
    box.stored = { checkedAt: 0, version: '0.3.0', url: 'https://x.test/r3' };
    box.fetchLatest.mockRejectedValue(new Error('offline'));
    const result = await createUpdateCheck(box.deps).check();
    expect(result).toEqual({ version: '0.3.0', url: 'https://x.test/r3' });
    expect(box.logError).toHaveBeenCalled();
  });

  it('reports null on a malformed release body', async () => {
    const box = fakeDeps();
    box.fetchLatest.mockResolvedValue({ message: 'API rate limit exceeded' });
    expect(await createUpdateCheck(box.deps).check()).toBeNull();
  });

  it('survives a corrupt stamp file', async () => {
    const box = fakeDeps({ readState: () => { throw new Error('bad json'); } });
    const result = await createUpdateCheck(box.deps).check();
    expect(result).toEqual({
      version: '0.2.0',
      url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
    });
    expect(box.logError).toHaveBeenCalled();
  });
});

// The preload cannot require this module (sandboxed), so the channel name is
// written out by hand there. This pin stops the two from drifting — same
// pattern as calendarIpc.test.ts.
describe('preload contract', () => {
  it('preload.cjs invokes the channel main registers', () => {
    const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
    expect(preload).toContain("ipcRenderer.invoke('phase-updates:check')");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `PhaseApp/`): `npx vitest run electron/updateCheck.test.ts`
Expected: FAIL — `Cannot find module './updateCheck.cjs'`.

- [ ] **Step 4: Write the implementation**

Create `PhaseApp/electron/updateCheck.cjs`:

```js
// The release update check: one GET against GitHub's releases/latest,
// throttled to once a day by a stamp the caller persists. Pure logic —
// network, clock, and storage are injected, and nothing here may require
// `electron`. Every failure is logged and swallowed: an update notice is a
// nicety, and a nicety must never block or crash launch.

const DAY_MS = 24 * 60 * 60 * 1000;

/** [major, minor, patch] or null when the string is not a version. */
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  // Unparseable input compares equal: "no opinion" must never read as newer.
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function shouldCheck(checkedAt, now) {
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return true;
  // A stamp from the future means the clock moved; distrust it.
  if (checkedAt > now) return true;
  return now - checkedAt >= DAY_MS;
}

function createUpdateCheck({ currentVersion, fetchLatest, readState, writeState, now, logError }) {
  const newerOf = (state) => {
    if (!state || typeof state.version !== 'string' || typeof state.url !== 'string') return null;
    if (compareVersions(state.version, currentVersion) <= 0) return null;
    return { version: state.version, url: state.url };
  };

  return {
    async check() {
      let state = null;
      try {
        state = readState();
      } catch (err) {
        logError('[phase-updates] stamp unreadable', err);
      }
      if (state && !shouldCheck(state.checkedAt, now())) return newerOf(state);
      try {
        const release = await fetchLatest();
        const tag = typeof release?.tag_name === 'string' ? release.tag_name : null;
        const url = typeof release?.html_url === 'string' ? release.html_url : null;
        const version = tag && url && parseVersion(tag) ? tag.replace(/^v/, '') : null;
        const next = { checkedAt: now(), version, url: version ? url : null };
        try {
          writeState(next);
        } catch (err) {
          logError('[phase-updates] stamp unwritable', err);
        }
        return newerOf(next);
      } catch (err) {
        // Offline, rate-limited, DNS — all the same: keep the last answer.
        logError('[phase-updates] check failed', err);
        return newerOf(state);
      }
    },
  };
}

module.exports = { compareVersions, shouldCheck, createUpdateCheck };
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run electron/updateCheck.test.ts`
Expected: all tests pass EXCEPT `preload contract` (Task 5 adds that line to `preload.cjs`). If executing Tasks 4+5 together before committing, both will pass at the end of Task 5. Otherwise mark the preload test `it.todo` now and un-todo it in Task 5 — do not commit a failing test.

- [ ] **Step 6: Commit**

```bash
git add electron/updateCheck.cjs electron/updateCheck.d.cts electron/updateCheck.test.ts
git commit -m "feat(updates): daily-throttled release check against GitHub"
```

---

### Task 5: Preload + main-process wiring

**Files:**
- Modify: `PhaseApp/electron/preload.cjs` (append at end)
- Modify: `PhaseApp/electron/main.cjs` (require block ~line 27, `onWillQuit` ~line 85, `app.whenReady` ~line 314)

**Interfaces:**
- Consumes: `createUpdateCheck` from Task 4.
- Produces: `window.phaseUpdates.check(): Promise<{version, url} | null>` (the frozen interface Workstream C consumes).

- [ ] **Step 1: Expose the preload surface**

Append to `PhaseApp/electron/preload.cjs`:

```js
// The MAIN renderer's door to the release update check. One fixed channel,
// pull-only: the renderer asks once on mount, so no push can race page load.
// updateCheck.test.ts reads this file to stop the channel names drifting.
contextBridge.exposeInMainWorld('phaseUpdates', {
  /** Resolves { version, url } when a newer release exists, else null. */
  check: () => ipcRenderer.invoke('phase-updates:check'),
});
```

- [ ] **Step 2: Wire main.cjs**

Add to the require block at the top (after the `createSyncFiles` require):

```js
const { createUpdateCheck } = require('./updateCheck.cjs')
```

Inside `app.whenReady().then(() => { ... })`, after the `phase-sync` try-block and before `lifecycle.register()`, add:

```js
try {
  // The stamp lives beside the app's other user data; the .app bundle is
  // read-only and replaced wholesale on every update.
  const updateStatePath = path.join(app.getPath('userData'), 'update-check.json')
  const updateCheck = createUpdateCheck({
    currentVersion: app.getVersion(),
    fetchLatest: async () => {
      const res = await fetch('https://api.github.com/repos/por25528/phase/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) throw new Error(`releases/latest answered ${res.status}`)
      return res.json()
    },
    readState: () => (fs.existsSync(updateStatePath)
      ? JSON.parse(fs.readFileSync(updateStatePath, 'utf8'))
      : null),
    writeState: (state) => fs.writeFileSync(updateStatePath, JSON.stringify(state)),
    now: () => Date.now(),
    logError: (...args) => console.error(...args),
  })
  ipcMain.handle('phase-updates:check', () => updateCheck.check())
} catch (err) {
  // Same rule as every bridge above: the planner opens even if this cannot.
  console.error('[phase-updates] IPC registration failed', err)
}
```

In the `onWillQuit` callback (next to the existing `ipcMain.removeHandler('phase-sync:...')` lines), add:

```js
ipcMain.removeHandler('phase-updates:check')
```

- [ ] **Step 3: Un-todo the preload contract test if Task 4 marked it, then run the electron suite**

Run: `npx vitest run electron/`
Expected: all pass, including `preload contract`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.cjs electron/main.cjs electron/updateCheck.test.ts
git commit -m "feat(updates): phaseUpdates preload door and main-process wiring"
```

---

### Task 6: Renderer bridge (`updateBridge.ts`)

**Files:**
- Create: `PhaseApp/src/lib/updateBridge.ts`
- Test: `PhaseApp/src/lib/updateBridge.test.ts`

**Interfaces:**
- Consumes: `window.phaseUpdates` (frozen interface — Workstream B provides it at runtime; tests stub it).
- Produces: `updateBridge(): PhaseUpdateBridge` with `{ available: boolean; check(): Promise<UpdateInfo | null> }`; `UpdateInfo = { version: string; url: string }`. Task 7 consumes both exports.

- [ ] **Step 1: Write the failing test**

Create `PhaseApp/src/lib/updateBridge.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateBridge } from './updateBridge';

declare global {
  interface Window {
    phaseUpdates?: { check(): Promise<{ version: string; url: string } | null> };
  }
}

afterEach(() => {
  delete window.phaseUpdates;
});

describe('updateBridge', () => {
  it('is an inert stub in the plain browser', async () => {
    const bridge = updateBridge();
    expect(bridge.available).toBe(false);
    expect(await bridge.check()).toBeNull();
  });

  it('passes check through to the preload', async () => {
    const info = { version: '0.2.0', url: 'https://github.com/por25528/phase/releases/tag/v0.2.0' };
    const check = vi.fn(async () => info);
    window.phaseUpdates = { check };
    const bridge = updateBridge();
    expect(bridge.available).toBe(true);
    expect(await bridge.check()).toEqual(info);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `PhaseApp/`): `npx vitest run src/lib/updateBridge.test.ts`
Expected: FAIL — cannot resolve `./updateBridge`.

- [ ] **Step 3: Write the bridge**

Create `PhaseApp/src/lib/updateBridge.ts`:

```ts
/**
 * The renderer-side wrapper around the preload bridge for the release update
 * check — the sibling of shellBridge.ts with the same rules. In the plain
 * browser the preload does not exist, so the factory returns an inert stub:
 * check() answers null forever and `available` says which world this is. One
 * fixed verb; nothing here accepts a channel name.
 */

export interface UpdateInfo {
  /** Bare semver of the newer release, no leading v. */
  version: string;
  /** The GitHub release page to send the user to. */
  url: string;
}

export interface PhaseUpdateBridge {
  /** False in the plain browser: check() answers null and nothing ever fires. */
  available: boolean;
  /** The newer release, or null when up to date, unknown, or errored. */
  check(): Promise<UpdateInfo | null>;
}

interface UpdatePreload {
  check(): Promise<UpdateInfo | null>;
}

function preloadOf<T>(name: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, T | undefined>)[name];
}

export function updateBridge(): PhaseUpdateBridge {
  const preload = preloadOf<UpdatePreload>('phaseUpdates');
  if (!preload) {
    return { available: false, check: async () => null };
  }
  return { available: true, check: () => preload.check() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/updateBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/updateBridge.ts src/lib/updateBridge.test.ts
git commit -m "feat(updates): renderer bridge over the phaseUpdates preload"
```

---

### Task 7: Update banner + App wiring

**Files:**
- Create: `PhaseApp/src/components/UpdateBanner.tsx`
- Test: `PhaseApp/src/components/UpdateBanner.test.tsx`
- Modify: `PhaseApp/src/App.tsx` (one import, one render line)

**Interfaces:**
- Consumes: `updateBridge`, `PhaseUpdateBridge`, `UpdateInfo` from Task 6.

- [ ] **Step 1: Write the failing tests**

Create `PhaseApp/src/components/UpdateBanner.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';
import type { PhaseUpdateBridge, UpdateInfo } from '../lib/updateBridge';

function bridgeWith(result: UpdateInfo | null, available = true): PhaseUpdateBridge {
  return { available, check: vi.fn(async () => result) };
}

const RELEASE = {
  version: '0.2.0',
  url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
};

describe('UpdateBanner', () => {
  beforeEach(() => localStorage.clear());

  it('shows the notice with a link to the release', async () => {
    render(<UpdateBanner bridge={bridgeWith(RELEASE)} />);
    expect(await screen.findByText(/Phase 0\.2\.0 is available/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(RELEASE.url);
  });

  it('renders nothing when up to date', async () => {
    const bridge = bridgeWith(null);
    const { container } = render(<UpdateBanner bridge={bridge} />);
    await waitFor(() => expect(bridge.check).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('never calls through when the bridge is unavailable', async () => {
    const bridge = bridgeWith(RELEASE, false);
    const { container } = render(<UpdateBanner bridge={bridge} />);
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(bridge.check).not.toHaveBeenCalled();
  });

  it('dismiss hides the notice and remembers the version', async () => {
    render(<UpdateBanner bridge={bridgeWith(RELEASE)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss update notice' }));
    expect(screen.queryByText(/is available/)).toBeNull();
    expect(localStorage.getItem('phase-update-dismissed')).toBe('0.2.0');
  });

  it('stays hidden for a version already dismissed', async () => {
    localStorage.setItem('phase-update-dismissed', '0.2.0');
    const bridge = bridgeWith(RELEASE);
    const { container } = render(<UpdateBanner bridge={bridge} />);
    await waitFor(() => expect(bridge.check).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('shows again for a NEWER version than the dismissed one', async () => {
    localStorage.setItem('phase-update-dismissed', '0.1.5');
    render(<UpdateBanner bridge={bridgeWith(RELEASE)} />);
    expect(await screen.findByText(/Phase 0\.2\.0 is available/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `PhaseApp/`): `npx vitest run src/components/UpdateBanner.test.tsx`
Expected: FAIL — cannot resolve `./UpdateBanner`.

- [ ] **Step 3: Write the component**

Create `PhaseApp/src/components/UpdateBanner.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { PhaseUpdateBridge, UpdateInfo } from '../lib/updateBridge';

// Dismissal is per-version: dismissing 0.2.0 must not silence 0.3.0. The key
// stores exactly one version string, so any DIFFERENT version shows again.
const DISMISSED_KEY = 'phase-update-dismissed';

/**
 * A quiet corner notice that a newer release exists. Pull-only: asks the
 * bridge once on mount (the main process throttles real network checks to one
 * a day). The link is a plain http anchor — main.cjs's window-open handler
 * routes those to the user's browser.
 */
export function UpdateBanner({ bridge }: { bridge: PhaseUpdateBridge }) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!bridge.available) return;
    let cancelled = false;
    void bridge
      .check()
      .then((info) => {
        if (cancelled || !info) return;
        if (localStorage.getItem(DISMISSED_KEY) === info.version) return;
        setUpdate(info);
      })
      .catch(() => {
        // The main process already swallows and logs failures; a rejection
        // here would only mean the bridge itself broke. Stay silent.
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  if (!update) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink shadow-lg"
    >
      <span>Phase {update.version} is available.</span>
      <a
        href={update.url}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline underline-offset-2"
      >
        Download
      </a>
      <button
        type="button"
        aria-label="Dismiss update notice"
        className="ml-1 rounded p-0.5 text-ink-faint hover:text-ink"
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, update.version);
          setUpdate(null);
        }}
      >
        ×
      </button>
    </div>
  );
}
```

Styling note: `border-line`, `bg-surface`, `text-ink`, `text-ink-faint` are guesses at this codebase's Tailwind theme tokens. Before writing, check `tailwind.config.*` / `src/index.css` for the real token names and use those; if the app has no such tokens, use the same literal classes the nearest existing surface (e.g. `Modal.tsx` or `QuickAdd.tsx`) uses for border, background, and text so the banner matches both themes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/UpdateBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount it in App.tsx**

In `PhaseApp/src/App.tsx`:

Add imports next to the other component imports:

```tsx
import { UpdateBanner } from './components/UpdateBanner';
import { updateBridge } from './lib/updateBridge';
```

Inside the `App` component, next to the existing `useMemo`-style singletons, create the bridge once:

```tsx
const updates = useMemo(() => updateBridge(), []);
```

In the returned JSX, render it as a sibling directly after `<ConfirmImportModal ... />` (search for `<ConfirmImportModal` in the return):

```tsx
<UpdateBanner bridge={updates} />
```

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npx tsc -b`
Expected: all pass, clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add src/components/UpdateBanner.tsx src/components/UpdateBanner.test.tsx src/App.tsx
git commit -m "feat(updates): dismissible new-release banner in the Hub"
```

---

## Final integration (coordinator, after all workstreams merge)

- [ ] Merge the three workstream branches; run `npm test && npx tsc -b && npm run build` in `PhaseApp/`.
- [ ] Push `main`, then `git tag v0.1.0 && git push origin v0.1.0`; watch the Release workflow produce both DMGs.
- [ ] Download the arm64 DMG from the release page on this Mac and walk the documented Gatekeeper flow to confirm the README instructions match reality.
