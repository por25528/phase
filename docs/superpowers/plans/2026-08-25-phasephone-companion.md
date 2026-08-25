# PhasePhone Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is split into three independent worker tracks (A, B, C) with disjoint file sets, designed to run in parallel worktrees. You were told which track is yours. Do ONLY your track's tasks. Never edit a file another track owns.**

**Goal:** An iPhone companion for Phase (tick, capture, park, view today) syncing through iCloud Drive files, with the Mac app as the single owner of canonical state.

**Architecture:** The Mac stays the only writer of `state.json` (the five entity arrays + a `meta` block). The phone appends `CompanionOp` lines to its own `ops-phone.jsonl` and renders `state.json` + a replay of its not-yet-ingested ops. The Mac ingests the journal by mapping each op onto the **existing** agent write surface (`handleAgentWrite`), so undo, toasts, persistence and every invariant hold for free. Spec: `docs/superpowers/specs/2026-08-25-phasephone-companion-design.md`.

**Tech Stack:** TypeScript everywhere. PhaseApp: React 19 + Vite + Dexie + Electron (existing). PhasePhone: Vite + React + Tailwind (new), Capacitor iOS shell later. The only Swift is the Capacitor plugin in track C.

## Global Constraints

- `PhaseApp/CLAUDE.md` is the authority for all PhaseApp work. Read it first if your track touches PhaseApp.
- **Already on main (do not recreate, import them):** `PhaseApp/src/lib/sync/ops.ts` (the op contract: `CompanionRequest`, `CompanionOp`, `StateFileMeta`, `serializeOp`, `parseOpsJournal`, `opsAfter`) and `PhaseApp/src/lib/sync/stateFile.ts` (`SyncSlices`, `StateFile`, `buildStateFile`, `parseStateFile`). Read both files before starting.
- PhasePhone may import from `PhaseApp/src/lib/**` and `PhaseApp/src/db/types.ts` ONLY — never views, never `src/state/store.ts`, never `src/db/db.ts`.
- Ops are ingested strictly in journal order; op `id` is the idempotency key; `meta.ingestedThroughOpId` is the high-water mark. `baseGeneration` is informational — never use it to decide ingestion.
- A malformed journal line, or an op whose target no longer exists, is skipped and counted — never fatal.
- Verification before claiming done: PhaseApp tracks run `npm test` AND `npx tsc -b` inside `PhaseApp/`; PhasePhone runs its own `npm test` and `npx tsc -b` inside `PhasePhone/`. All green, no skips.
- Commit after every task with a conventional-commit message. Never push. Stage files explicitly (`git add <paths>`), never `git add -A`.
- TDD: write the failing test first for every logic change.

---

## Track A — Mac side: export, ingest, Electron file bridge

**Owns:** `PhaseApp/src/state/syncIngest.ts(+test)`, `PhaseApp/src/state/syncExport.ts(+test)`, `PhaseApp/electron/syncFiles.cjs(+d.cts,+test)`, and small wiring edits in `PhaseApp/src/db/db.ts`, `PhaseApp/src/App.tsx`, `PhaseApp/electron/main.cjs`, `PhaseApp/electron/preload.cjs`.

### Task A1: Sync meta persistence in `db.ts`

**Files:** Modify `PhaseApp/src/db/db.ts`. Test: `PhaseApp/src/db/db.test.ts` if one exists, else add `PhaseApp/src/state/syncMeta.test.ts` exercising through fake-indexeddb (follow whatever pattern existing db-touching tests use — check `git grep -l fake-indexeddb src`).

**Interfaces (produces):**
```ts
export interface SyncMeta { generation: number; ingestedThroughOpId: string | null; }
export async function loadSyncMeta(): Promise<SyncMeta>   // default { generation: 0, ingestedThroughOpId: null }
export async function saveSyncMeta(meta: SyncMeta): Promise<void>
```

- [ ] Follow the exact pattern of `loadScale`/`saveScale` in `db.ts` (settings table row, lenient read). Test: default on empty DB, round-trip after save.
- [ ] Run the test, commit.

### Task A2: `syncIngest.ts` — journal → store actions

**Files:** Create `PhaseApp/src/state/syncIngest.ts`, `PhaseApp/src/state/syncIngest.test.ts`.

**Interfaces:**
- Consumes: `parseOpsJournal`, `opsAfter`, `CompanionOp` from `../lib/sync/ops`; `handleAgentWrite`, `AgentWriteDeps` from `../lib/agentWrites`.
- Produces:
```ts
export interface IngestDeps extends AgentWriteDeps {
  getIngestedThrough(): string | null;
  setIngestedThrough(id: string): void;   // called after EACH op, so a crash never replays
}
export interface IngestResult { applied: number; skipped: number; }
export function ingestJournal(journalText: string, deps: IngestDeps): IngestResult
```

Behavior, exactly:
1. `parseOpsJournal`, then `opsAfter(ops, deps.getIngestedThrough())`.
2. For each op in order: `add_loose_task` maps to `deps.actions.addTask(title, date ?? null, null)` and counts as applied; every other verb goes through `handleAgentWrite(op.request, deps)` — an `ok` response counts applied, an error response counts skipped (the design's "phone ticked a leaf the Mac deleted" case). Either way call `deps.setIngestedThrough(op.id)` before moving on.
3. Return the counts. No toasts here — the caller owns presentation (testability, same reason `agentWrites` takes injected deps).

- [ ] Study `PhaseApp/src/lib/agentWrites.test.ts` first and reuse its fake-deps pattern. Write failing tests: applies a `complete_task` op via `handleAgentWrite`; maps `add_loose_task` to `actions.addTask`; skips an op for a missing node but continues and still advances the high-water mark; ignores ops at or before `getIngestedThrough()`; empty/garbage journal → `{applied:0, skipped:0}`.
- [ ] Implement (the whole function is ~40 lines), run tests, commit.

### Task A3: `syncExport.ts` — debounced canonical export

**Files:** Create `PhaseApp/src/state/syncExport.ts`, `PhaseApp/src/state/syncExport.test.ts`.

**Interfaces:**
- Consumes: `buildStateFile` from `../lib/sync/stateFile`; `SyncMeta` from A1.
- Produces:
```ts
export interface ExportDeps {
  getSlices(): SyncSlices;                       // { goals, habits, tasks, sessions, lives } from store state
  loadMeta(): Promise<SyncMeta>;
  saveMeta(meta: SyncMeta): Promise<void>;
  writeState(text: string): Promise<void>;       // the Electron bridge
  now(): string;                                 // ISO timestamp, injected for tests
}
export function createSyncExporter(deps: ExportDeps, debounceMs?: number): {
  schedule(): void;      // debounced (default 1500ms)
  flush(): Promise<void>; // immediate — used right after ingest
}
```

Behavior: each actual write loads meta, bumps `generation` by 1, stamps `writtenAt: now()`, carries `ingestedThroughOpId` through, `buildStateFile(...)`, `writeState(text)`, then `saveMeta`. If `writeState` rejects, do NOT save meta (next schedule retries); swallow the rejection after a `console.warn` — sync must never break the app.

- [ ] Tests with fake timers: coalesces bursts into one write; flush writes immediately and cancels a pending debounce; generation increments per write; failed write leaves generation unbumped.
- [ ] Implement, run tests, commit.

### Task A4: `electron/syncFiles.cjs` — the file side

**Files:** Create `PhaseApp/electron/syncFiles.cjs`, `PhaseApp/electron/syncFiles.d.cts`, `PhaseApp/electron/syncFiles.test.ts`. Follow the module/test conventions of `electron/agentIpc.cjs` + its `.d.cts` + `.test.ts`.

**Interfaces (produces):**
```ts
// createSyncFiles({ dir, pollMs = 5000 }) — dir resolution: process.env.PHASE_SYNC_DIR
// if set, else path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Phase').
// (Plain iCloud Drive folder: works today with no developer account; the app-container
// switch is a one-env-var change later.)
createSyncFiles(opts): {
  start(onJournalChange: (text: string) => void): void, // mkdir -p dir; immediate read of ops-phone.jsonl if present; then poll mtime via fs.stat every pollMs and re-read on change
  readJournal(): string | null,
  writeState(text: string): void,   // atomic: write `${dir}/state.json.tmp`, fs.renameSync over state.json
  stop(): void,
}
```

- [ ] Tests against a temp dir (see how `agentSocket.test.ts` handles temp paths): writeState is atomic and readable back; start() fires the callback once on first existing journal and again after an append (advance the poll with fake timers or a short real poll); missing dir is created; corrupt/no journal → no callback, no throw.
- [ ] Implement, run `npm test`, commit.

### Task A5: Wiring — main, preload, App

**Files:** Modify `PhaseApp/electron/main.cjs`, `PhaseApp/electron/preload.cjs`, `PhaseApp/src/App.tsx`, `PhaseApp/src/state/store.ts` (read-only — you need `subscribe`/state access; add NO new store actions).

- [ ] `main.cjs`: instantiate `createSyncFiles` beside the agent bridge; `start` pushes journal text to the renderer via `mainWindow.webContents.send('phase:sync-journal', text)`; also re-read + push on app `browser-window-focus`. `ipcMain.handle('phase:sync-write-state', (_e, text) => syncFiles.writeState(text))`. Dispose in the same place `agentSocket.close()` runs.
- [ ] `preload.cjs`: expose `window.phaseSync = { writeState(text): Promise<void>, onJournal(cb): () => void }` following the existing contextBridge pattern in that file.
- [ ] `App.tsx`: one `useEffect` gated on `hydration === 'ready'` and `window.phaseSync !== undefined` (browser dev has no bridge): build `IngestDeps` from `actions`/store state + A1's meta helpers, subscribe `onJournal` → `ingestJournal` → if `applied+skipped > 0` toast `Phone: N change(s) applied` (append `, M couldn't` when skipped > 0) via `actions.showToast` → `exporter.flush()`. Create the A3 exporter with the store's subscribe → `schedule()` on any change to the five entity slices. Respect the tab lock: ingest and export only when this tab owns it — reuse however `App.tsx`/store gates other owner-only work (`ifOwner` semantics); a non-owning window must do neither.
- [ ] Manual smoke: `PHASE_SYNC_DIR=/tmp/phase-sync npm run app:dev`, tick a task → `/tmp/phase-sync/state.json` appears and generation bumps; append a valid op line to `/tmp/phase-sync/ops-phone.jsonl` (craft with `serializeOp` shape against a real task id from the state file) → toast appears, task completes, state.json regenerates with the op id as `ingestedThroughOpId`. Record what you saw in the commit message.
- [ ] `npm test` + `npx tsc -b`, commit.

---

## Track B — PhasePhone app + replay projection

**Owns:** `PhaseApp/src/lib/sync/replay.ts(+test)` and the entire `PhasePhone/` folder except `PhasePhone/plugin-icloud/` (track C's).

### Task B1: `replay.ts` — pure projection of pending ops

**Files:** Create `PhaseApp/src/lib/sync/replay.ts`, `PhaseApp/src/lib/sync/replay.test.ts`.

**Interfaces:**
- Consumes: `CompanionOp` from `./ops`; `SyncSlices` from `./stateFile`; tree/status helpers from `../tree`, `../status`.
- Produces: `export function replayOps(slices: SyncSlices, ops: readonly CompanionOp[]): SyncSlices` — pure, never mutates input, unknown/inapplicable op → skip silently.

Verb rules (mirror what the Mac will do with the same op — read the matching `handleAgentWrite` branch in `agentWrites.ts` for each before implementing):
- `complete_task` task-ref: `done: true`, `doneAt: op.ts.slice(0,10)`. Step-ref: leaf status `'done'`, `doneAt`, drop `blockedOn`.
- `set_status`: leaves only; `'todo'` deletes the field; `'blocked'` may carry `blockedOn`, every other status drops it; entering `'done'` sets `doneAt`, leaving it deletes `doneAt`. (Mirror `writeStatus` in `store.ts` — read it.)
- `add_task` (project step): append a new LEAF `{ id: op.id, title }` to the goal's root nodes, or to `parentId`'s children when given and that node is a container. The temp id `op.id` is deliberate — after ingest the phone re-renders from canonical and the temp node vanishes.
- `add_loose_task`: append `Task { id: op.id, title, done: false, goalId: null }` (+`date` when present).
- `log_time`: append `Session { id: op.id, goalId: ref.goalId, date: op.request.date ?? op.ts.slice(0,10), minutes, note: '' }` with `nodeId`/`taskId` per `ref.kind` (see the `Session` doc in `db/types.ts` — at most one of them).
- `append_note`: same separator/behavior as the `append_note` branch in `agentWrites.ts` — mirror it exactly, on `node.notes` / `goal.notes`.

- [ ] Failing tests first, one per verb, plus: input not mutated; op against a deleted node skips; replay of `[]` returns an equal projection.
- [ ] Implement, run `npx vitest run src/lib/sync/replay.test.ts`, then full `npm test` + `npx tsc -b` in PhaseApp, commit.

### Task B2: PhasePhone scaffold

**Files:** Create `PhasePhone/package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `vitest.config.ts`.

- [ ] Copy the toolchain shape from `PhaseWeb/` (same Vite/Tailwind/PostCSS versions — read its `package.json`) plus `vitest` + `jsdom` + `@testing-library/react` matching PhaseApp's dev-dep versions. Copy the theme-token block the way `PhaseWeb/src/index.css` does (its comment at line 5 documents the convention).
- [ ] Alias `@app/*` → `../PhaseApp/src/*` in BOTH `tsconfig.json` paths and `vite.config.ts` `resolve.alias`; set `include`/`server.fs.allow` so Vite may read the sibling folder. Prove it: `src/App.tsx` renders "Phase" + today's date via `todayStr()` from `@app/lib/dates`.
- [ ] Mobile viewport meta (`viewport-fit=cover`, no user scaling), `npm run dev` renders, `npx tsc -b` clean. Commit.

### Task B3: `FileBridge` + local dev bridge

**Files:** Create `PhasePhone/src/bridge/FileBridge.ts`, `PhasePhone/src/bridge/localBridge.ts`, `PhasePhone/src/bridge/localBridge.test.ts`.

**Interfaces (produces — track C's plugin will implement the same contract natively):**
```ts
export interface FileBridge {
  readStateFile(): Promise<string | null>;          // null: never synced yet
  readJournal(): Promise<string>;                   // '' when absent
  appendOp(line: string): Promise<void>;            // durable append
  rewriteJournal(text: string): Promise<void>;      // compaction
  onChange(cb: () => void): () => void;             // files changed externally
}
```

- [ ] `localBridge.ts`: localStorage-backed implementation (keys `phase-sync-state`, `phase-sync-journal`), `onChange` via the `storage` event; export `seedState(text: string)` for dev/tests. Tests: append accumulates lines; rewrite replaces; readStateFile null before seed.
- [ ] Commit.

### Task B4: `phoneStore.ts` — state, projection, op-writing actions

**Files:** Create `PhasePhone/src/state/phoneStore.ts`, `PhasePhone/src/state/phoneStore.test.ts`.

**Interfaces:**
- Consumes: `parseStateFile` (`@app/lib/sync/stateFile`), `parseOpsJournal`/`opsAfter`/`serializeOp` (`@app/lib/sync/ops`), `replayOps` (`@app/lib/sync/replay`), `FileBridge` (B3), `WorkRef` (`@app/lib/expectedTime`).
- Produces:
```ts
export interface PhoneState {
  status: 'loading' | 'ready' | 'never-synced';
  projected: SyncSlices | null;      // canonical + pending replay
  writtenAt: string | null;          // meta.writtenAt of the canonical file
  pendingCount: number;
}
export function createPhoneStore(bridge: FileBridge): {
  usePhoneStore(): PhoneState;       // useSyncExternalStore hook, PhaseApp store style
  refresh(): Promise<void>;
  ops: {
    completeTask(ref: WorkRef): Promise<void>;
    setStatus(nodeId: string, status: 'parked' | 'todo' | 'done'): Promise<void>;
    addStep(goalId: string, title: string, parentId?: string): Promise<void>;
    addLooseTask(title: string, date?: string): Promise<void>;
    logTime(ref: WorkRef, minutes: number): Promise<void>;
  };
}
```

Behavior: `refresh()` reads both files, parses (a null/corrupt state file KEEPS the previous good projection — design §5), computes `pending = opsAfter(ops, meta.ingestedThroughOpId)`, `projected = replayOps(base, pending)`. Every `ops.*` builds a `CompanionOp` (`crypto.randomUUID()`, `new Date().toISOString()`, `baseGeneration` from current meta), appends via bridge, then recomputes projection synchronously (optimistic). During append, compact: drop journal ops at-or-before `ingestedThroughOpId` via `rewriteJournal` (write pending + new op). Subscribe `bridge.onChange` → `refresh()`.

- [ ] Tests with a fake in-memory bridge: seed a small state file (build with `buildStateFile`), tick a task → projected shows it done + journal got one line; corrupt state text on a later refresh keeps previous projection; ops already covered by `ingestedThroughOpId` are compacted away on next append; `never-synced` when no state file.
- [ ] Implement, tests green, commit.

### Task B5: Today screen

**Files:** Create `PhasePhone/src/views/Today.tsx` (+ per-view components under `PhasePhone/src/views/today/` as needed), test `PhasePhone/src/views/Today.test.tsx`. Modify `src/App.tsx` (tab shell: Today / Capture / Week, bottom tab bar, Today default).

Reuse PhaseApp's pure derivations through `@app/lib/*` wherever the signature takes plain slices — read `PhaseApp/src/views/Today.tsx` and the lib modules it imports (`buildDailyWork` and friends) and reuse rather than re-derive. The screen shows, in order: a date header with a quiet "as of \<writtenAt\>" stamp when the canonical file is older than 10 minutes; today's committed work (tasks dated today + steps with a sitting today) with a tap-to-tick checkbox and a long-press/secondary Park action; carried-over commitments (past `date`/`plannedWeek`, reuse the lib's carry-over derivation); done-today last, no cap. Ticking calls `ops.completeTask`; park calls `ops.setStatus(nodeId,'parked')`. Match Phase's visual language (tokens, `STATUS_BOX` semantics — parked bar, not a faint border).

- [ ] Component test: seeded store → rows render in the three sections; tapping a row's checkbox marks it done optimistically (assert through the store, not the bridge).
- [ ] Implement, tests + `npx tsc -b` green, commit.

### Task B6: Capture + Week glance

**Files:** Create `PhasePhone/src/views/Capture.tsx`, `PhasePhone/src/views/Week.tsx`, tests beside them.

- [ ] Capture: one text field autofocused, an optional project picker (goals at column 0–1, plus "No project"), optional chips Today/Tomorrow (sets `date`), submit → `addLooseTask` or `addStep(goalId, title)`; clears and toasts inline "Captured". Test: submit with project → journal op is `add_task`; without → `add_loose_task`.
- [ ] Week: read-only. This week's placed sittings (walk goals/tasks `blocks` for the current week — reuse `@app/lib` week/slot helpers; read `slot.ts` first) grouped by day, `HH:MM – HH:MM title`, today highlighted. Test: seeded blocks appear under the right day.
- [ ] Full PhasePhone `npm test` + `npx tsc -b`, plus PhaseApp `npm test` + `npx tsc -b` (you touched `src/lib/sync/`), commit.

---

## Track C — Capacitor iCloud plugin

**Owns:** `PhasePhone/plugin-icloud/` (everything under it) and nothing else. This is a self-contained Capacitor plugin package; it must not import from, or depend on, tracks A or B.

### Task C1: Plugin package + TS surface

**Files:** Create `PhasePhone/plugin-icloud/package.json`, `tsconfig.json`, `src/definitions.ts`, `src/index.ts`, `src/web.ts`, `PhaseICloud.podspec`.

**Interfaces (produces — mirrors track B's `FileBridge`, adapted to Capacitor conventions):**
```ts
export interface PhaseICloudPlugin {
  readStateFile(): Promise<{ text: string | null }>;
  readJournal(): Promise<{ text: string }>;
  appendOp(options: { line: string }): Promise<void>;
  rewriteJournal(options: { text: string }): Promise<void>;
  addListener(eventName: 'filesChanged', listener: () => void): Promise<PluginListenerHandle>;
}
```

- [ ] Scaffold by hand following the official Capacitor 7 custom-plugin layout (peer-dep `@capacitor/core@^7`); `src/index.ts` uses `registerPlugin('PhaseICloud', { web: () => import('./web').then(m => new m.PhaseICloudWeb()) })`. `web.ts` implements the interface over localStorage exactly as track B's localBridge semantics (state under `phase-sync-state`, journal under `phase-sync-journal`) so the web build stays runnable.
- [ ] `npm install && npx tsc -b` inside `plugin-icloud/` green. Commit.

### Task C2: Swift implementation

**Files:** Create `PhasePhone/plugin-icloud/ios/Plugin/PhaseICloudPlugin.swift`, `ios/Plugin/PhaseICloud.swift`, `ios/Plugin/PhaseICloudPlugin.m` (the ObjC macro registration Capacitor needs).

`PhaseICloud.swift` owns the file logic; the plugin class is a thin bridge. Logic: base dir = `FileManager.default.url(forUbiquityContainerIdentifier: nil)?.appendingPathComponent("Documents/Phase")`, created on first use; all reads/writes through `NSFileCoordinator` (coordinated read for `state.json` with `startDownloadingUbiquitousItem` first when the item is not downloaded; coordinated write for journal append — read-modify-write the whole file, the journal is tiny). `filesChanged` via `NSMetadataQuery` scoped to `NSMetadataQueryUbiquitousDocumentsScope` filtered to the two filenames. `readStateFile` resolves `{ text: null }` when the container or file is absent — never rejects for absence; reject only for real IO errors.

- [ ] Write the Swift files. Verify what's verifiable without an Xcode project: `xcrun swiftc -parse ios/Plugin/*.swift` (if Capacitor imports block `-parse`, note it and eyeball twice instead — do not fake a pass).
- [ ] Commit.

### Task C3: Integration guide

**Files:** Create `PhasePhone/plugin-icloud/INTEGRATION.md`.

- [ ] Write the exact post-merge steps for the coordinator, concretely: add `"phase-icloud": "file:./plugin-icloud"` to PhasePhone, `npx cap add ios`, `npx cap sync`; Xcode signing + iCloud capability (iCloud Documents, container id — note the Mac side reads `~/Library/Mobile Documents/com~apple~CloudDocs/Phase` today via `PHASE_SYNC_DIR` default, and moving both to a shared app container `iCloud.com.<team>.phase` is the production setup: list both options with the exact entitlement keys); the ~20-line `icloudBridge.ts` adapter mapping `FileBridge` (quote track B's interface verbatim from this plan) onto the plugin; a manual device smoke checklist. No placeholders — every command and plist/entitlement key spelled out.
- [ ] Commit.

---

## Integration phase (coordinator, after all tracks merge — not for workers)

1. Merge A, B, C into main (A and B both touch `PhaseApp/src/lib/sync/` — additive, disjoint files).
2. Wire `PhasePhone/src/bridge/icloudBridge.ts` per C3's guide; bridge selection: Capacitor native → plugin, else localBridge.
3. Mac↔phone dry run without a phone: point `PHASE_SYNC_DIR` at a folder, run PhasePhone in the browser with localBridge swapped for a dev bridge over the same folder (or hand-copy files) and walk one full loop: phone tick → journal → Mac ingest toast → state.json regenerates → phone compacts.
4. Apple Developer enrollment, `cap add ios`, device smoke per INTEGRATION.md.
