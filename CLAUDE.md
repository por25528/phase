# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Phase is a local-first goal/habit/task planner — React 19 + TypeScript + Vite + Tailwind, persisted to IndexedDB via Dexie, packaged as a native macOS app via Electron.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — typecheck (`tsc -b`) then `vite build`
- `npm test` — run the Vitest suite (`vitest run --config vitest.config.ts`)
- `npm run app:dev` — Electron shell against the Vite dev server (hot-reload)
- `npm run build:mac` — production build, then `electron-builder --mac` (.dmg)

## Layers

- `src/db/types.ts` — all domain types: `Goal`, `GoalNode`, `Habit`, `Task`, and `Session`.
- `src/db/db.ts` — Dexie persistence. The only module that touches IndexedDB.
- `src/lib/*` — pure, side-effect-free helpers; new logic here ships with a sibling `*.test.ts`.
- `src/state/store.ts` — the single global store (`useSyncExternalStore`). All mutations go through `actions`, which call `setAndPersist`. Views never call `db` directly.
- `src/views/<View>.tsx` orchestrates a top-level view; its components live in a per-view subfolder (`plan/`, `timeline/`, `goals/`, `project/`).
- `src/components/` — shared visual primitives.
- `electron/main.cjs` — desktop shell (BrowserWindow, dev-server/dist URL switch).

## Invariants

- The `goals` array is kept column-major (all column-0 goals in order, then column-1, …). `normalizeByColumn` (called from `addGoals`) and the column-ordered rebuild in `setGoalBoard` — both in `store.ts` — are what maintain it; other mutations preserve existing order.
- Node `start`/`deadline`/`plannedWeek`/`plannedDay`/`plannedStartMin`/`estimateMin` are scheduling metadata and never affect the pct roll-up in `src/lib/pct.ts`. A checkpoint is deliberately not metadata: it is a real node and counts in the roll-up, unlike the `Milestone` it replaced.
- Deletes (and other destructive edits) are undo-aware: the action snapshots the affected slice and calls `scheduleUndo`, giving a 5-second undo window (`store.ts`). Any edit that discards user data to hold an invariant — `indentNode` clearing the new parent's completion and slot, `addChild` converting a scheduled leaf into a container — must be undoable too.
- **The Undo toast never outlives its restore.** `setAndPersist`'s sweep drops every non-surgical entry when an ordinary edit lands, and clears `pendingUndo` in the same write (`armedSurgical`). A visible Undo button that does nothing is worse than no button.
- **An import is a generation boundary.** `importBackup` clears `undoStack`/`pendingUndo`: a whole-slice restore armed against the previous dataset would otherwise overwrite the imported one and persist it.
- Backup export/import is disabled until `hydration === 'ready'` (`App.tsx`). A Web Lock (`src/lib/tabLock.ts`) rejects a second tab — Phase assumes a single writer. **A tab that does not own the lock never writes at all**: `persist` is gated in `setAndPersist`, every settings write goes through `ifOwner`, and `importBackup` refuses outright. A single write is a full clear + bulkPut of all four tables, so one from a stale tab rewrites the whole database.
- A failed write latches `persistFailed` until a later write succeeds, and `App.tsx` renders it as a banner. In-memory state advances regardless, so Export stays available as the recovery path.
- "Free" is tense-sensitive: `weekCapacity` reports what a PAST day held (`NO_PAST_LIMIT`) and what a current/future day has LEFT. The week total is the SUM of those day figures — it and `plannedMin` get compared by `isOverCommitted`, so they must cover the same days. Moving or resizing something already on the grid is an adjustment, not a new booking, and also uses `NO_PAST_LIMIT`.
- In the backlog rail, a due date only reorders a row if `dueChip` will also show it (`DUE_CHIP_DAYS`). Anything that jumps the queue has to say why.
- **`PLANNING_HORIZONS` (2) is the one Now/Next boundary.** `projectAttention` silences active-work verdicts above it, `backlogGroups` keeps a parked project's untouched work out of the rail, and `cardPrimaryAction` withholds "Plan next step" — all from that one constant, so a project cannot be quiet on the board and loud in the rail. Commitment is the exception: a parked project's step carrying a `plannedWeek`, or task carrying a `date`, stays listed, because `weekCapacity` bills it to "to place" and `countOpenCarryOver` offers to move it — a number you plan against must have a row beside it. An uncommitted one is DROPPED, never demoted to "Loose tasks": that bucket means "belongs to no project", and it sits at the bottom of the rail, which is more prominent than where the row started, not less.
- **"Planned" means on the calendar** — a day AND a start minute, the predicate `scheduledOn`/`backlogGroups` partition on. Work that is merely committed is `backlogMin` ("to place"), reported separately, because `⌘N` always sets a date and never a start minute: folding the two made the capacity readout contradict the rail beside it. `isOverCommitted` compares planned + backlog against free.
- Bulk edits are ONE undoable write (`removeNodes`/`completeNodes`), never a loop over the single-node action — each call arms its own undo entry and each write's sweep discards the ones before it. They return whether they wrote; callers must not report success on a refusal.
- The tree's rows are covered by children that stop propagation, so row-level MODIFIER clicks are caught in the capture phase (`onClickCapture`). A test that dispatches at the row element cannot see this — component tests must click the child a person actually hits.
- Layout that depends on the Plan sidebar must measure the RAIL, not the viewport: it is 249px at every viewport ≥768px. Use `@container` on `.hb-rail`.
- Visual identity is locked — don't restyle unless explicitly asked. Colours come from the theme tokens: `designScale.test.ts` fails the build on a literal hex, on an arbitrary `text-[Nrem]`, and on a `fontSize` key that collides with a `colors` key (Tailwind emits both as `text-<key>`, and the colour silently wins).
- Hover-revealed row controls use the `.quiet-control` class, never a hand-rolled `opacity-0 group-hover:opacity-100`: it carries the `@media (hover: hover)` gate that keeps them reachable on touch, plus the 24px target floor. It needs a literal `group` ancestor (`group/name` does not match).
- dnd-kit's `attributes` go on a dedicated drag handle, or through `containerDragAttributes` when the draggable is a container holding real buttons — `role="button"` around buttons is invalid and swallows their labels.

## Conventions

- New pure logic goes in `src/lib` with a test file; views stay thin and delegate to `actions`.
- Run `npm test` and `npx tsc -b` before committing.
