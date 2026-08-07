# Phase Usage-Ready Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Phase from feature-complete to daily-driver: land the pending goal-import feature, make persistence crash-safe, fail loudly instead of silently, and polish offline / mobile / install.

**Architecture:** No new subsystems. Ten small hardening tasks against the existing store (`useSyncExternalStore` singleton in `src/state/store.ts`), the Dexie layer (`src/db/db.ts`), and the App shell (`src/App.tsx`). Every task ends green (`npm test` + `npm run build`) and commits.

**Tech Stack:** React 19, Vite 8, Tailwind 3.4, Dexie 4, Vitest 3 (node environment, tests match `src/**/*.test.ts`).

## Global Constraints

- **Visual identity is locked** (palette v3): all colors come from the tokens in `tailwind.config.js` (`bg`, `panel`, `ink`, `ink-soft`, `muted`, `faint`, `line`, `line-2`, `hover`, `accent`, `warn`, `warn-tint`, `paper`…). Fonts: Fraunces (`font-disp`) for display, Inter (`font-ui`) for UI. No redesigns, no new hex values, no new fonts.
- **Goals array stays column-major**: `normalizeByColumn()` in `src/state/store.ts` keeps `goals` sorted by `column` (stable within a column). Any mutation of `goals` must preserve this — the Goals view is a drag-between-columns priority board that depends on it.
- **New dependencies allowed by this plan, exactly**: `fake-indexeddb` (dev), `@fontsource-variable/fraunces`, `@fontsource-variable/inter`. Nothing else.
- **tsconfig has `noUnusedLocals` + `noUnusedParameters`** — when you delete code, delete its now-unused imports too or `npm run build` fails.
- **Dates are local `'YYYY-MM-DD'` strings** everywhere; they compare lexicographically. Never store `Date` objects.
- **Baseline at plan time: 177 tests green, `npm run build` clean.** Both must stay green at every commit.
- Commit messages follow the repo's conventional style: `feat(scope): …`, `fix(scope): …`, `chore: …`.
- The working tree starts with **uncommitted WIP** (Task 1 lands it). Do not discard or stash it.

## Audited and deliberately NOT included (don't "fix" these)

- `daysLeftLabel` DST concern — `Math.round` on the ms-difference absorbs the ±1 h skew; it is correct as written (`src/lib/dates.ts:57-64`).
- Checkbox accessibility — the real checkboxes (`TodayCheckbox`, `LeafCheckbox` in `GoalTree.tsx`) are already `<button role="checkbox" aria-checked>`. The inaccessible `src/components/Checkbox.tsx` is dead code and gets deleted in Task 8.
- Goals board horizontal scroll on small screens — already handled (`overflow-x-auto` on the columns row, `Goals.tsx`).
- Service worker / offline caching — deliberately skipped: the app is served locally, and SW cache staleness during active development costs more than the offline gain. Task 10 adds a manifest only.
- Live cross-tab state sync — out of scope; Task 5 ships an honest "second tab" warning instead.
- Component-level tests (@testing-library) — pure-lib + store tests still cover the risky logic; keep it that way.

---

### Task 1: Land the goal-import feature (already written, uncommitted)

The working tree contains a complete feature: **New Goal modal + JSON import modal with a copyable AI prompt** (`Modal.tsx`, `goalImport.ts` + 26 passing tests, `store.addGoals`, rewritten Goals header/empty-state). This task adds the missing store-level tests, smoke-tests it, and commits it.

**Files:**
- Modify: `src/state/store.test.ts` (append tests)
- Commit as-is (already written): `src/components/Modal.tsx`, `src/lib/goalImport.ts`, `src/lib/goalImport.test.ts`, `src/state/store.ts`, `src/views/Goals.tsx`

**Interfaces:**
- Produces: `actions.addGoals(newGoals: Goal[]): void` — appends fully-built goals, re-sorts column-major, auto-expands imported container nodes. Later tasks may rely on it existing.

- [ ] **Step 1: Confirm the baseline is green**

Run: `npm test` → 177 pass (8 files). Run: `npm run build` → clean.

- [ ] **Step 2: Write failing store tests for `addGoals`**

Append to `src/state/store.test.ts` (inside the top-level `describe('store actions', …)` block, after the last test). Also add `import type { Goal } from '../db/types';` next to the existing imports at the top of the file.

```ts
  describe('addGoals (import path)', () => {
    it('appends, re-sorts column-major, and auto-expands imported containers', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('existing', '2026-12-31'); // lands in column 0
      const imported: Goal[] = [
        {
          id: 'gi_later', title: 'Imported later', start: '2026-07-05', deadline: '2026-12-31',
          column: 2,
          nodes: [{ id: 'grp1', title: 'Group', children: [{ id: 'leaf1', title: 'Leaf', done: false }] }],
        },
        { id: 'gi_top', title: 'Imported top', start: '2026-07-05', deadline: '2026-12-31', column: 0, nodes: [] },
      ];
      actions.addGoals(imported);
      // column-major: both col-0 goals (in insertion order) before the col-2 goal
      expect(getState().goals.map((g) => g.title)).toEqual(['existing', 'Imported top', 'Imported later']);
      // container nodes from imported goals render expanded in the drawer
      expect(getState().expanded.has('grp1')).toBe(true);
    });

    it('is a no-op for an empty array', async () => {
      const { actions, getState } = await freshStore();
      const before = getState().goals;
      actions.addGoals([]);
      expect(getState().goals).toBe(before);
    });
  });
```

- [ ] **Step 3: Run the tests** — `npm test` → the two new tests PASS (the action already exists in the WIP; these tests pin its contract). All 179 green. If either fails, the store has a real bug — fix the store, not the test.

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`, open the Goals view:
1. "+ New goal" → modal: title, priority select, start/deadline dates, "First steps" (type a step, Enter adds it, ✕ removes), notes → "Add goal" → goal appears in the chosen column, toast "Goal added".
2. "Import goal" → modal: paste `{"title":"Import test","priority":"medium","subgoals":["a", {"title":"grp","subgoals":["b"]}]}` → "Add to board" → goal in Medium column, toast, drawer shows the group expanded.
3. Paste `not json` → inline red error, modal stays open. Esc closes both modals.
4. With all goals deleted, the board area shows the dashed empty state with both buttons.

- [ ] **Step 5: Commit everything**

```bash
git add src/components/Modal.tsx src/lib/goalImport.ts src/lib/goalImport.test.ts src/state/store.ts src/views/Goals.tsx src/state/store.test.ts
git commit -m "feat(goals): new-goal modal + JSON import with copyable AI prompt"
```

---

### Task 2: Atomic persistence (Dexie transaction)

`persist()` currently runs four independent `clear().then(bulkPut)` chains in a `Promise.all` (`src/db/db.ts:160-167`). If one chain fails after another's `clear()` succeeded, the DB is left partially wiped. Wrap the whole write in one `rw` transaction so it's all-or-nothing, and pin the behavior with real-IndexedDB tests via `fake-indexeddb`.

**Files:**
- Modify: `src/db/db.ts:160-167` (`persist`)
- Create: `src/db/db.test.ts`
- Modify: `package.json` (dev dep)

**Interfaces:**
- Consumes: `db`, `persist`, types `AppState`, `Goal` from `./types`.
- Produces: `src/db/db.test.ts` with a shared `goal(id)` helper and a table-clearing `beforeEach` — Tasks 4 and 9 append to this file.

- [ ] **Step 1: Install the dev dependency**

Run: `npm i -D fake-indexeddb`

- [ ] **Step 2: Write pinning tests**

These are behavior pins, not red-first TDD — they pass against the old implementation too; their job is to prove the transaction refactor changes nothing observable. Create `src/db/db.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, persist } from './db';
import type { AppState, Goal } from './types';

function goal(id: string): Goal {
  return { id, title: id, start: '2026-01-01', deadline: '2026-12-31', nodes: [], column: 0 };
}

const stateA: AppState = { goals: [goal('a'), goal('b')], habits: [], tasks: [], sessions: [] };
const stateB: AppState = { goals: [goal('c')], habits: [], tasks: [], sessions: [] };

beforeEach(async () => {
  await Promise.all([
    db.goals.clear(), db.habits.clear(), db.tasks.clear(), db.sessions.clear(), db.settings.clear(),
  ]);
});

describe('persist', () => {
  it('round-trips every table', async () => {
    await persist({ ...stateA, tasks: [{ id: 't1', title: 't', date: '2026-07-05', done: false }] });
    expect((await db.goals.toArray()).map((g) => g.id).sort()).toEqual(['a', 'b']);
    expect(await db.tasks.count()).toBe(1);
  });

  it('replaces stale rows — no leftovers from the previous save', async () => {
    await persist(stateA);
    await persist(stateB);
    expect((await db.goals.toArray()).map((g) => g.id)).toEqual(['c']);
  });
});
```

- [ ] **Step 3: Run** — `npm test` → both PASS against the current implementation.

- [ ] **Step 4: Refactor `persist` to a single transaction**

In `src/db/db.ts`, replace the body of `persist`:

```ts
export async function persist(state: AppState): Promise<void> {
  // One rw transaction: either every table reflects `state`, or none does.
  // (The previous Promise.all of independent clear→bulkPut chains could leave
  // the DB partially wiped if one chain failed mid-flight.)
  await db.transaction('rw', db.goals, db.habits, db.tasks, db.sessions, async () => {
    await Promise.all([
      db.goals.clear().then(() => db.goals.bulkPut(state.goals)),
      db.habits.clear().then(() => db.habits.bulkPut(state.habits)),
      db.tasks.clear().then(() => db.tasks.bulkPut(state.tasks)),
      db.sessions.clear().then(() => db.sessions.bulkPut(state.sessions)),
    ]);
  });
}
```

- [ ] **Step 5: Verify** — `npm test` (all green, including the two pins) and `npm run build` (clean).

- [ ] **Step 6: Commit**

```bash
git add src/db/db.ts src/db/db.test.ts package.json package-lock.json
git commit -m "fix(db): persist writes all tables in one rw transaction"
```

---

### Task 3: Hydration gate + boot-failure screen

`initStore()` is fire-and-forget with no catch (`src/App.tsx:225-227`, `src/state/store.ts:95-106`). Two consequences: (a) the UI flashes empty cards for the ~50 ms IndexedDB load, and (b) if IndexedDB is unavailable (private browsing, blocked storage) the app **silently renders empty forever — which reads as "my data is gone."** Add a `hydration` status to the store, gate the main content on it, and show an honest error screen on failure.

**Files:**
- Modify: `src/state/store.ts` (UIState, initial state, `initStore`)
- Modify: `src/App.tsx` (destructure `hydration`, gate `<main>` content)
- Modify: `src/state/store.test.ts` (hydration tests)

**Interfaces:**
- Produces: `FullState.hydration: 'loading' | 'ready' | 'error'` — Task 5 adds its own flag beside it; App consumes it.

- [ ] **Step 1: Write failing tests**

Append inside the `describe('store actions', …)` block of `src/state/store.test.ts`:

```ts
  describe('hydration', () => {
    it('starts loading and becomes ready after initStore', async () => {
      const store = await freshStore();
      expect(store.getState().hydration).toBe('loading');
      await store.initStore();
      expect(store.getState().hydration).toBe('ready');
    });

    it('reports error when the DB cannot load', async () => {
      vi.resetModules();
      const dbMod = await import('../db/db');
      vi.mocked(dbMod.loadState).mockRejectedValueOnce(new Error('idb unavailable'));
      const store = await import('./store');
      await store.initStore();
      expect(store.getState().hydration).toBe('error');
    });
  });
```

(The second test imports the mocked `../db/db` *after* `vi.resetModules()` so the rejected mock and the store share one module graph.)

- [ ] **Step 2: Run** — `npm test` → both FAIL (`hydration` is `undefined`).

- [ ] **Step 3: Implement in the store**

In `src/state/store.ts`:

1. Add to `interface UIState`:
```ts
  hydration: 'loading' | 'ready' | 'error';
```
2. Add to the initial `state` literal (next to `pxPerDay: 13`):
```ts
  hydration: 'loading',
```
3. Replace `initStore`:
```ts
export async function initStore(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const [appState, pxPerDay] = await Promise.all([loadState(), loadScale()]);
    state = {
      ...state,
      ...appState,
      pxPerDay,
      hydration: 'ready',
      expanded: collectContainers(appState.goals),
    };
    notify();
  } catch {
    // IndexedDB unavailable (private mode, blocked storage) or corrupt.
    // Nothing was deleted — refuse to render an empty board that would
    // read as data loss.
    set({ hydration: 'error' });
  }
}
```

- [ ] **Step 4: Run** — `npm test` → all green.

- [ ] **Step 5: Gate the App shell**

In `src/App.tsx`, add `hydration` to the destructure:
```ts
const { view, openGoalId, toast, pendingUndo, goals, hydration, actions } = useAppStore();
```
Replace the `<main>` block (keep the three existing view branches verbatim as the tail):
```tsx
      {/* Main */}
      <main className="flex-1 min-w-0">
        {hydration === 'error' ? (
          <div className="max-w-[520px] mx-auto mt-[80px] px-[24px] text-center">
            <div className="font-disp text-[1.3rem] font-semibold mb-[10px]">
              Phase can’t reach its local database
            </div>
            <p className="text-[.9rem] text-muted leading-[1.6] mb-[18px]">
              Your data lives in this browser’s storage (IndexedDB) and nothing has been
              deleted — but it can’t be opened right now. This usually means private
              browsing, blocked site data, or a full disk.
            </p>
            <button
              className="text-[.84rem] font-semibold text-paper bg-ink px-[14px] py-[8px] rounded-field hover:bg-ink-hover"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        ) : hydration === 'loading' ? null : view === 'today' ? (
          <div className="max-w-[1280px] mx-auto px-[36px] pb-[40px]">
            <Today />
          </div>
        ) : view === 'timeline' ? (
          <div className="w-full px-[36px] py-[32px]">
            <Timeline />
          </div>
        ) : (
          <div className="max-w-[1280px] mx-auto px-[36px] py-[42px] pb-[90px]">
            <Goals />
          </div>
        )}
      </main>
```
(`loading` renders nothing: hydration takes ~50 ms, and a blank beat beats a spinner flash or a lying empty state.)

- [ ] **Step 6: Manual verify**

`npm run dev`: normal load shows no empty-card flash. Then temporarily add `throw new Error('boom');` as the first line of `loadState()` in `src/db/db.ts` → reload shows the error panel with working Reload button; **revert the throw**.

- [ ] **Step 7: Verify + commit**

`npm test` and `npm run build` green, then:
```bash
git add src/state/store.ts src/state/store.test.ts src/App.tsx
git commit -m "feat(boot): hydration gate + IndexedDB failure screen"
```

---

### Task 4: Backup import — validation, honest errors, confirm-before-replace

Header "↑ IMPORT" currently **replaces the entire database with zero confirmation**, accepts any JSON (e.g. `{"foo":1}` silently wipes everything to empty tables), and every failure collapses into "Could not read that file". Fix all three. Also swap the legacy `FileReader` for `file.text()` so the function is testable in the node test environment.

**Files:**
- Modify: `src/db/db.ts` (`importStateFromFile`, add `isEntityArray` helper)
- Modify: `src/state/store.ts` (`importBackup` shows the real message)
- Modify: `src/App.tsx` (confirm dialog on the file input)
- Modify: `src/db/db.test.ts` (append tests)

**Interfaces:**
- Consumes: `goal(id)` helper and clearing `beforeEach` from Task 2's `db.test.ts`.
- Produces: `importStateFromFile(file: File): Promise<AppState & { pxPerDay: number }>` — same signature, but now throws `Error` with user-facing `.message`.

- [ ] **Step 1: Write failing tests**

Append to `src/db/db.test.ts` (extend the existing import line to `import { db, persist, importStateFromFile } from './db';`):

```ts
function fileOf(contents: string): File {
  return new File([contents], 'backup.json', { type: 'application/json' });
}

describe('importStateFromFile', () => {
  it('imports a valid backup, persists it, and returns the scale', async () => {
    const backup = { goals: [goal('g1')], habits: [], tasks: [], sessions: [], pxPerDay: 40 };
    const result = await importStateFromFile(fileOf(JSON.stringify(backup)));
    expect(result.goals.map((g) => g.id)).toEqual(['g1']);
    expect(result.pxPerDay).toBe(40);
    expect((await db.goals.toArray()).map((g) => g.id)).toEqual(['g1']);
  });

  it('rejects non-JSON with a JSON-specific message', async () => {
    await expect(importStateFromFile(fileOf('not json {'))).rejects.toThrow(/valid JSON/);
  });

  it('rejects JSON that has none of the Phase tables', async () => {
    await expect(importStateFromFile(fileOf('{"foo": 1}'))).rejects.toThrow(/Phase backup/);
  });

  it('rejects a backup whose tables are malformed', async () => {
    await expect(importStateFromFile(fileOf('{"goals": "nope"}'))).rejects.toThrow(/Phase backup/);
  });
});
```

- [ ] **Step 2: Run** — `npm test` → the three rejection tests FAIL (old code accepts garbage / gives the generic message).

- [ ] **Step 3: Rewrite `importStateFromFile`**

In `src/db/db.ts`, replace the whole function (and add the helper above it):

```ts
function isEntityArray(v: unknown): boolean {
  return Array.isArray(v) && v.every(
    (x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string',
  );
}

export async function importStateFromFile(file: File): Promise<AppState & { pxPerDay: number }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error('Could not read that file.');
  }

  let raw: Partial<AppState & { pxPerDay?: number; zoom?: string }>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }

  const tables = ['goals', 'habits', 'tasks', 'sessions'] as const;
  const present = raw && typeof raw === 'object' ? tables.filter((t) => raw[t] !== undefined) : [];
  if (present.length === 0 || present.some((t) => !isEntityArray(raw[t]))) {
    throw new Error("That file doesn't look like a Phase backup.");
  }

  const pxPerDay =
    Number.isFinite(raw.pxPerDay) && (raw.pxPerDay as number) > 0
      ? clampScale(raw.pxPerDay as number)
      : legacyZoomToScale(raw.zoom); // old backups carry a zoom string
  const parsed: AppState = {
    goals: raw.goals ?? [],
    habits: raw.habits ?? [],
    tasks: raw.tasks ?? [],
    sessions: raw.sessions ?? [],
  };
  await persist(parsed);
  await saveScale(pxPerDay);
  return { ...parsed, pxPerDay };
}
```

- [ ] **Step 4: Run** — `npm test` → all green.

- [ ] **Step 5: Surface the real message + confirm before replacing**

In `src/state/store.ts`, replace the `catch` of `importBackup`:
```ts
    } catch (e) {
      actions.showToast(e instanceof Error ? e.message : 'Could not read that file.');
    }
```
In `src/App.tsx`, replace the file input's `onChange`:
```tsx
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && window.confirm('Importing a backup replaces everything currently in Phase. Continue?')) {
                actions.importBackup(f);
              }
              e.target.value = '';
            }}
```

- [ ] **Step 6: Manual verify** — `npm run dev`: ↑ IMPORT a real export → confirm dialog → data replaced, toast "Backup imported". Import a `.txt` of garbage → toast "That file isn't valid JSON." Cancel the confirm → nothing changes.

- [ ] **Step 7: Verify + commit**

`npm test` + `npm run build` green, then:
```bash
git add src/db/db.ts src/db/db.test.ts src/state/store.ts src/App.tsx
git commit -m "feat(backup): validated import, honest error messages, replace confirmation"
```

---

### Task 5: Second-tab write guard

Phase assumes a single writer: each tab holds the full state in memory and every save rewrites every table, so two open tabs silently clobber each other (last write wins). Full sync is out of scope; instead, the first tab takes a session-long Web Lock and any later tab shows a warning banner.

**Files:**
- Create: `src/lib/tabLock.ts`
- Create: `src/lib/tabLock.test.ts`
- Modify: `src/state/store.ts` (`secondTab` flag, hook into `initStore`)
- Modify: `src/App.tsx` (banner under the header)

**Interfaces:**
- Produces: `acquireTabLock(locks?: LockManager): Promise<boolean>` — resolves `true` if this tab is the sole owner (or Web Locks unsupported), `false` if another tab holds the lock. Also `FullState.secondTab: boolean`.

- [ ] **Step 1: Write failing tests**

Create `src/lib/tabLock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { acquireTabLock } from './tabLock';

function stubLocks(granted: boolean): LockManager {
  const request = ((_name: string, _opts: unknown, cb: (lock: Lock | null) => unknown) => {
    void cb(granted ? ({ name: 'phase-tab', mode: 'exclusive' } as Lock) : null);
    return new Promise<void>(() => {}); // like the real API: pending while the lock is held
  }) as LockManager['request'];
  return { request, query: async () => ({ held: [], pending: [] }) } as LockManager;
}

describe('acquireTabLock', () => {
  it('resolves true when the lock is granted (first tab)', async () => {
    await expect(acquireTabLock(stubLocks(true))).resolves.toBe(true);
  });
  it('resolves false when another tab already holds it', async () => {
    await expect(acquireTabLock(stubLocks(false))).resolves.toBe(false);
  });
  it('resolves true when Web Locks is unavailable', async () => {
    await expect(acquireTabLock(undefined)).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `npm test` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/lib/tabLock.ts`:

```ts
// Phase assumes a single writer: every save rewrites every table from this
// tab's in-memory state, so two tabs silently clobber each other. The first
// tab holds a session-long exclusive Web Lock; later tabs fail the
// ifAvailable request and get a warning banner instead of live sync.

export function acquireTabLock(
  locks: LockManager | undefined = typeof navigator !== 'undefined' ? navigator.locks : undefined,
): Promise<boolean> {
  if (!locks) return Promise.resolve(true); // no Web Locks (very old browser / node) — don't block usage
  return new Promise((resolve) => {
    void locks.request('phase-tab', { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      // Returning a never-resolving promise keeps the lock for the tab's lifetime.
      return lock ? new Promise<void>(() => {}) : undefined;
    });
  });
}
```

- [ ] **Step 4: Run** — `npm test` → green.

- [ ] **Step 5: Wire into store and App**

In `src/state/store.ts`:
1. Add import: `import { acquireTabLock } from '../lib/tabLock';`
2. Add to `interface UIState`: `secondTab: boolean;` and to the initial state literal: `secondTab: false,`
3. In `initStore`, insert as the first statement after `initialized = true;`:
```ts
  void acquireTabLock().then((owned) => {
    if (!owned) set({ secondTab: true });
  });
```
In `src/App.tsx`: add `secondTab` to the `useAppStore()` destructure, and insert directly **after** the closing `</header>` tag:
```tsx
      {secondTab && (
        <div className="bg-warn-tint text-warn text-[.8rem] px-[16px] sm:px-[36px] py-[7px] border-b border-line">
          Phase is already open in another tab. Edits from two tabs overwrite each other — keep just one open.
        </div>
      )}
```

- [ ] **Step 6: Manual verify** — `npm run dev`, open the app in two tabs: first tab has no banner, second tab shows it. Close the first tab and reload the second → banner gone.

- [ ] **Step 7: Verify + commit**

`npm test` + `npm run build` green, then:
```bash
git add src/lib/tabLock.ts src/lib/tabLock.test.ts src/state/store.ts src/App.tsx
git commit -m "feat(guard): warn when Phase is open in a second tab (Web Locks)"
```

---

### Task 6: Self-hosted fonts (offline-proof the visual identity)

`index.html` loads Fraunces + Inter from the Google Fonts CDN. Offline or on a flaky network, the app falls back to Georgia/system-ui — the locked visual identity silently breaks. Self-host both as variable fonts.

**Files:**
- Modify: `package.json` (2 deps), `src/main.tsx`, `tailwind.config.js`, `index.html`

- [ ] **Step 1: Install**

Run: `npm i @fontsource-variable/fraunces @fontsource-variable/inter`

- [ ] **Step 2: Check which Fraunces axis file to import**

Run: `ls node_modules/@fontsource-variable/fraunces/`. Fraunces has an `opsz` axis (the current Google link loads `opsz,wght@9..144,400..650`). If `opsz.css` exists (it should), import it; otherwise fall back to the package's `index.css` (wght only).

- [ ] **Step 3: Import the fonts**

In `src/main.tsx`, add as the **first** imports (before `./index.css`):
```ts
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/inter';
```

- [ ] **Step 4: Point Tailwind at the variable family names**

In `tailwind.config.js`, replace the `fontFamily` block:
```js
      fontFamily: {
        disp: ['Fraunces Variable', 'Fraunces', 'Georgia', 'serif'],
        ui: ['Inter Variable', 'Inter', '-apple-system', 'system-ui', 'sans-serif'],
      },
```

- [ ] **Step 5: Remove the CDN links**

In `index.html`, delete these three lines:
```html
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,650&family=Inter:wght@400;450;500;600&display=swap" rel="stylesheet">
```

- [ ] **Step 6: Verify**

`npm run build` → `dist/assets/` now contains `.woff2` files. `npm run preview`, open the app, DevTools → Network tab → set **Offline**, hard-reload: the "Phase." wordmark still renders in Fraunces (serif, weight 650) and body text in Inter. DevTools → Network shows zero requests to `fonts.googleapis.com`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/main.tsx tailwind.config.js index.html
git commit -m "feat(fonts): self-host Fraunces + Inter variable — no CDN, offline-safe"
```

---

### Task 7: Mobile gutters + narrower timeline label column

Fixed `px-[36px]` gutters eat 72 px of a 375 px phone screen, and the timeline's sticky label column is a fixed 200 px (over half a small screen). Make both responsive. (Tailwind's `sm:` breakpoint = 640 px.)

**Files:**
- Modify: `src/App.tsx` (header + three view wrappers)
- Modify: `src/index.css` (shared label-width class)
- Modify: `src/views/Timeline.tsx:361`, `src/views/timeline/GoalRow.tsx:54`, `src/views/timeline/NodeLane.tsx:92` and `:129`

- [ ] **Step 1: Responsive gutters in App.tsx**

Replace every `px-[36px]` in `src/App.tsx` with `px-[16px] sm:px-[36px]`. There are exactly 4: the `<header>` (line ~256) and the three view wrapper divs inside `<main>` (Today, Timeline, Goals). (The Task-5 banner is already responsive — leave it.)

- [ ] **Step 2: One width source for the timeline label column**

The four sticky label cells must share a width or the lanes misalign. Add to the `@layer components` block of `src/index.css`:
```css
  /* Timeline sticky label column — single width source so all lanes align */
  .tl-label-w { @apply w-[148px] sm:w-[200px]; }
```
Then replace the class `w-[200px]` with `tl-label-w` (keeping all sibling classes) in exactly these 4 places:
- `src/views/Timeline.tsx:361` (header cell)
- `src/views/timeline/GoalRow.tsx:54`
- `src/views/timeline/NodeLane.tsx:92`
- `src/views/timeline/NodeLane.tsx:129`

- [ ] **Step 3: Manual verify**

`npm run dev`, DevTools device toolbar at iPhone SE (375 px): Today cards get 16 px gutters; Goals board scrolls horizontally with usable columns; Timeline label column is 148 px and **all lanes stay aligned** while scrolling horizontally. Desktop (≥640 px) is pixel-identical to before.

- [ ] **Step 4: Verify + commit**

`npm test` + `npm run build` green, then:
```bash
git add src/App.tsx src/index.css src/views/Timeline.tsx src/views/timeline/GoalRow.tsx src/views/timeline/NodeLane.tsx
git commit -m "feat(responsive): mobile gutters + narrower timeline label column"
```

---

### Task 8: Dead code + duplication sweep

**Files:**
- Delete: `src/components/Checkbox.tsx`
- Modify: `src/App.tsx` (dedupe `todayISO`)

- [ ] **Step 1: Confirm Checkbox is dead**

Run: `grep -rn "components/Checkbox" src/` → expect no matches (the live checkboxes are `TodayCheckbox` and `GoalTree`'s `LeafCheckbox`). If a match appears, stop and reassess — do not delete.

- [ ] **Step 2: Delete it**

Run: `git rm src/components/Checkbox.tsx`

- [ ] **Step 3: Dedupe `todayISO`**

`src/App.tsx:16-19` defines `todayISO()` — a byte-for-byte duplicate of `todayStr()` from `src/lib/dates` (already imported on line 13). Delete the `todayISO` function and replace its 3 call sites inside `MilestonesSection` (`useState(g.start || todayISO())`, `actions.addMilestone(g.id, t, newDate || todayISO())`, `setNewDate(g.start || todayISO())`) with `todayStr()`.

- [ ] **Step 4: Verify + commit**

`npm run build` (the `noUnusedLocals` check will catch any leftover import) + `npm test` green, then:
```bash
git add src/App.tsx
git commit -m "chore: drop dead Checkbox component, dedupe todayISO into todayStr"
```

---

### Task 9: Retire the hardcoded first-run seed

`loadState()` seeds a fresh DB with five hardcoded personal 2026 goals + five habits (`src/db/db.ts:41-136`). Now that Task 1 landed real empty states and an import flow, a clean start is the honest first-run: an empty board with "+ New goal / Import goal", not someone's demo plan. Existing browsers are unaffected (their tables are non-empty).

**Files:**
- Modify: `src/db/db.ts` (delete `buildSeed` + seeding branch + newly-unused imports)
- Modify: `src/db/db.test.ts` (append test)

- [ ] **Step 1: Write the failing test**

Append to `src/db/db.test.ts` (extend the import line to include `loadState`):
```ts
describe('loadState', () => {
  it('returns an empty state on a fresh database — no demo seed', async () => {
    const s = await loadState();
    expect(s).toEqual({ goals: [], habits: [], tasks: [], sessions: [] });
  });
});
```

- [ ] **Step 2: Run** — `npm test` → FAILS (seed goals come back).

- [ ] **Step 3: Implement**

In `src/db/db.ts`:
1. Delete the entire `buildSeed()` function and the `const YEAR = 2026;` line.
2. Replace `loadState` with:
```ts
export async function loadState(): Promise<AppState> {
  const [goals, habits, tasks, sessions] = await Promise.all([
    db.goals.toArray(),
    db.habits.toArray(),
    db.tasks.toArray(),
    db.sessions.toArray(),
  ]);
  return { goals, habits, tasks, sessions };
}
```
3. Clean the imports: `addDays` and `uid` were only used by `buildSeed` — remove them (`todayStr` stays; `exportState` uses it). `npm run build` enforces this via `noUnusedLocals`.

- [ ] **Step 4: Run** — `npm test` → green.

- [ ] **Step 5: Manual verify** — open the app in a private/incognito window (fresh IndexedDB): Goals shows the dashed empty state with both buttons; Today renders with empty cards; nothing crashes. Your normal profile still shows existing data.

- [ ] **Step 6: Commit**

```bash
git add src/db/db.ts src/db/db.test.ts
git commit -m "feat(first-run): clean empty start — retire hardcoded demo seed"
```

---

### Task 10: Installable-app manifest

Make Phase installable as a standalone app (dock/home-screen icon, no browser chrome). Manifest only — **no service worker** (see the not-included list).

**Files:**
- Create: `public/manifest.webmanifest`
- Modify: `index.html`

- [ ] **Step 1: Create `public/manifest.webmanifest`**

```json
{
  "name": "Phase",
  "short_name": "Phase",
  "description": "Local goal, habit and task planner",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FAF9F7",
  "theme_color": "#FAF9F7",
  "icons": [
    { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }
  ]
}
```
(`#FAF9F7` is the `bg`/`paper` token. The existing `public/favicon.svg` serves as the icon — Chrome accepts SVG manifest icons. Safari's install path wants a PNG `apple-touch-icon`; that's a known, accepted gap — do not generate ad-hoc PNGs.)

- [ ] **Step 2: Link it**

In `index.html` `<head>`, after the favicon link, add:
```html
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#FAF9F7" />
```

- [ ] **Step 3: Verify**

`npm run build && npm run preview` → Chrome DevTools → Application → Manifest: parses with no warnings besides the PNG-icon note; the browser offers "Install Phase"; installing opens a standalone window with the correct background color.

- [ ] **Step 4: Commit**

```bash
git add public/manifest.webmanifest index.html
git commit -m "feat(meta): web app manifest — installable as a standalone app"
```

---

## Self-Review (done at authoring time)

- **Coverage vs. audit:** every confirmed audit finding maps to a task — uncommitted WIP → 1, non-transactional persist → 2, silent boot failure + empty-flash → 3, unvalidated destructive import → 4, multi-tab clobbering → 5, CDN fonts → 6, mobile gutters/label column → 7, dead Checkbox → 8, stale personal seed → 9, no manifest → 10. Findings that did **not** survive verification are listed in "deliberately NOT included" so the executor doesn't re-fix them.
- **Type consistency:** `hydration: 'loading' | 'ready' | 'error'` (Task 3) and `secondTab: boolean` (Task 5) are both `UIState` fields consumed by `App.tsx` with those exact names. `acquireTabLock(locks?)` signature matches its tests. `importStateFromFile` keeps its public signature; only its error contract changes (typed `Error` messages), and `importBackup` (Task 4) consumes `.message`.
- **Ordering:** Task 1 must run first (later tasks edit `store.ts`/`App.tsx` on top of the committed WIP). Tasks 4 and 9 append to `db.test.ts` created in Task 2. Tasks 6–10 are order-independent after that.
- **No placeholders:** every code step contains the actual code; the only conditional is Task 6 Step 2 (which Fraunces axis file exists), which is an explicit verification step with a defined fallback.
