# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Phase is a local-first goal/habit/task planner — React 18 + TypeScript + Vite + Tailwind, persisted to IndexedDB via Dexie, packaged as a native macOS app via Electron.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — typecheck (`tsc -b`) then `vite build`
- `npm test` — run the Vitest suite (`vitest run --config vitest.config.ts`)
- `npm run app:dev` — Electron shell against the Vite dev server (hot-reload)
- `npm run build:mac` — production build, then `electron-builder --mac` (.dmg)

## Layers

- `src/db/types.ts` — all domain types: `Goal`, `GoalNode`, `Habit`, `Task`, `Session`, `Milestone`.
- `src/db/db.ts` — Dexie persistence. The only module that touches IndexedDB.
- `src/lib/*` — pure, side-effect-free helpers; new logic here ships with a sibling `*.test.ts`.
- `src/state/store.ts` — the single global store (`useSyncExternalStore`). All mutations go through `actions`, which call `setAndPersist`. Views never call `db` directly.
- `src/views/<View>.tsx` orchestrates a top-level view; its components live in a per-view subfolder (`today/`, `timeline/`, `goals/`).
- `src/components/` — shared visual primitives.
- `electron/main.cjs` — desktop shell (BrowserWindow, dev-server/dist URL switch).

## Invariants

- The `goals` array is kept column-major (all column-0 goals in order, then column-1, …). `normalizeByColumn` (called from `addGoals`) and the column-ordered rebuild in `setGoalBoard` — both in `store.ts` — are what maintain it; other mutations preserve existing order.
- `Milestone`s and node `start`/`deadline` are display/scheduling metadata only — they never affect the pct roll-up in `src/lib/pct.ts`.
- Deletes (and other destructive edits) are undo-aware: the action snapshots the affected slice and calls `scheduleUndo`, giving a 5-second undo window (`store.ts`).
- Backup export/import is disabled until `hydration === 'ready'` (`App.tsx`). A Web Lock (`src/lib/tabLock.ts`) rejects a second tab — Phase assumes a single writer, so a second tab gets a warning banner instead of silently clobbering the first.
- Visual identity is locked — don't restyle unless explicitly asked.

## Conventions

- New pure logic goes in `src/lib` with a test file; views stay thin and delegate to `actions`.
- Run `npm test` and `npx tsc -b` before committing.
