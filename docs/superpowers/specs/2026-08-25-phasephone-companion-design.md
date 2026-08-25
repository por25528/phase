# PhasePhone — iPhone companion via Capacitor + iCloud file sync

**Date:** 2026-08-25
**Status:** Approved

## What this is

A companion iPhone app for Phase: tick things off, quick capture, park/unpark,
see today. Planning (week grid, goal tree, board) stays on the Mac. The phone
never becomes a second full client — it is a projection of the Mac's state plus
a journal of small edits.

Decisions made during brainstorming:

- **Scope:** companion, not parity and not read-only.
- **Sync channel:** iCloud Drive files. No server, no accounts, stays
  local-first. Apple-only, which matches the user's devices.
- **Shell:** Capacitor wrapping a mobile-first React build. Reuses
  `PhaseApp/src/lib` and the domain types verbatim; the only Swift is a thin
  file-access plugin. SwiftUI was rejected because every derivation the
  companion needs (`firstOpenLeaf`, `backlogGroups`, status rules) would have
  to be reimplemented and kept in step by hand; React Native was rejected as a
  new toolchain plus a full view rewrite for no reuse gain over Capacitor.
- **Sync model:** Mac owns, phone journals. The Mac stays the single writer of
  the canonical state; the phone appends ops to its own file. No merge
  conflicts by construction.
- **Desktop distribution:** unchanged. The unsigned `.dmg` ritual stays; the
  one unavoidable piece of "distribution" work is an Apple Developer account
  ($99/yr) for the iCloud container and the iOS build.

## 1. Shape of the repo

A third folder, `PhasePhone/`, beside `PhaseApp/` and `PhaseWeb/`. The
no-cross-imports rule is relaxed in one direction only: `PhasePhone` may import
from `PhaseApp/src/lib`, `PhaseApp/src/db/types.ts`, and pure derivation code,
via a TS path alias — never copies. It never imports views, the store, or
Dexie. The desktop app is untouched except for the new sync module (§3).

- `PhasePhone/` = Vite + React + Tailwind (same theme tokens as the app) +
  Capacitor iOS shell.
- Screens:
  - **Today** — the advisor's Now, carried-over rows, tick/park, completed.
  - **Capture** — add a loose task, or a step under a picked project.
  - **Week glance** — read-only list of this week's planned blocks.
- No goal tree, no board, no drag scheduling.

## 2. Sync contract (the core)

Files in the app's iCloud Drive container, `Phase/`:

- `state.json` — the existing backup-export format, plus a `generation`
  counter and `writtenAt`. **Only the Mac writes it.**
- `ops-phone.jsonl` — append-only journal. **Only the phone writes it.**
  Each op: `{id, ts, baseGeneration, verb, payload}`.

The ops vocabulary is limited to the companion's powers:
`completeLeaf`, `uncompleteLeaf`, `completeTask`, `toggleParked`, `addTask`,
`addStep`, `logTime`, `appendNote`.

The phone renders `state.json` + replay of its own not-yet-ingested ops. It
knows which ops are pending by comparing each op's `baseGeneration` against the
state file's `generation`. The phone therefore works offline and while the Mac
is asleep — it is rendering a projection, never owning state.

## 3. Mac-side ingest

New module in PhaseApp, `src/sync/icloudIngest.ts`, plus a small Electron
main-process piece watching
`~/Library/Mobile Documents/iCloud~<container>/Documents/Phase/`.

- On launch, on focus, and on file change: read the journal, drop ops already
  ingested (op ids tracked in settings), and map each verb onto the
  **existing store actions**. Ops never touch Dexie or the state shape
  directly, so every invariant (undo sweep, status rules, single-writer gate)
  holds for free.
- After `setAndPersist` succeeds, export `state.json` with `generation + 1`,
  reusing the existing backup-export path.
- An op that no longer applies (its node was deleted on the Mac) is skipped
  and logged, not an error — ticks are idempotent, captures cannot conflict.
- The Web-lock rule extends naturally: only the lock-owning tab/process
  ingests and exports.

## 4. Phone-side mechanics

- A Capacitor plugin (~40 lines of Swift — the only Swift in the project)
  exposes: read `state.json`, append a line to `ops-phone.jsonl`, and a
  change callback, all inside the iCloud container. This is boilerplate
  `NSFileCoordinator` code, not app logic.
- The phone mirrors its journal in local storage, so an op is never lost to an
  iCloud hiccup; the append is retried until the file write confirms.
- No Dexie on the phone. State is read-only input + an in-memory ops overlay.

## 5. Failure handling

- **iCloud slow or unavailable:** the phone shows last-known state with a
  quiet "as of \<time\>" stamp; ops queue locally. The Mac simply sees the
  journal later.
- **The one true conflict** — the phone ticks a leaf the Mac deleted —
  resolves as skip-and-report: a small ingest toast on the Mac
  ("2 phone changes couldn't apply").
- **Corrupt or partial `state.json` read** (iCloud mid-write): keep the
  previous good copy; `generation` makes staleness detectable.

## 6. Testing

- The ops vocabulary and the replay projection are pure TS → Vitest, same
  discipline as `src/lib`.
- The ingest mapping is tested against the real store in PhaseApp's suite:
  op in → state out, idempotency, unknown-node skip.
- The Swift plugin stays too thin to need tests beyond a manual smoke run on
  device.

## Build order

1. Ops vocabulary + replay + ingest into PhaseApp — usable and testable with
   plain files, no phone involved yet.
2. `PhasePhone` Today screen against a copied `state.json`.
3. Capacitor shell + iCloud plugin, on device.
4. Capture + Week glance + polish.
