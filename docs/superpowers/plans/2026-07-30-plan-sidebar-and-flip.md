# Plan Sidebar and Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Plan view its sidebar, inline recap and keyboard placement, then make it the home view and delete `Today` and the old modal planner.

**Architecture:** The accordion sidebar holds every card the old `Today` view carried: the backlog pinned open, with Habits / Suggestions / Stats / Month folded beneath it. New logic goes into `src/lib` where it can be tested; the panels themselves are relocations of existing components. The flip lands last, in one revertible commit.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 3, Dexie/IndexedDB, `@dnd-kit/core`, Vitest (`environment: 'node'`).

## Scope

This is **plan 2 of 2**. Plan 1 (`docs/superpowers/plans/2026-07-29-calendar-grid-foundation.md`, merged as `bd30630`) delivered the data layer and a working grid behind a fourth nav item.

Spec: `docs/superpowers/specs/2026-07-29-plan-week-calendar-redesign-design.md`

## Global Constraints

- **`npm`, `npx` and `node` are broken in this shell.** They are zsh functions wrapping a missing `_load_nvm`, and **`$?` after a pipe reports 0, so a failing build looks like a pass.** Run binaries directly:
  - Tests: `./node_modules/.bin/vitest run --config vitest.config.ts`
  - Typecheck: `./node_modules/.bin/tsc -b`
  - Never trust an exit status read after a pipe; use `${pipestatus[1]}` in zsh or read the real output.
- **Never stage, modify, or commit `src/components/GoalTree.tsx`.** It holds unrelated uncommitted user work and stayed clean through all 31 commits of plan 1. **Never `git add -A` or `git add .`** — stage every file explicitly by path.
- **Every new test must be proved to discriminate.** Plan 1 produced **ten** separate tests that could not fail — including one that asserted a data-loss bug as correct behaviour. For each test you add, apply a plausible mutation to the code it guards, confirm the test fails, revert, and record the real output in your report. A test that passes under mutation closes nothing.
- **The scheduling invariant:** an item is on the grid **iff** it has a day *and* a start minute. Anything else is backlog. Violations of this caused four separate bugs in plan 1, in four different modules.
- **Never clear a task's `date`.** No surface lists a dateless task, so dropping a date makes it unreachable. Unpinning clears `startMin` alone. This plan adds the task backlog that finally gives a dateless task somewhere to live — until Task 5 lands, the rule stands absolutely.
- `dow` is `0 = Monday … 6 = Sunday`. Minutes are integers from local midnight, `0..1440`, **end exclusive**.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`. Views stay thin and delegate to `actions`; views never touch `db`. `src/db/db.ts` is the only module touching IndexedDB.
- Device preferences use `set()` plus their own save helper, never `setAndPersist` — follow `setAvailability`/`setAllDayBlocks`.
- Destructive edits stay undo-aware via `withUndo`/`scheduleUndo`.
- **Visual identity is locked.** Only tokens already in this codebase. No new colours, fonts or spacing scales.
- `"noUnusedParameters"` and `"noUnusedLocals"` are on — an unused import, prop or local is a hard compile error.
- **`vitest` runs `environment: 'node'` — there is no DOM.** React components cannot be unit-tested. Do not add `jsdom` or a DOM environment. Component tasks are gated by `tsc -b` plus the manual smoke checklist each one specifies, and **no implementer may claim to have run a browser check.**

## File structure

| File | Responsibility |
|---|---|
| `src/lib/backlog.ts` | **New.** One selector producing everything the backlog rail shows — unplanned steps *and* unplaced tasks — grouped by project with completion percentages. |
| `src/lib/planKeyboard.ts` | **New.** Pure resolution of the Plan view's keys: `1`–`7`, `[`, `]`, `T`. |
| `src/db/db.ts` | Adds load/save for the sidebar's open-panel preference, and puts the pre-migration snapshot into the backup export. |
| `src/state/store.ts` | Adds `setSidebarPanels`; fixes two actions that leave a stale `startMin`. |
| `src/views/plan/PlanSidebar.tsx` | **New.** The accordion shell: quick-add, pinned backlog, four collapsible panels. |
| `src/views/plan/sidebar/*.tsx` | **New.** `Backlog`, `Habits`, `Suggestions`, `Stats`, `Month` — the backlog is new, the other four relocate existing `today/` components. |
| `src/views/plan/RecapPanel.tsx` | **New.** Last week's recap, inline and dismissible rather than a modal gate. |
| `src/views/Plan.tsx` | Gains the sidebar, the recap and keyboard handling. |
| `src/views/Today.tsx`, `src/views/today/*`, `src/views/plan/PlanWeekOverlay.tsx` | **Deleted** in the final task. |

---

### Task 1: `backlog.ts` — one selector for everything the rail shows

**Files:**
- Create: `src/lib/backlog.ts`
- Create: `src/lib/backlog.test.ts`

**Interfaces:**
- Consumes: `walkLeaves`, `activeGoals`, `attentionRank` from `src/lib/plan.ts`; `goalPct` from `src/lib/pct.ts`; `normalizeEstimate` from `src/lib/capacity.ts`.
- Produces:
  - `interface BacklogItem { kind: 'step' | 'task'; id: string; goalId: string | null; title: string; estimateMin?: number }`
  - `interface BacklogGroup { goalId: string | null; goalTitle: string; pct: number; items: BacklogItem[] }`
  - `backlogGroups(goals: Goal[], tasks: Task[], week: string, today: string): BacklogGroup[]`

This is where the task backlog finally exists. Plan 1 deliberately never cleared a task's `date` because nothing listed a dateless task; this selector is what makes that state visible, and it must also surface a task that has a `date` but no `startMin` — committed to a day, not placed on the grid.

Tasks with no project group under a `goalId: null` group titled `Loose tasks`, placed last.

`pct` on each group folds in the old `GoalsCard`, which the spec removes as a separate section.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/backlog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Goal, Task } from '../db/types';
import { backlogGroups } from './backlog';

const WEEK = '2026-07-13';
const TODAY = '2026-07-15';

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', title: 'Thesis', nodes: [], ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Email', done: false, goalId: null, ...over } as Task;
}

describe('backlogGroups', () => {
  it('includes an open step that is not planned at all', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft' }] });
    expect(backlogGroups([g], [], WEEK, TODAY)).toEqual([
      { goalId: 'g1', goalTitle: 'Thesis', pct: 0, items: [{ kind: 'step', id: 'n1', goalId: 'g1', title: 'Draft' }] },
    ]);
  });

  it('includes a step committed to this week but not placed on a day', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: WEEK }] });
    expect(backlogGroups([g], [], WEEK, TODAY)[0].items.map((i) => i.id)).toEqual(['n1']);
  });

  it('includes a step with a day but no start minute — it is not on the grid', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: TODAY }] });
    expect(backlogGroups([g], [], WEEK, TODAY)[0].items.map((i) => i.id)).toEqual(['n1']);
  });

  it('excludes a step genuinely placed on the grid this week', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: TODAY, plannedStartMin: 600 }] });
    expect(backlogGroups([g], [], WEEK, TODAY)).toEqual([]);
  });

  it('excludes done steps and archived projects', () => {
    const done = goal({ nodes: [{ id: 'n1', title: 'Done', done: true }] });
    const archived = goal({ id: 'g2', completedAt: '2026-07-01', nodes: [{ id: 'n2', title: 'Old' }] });
    expect(backlogGroups([done, archived], [], WEEK, TODAY)).toEqual([]);
  });

  it('includes a dateless task under Loose tasks', () => {
    expect(backlogGroups([], [task()], WEEK, TODAY)).toEqual([
      { goalId: null, goalTitle: 'Loose tasks', pct: 0, items: [{ kind: 'task', id: 't1', goalId: null, title: 'Email' }] },
    ]);
  });

  it('includes a task with a date but no start minute', () => {
    expect(backlogGroups([], [task({ date: TODAY })], WEEK, TODAY)[0].items.map((i) => i.id)).toEqual(['t1']);
  });

  it('excludes a task placed on the grid, and a done task', () => {
    const placed = task({ id: 't1', date: TODAY, startMin: 600 });
    const finished = task({ id: 't2', done: true });
    expect(backlogGroups([], [placed, finished], WEEK, TODAY)).toEqual([]);
  });

  it('files a task under its project when it has one', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft' }] });
    const groups = backlogGroups([g], [task({ goalId: 'g1' })], WEEK, TODAY);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.kind)).toEqual(['step', 'task']);
  });

  it('puts Loose tasks last', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft' }] });
    const groups = backlogGroups([g], [task()], WEEK, TODAY);
    expect(groups.map((x) => x.goalId)).toEqual(['g1', null]);
  });

  it('carries the estimate through when one is usable', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', estimateMin: 90 }] });
    expect(backlogGroups([g], [], WEEK, TODAY)[0].items[0].estimateMin).toBe(90);
  });

  it('omits an unusable estimate rather than passing it through', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', estimateMin: 0 }] });
    expect('estimateMin' in backlogGroups([g], [], WEEK, TODAY)[0].items[0]).toBe(false);
  });

  it('drops a project that has nothing left to plan', () => {
    const empty = goal({ id: 'g2', title: 'Empty', nodes: [] });
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft' }] });
    expect(backlogGroups([g, empty], [], WEEK, TODAY).map((x) => x.goalId)).toEqual(['g1']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/backlog.test.ts`
Expected: FAIL — cannot resolve `./backlog`.

- [ ] **Step 3: Write `src/lib/backlog.ts`**

```ts
import type { Goal, Task } from '../db/types';
import { normalizeEstimate } from './capacity';
import { goalPct } from './pct';
import { attentionRank, walkLeaves } from './plan';

/** One draggable row in the backlog rail. */
export interface BacklogItem {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
  estimateMin?: number;
}

/** A project heading plus its unplaced work. `goalId: null` is the loose bucket. */
export interface BacklogGroup {
  goalId: string | null;
  goalTitle: string;
  pct: number;
  items: BacklogItem[];
}

export const LOOSE_GROUP_TITLE = 'Loose tasks';

/**
 * Everything available to drag onto the grid, grouped by project.
 *
 * The membership rule is the exact complement of `scheduledOn`: an item is
 * backlog unless it is genuinely placed — a day AND a start minute — for
 * `week`. That covers three shapes the old planner could not express: never
 * planned, committed to the week with no day, and pinned to a day with no
 * time. All three are invisible on the grid, so all three must be reachable
 * here or the work is lost.
 *
 * Loose tasks sort last: they are the least structured thing on screen and
 * should not push projects down.
 */
export function backlogGroups(
  goals: Goal[],
  tasks: Task[],
  week: string,
  today: string,
): BacklogGroup[] {
  const withEstimate = (min: number | undefined): { estimateMin?: number } => {
    const usable = normalizeEstimate(min);
    return usable === undefined ? {} : { estimateMin: usable };
  };

  const byGoal = new Map<string, BacklogItem[]>();
  const ranked = attentionRank(goals, today); // archived projects already dropped

  for (const g of ranked) {
    const items: BacklogItem[] = [];
    walkLeaves(g, (n) => {
      if (n.done) return;
      const placed =
        n.plannedWeek === week && n.plannedDay !== undefined && n.plannedStartMin !== undefined;
      if (placed) return;
      items.push({ kind: 'step', id: n.id, goalId: g.id, title: n.title, ...withEstimate(n.estimateMin) });
    });
    byGoal.set(g.id, items);
  }

  const loose: BacklogItem[] = [];
  for (const t of tasks) {
    if (t.done) continue;
    if (t.date !== undefined && t.startMin !== undefined) continue; // on the grid
    const item: BacklogItem = {
      kind: 'task', id: t.id, goalId: t.goalId, title: t.title, ...withEstimate(t.estimateMin),
    };
    const bucket = t.goalId ? byGoal.get(t.goalId) : undefined;
    if (bucket) bucket.push(item);
    else loose.push(item);
  }

  const out: BacklogGroup[] = [];
  for (const g of ranked) {
    const items = byGoal.get(g.id) ?? [];
    if (items.length === 0) continue;
    out.push({ goalId: g.id, goalTitle: g.title, pct: Math.round(goalPct(g)), items });
  }
  if (loose.length > 0) {
    out.push({ goalId: null, goalTitle: LOOSE_GROUP_TITLE, pct: 0, items: loose });
  }
  return out;
}
```

Note: `walkLeaves` must be exported from `src/lib/plan.ts` — plan 1 already exported it.

- [ ] **Step 4: Run tests and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/backlog.test.ts`
Expected: PASS, 13 tests.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 5: Prove the tests discriminate**

Apply each mutation, run the file, record the real output, revert:

1. Drop `&& n.plannedStartMin !== undefined` from `placed` → the "day but no start minute" test must fail.
2. Change the task guard to `if (t.date !== undefined) continue;` → the "date but no start minute" test must fail.
3. Remove the `loose.length > 0` ordering so loose comes first → the ordering test must fail.

If any mutation survives, add the test that catches it before committing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backlog.ts src/lib/backlog.test.ts
git commit -m "feat(backlog): one selector for unplaced steps and tasks"
```

---

### Task 2: Sidebar open-panel preference

**Files:**
- Modify: `src/db/db.ts` (append after `saveAllDayBlocks`)
- Modify: `src/db/db.test.ts`
- Modify: `src/state/store.ts`

**Interfaces:**
- Produces:
  - `type SidebarPanel = 'habits' | 'suggestions' | 'stats' | 'month'`
  - `loadSidebarPanels(): Promise<SidebarPanel[]>` / `saveSidebarPanels(panels: SidebarPanel[]): Promise<void>` in `db.ts`
  - `actions.setSidebarPanels(panels: SidebarPanel[]): void`
  - `state.sidebarPanels: SidebarPanel[]`

Which panels are expanded is a **device preference**, not app data: it uses `set()` plus its own save, exactly like `availability` and `allDayBlocks`, and never `setAndPersist`. The backlog is pinned open and is not a member of this set.

Parsing is total, matching `parseAvailability`'s posture: anything malformed yields the default (all collapsed) rather than a partially-valid list.

- [ ] **Step 1: Write the failing tests**

Append to `src/db/db.test.ts`, inside a new `describe('sidebar panels', …)`:

```ts
it('defaults to no expanded panels', async () => {
  expect(await loadSidebarPanels()).toEqual([]);
});

it('round-trips a saved selection', async () => {
  await saveSidebarPanels(['habits', 'month']);
  expect(await loadSidebarPanels()).toEqual(['habits', 'month']);
});

it('drops unknown panel names rather than storing them', async () => {
  await saveSidebarPanels(['habits', 'bogus' as SidebarPanel]);
  expect(await loadSidebarPanels()).toEqual(['habits']);
});

it('falls back to empty for malformed stored JSON', async () => {
  await db.settings.put({ key: 'sidebarPanels', value: 'not json' });
  expect(await loadSidebarPanels()).toEqual([]);
});

it('deduplicates repeated panels', async () => {
  await saveSidebarPanels(['stats', 'stats']);
  expect(await loadSidebarPanels()).toEqual(['stats']);
});
```

Add `loadSidebarPanels`, `saveSidebarPanels`, `type SidebarPanel` to that file's imports from `./db`.

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/db/db.test.ts`
Expected: FAIL — `loadSidebarPanels` is not exported.

- [ ] **Step 3: Add the helpers to `src/db/db.ts`**

Append after `saveAllDayBlocks`:

```ts
/** Which sidebar panels are expanded. The backlog is pinned and never listed. */
export type SidebarPanel = 'habits' | 'suggestions' | 'stats' | 'month';

const SIDEBAR_PANELS: readonly SidebarPanel[] = ['habits', 'suggestions', 'stats', 'month'];
const SIDEBAR_PANELS_KEY = 'sidebarPanels';

/**
 * Total parse: a malformed or partly-unknown value yields the default rather
 * than a half-trusted list, mirroring `parseAvailability`. Collapsing every
 * panel is a harmless fallback — the backlog, the only section that matters
 * for placing work, is pinned open regardless.
 */
function parseSidebarPanels(raw: string | undefined): SidebarPanel[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const kept = SIDEBAR_PANELS.filter((panel) => value.includes(panel));
  return [...kept];
}

export async function loadSidebarPanels(): Promise<SidebarPanel[]> {
  const row = await db.settings.get(SIDEBAR_PANELS_KEY);
  return parseSidebarPanels(row?.value);
}

export async function saveSidebarPanels(panels: SidebarPanel[]): Promise<void> {
  const clean = SIDEBAR_PANELS.filter((panel) => panels.includes(panel));
  await db.settings.put({ key: SIDEBAR_PANELS_KEY, value: JSON.stringify(clean) });
}
```

Filtering against `SIDEBAR_PANELS` rather than the input's own order gives deduplication and unknown-name rejection in one pass, and makes the stored order stable.

- [ ] **Step 4: Wire the store**

In `src/state/store.ts`: add `loadSidebarPanels, saveSidebarPanels, type SidebarPanel` to the `../db/db` import; add `sidebarPanels: SidebarPanel[]` to `UIState` with initial `[]`; add `loadSidebarPanels()` to the `Promise.all` in `initStore` and thread the result into the hydrated state; and add the action beside `setAllDayBlocks`:

```ts
  // A device preference, like availability and the all-day setting: set() plus
  // its own save, never setAndPersist — this is not app data.
  setSidebarPanels(panels: SidebarPanel[]): void {
    set({ sidebarPanels: panels });
    void saveSidebarPanels(panels);
  },
```

`src/state/store.test.ts` mocks `../db/db` by hand; add `loadSidebarPanels` (resolving `[]`) and `saveSidebarPanels` to that mock or the existing suite will fail.

- [ ] **Step 5: Run the suite and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS, including 5 new cases.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 6: Prove the tests discriminate**

Mutate `parseSidebarPanels` to `return value as SidebarPanel[]` (skipping the filter); the unknown-name and dedup tests must fail. Revert and record the output.

- [ ] **Step 7: Commit**

```bash
git add src/db/db.ts src/db/db.test.ts src/state/store.ts src/state/store.test.ts
git commit -m "feat(sidebar): persist which panels are expanded as a device preference"
```

---

### Task 3: `planKeyboard.ts` — resolving the Plan view's keys

**Files:**
- Create: `src/lib/planKeyboard.ts`
- Create: `src/lib/planKeyboard.test.ts`

**Interfaces:**
- Produces:
  - `type PlanKeyCommand = { kind: 'place'; dow: number } | { kind: 'week'; delta: number } | { kind: 'today' }`
  - `resolvePlanKey(event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: unknown }): PlanKeyCommand | null`

`1`–`7` place the focused backlog item on that weekday (`1` = Monday, matching `dow`). `[` and `]` move weeks. `T` returns to today.

The `target` guard matters: these keys must do nothing while the user is typing in the quick-add box or an estimate field. `src/lib/appKeyboard.ts` already has an editable-target helper — reuse it rather than writing a second one, exporting it if it is currently private.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/planKeyboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolvePlanKey } from './planKeyboard';

describe('resolvePlanKey', () => {
  it('maps 1 to Monday and 7 to Sunday', () => {
    expect(resolvePlanKey({ key: '1' })).toEqual({ kind: 'place', dow: 0 });
    expect(resolvePlanKey({ key: '7' })).toEqual({ kind: 'place', dow: 6 });
  });

  it('maps every weekday digit in between', () => {
    const got = ['2', '3', '4', '5', '6'].map((key) => resolvePlanKey({ key }));
    expect(got).toEqual([1, 2, 3, 4, 5].map((dow) => ({ kind: 'place', dow })));
  });

  it('ignores 0, 8 and 9', () => {
    for (const key of ['0', '8', '9']) expect(resolvePlanKey({ key })).toBeNull();
  });

  it('maps bracket keys to week navigation', () => {
    expect(resolvePlanKey({ key: '[' })).toEqual({ kind: 'week', delta: -1 });
    expect(resolvePlanKey({ key: ']' })).toEqual({ kind: 'week', delta: 1 });
  });

  it('maps t and T to today', () => {
    expect(resolvePlanKey({ key: 't' })).toEqual({ kind: 'today' });
    expect(resolvePlanKey({ key: 'T' })).toEqual({ kind: 'today' });
  });

  it('ignores every key while a text input is focused', () => {
    const target = { tagName: 'INPUT' };
    for (const key of ['1', '7', '[', ']', 't']) {
      expect(resolvePlanKey({ key, target })).toBeNull();
    }
  });

  it('ignores keys inside a contenteditable region', () => {
    expect(resolvePlanKey({ key: '3', target: { isContentEditable: true } })).toBeNull();
  });

  it('ignores modified keys so browser and app shortcuts still work', () => {
    expect(resolvePlanKey({ key: '1', metaKey: true })).toBeNull();
    expect(resolvePlanKey({ key: '1', ctrlKey: true })).toBeNull();
    expect(resolvePlanKey({ key: '1', altKey: true })).toBeNull();
  });

  it('returns null for an unrelated key', () => {
    expect(resolvePlanKey({ key: 'q' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/planKeyboard.test.ts`
Expected: FAIL — cannot resolve `./planKeyboard`.

- [ ] **Step 3: Write `src/lib/planKeyboard.ts`**

Read `src/lib/appKeyboard.ts` first and reuse its editable-target check, exporting it if it is private. Do not write a second implementation.

```ts
import { isEditableTarget } from './appKeyboard';

/** What a key press means inside the Plan view. */
export type PlanKeyCommand =
  | { kind: 'place'; dow: number }   // 0 = Monday … 6 = Sunday
  | { kind: 'week'; delta: number }  // -1 previous, +1 next
  | { kind: 'today' };

interface PlanKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}

/**
 * Pure key resolution for the Plan view.
 *
 * `1`–`7` are weekdays, matching this codebase's `dow` convention where
 * Monday is 0 — so the digit is one greater than the index it produces.
 *
 * Every branch is gated on an unmodified key with a non-editable target: the
 * sidebar's quick-add box and the inline estimate fields sit inside this view,
 * and swallowing a typed "7" there would be worse than having no shortcut.
 */
export function resolvePlanKey(event: PlanKeyEvent): PlanKeyCommand | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isEditableTarget(event.target)) return null;

  if (event.key >= '1' && event.key <= '7') {
    return { kind: 'place', dow: Number(event.key) - 1 };
  }
  if (event.key === '[') return { kind: 'week', delta: -1 };
  if (event.key === ']') return { kind: 'week', delta: 1 };
  if (event.key === 't' || event.key === 'T') return { kind: 'today' };
  return null;
}
```

If `appKeyboard.ts`'s helper has a different name or signature, adapt to it and say so in your report — do not rename the existing one.

- [ ] **Step 4: Run tests and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/planKeyboard.test.ts`
Expected: PASS, 9 tests.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 5: Prove the tests discriminate**

Apply each mutation, run, record output, revert:

1. Change the digit conversion to `Number(event.key)` (dropping the `- 1`) → the Monday/Sunday test must fail.
2. Delete the `isEditableTarget` guard → the text-input test must fail.
3. Delete the modifier guard → the modified-keys test must fail.

- [ ] **Step 6: Commit**

```bash
git add src/lib/planKeyboard.ts src/lib/planKeyboard.test.ts src/lib/appKeyboard.ts
git commit -m "feat(plan): pure key resolution for weekday placement and week nav"
```

---

### Task 4: Two actions that leave a stale start minute

**Files:**
- Modify: `src/state/store.ts` (`rescheduleTask`)
- Modify: `src/lib/deferWork.ts`
- Modify: `src/state/store.test.ts`, `src/lib/deferWork.test.ts`

**Interfaces:** no signature changes.

Carried from plan 1's final review. `rescheduleTask` changes a task's `date` while **keeping** its `startMin`, with no check that the new day has room at that minute — so moving a task from Wednesday to Saturday parks it at 10:00 on a day with no availability window at all. `deferOpenWork` has the same shape for steps.

The fix is not to re-resolve a slot here: these are bulk and drag-to-another-day paths that have no aim minute to work from, and silently relocating work is what the grid's refuse-and-explain rule exists to avoid. Instead, **moving an item to a different day drops its start minute**, returning it to the backlog for that day — visible, and one drag from being placed.

- [ ] **Step 1: Write the failing tests**

Append to `src/state/store.test.ts` in the task-actions block:

```ts
it('drops the start minute when a task moves to a different day', () => {
  // The new day may have no room at that minute, or no availability at all.
  // Returning it to the backlog is honest; carrying the time over is not.
  actions.addTask('Email', '2026-07-15');
  const id = getState().tasks[0].id;
  actions.scheduleTask(id, '2026-07-15', 600);
  expect(getState().tasks[0].startMin).toBe(600);

  actions.rescheduleTask(id, '2026-07-16');
  expect(getState().tasks[0].date).toBe('2026-07-16');
  expect('startMin' in getState().tasks[0]).toBe(false);
});

it('keeps the start minute when rescheduling to the same day', () => {
  actions.addTask('Email', '2026-07-15');
  const id = getState().tasks[0].id;
  actions.scheduleTask(id, '2026-07-15', 600);
  actions.rescheduleTask(id, '2026-07-15');
  expect(getState().tasks[0].startMin).toBe(600);
});
```

Append to `src/lib/deferWork.test.ts`:

```ts
it('drops a start minute when deferring a placed step to another week', () => {
  const goals: Goal[] = [{
    id: 'g1', title: 'Thesis',
    nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: '2026-07-15', plannedStartMin: 600 }],
  }];
  const { goals: next } = deferOpenWork(goals, [], '2026-07-15', '2026-07-20');
  const node = next[0].nodes[0];
  expect(node.plannedWeek).toBe('2026-07-20');
  expect('plannedDay' in node).toBe(false);
  expect('plannedStartMin' in node).toBe(false);
});
```

Match `deferOpenWork`'s real signature — read it first; the argument list above may not be exact.

- [ ] **Step 2: Run to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/state/store.test.ts src/lib/deferWork.test.ts`
Expected: FAIL — the moved task keeps `startMin`; the deferred node keeps `plannedStartMin`.

- [ ] **Step 3: Fix `rescheduleTask`**

In `src/state/store.ts`, replace the mapping inside `rescheduleTask` so a genuine day change clears the time:

```ts
    const tasks = state.tasks.map((item) => {
      if (item.id !== taskId) return item;
      // A different day cannot inherit this day's minute: the new day may have
      // no room there, or no availability window at all. Clearing it returns
      // the task to that day's backlog rather than parking it in dead time.
      const moved = { ...item, date };
      delete moved.startMin;
      return moved;
    });
```

The existing early return already skips a same-day call, so that case keeps its minute untouched.

- [ ] **Step 4: Fix `deferOpenWork`**

`src/lib/deferWork.ts` already deletes `plannedDay` and `plannedStartMin` together for the leaves it replans (this landed in plan 1). Verify that by reading it. If it does, delete the redundant assertion from your new test and say so in your report; if it does not, make it clear all three fields via the shared helper.

- [ ] **Step 5: Run the suite and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 6: Prove the tests discriminate**

Revert the `delete moved.startMin` line; the cross-day test must fail while the same-day test still passes. Record both, then restore.

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts src/lib/deferWork.ts src/lib/deferWork.test.ts
git commit -m "fix(schedule): a move to another day drops its stale start minute"
```

---

### Task 5: Make the pre-migration snapshot recoverable

**Files:**
- Modify: `src/db/db.ts` (`exportState`, `importStateFromFile`)
- Modify: `src/db/db.test.ts`

**Interfaces:**
- Produces: `loadSlotMigrationSnapshot(): Promise<{ goals: Goal[]; tasks: Task[] } | null>`

Carried from plan 1's final review. The migration writes a `preSlotMigrationSnapshot` row before rewriting the user's scheduling — but **nothing reads it**, `exportState` does not carry it, and there is no restore path. It is a full copy of goals and tasks living inside the very database it insures against.

Minimal fix: give it a reader, and include it in the backup file so a user's export carries their pre-migration state off-device. Restoring it is a manual act via import; this plan does not add a restore button.

- [ ] **Step 1: Write the failing tests**

Append to `src/db/db.test.ts`:

```ts
it('returns null when no snapshot has been taken', async () => {
  expect(await loadSlotMigrationSnapshot()).toBeNull();
});

it('reads back a snapshot that was written', async () => {
  const goals = [{ id: 'g1', title: 'Thesis', nodes: [] }];
  const tasks = [{ id: 't1', title: 'Email', date: '2026-07-15', done: false, goalId: null }];
  await saveSlotMigrationSnapshot(goals, tasks);
  expect(await loadSlotMigrationSnapshot()).toEqual({ goals, tasks });
});

it('returns null rather than throwing on a corrupt snapshot row', async () => {
  await db.settings.put({ key: 'preSlotMigrationSnapshot', value: '{ not json' });
  expect(await loadSlotMigrationSnapshot()).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/db/db.test.ts`
Expected: FAIL — `loadSlotMigrationSnapshot` is not exported.

- [ ] **Step 3: Add the reader and carry it into the export**

In `src/db/db.ts`, beside the other slot-migration helpers:

```ts
/**
 * The pre-migration copy of goals and tasks, or null if none was taken or the
 * row is unreadable. A corrupt row must not throw: this is a recovery path,
 * and failing loudly here would block the very export that rescues the data.
 */
export async function loadSlotMigrationSnapshot(): Promise<{ goals: Goal[]; tasks: Task[] } | null> {
  const row = await db.settings.get(SLOT_SNAPSHOT_KEY);
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as { goals?: Goal[]; tasks?: Task[] };
    if (!Array.isArray(parsed.goals) || !Array.isArray(parsed.tasks)) return null;
    return { goals: parsed.goals, tasks: parsed.tasks };
  } catch {
    return null;
  }
}
```

`exportState` is synchronous and builds the backup object from arguments. Add an optional final parameter rather than making it async, and have `actions.exportBackup` load the snapshot before calling it:

```ts
export function exportState(
  state: AppState,
  pxPerDay: number,
  planReview: PlanReview | null,
  availability: AvailabilityWindow[],
  allDayBlocks: boolean,
  preSlotMigrationSnapshot?: { goals: Goal[]; tasks: Task[] } | null,
): void {
```

and inside the `backup` object literal:

```ts
    ...(preSlotMigrationSnapshot ? { preSlotMigrationSnapshot } : {}),
```

Absent when there is nothing to carry, so existing backups keep their exact shape.

- [ ] **Step 4: Have the export action supply it**

In `src/state/store.ts`, `exportBackup` currently calls `exportState(...)` directly. Make it `await loadSlotMigrationSnapshot()` first and pass the result. Import the reader alongside the other db helpers.

`importStateFromFile` must **ignore** an incoming `preSlotMigrationSnapshot` key — it is a record of a previous device's pre-migration state and must never overwrite this device's own snapshot. Add a comment saying so; the import already clears both slot-migration rows (plan 1), and that behaviour stays.

- [ ] **Step 5: Run the suite and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS, including 3 new cases.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 6: Prove the tests discriminate**

Remove the `try`/`catch` from `loadSlotMigrationSnapshot`; the corrupt-row test must fail (it will throw rather than return null). Revert and record.

- [ ] **Step 7: Commit**

```bash
git add src/db/db.ts src/db/db.test.ts src/state/store.ts
git commit -m "feat(backup): make the pre-migration snapshot readable and exportable"
```

---

## View tasks

Tasks 6–11 build React components. **`vitest` runs `environment: 'node'` — there is no DOM, so none of them can be unit-tested.** Do not add `jsdom` or a DOM environment, and do not write a component test that only asserts a mock. Their gate is `./node_modules/.bin/tsc -b` clean, the existing suite still green, and the numbered smoke checks each task lists — which **only a human can run**. No implementer may claim to have performed one.

Push any logic that *can* be tested down into `src/lib` and test it there.

Throughout tasks 6–10, `Today` and the old modal planner keep working. The flip is Task 11 alone.

### Task 6: The sidebar shell

**Files:**
- Create: `src/views/plan/PlanSidebar.tsx`
- Modify: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `SidebarPanel` and `actions.setSidebarPanels` from Task 2.
- Produces: `PlanSidebar({ children })` where `children` is the pinned backlog, plus a `SidebarSection` sub-component for the four collapsible panels.

The layout is the A2 decision from the spec: quick-add at the top, the backlog **pinned open** directly beneath it, then four one-line collapsible headers each showing a count. Nothing is hidden — folded panels still report their number, so "3 need a decision" is legible without expanding.

- [ ] **Step 1: Create `src/views/plan/PlanSidebar.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { SidebarPanel } from '../../db/db';
import { useAppStore } from '../../state/store';

/**
 * One collapsible sidebar panel.
 *
 * `count` stays visible while collapsed on purpose: the whole point of folding
 * these rather than deleting them is that the user can still see there are
 * three suggestions without giving them screen space.
 */
export function SidebarSection({
  panel, title, count, children,
}: {
  panel: SidebarPanel;
  title: string;
  count?: string;
  children: ReactNode;
}) {
  const { sidebarPanels, actions } = useAppStore();
  const open = sidebarPanels.includes(panel);

  function toggle() {
    actions.setSidebarPanels(
      open ? sidebarPanels.filter((p) => p !== panel) : [...sidebarPanels, panel],
    );
  }

  return (
    <div className="border-t border-line-soft">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-[8px] w-full text-left px-[4px] py-[8px] rounded-[8px] hover:bg-hover transition-colors"
      >
        <span
          aria-hidden="true"
          className={`text-faint text-[.6rem] flex-none transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
        <span className="font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold flex-1">
          {title}
        </span>
        {count && <span className="font-mono text-[.56rem] text-faint tabular-nums flex-none">{count}</span>}
      </button>
      {open && <div className="pb-[10px] px-[2px]">{children}</div>}
    </div>
  );
}

/**
 * The Plan view's sidebar. The backlog arrives as `children` and is pinned
 * above every collapsible panel — it is the only section the user drags from,
 * so it never competes for space with the ones they merely read.
 */
export function PlanSidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="min-w-0 flex flex-col gap-[6px]">{children}</aside>
  );
}
```

- [ ] **Step 2: Render it from `Plan.tsx`**

Replace the provisional backlog markup in `src/views/Plan.tsx` with `<PlanSidebar>`, leaving the existing provisional list inside it as its child for now — Task 7 replaces that child. Import `PlanSidebar` and keep the existing two-column grid.

- [ ] **Step 3: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS, no regressions.

- [ ] **Step 4: Smoke checklist for the human**

Record these in your report as unrun:
1. The sidebar renders left of the grid with the provisional backlog visible.
2. Nothing else on the Plan view has shifted or restyled.
3. `Today`, `Goals`, `Timeline` and the old planner (`4`) all still work.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/PlanSidebar.tsx src/views/Plan.tsx
git commit -m "feat(plan): sidebar shell with collapsible, counted panels"
```

---

### Task 7: The backlog panel

**Files:**
- Create: `src/views/plan/sidebar/Backlog.tsx`
- Modify: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `backlogGroups`, `BacklogGroup`, `BacklogItem` from Task 1; `PlanDragData` from `src/views/plan/dropTarget.ts`.
- Produces: `Backlog({ weekStart, today, onFocusItem })` — `weekStart: string`, `today: string`, and `onFocusItem: (item: BacklogItem | null) => void`, which reports the focused row so Task 10's `1`–`7` keys know what to place.

Every row is a drag source. Its payload must match `PlanDragData` exactly — `{ kind, id, goalId, title }` — because `Plan.tsx`'s `handleDragEnd` routes on `kind` and requires `goalId` for steps.

**Tasks are draggable here for the first time.** Plan 1 had a steps-only rail, so a task with no start minute had no way back onto the grid. That is the gap this closes.

- [ ] **Step 1: Create `src/views/plan/sidebar/Backlog.tsx`**

```tsx
import { useDraggable } from '@dnd-kit/core';
import type { BacklogItem } from '../../../lib/backlog';
import { backlogGroups } from '../../../lib/backlog';
import { useAppStore } from '../../../state/store';
import type { PlanDragData } from '../dropTarget';

function BacklogRow({
  item, onFocusItem,
}: {
  item: BacklogItem;
  onFocusItem: (item: BacklogItem | null) => void;
}) {
  const data: PlanDragData = {
    kind: item.kind, id: item.id, goalId: item.goalId, title: item.title,
  };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `${item.kind}:${item.id}`,
    data,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onFocus={() => onFocusItem(item)}
      onBlur={() => onFocusItem(null)}
      className={`flex items-center gap-[6px] text-[.78rem] text-ink-soft truncate px-[6px] py-[4px] mt-[3px] rounded-[6px] border border-line-2 bg-panel cursor-grab touch-none ${
        isDragging ? 'opacity-40' : 'hover:bg-hover'
      }`}
    >
      <span className="flex-1 min-w-0 truncate">{item.title}</span>
      {item.estimateMin !== undefined && (
        <span className="flex-none font-mono text-[.56rem] text-faint tabular-nums">
          {item.estimateMin}m
        </span>
      )}
    </div>
  );
}

/**
 * The pinned backlog: everything not placed on the grid, grouped by project.
 *
 * Both kinds of work are draggable. Tasks in particular are new here — the
 * earlier rail listed steps only, so an unplaced task had no route back onto
 * the grid at all.
 */
export function Backlog({
  weekStart, today, onFocusItem,
}: {
  weekStart: string;
  today: string;
  onFocusItem: (item: BacklogItem | null) => void;
}) {
  const { goals, tasks } = useAppStore();
  const groups = backlogGroups(goals, tasks, weekStart, today);
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div>
      <h3 className="flex items-baseline gap-[6px] font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold py-[6px]">
        <span className="flex-1">To plan</span>
        <span className="text-faint tabular-nums">{total}</span>
      </h3>

      {groups.length === 0 ? (
        <div className="text-faint text-[.82rem] italic px-[4px]">
          Nothing left to plan.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.goalId ?? 'loose'} className="mb-[10px]">
            <div className="flex items-baseline gap-[6px] px-[2px]">
              <span className="font-disp text-[.86rem] font-semibold flex-1 min-w-0 truncate">
                {group.goalTitle}
              </span>
              {group.goalId && (
                <span className="flex-none font-mono text-[.56rem] text-faint tabular-nums">
                  {group.pct}%
                </span>
              )}
            </div>
            {group.items.map((item) => (
              <BacklogRow key={`${item.kind}:${item.id}`} item={item} onFocusItem={onFocusItem} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
```

The per-project percentage is what folds the old `GoalsCard` away, per the spec — it earns its place on a heading that already exists rather than taking a seventh section.

- [ ] **Step 2: Wire it into `Plan.tsx`**

Replace the provisional backlog list inside `<PlanSidebar>` with `<Backlog weekStart={weekStart} today={today} onFocusItem={setFocusedItem} />`, adding `const [focusedItem, setFocusedItem] = useState<BacklogItem | null>(null);`. Task 10 consumes `focusedItem`; until then it is set and unread, so add the state in Task 10 instead if `noUnusedLocals` rejects it here — say which you did.

Delete the now-dead provisional markup and any imports it alone used (`attentionRank`, `unplannedOpenLeaves`) if nothing else in the file needs them.

- [ ] **Step 3: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS.

- [ ] **Step 4: Smoke checklist for the human**

1. The backlog lists open steps grouped by project, each heading showing a completion percentage.
2. A task with no date appears under **Loose tasks** at the bottom.
3. A task with a date but no time also appears — this is the case that was previously invisible.
4. Dragging a **task** row onto a day schedules it.
5. Dragging a **step** row still works as before.
6. Placing an item removes it from the backlog; unscheduling it with `×` returns it.
7. The count beside "To plan" matches the number of rows.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/sidebar/Backlog.tsx src/views/Plan.tsx
git commit -m "feat(plan): pinned backlog with draggable steps and tasks"
```

---

### Task 8: Relocate the four remaining panels

**Files:**
- Move: `src/views/today/HabitsCard.tsx` → `src/views/plan/sidebar/Habits.tsx`
- Move: `src/views/today/WorthConsideringCard.tsx` → `src/views/plan/sidebar/Suggestions.tsx`
- Move: `src/views/today/MiniCalendar.tsx` → `src/views/plan/sidebar/Month.tsx`
- Move: `src/views/today/QuickAdd.tsx` → `src/views/plan/sidebar/QuickAdd.tsx`
- Create: `src/views/plan/sidebar/Stats.tsx`
- Modify: `src/views/Today.tsx`, `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `SidebarSection` from Task 6.
- Produces: `Habits`, `Suggestions`, `Month`, `QuickAdd`, `Stats` under `src/views/plan/sidebar/`.

Use `git mv` so history follows the files. **`Today.tsx` must keep working** — update its imports to the new paths rather than leaving it broken; it is deleted in Task 11, not this one.

`HabitsCard` also pulls in `HabitDots`, `GripIcon` and `useReducedMotion`. Move whatever it alone uses; leave anything `TodayWorkCard` or `DailyWorkRow` still needs where it is. Check with `grep -rn "<name>" src/` before moving each.

`Stats` is new but small: it is the three figures from `Hero` — habits done today, planned steps completed this week, and the habit-hit percentage — without the greeting or date kicker, which the week header already supplies. Read `src/views/today/Hero.tsx` and lift the `stats` array and its hover legends verbatim; do not reword them.

`Suggestions` needs `DailyWorkSections`, which comes from `buildDailyWork(goals, tasks, today)` in `src/lib/dailyWork.ts`. `Plan.tsx` must compute it and pass it down, the way `Today.tsx` does today.

- [ ] **Step 1: Move the files and fix every import**

```bash
git mv src/views/today/HabitsCard.tsx src/views/plan/sidebar/Habits.tsx
git mv src/views/today/WorthConsideringCard.tsx src/views/plan/sidebar/Suggestions.tsx
git mv src/views/today/MiniCalendar.tsx src/views/plan/sidebar/Month.tsx
git mv src/views/today/QuickAdd.tsx src/views/plan/sidebar/QuickAdd.tsx
```

Each moved file goes one directory deeper, so every relative import inside it needs another `../`. Rename the exported components to match their new filenames (`HabitsCard` → `Habits`, `WorthConsideringCard` → `Suggestions`, `MiniCalendar` → `Month`) and update `Today.tsx` accordingly. Run `./node_modules/.bin/tsc -b` after this step alone — it is the fastest way to find every stale path.

- [ ] **Step 2: Create `src/views/plan/sidebar/Stats.tsx`**

Lift the three figures from `Hero`, keeping the `title` legends exactly as written:

```tsx
import { useAppStore } from '../../../state/store';
import { todayStr } from '../../../lib/dates';
import { habitHitPct } from '../../../lib/today';
import { plannedLeaves, weekOf } from '../../../lib/plan';

/**
 * The three figures the old Today hero carried. The greeting and date kicker
 * are dropped: the week header above the grid already says what day it is.
 */
export function Stats() {
  const { habits, goals } = useAppStore();
  const today = todayStr();
  const habitsDone = habits.filter((h) => h.checkins.includes(today)).length;
  const wk = plannedLeaves(goals, weekOf(today));
  const wkDone = wk.filter((l) => l.done).length;

  const stats: [string, string, string][] = [
    [`${habitsDone}/${habits.length}`, 'habits', 'Habits checked off today'],
    [`${wkDone}/${wk.length}`, 'planned this week', 'Planned steps completed this week'],
  ];
  if (habits.length > 0) {
    stats.push([
      `${habitHitPct(habits, today, 20)}%`,
      'habit hits',
      'Share of the last 20 days your habits were completed',
    ]);
  }

  return (
    <div className="flex flex-col gap-[3px]">
      {stats.map(([value, label, hint]) => (
        <span key={label} title={hint} className="flex items-baseline gap-[5px] cursor-help text-[.78rem]">
          <span className="font-semibold text-ink tabular-nums">{value}</span>
          <span className="text-muted">{label}</span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Mount all four panels in `Plan.tsx`**

Inside `<PlanSidebar>`, above the backlog, render `<QuickAdd …/>` with the local state it needs (mirror `Today.tsx`'s usage). Below the backlog:

```tsx
        <SidebarSection panel="habits" title="Habits" count={`${habitsDone}/${habits.length} today`}>
          <Habits />
        </SidebarSection>
        <SidebarSection panel="suggestions" title="Worth considering" count={String(dailyWork.suggestions.length)}>
          <Suggestions sections={dailyWork} today={today} />
        </SidebarSection>
        <SidebarSection panel="stats" title="This week">
          <Stats />
        </SidebarSection>
        <SidebarSection panel="month" title="Month">
          <Month />
        </SidebarSection>
```

Compute `dailyWork` with `useMemo(() => buildDailyWork(goals, tasks, today), [goals, tasks, today])`, matching `Today.tsx`.

- [ ] **Step 4: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS. Any test importing a moved path needs its import updated — that is expected churn, not a failure to work around.

- [ ] **Step 5: Smoke checklist for the human**

1. All four headers appear, collapsed, each with its count.
2. Expanding one persists across a reload; collapsing it persists too.
3. Habits: check one off, add one, drag to reorder — all still work inside the sidebar.
4. Quick-add creates a task, and it appears in the backlog under **Loose tasks**.
5. `Today` still renders correctly with its moved imports.

- [ ] **Step 6: Commit**

```bash
git add src/views/plan/sidebar src/views/today src/views/Today.tsx src/views/Plan.tsx
git commit -m "feat(plan): relocate habits, suggestions, stats and month into the sidebar"
```

---

### Task 9: The inline recap

**Files:**
- Create: `src/views/plan/RecapPanel.tsx`
- Modify: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `weekRecap`, `loggedTimeForWeek`, `formatLoggedMinutes` from `src/lib/plan.ts`; `actions.markWeekReviewed`.
- Produces: `RecapPanel()` — renders nothing when there is no pending unreviewed recap.

The old planner gates you behind the recap before letting you plan. The spec makes it a dismissible panel at the top of the page instead: it no longer blocks.

Lift the markup from the `RecapStep` function in `src/views/plan/PlanWeekOverlay.tsx` — it runs from its `function RecapStep(` declaration to its closing brace, roughly lines 90–194, and the file is still present until Task 11 deletes it. Copy its body across **verbatim**: the "N of M of last week's commitments are now complete" sentence, the logged-time clause, the `Done` section, the `Unfinished — decide` section and every triage control in it. Do not reword any of it — this copy is the only surviving version once the overlay is deleted.

Drop only the modal's two-button footer; a single "Done" calling `markWeekReviewed` is enough now that nothing is being gated.

- [ ] **Step 1: Create `src/views/plan/RecapPanel.tsx`**

Read `RecapStep` first and carry its structure across. The shell:

```tsx
import { useAppStore } from '../../state/store';
import { weekRecap, loggedTimeForWeek, formatLoggedMinutes } from '../../lib/plan';

/**
 * Last week's recap, inline and dismissible.
 *
 * The old planner made this a gate you passed through before you could plan.
 * It is a panel now: reviewing last week is worth prompting, not worth
 * blocking this week's planning behind.
 */
export function RecapPanel() {
  const { goals, sessions, planReview, actions } = useAppStore();
  if (!planReview || planReview.reviewed || planReview.entries.length === 0) return null;

  const r = weekRecap(planReview, goals);
  const logged = loggedTimeForWeek(sessions, planReview.week);

  return (
    <section className="mb-[14px] p-[12px] rounded-card border border-line-2 bg-panel">
      {/* RecapStep's body, copied verbatim — see this task's preamble */}
      <div className="flex items-center gap-[12px] mt-[10px] pt-[10px] border-t border-line-soft">
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => actions.markWeekReviewed()}
          className="px-[14px] py-[6px] rounded-field bg-ink text-paper text-[.82rem] font-semibold hover:bg-ink-hover"
        >
          Done
        </button>
      </div>
    </section>
  );
}
```

The guard is deliberately three conditions: an absent review, an already-reviewed one, and an empty one all mean nothing to show. `planOpeningStep` in `src/lib/plan.ts` encodes the same rule for the modal — read it and keep the two consistent.

- [ ] **Step 2: Render it at the top of the Plan view**

Place `<RecapPanel />` above the two-column grid in `Plan.tsx`, so it spans the full width and pushes the sidebar and grid down while present.

- [ ] **Step 3: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS.

- [ ] **Step 4: Smoke checklist for the human**

1. With a pending unreviewed recap, the panel appears above the grid and the grid is still fully usable behind it.
2. "Done" dismisses it, and it stays dismissed across a reload.
3. With nothing to review, no panel and no empty container renders.
4. The triage controls carried over from the modal still act on the right items.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/RecapPanel.tsx src/views/Plan.tsx
git commit -m "feat(plan): inline dismissible recap instead of a modal gate"
```

---

### Task 10: Keyboard placement

**Files:**
- Modify: `src/views/Plan.tsx`
- Modify: `src/components/ShortcutsOverlay.tsx`

**Interfaces:**
- Consumes: `resolvePlanKey`, `PlanKeyCommand` from Task 3; `onFocusItem` from Task 7.

`docs/feedback/2026-07-24-usability-experience-cs-student.md` calls the planner "a keyboard dead zone — and it's the app's whole point". This closes that.

Focus a backlog row and press `1`–`7` to schedule it on that weekday; `[` and `]` move weeks; `T` returns to today. Placement goes through the same `scheduleNode`/`scheduleTask` actions as a drop, so it snaps to the nearest fitting gap and refuses with the same explanatory toast.

- [ ] **Step 1: Add the handler to `Plan.tsx`**

```tsx
  // Keyboard placement. The aim is the start of the visible range, so the
  // store snaps to that day's earliest fitting gap — the same semantic the
  // data migration uses. Refusals surface the store's own toast.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const command = resolvePlanKey(e);
      if (!command) return;

      if (command.kind === 'week') {
        e.preventDefault();
        setWeekStart((current) => addDays(current, command.delta * 7));
        return;
      }
      if (command.kind === 'today') {
        e.preventDefault();
        setWeekStart(weekOf(todayStr()));
        return;
      }
      if (!focusedItem) return; // nothing selected — let the key fall through
      e.preventDefault();
      const date = days[command.dow];
      if (focusedItem.kind === 'task') actions.scheduleTask(focusedItem.id, date, range.startMin);
      else if (focusedItem.goalId) actions.scheduleNode(focusedItem.goalId, focusedItem.id, date, range.startMin);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedItem, days, range.startMin]);
```

`resolvePlanKey` already refuses when the event target is editable, so the quick-add box and the inline estimate fields keep their digits.

Note that `App.tsx` binds `1`–`3` to view switching on the same `window`. Read `src/App.tsx`'s key handler and confirm the ordering: while the Plan view is active with a focused backlog row, `1` must place work rather than navigate to Today. If both fire, gate the App-level handler on the Plan view not having a focused item, or call `stopPropagation`. **Describe in your report which mechanism you used and why** — a silent double-fire here would be a bad surprise.

- [ ] **Step 2: Document the keys**

Add rows to `src/components/ShortcutsOverlay.tsx` for `1`–`7` (place the focused step on that weekday), `[` / `]` (previous / next week) and `T` (back to today), matching the file's existing row format. Update the nav `title` string in `src/App.tsx` if it enumerates shortcuts.

- [ ] **Step 3: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS.

- [ ] **Step 4: Smoke checklist for the human**

1. Tab to a backlog row, press `3` → it lands on Wednesday at that day's earliest free slot.
2. Press a weekday key with a **full** day → the same refusal toast a drop gives, and nothing moves.
3. Press a weekday key for a **hatched off-day** → refused, nothing moves.
4. `[` and `]` move weeks; `T` returns to this week.
5. With focus in the quick-add box, typing `3` inserts a "3" and does not schedule anything.
6. With no backlog row focused, `1` still switches to the Today view.

- [ ] **Step 5: Commit**

```bash
git add src/views/Plan.tsx src/components/ShortcutsOverlay.tsx src/App.tsx
git commit -m "feat(plan): weekday placement and week navigation from the keyboard"
```

---

### Task 11: The flip

**Files:**
- Modify: `src/state/store.ts` (`ViewName`, initial `view`)
- Modify: `src/App.tsx`
- Modify: `src/lib/appKeyboard.ts`, `src/lib/appKeyboard.test.ts`
- Delete: `src/views/Today.tsx`, the remainder of `src/views/today/`, `src/views/plan/PlanWeekOverlay.tsx`

**Interfaces:**
- Produces: `ViewName` becomes `'plan' | 'goals' | 'timeline'`; `'today'` and the `open-plan` command are removed.

This is the commit the whole two-plan sequence has been building toward, and the one most worth keeping small and revertible.

- [ ] **Step 1: Make Plan the default view**

In `src/state/store.ts`: narrow `ViewName` to `'plan' | 'goals' | 'timeline'`, change the initial `view` to `'plan'`, and delete the `planOpen` / `planFocusGoalId` UI state along with `openPlan` / `closePlan` now that no modal consumes them. `tsc` will point at every consumer.

- [ ] **Step 2: Rewire the nav and routing**

In `src/App.tsx`: the nav array becomes `[['plan', 'Plan'], ['goals', 'Goals'], ['timeline', 'Timeline']]`; remove the "Old planner" button and the `<PlanWeekOverlay …/>` mount; make the routing render `Plan` for `view === 'plan'` and drop the `Today` branch.

Keep the `reviewWaiting` cue only if something still consumes it — the inline recap now carries that signal, so it is likely dead. Remove it if so.

- [ ] **Step 3: Free the keys**

In `src/lib/appKeyboard.ts`: remove `'view-today'` and `'open-plan'` from `AppKeyCommand`; map `1` → `view-plan`, `2` → `view-goals`, `3` → `view-timeline`; delete the `4` mapping and rename `'view-plan'`'s key from `5` to `1`.

**`1`–`3` now collide with Task 10's weekday placement on the same window.** Whatever mechanism Task 10 chose to arbitrate them must still hold with the digits reassigned — re-check it and say so.

Update `src/lib/appKeyboard.test.ts` for every changed mapping, and `src/components/ShortcutsOverlay.tsx` for the new numbering.

- [ ] **Step 4: Delete the dead views**

```bash
git rm src/views/Today.tsx src/views/plan/PlanWeekOverlay.tsx
git rm src/views/today/WeekStrip.tsx src/views/today/TodayWorkCard.tsx src/views/today/GoalsCard.tsx src/views/today/Hero.tsx
```

Then, for each remaining file in `src/views/today/`, check whether anything still imports it before deleting:

```bash
for f in src/views/today/*; do
  name=$(basename "$f" | sed 's/\..*//')
  echo "== $name: $(grep -rl "$name" src --include='*.ts' --include='*.tsx' | grep -v "^$f$" | tr '\n' ' ')"
done
```

Delete only those with no remaining importer. `PlanWeekOverlay.tsx` also owns `AvailabilitySettings`, `EstimateField`, `planner.ts` and `capacityLabel.ts` as siblings under `src/views/plan/` — **those stay**; only the overlay itself goes. If `AvailabilitySettings` had no mount outside the overlay, add it to a sidebar section rather than losing access to it, and say what you did.

- [ ] **Step 5: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output. Expect a cascade first — work through it; every error is a real reference to something deleted.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS. Tests referencing deleted components must be deleted with them; tests covering `src/lib` logic must **not** be, and any that now fail are telling you the flip changed behaviour it should not have.

- [ ] **Step 6: Smoke checklist for the human**

1. The app opens on **Plan**. The nav reads `Plan · Goals · Timeline`.
2. `1`, `2`, `3` switch views; `4` and `5` do nothing.
3. With a backlog row focused, `1`–`7` still place work rather than navigating.
4. Everything the old Today carried is reachable: habits, suggestions, stats, month, quick-add.
5. Availability is still editable.
6. Export and import a backup; goals, habits, tasks and sessions all survive.
7. Undo still works after unscheduling.
8. Nothing in `Goals` or `Timeline` regressed.

- [ ] **Step 7: Commit**

```bash
git add -u
git add src/App.tsx src/state/store.ts src/lib/appKeyboard.ts src/lib/appKeyboard.test.ts src/components/ShortcutsOverlay.tsx
git commit -m "feat(plan): make the calendar the home view and delete Today"
```

`git add -u` stages deletions of already-tracked files only and cannot pick up `src/components/GoalTree.tsx` unless it were already staged — it is not, and must not be. Verify with `git status --short` before committing that `GoalTree.tsx` still shows as unstaged `M`.

---

## Done criteria

- `./node_modules/.bin/tsc -b` clean; full suite green.
- The app opens on the calendar. Every card the old `Today` carried is reachable from the sidebar.
- Steps **and** tasks can be dragged from the backlog and placed by keyboard.
- `src/views/Today.tsx`, `src/views/today/` and `PlanWeekOverlay.tsx` are gone.
- `src/components/GoalTree.tsx` is still unstaged, uncommitted and byte-identical.

## Deliberately not in this plan

- **A restore button for the pre-migration snapshot.** Task 5 makes it readable and exports it; wiring a one-click restore is a separate decision about a destructive action.
- **Relabelling the header's capacity figure.** A deferred Minor from plan 1: "planned" counts work committed to the week including items not placed on the grid, so after a bulk defer the header can read `6h planned` above a nearly empty grid. It is not a wrong number — `plannedWeek` is this codebase's uniform definition of planned — and this plan makes the gap far less confusing by putting that unplaced work in a visible backlog beside the grid. Revisit the wording only if it still misleads once the sidebar is in use.
- **Recurring steps.** Raised in feedback, still out of scope.
- **A mobile or narrow layout.** Phase ships as a desktop Electron app.
- **Removing `plannedWeek`.** Now genuinely redundant, but its own change with its own review.
