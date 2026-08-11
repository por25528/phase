# Lives — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can name up to three lives (e.g. "MIT", "Startup"), assign each goal to one, and see which life a goal belongs to — with unassigned staying a first-class, permanent state.

**Architecture:** `Life` becomes a fifth slice of `AppState`, alongside `goals`/`habits`/`tasks`/`sessions`, because a life is named user content that must survive export, import and undo. A goal points at one with `Goal.lifeId?`, and — exactly like `Session.nodeId` — **that reference is allowed to dangle**: a goal whose life no longer exists reads as unassigned rather than as broken, which is what makes deleting a life a two-slice edit that never touches a goal's own data. All grouping logic is pure and lives in `src/lib/lives.ts` with a sibling test; the two UI surfaces (a Settings section to manage lives, a card menu entry to assign one) stay thin.

**Tech Stack:** React 19, TypeScript, Dexie 4 (IndexedDB), Tailwind 3, Vitest + @testing-library/react (jsdom), fake-indexeddb.

## Global Constraints

Copied from `CLAUDE.md` and enforced by `src/lib/designScale.test.ts`:

- No arbitrary font sizes. Named `fontSize` keys only. No literal hex / `rgb()` / `hsl()` colours — theme tokens only.
- Radii: only `rounded-[4px]`, `rounded-[6px]`, `rounded-[11px]`, `rounded-field`, `rounded-card`.
- No Unicode icon glyphs. Use `src/components/Icons.tsx`.
- `font-disp` only in `App.tsx`. `uppercase` only in the three named calendar files. `border-dashed` only in `views/plan/DayColumn.tsx` and `views/plan/EventBlock.tsx`.
- A section label is `text-meta font-semibold text-muted`, sentence case.
- `.quiet-control` is the ONE hover-reveal mechanism for controls; it needs a **literal `group` ancestor**.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`. Views stay thin and delegate to `actions`; views never call `db` directly.
- `jest-dom` is NOT installed. Plain DOM reads only.
- Run `npm test` and `npx tsc -b` before every commit.

**Baseline before starting:** `tsc -b` clean, **127 test files, 2467 tests passing**.

**Branch:** `main` was checked out and clean at planning time. Branch before the first commit — do not commit slice work to `main`.

## Scope

This is **slice 1 of three** from [`ideas/vision.md`](../../../ideas/vision.md):

| Slice | Contents | Vision refs |
|---|---|---|
| **1 — Lives (this plan)** | The `Life` model, assignment, and making a goal's life visible. | D-7 (partial) |
| 2 — The week budget | `WeekRecord`, per-life shares, the budget line on the board, retiring the 3-slot Now cap. | D-8, D-15, D-16 |
| 3 — The planning flow | The flow itself, one pass per life, the refusal step. | D-5, D-6 |

**Deliberately NOT in this slice**, so nobody builds it early:

- **No budget, no hours, no capacity change.** `weekCapacity` and `isOverCommitted` are untouched.
- **No board restructure.** The board keeps its horizon columns exactly as they are. Grouping the board by life is slice 2's work, because the thing that makes a life-group legible is the budget line, and a group without one is just a divider.
- **No 3-slot Now cap change.** That is D-8 and it depends on the budget existing.
- **No planning-flow scoping.** D-7 says scoping exists only inside the flow; the flow is slice 3.
- **No `Goal.type` change.** It stays inert. A template is not an organising dimension.

---

### Task 1: The `Life` type and the pure helpers

**Files:**
- Modify: `src/db/types.ts`
- Create: `src/lib/lives.ts`
- Create: `src/lib/lives.test.ts`

**Interfaces:**
- Consumes: `Goal` from `src/db/types.ts`.
- Produces: `Life`, `Goal.lifeId?: string`, `AppState.lives: Life[]`; and from `src/lib/lives.ts`: `MAX_LIVES: 3`, `canAddLife(lives): boolean`, `sortedLives(lives): Life[]`, `nextLifeOrder(lives): number`, `lifeOf(goal, lives): Life | null`, `sanitizeBackupLives(raw: unknown): Life[]`.

**No `groupByLife` here.** Bucketing goals into life-groups is slice 2's board restructure and nothing in slice 1 calls it. It is not written in advance.

- [ ] **Step 1: Add the type and the two fields**

In `src/db/types.ts`, add above `export interface Goal`:

```ts
/**
 * One of the handful of lives a person is living at once — "MIT", "Startup".
 *
 * A life is an ORGANISING dimension, not a container: it groups goals and (in
 * slice 2) takes a share of the week's hours. It is deliberately NOT
 * `Goal.type`, which is a template deciding what an empty workspace offers on
 * first visit — welding them would mean a study-shaped goal could never sit on
 * the startup board.
 *
 * Capped at `MAX_LIVES` (3). Scarcity is how this product thinks, and four
 * lives is not a life, it is a tag system.
 */
export interface Life {
  id: string;
  title: string;
  order: number; // ascending display order; ties broken by array position
}
```

In the same file, add to `Goal` immediately after `column`:

```ts
  /**
   * The life this goal belongs to. Absent ⇒ unassigned, which is a REAL,
   * permanent state, not a migration gap — an errand belongs to no life.
   *
   * The reference MAY DANGLE, exactly as `Session.nodeId` may. Deleting a life
   * leaves its goals pointing at nothing and they read as unassigned; `lifeOf`
   * resolves that at read time. This is what lets `removeLife` avoid rewriting
   * every goal it touched, and what keeps its undo honest.
   */
  lifeId?: string;
```

And add to `AppState`:

```ts
export interface AppState {
  goals: Goal[];
  habits: Habit[];
  tasks: Task[];
  sessions: Session[];
  lives: Life[];
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/lives.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Goal, Life } from '../db/types';
import {
  MAX_LIVES, canAddLife, lifeOf, nextLifeOrder, sanitizeBackupLives, sortedLives,
} from './lives';

const life = (id: string, order: number): Life => ({ id, title: id.toUpperCase(), order });
const goal = (id: string, lifeId?: string): Goal => ({ id, title: id, nodes: [], ...(lifeId ? { lifeId } : {}) });

describe('canAddLife', () => {
  it('allows up to three and refuses the fourth', () => {
    expect(canAddLife([])).toBe(true);
    expect(canAddLife([life('a', 0), life('b', 1)])).toBe(true);
    expect(canAddLife([life('a', 0), life('b', 1), life('c', 2)])).toBe(false);
    expect(MAX_LIVES).toBe(3);
  });
});

describe('nextLifeOrder', () => {
  it('is 0 for the first life and one past the highest after that', () => {
    expect(nextLifeOrder([])).toBe(0);
    expect(nextLifeOrder([life('a', 0), life('b', 4)])).toBe(5);
  });
});

describe('sortedLives', () => {
  it('orders by `order` without mutating the input', () => {
    const input = [life('b', 2), life('a', 1)];
    expect(sortedLives(input).map((l) => l.id)).toEqual(['a', 'b']);
    expect(input.map((l) => l.id)).toEqual(['b', 'a']);
  });
});

describe('lifeOf', () => {
  it('resolves an assigned goal, and returns null for unassigned', () => {
    const lives = [life('a', 0)];
    expect(lifeOf(goal('g', 'a'), lives)?.id).toBe('a');
    expect(lifeOf(goal('g'), lives)).toBeNull();
  });

  // A life can be deleted without rewriting its goals. The dangling id is
  // inert, exactly as a Session pointing at a deleted node is inert.
  it('returns null for a goal pointing at a life that no longer exists', () => {
    expect(lifeOf(goal('g', 'gone'), [life('a', 0)])).toBeNull();
  });
});

describe('sanitizeBackupLives', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(sanitizeBackupLives(undefined)).toEqual([]);
    expect(sanitizeBackupLives(null)).toEqual([]);
    expect(sanitizeBackupLives('MIT')).toEqual([]);
  });

  it('drops malformed rows and de-duplicates ids', () => {
    const out = sanitizeBackupLives([
      { id: 'a', title: 'MIT', order: 0 },
      { id: 'a', title: 'Duplicate', order: 1 },
      { id: '', title: 'Blank id', order: 2 },
      { title: 'No id', order: 3 },
      { id: 'b', title: 42, order: 4 },
      null,
      { id: 'c', title: 'Startup', order: 5 },
    ]);

    expect(out).toEqual([
      { id: 'a', title: 'MIT', order: 0 },
      { id: 'c', title: 'Startup', order: 5 },
    ]);
  });

  it('substitutes a positional order when the stored one is not a finite number', () => {
    expect(sanitizeBackupLives([{ id: 'a', title: 'MIT', order: 'first' }])).toEqual([
      { id: 'a', title: 'MIT', order: 0 },
    ]);
  });

  // A backup written by a future build with a higher cap must not smuggle a
  // fourth life past the constraint this build enforces everywhere else.
  it('caps at MAX_LIVES', () => {
    const out = sanitizeBackupLives(
      ['a', 'b', 'c', 'd'].map((id, i) => ({ id, title: id, order: i })),
    );
    expect(out.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npx vitest run src/lib/lives.test.ts`
Expected: FAIL — `Failed to resolve import "./lives"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/lives.ts`:

```ts
import type { Goal, Life } from '../db/types';

/**
 * The vocabulary for a person's handful of lives.
 *
 * Everything here is a pure read. The one rule that is not obvious: a goal's
 * `lifeId` MAY point at a life that no longer exists, and every reader here
 * resolves that to "unassigned" rather than treating it as an error. That is
 * what makes deleting a life cheap — it rewrites `lives` and nothing else — and
 * it is the same licence `Session.nodeId` already has.
 */

/**
 * Three.
 *
 * Scarcity is the mechanism this product already trusts, and a fourth life is
 * the point at which "which life is this?" stops being obvious and the concept
 * degrades into the tag system CLAUDE.md refuses.
 */
export const MAX_LIVES = 3;

export function canAddLife(lives: Life[]): boolean {
  return lives.length < MAX_LIVES;
}

export function sortedLives(lives: Life[]): Life[] {
  return [...lives].sort((a, b) => a.order - b.order);
}

/** The `order` a newly created life should take: one past the highest in use. */
export function nextLifeOrder(lives: Life[]): number {
  return lives.reduce((max, l) => Math.max(max, l.order), -1) + 1;
}

/** The life a goal belongs to, or null when unassigned OR pointing at a deleted life. */
export function lifeOf(goal: Goal, lives: Life[]): Life | null {
  if (goal.lifeId === undefined) return null;
  return lives.find((l) => l.id === goal.lifeId) ?? null;
}

/**
 * Lives off an imported backup, made safe.
 *
 * Mirrors `sanitizeBackupGoal`/`sanitizeBackupHabit` in `goalImport.ts` — the
 * file is user-editable JSON, so every field is checked. The cap is applied
 * HERE as well as at creation: a backup written by a build with a higher limit
 * must not smuggle a fourth life past a build that enforces three.
 */
export function sanitizeBackupLives(raw: unknown): Life[] {
  if (!Array.isArray(raw)) return [];
  const out: Life[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (out.length === MAX_LIVES) break;
    if (!row || typeof row !== 'object') continue;
    const { id, title, order } = row as Partial<Life>;
    if (typeof id !== 'string' || id === '') continue;
    if (typeof title !== 'string') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      order: typeof order === 'number' && Number.isFinite(order) ? order : out.length,
    });
  }
  return out;
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run src/lib/lives.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Confirm the type change surfaces every call site**

Run: `npx tsc -b`
Expected: **FAIL** — errors wherever an `AppState` literal is built without `lives`. This is the point of the step; it enumerates Task 2 and Task 3's work. Note the file list, then continue — the build goes green at the end of Task 3.

- [ ] **Step 7: Commit**

```bash
git checkout -b lives-slice-1
git add src/db/types.ts src/lib/lives.ts src/lib/lives.test.ts
git commit -m "feat(lives): a life is a named group a goal may belong to"
```

---

### Task 2: Persistence — the fifth table, and a backup that carries it

**Files:**
- Modify: `src/db/db.ts`
- Test: `src/db/db.test.ts`

**Interfaces:**
- Consumes: `Life`, `AppState.lives` and `sanitizeBackupLives` from Task 1.
- Produces: `db.lives` (Dexie table, key `id`); `loadState()` returns `lives`; `persist(state)` writes them; `exportState` includes them; `importStateFromFile` restores them.

**Why a table and not settings.** Lives are named user content. They must survive export, import and undo like everything else in `AppState`, and settings are neither exported nor undoable. Three rows is negligible churn against `goals` in a `clear()` + `bulkPut()`.

- [ ] **Step 1: Write the failing tests**

Add to `src/db/db.test.ts`. Extend the existing `beforeEach` clear list first — find the `beforeEach(async () => {` block near the top and add `db.lives.clear(),` to the `Promise.all` array:

```ts
beforeEach(async () => {
  await Promise.all([
    db.goals.clear(), db.habits.clear(), db.tasks.clear(), db.sessions.clear(), db.settings.clear(),
    db.planReview.clear(), db.assets.clear(), db.calendarCache.clear(), db.lives.clear(),
  ]);
});
```

Then append this `describe` at the end of the file:

```ts
describe('lives', () => {
  const withLives = (lives: AppState['lives']): AppState => ({
    goals: [], habits: [], tasks: [], sessions: [], lives,
  });

  it('round-trips through persist and loadState', async () => {
    await persist(withLives([{ id: 'l1', title: 'MIT', order: 0 }]));

    const loaded = await loadState();

    expect(loaded.lives).toEqual([{ id: 'l1', title: 'MIT', order: 0 }]);
  });

  // persist is a full clear + bulkPut, so a life removed in memory must be
  // gone from disk — not merged with what was there before.
  it('a removed life does not survive the next write', async () => {
    await persist(withLives([
      { id: 'l1', title: 'MIT', order: 0 },
      { id: 'l2', title: 'Startup', order: 1 },
    ]));
    await persist(withLives([{ id: 'l1', title: 'MIT', order: 0 }]));

    expect((await loadState()).lives.map((l) => l.id)).toEqual(['l1']);
  });

  it('loads as an empty list when nothing was ever written', async () => {
    expect((await loadState()).lives).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/db/db.test.ts -t lives`
Expected: FAIL — `Property 'lives' does not exist on type 'PhaseDB'`.

- [ ] **Step 3: Add the table**

In `src/db/db.ts`, add the declaration to the `PhaseDB` class beside the others:

```ts
  lives!: Table<Life, string>;
```

Add `Life` to the type import at the top of the file:

```ts
import type { Goal, Habit, Task, Session, AppState, PlanReview, AvailabilityWindow, Asset, CalendarCache, Life } from './types';
```

And append a new version **after** `this.version(6)`, repeating every existing store — Dexie versions are cumulative declarations, not diffs:

```ts
    this.version(7).stores({
      goals: 'id',
      habits: 'id',
      tasks: 'id',
      settings: 'key',
      sessions: 'id',
      planReview: 'week',
      assets: 'id',
      calendarCache: 'key',
      lives: 'id',
    });
```

- [ ] **Step 4: Read and write them**

In `loadState`, add `db.lives.toArray()` to the `Promise.all` and return the slice:

```ts
export async function loadState(): Promise<AppState> {
  const [goals, habits, tasks, sessions, lives] = await Promise.all([
    db.goals.toArray(),
    db.habits.toArray(),
    db.tasks.toArray(),
    db.sessions.toArray(),
    db.lives.toArray(),
  ]);
```

and change the return statement to:

```ts
  return { goals: migrateNodeStatus(goals), habits, tasks, sessions, lives };
```

In `persist`, add `db.lives` to the transaction's table list and one more `clear().then(bulkPut)`:

```ts
  await db.transaction('rw', db.goals, db.habits, db.tasks, db.sessions, db.lives, async () => {
    await Promise.all([
      db.goals.clear().then(() => db.goals.bulkPut(state.goals)),
      db.habits.clear().then(() => db.habits.bulkPut(state.habits)),
      db.tasks.clear().then(() => db.tasks.bulkPut(state.tasks)),
      db.sessions.clear().then(() => db.sessions.bulkPut(state.sessions)),
      db.lives.clear().then(() => db.lives.bulkPut(state.lives)),
    ]);
  });
```

**`exportState` needs no change.** It builds the backup with `{ ...state, … }`, so a new `AppState` key rides along automatically.

- [ ] **Step 5: Restore them on import**

In `src/db/db.ts`, add the import:

```ts
import { sanitizeBackupLives } from '../lib/lives';
```

In `importStateFromFile`, find the `const parsed: AppState = {` literal and add the fifth key:

```ts
  const parsed: AppState = {
    goals: blocked.goals,
    habits: (raw.habits ?? []).map(sanitizeBackupHabit),
    tasks: blocked.tasks,
    sessions: raw.sessions ?? [],
    // A goal whose `lifeId` names a life this backup does not carry is left
    // exactly as it is: the reference dangles and reads as unassigned. Stripping
    // it would silently rewrite user data to satisfy a constraint the read path
    // already handles.
    lives: sanitizeBackupLives((raw as { lives?: unknown }).lives),
  };
```

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npx vitest run src/db/db.test.ts`
Expected: PASS — the whole file, including the three new tests.

- [ ] **Step 7: Add a backup round-trip test**

Append to the `describe('lives', …)` block in `src/db/db.test.ts`:

```ts
  it('survives an export/import round trip, capping and cleaning on the way in', async () => {
    const raw = JSON.stringify({
      goals: [], habits: [], tasks: [], sessions: [],
      lives: [
        { id: 'l1', title: 'MIT', order: 0 },
        { id: 'l1', title: 'Duplicate', order: 1 },
        { id: 'l2', title: 'Startup', order: 1 },
      ],
      pxPerDay: 13,
    });
    const file = new File([raw], 'phase-goals-2026-08-11.json', { type: 'application/json' });

    const imported = await importStateFromFile(file);

    expect(imported.lives).toEqual([
      { id: 'l1', title: 'MIT', order: 0 },
      { id: 'l2', title: 'Startup', order: 1 },
    ]);
    expect((await loadState()).lives.map((l) => l.id)).toEqual(['l1', 'l2']);
  });
```

If `importStateFromFile` is not already imported at the top of `db.test.ts`, it is — the existing import block lists it.

- [ ] **Step 8: Run and verify**

Run: `npx vitest run src/db/db.test.ts -t lives`
Expected: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add src/db/db.ts src/db/db.test.ts
git commit -m "feat(lives): lives persist, export and import with everything else"
```

---

### Task 3: Store actions — create, rename, delete, assign

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `Life`, `AppState.lives`, `canAddLife`, `nextLifeOrder` from Tasks 1–2.
- Produces, on the `actions` object:
  - `addLife(title: string): boolean` — false when at the cap or the title is blank.
  - `renameLife(id: string, title: string): void` — no-op on a blank title.
  - `removeLife(id: string): void` — undoable across two slices.
  - `setGoalLife(goalId: string, lifeId: string | null): void`.

**The one subtle rule.** `removeLife` deletes the life and **leaves every goal's `lifeId` exactly where it is**. The reference dangles, `lifeOf` reads it as unassigned, and undo restores the life — at which point every goal snaps back to it, with no goal write to get wrong. It still uses `withUndoSlices` over `{ lives, goals }` rather than `withUndo('lives', …)`, because slice 2 will need the goals snapshot when a life carries a budget, and because a reader must not have to prove the goals slice is untouched to trust the undo.

- [ ] **Step 1: Write the failing tests**

In `src/state/store.test.ts`, first fix the hoisted `loadState` mock so it returns the new slice — find `loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [] })),` in the `dbMocks` block and change it to:

```ts
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [], lives: [] })),
```

Then append this `describe` at the end of the file. It uses the file's existing
`freshStore()` helper and `getState()` — **not** `useAppStore.getState()`, which
does not exist; `useAppStore` is a hook, and `getState` is a separate named
export of `store.ts`. Undo is triggered by `actions.undoLastDelete()`, and goals
are created with `actions.addGoals(Goal[])` (`actions.addGoal` takes a *title*
string and generates its own id, which these tests need to control):

```ts
describe('lives', () => {
  const psets = { id: 'g1', title: 'Psets', nodes: [] };

  it('adds a life, refuses a blank title, and refuses a fourth', async () => {
    const { actions, getState } = await freshStore();

    expect(actions.addLife('MIT')).toBe(true);
    expect(actions.addLife('   ')).toBe(false);
    expect(actions.addLife('Startup')).toBe(true);
    expect(actions.addLife('Music')).toBe(true);
    expect(actions.addLife('Fourth')).toBe(false);

    expect(getState().lives.map((l) => l.title)).toEqual(['MIT', 'Startup', 'Music']);
    expect(getState().lives.map((l) => l.order)).toEqual([0, 1, 2]);
  });

  it('trims the title it stores', async () => {
    const { actions, getState } = await freshStore();
    actions.addLife('  MIT  ');
    expect(getState().lives[0].title).toBe('MIT');
  });

  it('renames a life and ignores a blank rename', async () => {
    const { actions, getState } = await freshStore();
    actions.addLife('MIT');
    const id = getState().lives[0].id;

    actions.renameLife(id, 'Course 6');
    expect(getState().lives[0].title).toBe('Course 6');

    actions.renameLife(id, '  ');
    expect(getState().lives[0].title).toBe('Course 6');
  });

  it('assigns a goal to a life and back to unassigned', async () => {
    const { actions, getState } = await freshStore();
    actions.addLife('MIT');
    const lifeId = getState().lives[0].id;
    actions.addGoals([psets]);

    actions.setGoalLife('g1', lifeId);
    expect(getState().goals[0].lifeId).toBe(lifeId);

    actions.setGoalLife('g1', null);
    expect(getState().goals[0].lifeId).toBeUndefined();
    expect('lifeId' in getState().goals[0]).toBe(false);
  });

  // The dangling reference is the whole design: deleting a life writes one
  // slice, and the goals it held are read as unassigned without being touched.
  it('deleting a life leaves its goals alone, and undo restores the assignment', async () => {
    const { actions, getState } = await freshStore();
    actions.addLife('MIT');
    const lifeId = getState().lives[0].id;
    actions.addGoals([psets]);
    actions.setGoalLife('g1', lifeId);

    actions.removeLife(lifeId);
    expect(getState().lives).toEqual([]);
    expect(getState().goals[0].lifeId).toBe(lifeId);
    expect(getState().pendingUndo?.label).toBe('Deleted "MIT"');

    actions.undoLastDelete();
    expect(getState().lives.map((l) => l.id)).toEqual([lifeId]);
    expect(getState().goals[0].lifeId).toBe(lifeId);
  });

  it('deleting an unknown life writes nothing', async () => {
    const { actions, getState } = await freshStore();
    actions.addLife('MIT');
    const before = getState().lives;

    actions.removeLife('nope');

    expect(getState().lives).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/state/store.test.ts -t lives`
Expected: FAIL — `actions.addLife is not a function`.

- [ ] **Step 3: Add `lives` to the store's initial state**

In `src/state/store.ts`, find the `let state: FullState = {` literal and add `lives: [],` immediately after `sessions: [],`:

```ts
let state: FullState = {
  goals: [],
  habits: [],
  tasks: [],
  sessions: [],
  lives: [],
```

Find the `persist({ goals: next.goals, … })` call inside `setAndPersist` and add the slice:

```ts
  persist({ goals: next.goals, habits: next.habits, tasks: next.tasks, sessions: next.sessions, lives: next.lives }).then(
```

- [ ] **Step 4: Add the four actions**

Add these imports at the top of `src/state/store.ts`:

```ts
import { canAddLife, nextLifeOrder } from '../lib/lives';
import type { Life } from '../db/types';
```

(If `Life` can be folded into the existing `import type { … } from '../db/types'` line, do that instead of adding a second one.)

Add to the `actions` object, beside the other goal-level actions:

```ts
  /**
   * Create a life. Returns false when refused, so a caller never reports
   * success on a refusal — the same contract the bulk edits already keep.
   */
  addLife(title: string): boolean {
    const clean = title.trim();
    if (clean === '') return false;
    if (!canAddLife(state.lives)) return false;
    const life: Life = { id: uid(), title: clean, order: nextLifeOrder(state.lives) };
    setAndPersist({ lives: [...state.lives, life] });
    return true;
  },

  renameLife(id: string, title: string) {
    const clean = title.trim();
    if (clean === '') return;
    if (!state.lives.some((l) => l.id === id)) return;
    setAndPersist({ lives: state.lives.map((l) => (l.id === id ? { ...l, title: clean } : l)) });
  },

  /**
   * Delete a life WITHOUT touching the goals in it.
   *
   * Their `lifeId` is left pointing at the deleted row; `lifeOf` reads that
   * as unassigned. Undo then restores the life and every goal is back in
   * it, because no goal was ever rewritten. The snapshot still spans both
   * slices so the guarantee does not depend on a reader proving `goals` was
   * untouched.
   */
  removeLife(id: string) {
    const life = state.lives.find((l) => l.id === id);
    if (!life) return;
    withUndoSlices(
      `Deleted "${life.title}"`,
      { lives: state.lives.filter((l) => l.id !== id), goals: state.goals },
      DESTRUCTIVE_UNDO_MS,
    );
  },

  setGoalLife(goalId: string, lifeId: string | null) {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) return;
    if (lifeId !== null && !state.lives.some((l) => l.id === lifeId)) return;
    setAndPersist({
      goals: state.goals.map((g) => {
        if (g.id !== goalId) return g;
        if (lifeId === null) {
          // Absent, never `undefined` left in place — the field's absence IS
          // "unassigned", and a key holding undefined survives structuredClone
          // into the undo snapshot as a difference nobody asked for.
          const { lifeId: _drop, ...rest } = g;
          return rest;
        }
        return { ...g, lifeId };
      }),
    });
  },
```

Use whatever id generator the file already uses — search for `uid(` in `store.ts` and match it.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/state/store.test.ts -t lives`
Expected: PASS, 6 tests.

- [ ] **Step 6: Confirm the whole build is green again**

Run: `npx tsc -b && npm test`
Expected: `tsc` exits 0; **128 test files, 2467 + 19 = 2486 tests passing** (9 from Task 1, 4 from Task 2, 6 here — only Task 1 adds a *file*). If other `AppState` literals in test files still fail to typecheck, add `lives: []` to each — that is the remainder of Task 1 Step 6's list.

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(lives): create, rename, delete and assign, with a delete that leaves goals alone"
```

---

### Task 4: Manage lives in Settings

**Files:**
- Create: `src/views/goals/LivesSettings.tsx`
- Create: `src/views/goals/LivesSettings.test.tsx`
- Modify: `src/components/SettingsModal.tsx`

**Interfaces:**
- Consumes: `actions.addLife`, `actions.renameLife`, `actions.removeLife`, `useAppStore().lives`, `MAX_LIVES`, `sortedLives`.
- Produces: `<LivesSettings />`, rendered inside `SettingsModal`.

**Why here.** `SettingsModal`'s own docstring says it is *"where the low-frequency system operations live"* and that it is *"provider-style configuration, not routine editing, reached deliberately from the utility menu or `⌘K`."* Naming your lives happens roughly once a semester. It also costs no new chrome anywhere on the board — which is what "minimal in surface" means. The modal is retitled from "Working hours" to "Settings", with the existing content becoming a labelled section.

- [ ] **Step 1: Write the failing test**

Create `src/views/goals/LivesSettings.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LivesSettings } from './LivesSettings';

const addLife = vi.fn(() => true);
const renameLife = vi.fn();
const removeLife = vi.fn();
let lives = [{ id: 'l1', title: 'MIT', order: 0 }];

vi.mock('../../state/store', () => ({
  useAppStore: () => ({ lives, actions: { addLife, renameLife, removeLife } }),
  actions: { addLife, renameLife, removeLife },
}));

beforeEach(() => {
  lives = [{ id: 'l1', title: 'MIT', order: 0 }];
  addLife.mockClear();
  renameLife.mockClear();
  removeLife.mockClear();
});

describe('LivesSettings', () => {
  it('lists each life in an editable field', () => {
    render(<LivesSettings />);
    expect((screen.getByLabelText('Life name') as HTMLInputElement).value).toBe('MIT');
  });

  it('adds a life from the new-life field', () => {
    render(<LivesSettings />);
    const field = screen.getByLabelText('New life name');
    fireEvent.change(field, { target: { value: 'Startup' } });
    fireEvent.submit(field.closest('form')!);

    expect(addLife).toHaveBeenCalledWith('Startup');
  });

  it('renames on blur', () => {
    render(<LivesSettings />);
    const field = screen.getByLabelText('Life name');
    fireEvent.change(field, { target: { value: 'Course 6' } });
    fireEvent.blur(field);

    expect(renameLife).toHaveBeenCalledWith('l1', 'Course 6');
  });

  it('deletes a life', () => {
    render(<LivesSettings />);
    fireEvent.click(screen.getByLabelText('Delete MIT'));
    expect(removeLife).toHaveBeenCalledWith('l1');
  });

  // The cap is a product rule, so it is stated rather than enforced silently
  // by a control that stops working for no visible reason.
  it('replaces the add field with the reason once three exist', () => {
    lives = [
      { id: 'l1', title: 'MIT', order: 0 },
      { id: 'l2', title: 'Startup', order: 1 },
      { id: 'l3', title: 'Music', order: 2 },
    ];
    render(<LivesSettings />);

    expect(screen.queryByLabelText('New life name')).toBeNull();
    expect(screen.getByText('Three is the most Phase will hold.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/views/goals/LivesSettings.test.tsx`
Expected: FAIL — `Failed to resolve import "./LivesSettings"`.

- [ ] **Step 3: Write the component**

Create `src/views/goals/LivesSettings.tsx`:

```tsx
import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { MAX_LIVES, sortedLives } from '../../lib/lives';
// There is no trash icon in this codebase. `IconX` is the removal glyph, and
// inventing a Unicode "🗑" fails `designScale.test.ts` outright.
import { IconX } from '../../components/Icons';

/**
 * Naming the two or three lives you are living at once.
 *
 * A rename commits on blur rather than behind a Save button, matching
 * `commitDates`: a form that autosaves on a valid change is the pattern this
 * app settled on. Deleting is undoable through the store, so there is no
 * confirmation dialog here — undo-instead-of-confirm, as everywhere else.
 */
export function LivesSettings() {
  const { lives, actions } = useAppStore();
  const [draft, setDraft] = useState('');

  return (
    <div>
      <ul className="flex flex-col gap-[6px] mb-[12px]">
        {sortedLives(lives).map((life) => (
          <li key={life.id} className="flex items-center gap-[6px]">
            <input
              aria-label="Life name"
              defaultValue={life.title}
              onBlur={(e) => {
                if (e.target.value.trim() !== life.title) actions.renameLife(life.id, e.target.value);
              }}
              className="flex-1 min-w-0 text-ui text-ink bg-panel border border-line-2 rounded-field px-[8px] py-[5px]"
            />
            <button
              type="button"
              aria-label={`Delete ${life.title}`}
              onClick={() => actions.removeLife(life.id)}
              className="text-faint hover:text-warn min-h-[24px] px-[6px] inline-flex items-center rounded-field hover:bg-hover"
            >
              <IconX />
            </button>
          </li>
        ))}
      </ul>

      {lives.length < MAX_LIVES ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (actions.addLife(draft)) setDraft('');
          }}
        >
          <input
            aria-label="New life name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a life — MIT, Startup…"
            className="w-full text-ui text-ink bg-panel border border-line-2 rounded-field px-[8px] py-[5px]"
          />
        </form>
      ) : (
        <p className="text-meta text-muted">Three is the most Phase will hold.</p>
      )}
    </div>
  );
}
```

`Modal` supplies the dialog chrome; this component renders only its own contents.

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/views/goals/LivesSettings.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mount it in Settings**

Rewrite `src/components/SettingsModal.tsx` as:

```tsx
import { Modal } from './Modal';
import { AvailabilitySettings } from '../views/plan/AvailabilitySettings';
import { LivesSettings } from '../views/goals/LivesSettings';

/**
 * Where the low-frequency system operations live.
 *
 * Working hours were an accordion in the Plan rail, sitting as a peer of "To
 * plan" — the one section used repeatedly while planning — even though a
 * person edits their availability roughly never after the first week. The rail
 * is 249px of the most valuable column on the busiest screen; a settings form
 * is not what it is for.
 *
 * A dialog earns itself here for the reason §14 gives: this is provider-style
 * configuration, not routine editing, and it is reached deliberately from the
 * utility menu or `⌘K`, never stumbled into. Naming your lives belongs to the
 * same class — done once a semester, and it costs the board no chrome.
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <h3 className="text-meta font-semibold text-muted mb-[6px]">Lives</h3>
      <p className="text-ui text-muted mb-[12px] leading-[1.5]">
        The handful of things you are doing at once. A goal belongs to one of
        them, or to none — an errand is nobody's project.
      </p>
      <LivesSettings />

      <h3 className="text-meta font-semibold text-muted mt-[20px] mb-[6px]">Working hours</h3>
      <p className="text-ui text-muted mb-[12px] leading-[1.5]">
        The hours Phase may schedule into. Everything that reports free time —
        the week's capacity, where a dragged task lands, whether a goal still
        fits before its deadline — is measured against these.
      </p>
      <AvailabilitySettings />
    </Modal>
  );
}
```

- [ ] **Step 6: Check nothing depended on the old title**

Run: `grep -rn "Working hours" src --include=*.tsx --include=*.ts | grep -v node_modules`
Expected: hits in `SettingsModal.tsx` and wherever the palette or utility menu names the command. If a test or `commands.ts` asserts the modal's accessible name is "Working hours", update it to "Settings" — the command that *opens* it may keep its own label.

- [ ] **Step 7: Run the full suite**

Run: `npx tsc -b && npm test`
Expected: `tsc` exits 0, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/views/goals/LivesSettings.tsx src/views/goals/LivesSettings.test.tsx src/components/SettingsModal.tsx
git commit -m "feat(lives): name your lives where the once-a-semester settings live"
```

---

### Task 5: Assign a goal to a life from its card

**Files:**
- Modify: `src/views/goals/BoardCard.tsx`
- Modify: `src/views/Goals.tsx`
- Test: `src/views/goals/BoardCard.life.test.tsx` (create)

**Interfaces:**
- Consumes: `lifeOf`, `sortedLives`, `Life`, `actions.setGoalLife`.
- Produces: `BoardCard` gains props `lives: Life[]` and `onSetLife: (goalId: string, lifeId: string | null) => void`.

**Where it goes.** `BoardCard` already owns a `⋯` overflow whose docstring says it holds *"the two things the card body cannot do: move it, and delete it."* Assigning a life is the third. It reuses the existing `role="menu"` and its section-label idiom (`px-[11px] py-[3px] text-meta text-muted`) rather than inventing a second pattern.

The life is shown on the card as plain text so the assignment is visible without opening anything — otherwise this whole slice ships invisible.

- [ ] **Step 1: Write the failing test**

Create `src/views/goals/BoardCard.life.test.tsx`. Open `src/views/goals/BoardCard.unblock.test.tsx` first and copy its render harness verbatim — it already supplies the dnd-kit context `BoardCard` needs. `BoardCard`'s full prop list, which the harness must satisfy, is:

```
goal, today, onOpen, onMove, onRank, onDelete, reducedMotion, dimmed, matched,
highlighted?   — plus the two this task adds: lives, onSetLife
```

Then adapt:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// …the same imports and renderCard harness as BoardCard.unblock.test.tsx,
// extended to pass `lives` and `onSetLife` through to BoardCard.

const LIVES = [
  { id: 'l1', title: 'MIT', order: 0 },
  { id: 'l2', title: 'Startup', order: 1 },
];

describe('BoardCard — life', () => {
  it('names the life a goal belongs to', () => {
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [], lifeId: 'l1' }, lives: LIVES });
    expect(screen.getByText('MIT')).toBeTruthy();
  });

  it('says nothing at all when the goal is unassigned', () => {
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [] }, lives: LIVES });
    expect(screen.queryByText('MIT')).toBeNull();
    expect(screen.queryByText('Unassigned')).toBeNull();
  });

  // A life deleted out from under a goal must not render its stale id.
  it('says nothing when the goal points at a life that no longer exists', () => {
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [], lifeId: 'gone' }, lives: LIVES });
    expect(screen.queryByText('gone')).toBeNull();
  });

  it('offers every life plus None, and assigns the one clicked', () => {
    const onSetLife = vi.fn();
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [] }, lives: LIVES, onSetLife });

    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Startup' }));

    expect(onSetLife).toHaveBeenCalledWith('g1', 'l2');
  });

  it('clears the life with None', () => {
    const onSetLife = vi.fn();
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [], lifeId: 'l1' }, lives: LIVES, onSetLife });

    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'None' }));

    expect(onSetLife).toHaveBeenCalledWith('g1', null);
  });

  // With no lives created, the section is chrome explaining a concept the
  // person has not opted into.
  it('omits the whole section when no lives exist', () => {
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [] }, lives: [] });
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.queryByText('Life')).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/views/goals/BoardCard.life.test.tsx`
Expected: FAIL — no "MIT" text, no "Startup" menu item.

- [ ] **Step 3: Add the props and the menu section**

In `src/views/goals/BoardCard.tsx`, add to the imports:

```tsx
import type { Life } from '../../db/types';
import { lifeOf, sortedLives } from '../../lib/lives';
```

Add `lives` and `onSetLife` to the component's props type and destructuring, then derive the current life near the other derived values in the component body:

```tsx
  const life = lifeOf(goal, lives);
```

Inside the `role="menu"` div, **after** the horizon buttons' closing `))}` and **before** the `<div className="border-t border-line-soft my-[4px]" />` that precedes "Delete goal", insert:

```tsx
              {lives.length > 0 && (
                <>
                  <div className="border-t border-line-soft my-[4px]" />
                  <div className="px-[11px] py-[3px] text-meta text-muted">
                    Life
                  </div>
                  {sortedLives(lives).map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      role="menuitem"
                      disabled={l.id === life?.id}
                      onClick={act(() => {
                        onSetLife(goal.id, l.id);
                        setMenuOpen(false);
                      })}
                      className="w-full text-left text-ui px-[11px] py-[5px] text-ink-soft hover:bg-hover disabled:text-faint disabled:hover:bg-transparent disabled:cursor-default"
                    >
                      {l.title}
                      {l.id === life?.id && <span className="text-faint text-meta"> · current</span>}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={life === null}
                    onClick={act(() => {
                      onSetLife(goal.id, null);
                      setMenuOpen(false);
                    })}
                    className="w-full text-left text-ui px-[11px] py-[5px] text-ink-soft hover:bg-hover disabled:text-faint disabled:hover:bg-transparent disabled:cursor-default"
                  >
                    None
                  </button>
                </>
              )}
```

- [ ] **Step 4: Show the life on the card**

In `src/views/goals/BoardCard.tsx`, insert immediately **before** the `{blocked > 0 && (` block (around line 144 — it sits in the same flex row as the badge and the blocked-reason text):

```tsx
          {life && <span className="text-meta text-muted whitespace-nowrap">{life.title}</span>}
```

Note that row is inside a `{… && (` guard, so a card with no badge, no blocked
tasks and no reason may not render the row at all. Verify with the first test in
Step 1 — if `screen.getByText('MIT')` fails on an otherwise-bare goal, widen the
guard so the row also renders when `life !== null`.

An unassigned goal prints **nothing** — never the word "Unassigned". Absence is the state; naming it would put a label on every card that has not opted in.

- [ ] **Step 5: Pass the props from `Goals.tsx`**

In `src/views/Goals.tsx`, pull `lives` out of the store — find the existing `const { goals, dateReviewDismissed, activeHorizon, goalsMode, goalModal, actions } = useAppStore();` and add `lives`:

```tsx
  const { goals, lives, dateReviewDismissed, activeHorizon, goalsMode, goalModal, actions } = useAppStore();
```

Then find the `<BoardCard` element inside the `columns[i].map(...)` and add the two props:

```tsx
                    lives={lives}
                    onSetLife={actions.setGoalLife}
```

- [ ] **Step 6: Run and verify it passes**

Run: `npx vitest run src/views/goals/BoardCard.life.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 7: Fix the sibling card tests**

Run: `npx vitest run src/views/goals/`
Expected: `BoardCard.keyboard.test.tsx` and `BoardCard.unblock.test.tsx` may fail to typecheck on the two new required props. Add `lives={[]}` and `onSetLife={() => {}}` to their render harnesses. **Do not** make the props optional to avoid this — a card that silently drops the assignment path is the failure mode.

- [ ] **Step 8: Run the full suite**

Run: `npx tsc -b && npm test`
Expected: `tsc` exits 0; **130 test files, 2497 tests passing** (2486 after Task 3, +5 from Task 4, +6 here).

- [ ] **Step 9: Commit**

```bash
git add src/views/goals/BoardCard.tsx src/views/goals/BoardCard.life.test.tsx src/views/goals/BoardCard.keyboard.test.tsx src/views/goals/BoardCard.unblock.test.tsx src/views/Goals.tsx
git commit -m "feat(lives): a card says which life it is in, and can be moved between them"
```

---

## Manual verification

After Task 5, run `npm run dev` and confirm end to end:

1. Open Settings. Add "MIT" and "Startup". Confirm a third can be added and a fourth cannot — the field is replaced by *"Three is the most Phase will hold."*
2. Rename "MIT" to "Course 6" and click away. Reload the page. The rename survived.
3. On the board, open a card's `⋯`. Assign it to Course 6. The card now names it.
4. Assign it to None. The card names nothing — not "Unassigned".
5. Delete Course 6 in Settings, then press Undo within 15 seconds. The life returns **and every goal that was in it is in it again.**
6. Delete Course 6 and let the undo expire. Its goals are still on the board, unassigned, with their titles and steps intact.
7. Export a backup. Open the JSON: it has a top-level `lives` array, and goals carry `lifeId`.
8. Import that backup into a fresh profile. Lives and assignments come back.

## Notes for slice 2

- **`groupByLife` belongs to slice 2, not here.** It buckets goals into ordered life-groups with unassigned last — a named life kept even when empty (you made it), the unassigned group omitted when empty (it is not a life). It goes in `src/lib/lives.ts` beside `lifeOf`, whose dangling-reference test already pins the semantics it depends on.
- `Life` has no budget field yet. Slice 2 adds `defaultShareMin?: number` to `Life` and the `WeekRecord` slice, per vision D-15.
- `removeLife` already spans `{ lives, goals }` in one undo entry, so adding a budget to a life does not change its undo shape.
