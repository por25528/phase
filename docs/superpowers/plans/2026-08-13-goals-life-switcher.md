# Goals Life Switcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Goals board scopes to one life at a time through a tab strip, the Now cap becomes three per life, and every column claims width in proportion to what it holds.

**Architecture:** All new reasoning is pure and lives in two new `src/lib` modules (`lifeScope.ts`, `boardTracks.ts`) with sibling tests. `activeLifeId` is in-memory view state on the store beside `activeHorizon` — it never persists and never enters `AppState`. The board keeps its four horizon columns; only their widths and their membership change. Two existing ordering paths are corrected: `weaveCompleted` is renamed `weaveHidden` (it was already general), and `moveGoalRank` learns to step over goals the active scope hides.

**Tech Stack:** React 19, TypeScript, Vite, Dexie 4 (IndexedDB), Tailwind 3, dnd-kit, Vitest + @testing-library/react (jsdom).

**Spec:** [`docs/superpowers/specs/2026-08-13-goals-life-switcher-design.md`](../specs/2026-08-13-goals-life-switcher-design.md)

## Global Constraints

Copied from `CLAUDE.md` and enforced by `src/lib/designScale.test.ts`:

- No literal hex / `rgb()` / `hsl()` colours — theme tokens only. No arbitrary font sizes (`text-[1.2rem]`); named `fontSize` keys only.
- Radii: only `rounded-[4px]`, `rounded-[6px]`, `rounded-[11px]`, `rounded-field`, `rounded-card`.
- No Unicode icon glyphs. Use `src/components/Icons.tsx`.
- `font-disp` only in `App.tsx`. `uppercase` only in the three named calendar files. `border-dashed` only in `views/plan/DayColumn.tsx` and `views/plan/EventBlock.tsx` — **an empty board column is empty; it gets no dashed box.**
- A section label is `text-meta font-semibold text-muted`, sentence case.
- `.quiet-control` is the ONE hover-reveal mechanism; it needs a **literal `group` ancestor**.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`. Views stay thin and delegate to `actions`; views never call `db` directly.
- `jest-dom` is NOT installed. Plain DOM reads only (`textContent`, `getAttribute`, `querySelector`).
- Run `npm test` and `npx tsc -b` before every commit.

**Baseline before starting:** `tsc -b` clean, **150 test files, 2787 tests passing**.

**Branch:** `main` was checked out at planning time and a parallel session was editing `docs/`. **Create a branch before the first commit** — `git checkout -b goals-life-switcher` — and do not commit code to `main`.

## Scope

**In:** the Goals page — both Board and Timeline modes — plus the two pure lib modules, the two ordering fixes, and the doc amendments.

**Deliberately NOT in this plan**, so nobody builds it early:

- **No budget, no hours, no `WeekRecord`, no per-life capacity.** That is the unmerged `lives-slice-2` branch and it stays there. `weekCapacity`, `isOverCommitted`, `plannedMin` and `backlogMin` are untouched.
- **No scoping of Today, Plan, the backlog rail or the Timeline's capacity readouts.** One week, one Today, one over-commitment verdict.
- **No persistence of the scope.** No `db.ts` change, no settings row, no migration.
- **No `Goal.type` change.** A template is not an organising dimension.
- **No second life editor.** `LivesSettings` in Settings stays the only one.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/lifeScope.ts` **(new)** | The scope vocabulary: resolve, tab list, membership, Now cap, new-goal assignment |
| `src/lib/boardTracks.ts` **(new)** | One function: counts → `grid-template-columns` |
| `src/lib/board.ts` | `weaveHidden` (renamed), `rankMoveTarget` (new) |
| `src/lib/plan.ts` | `focusSummary` gains an optional limit |
| `src/state/store.ts` | `activeLifeId`, `setGoalScope`, scope-aware `moveGoalRank`, `settingsOpen` lifted from `App.tsx` |
| `src/views/goals/Goals.board.test.tsx` **(new)** | The one store-backed harness for the board — scope, geometry and header describes all share it |
| `src/components/Tabs.tsx` **(new)** | The underline tablist, extracted from `AreaPage` |
| `src/components/Icons.tsx` | `IconColumns`, `IconTimeline` |
| `src/views/goals/LifeTabs.tsx` **(new)** | The life strip, built on `Tabs` |
| `src/views/goals/Column.tsx` | Slim/populated rendering, `nowLimit` prop, hints removed |
| `src/views/Goals.tsx` | Wiring: scope, geometry, header |

---

### Task 1: The scope vocabulary

**Files:**
- Create: `src/lib/lifeScope.ts`
- Create: `src/lib/lifeScope.test.ts`

**Interfaces:**
- Consumes: `Goal`, `Life` from `src/db/types.ts`; `lifeOf`, `sortedLives` from `src/lib/lives.ts`; `NOW_WIP_LIMIT` from `src/lib/plan.ts`.
- Produces:
  ```ts
  export type LifeScope = 'all' | 'unassigned' | string;
  export interface LifeTab { scope: LifeScope; label: string }
  export function resolveScope(current: LifeScope, lives: Life[]): LifeScope;
  export function lifeTabs(lives: Life[], goals: Goal[]): LifeTab[];
  export function goalsInScope(goals: Goal[], scope: LifeScope, lives: Life[]): Goal[];
  export function nowLimit(scope: LifeScope, tabs: LifeTab[]): number;
  export function withScopeLife<T extends Goal>(goal: T, scope: LifeScope): T;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/lifeScope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Goal, Life } from '../db/types';
import {
  goalsInScope, lifeTabs, nowLimit, resolveScope, withScopeLife,
} from './lifeScope';

const life = (id: string, order: number): Life => ({ id, title: id.toUpperCase(), order });
const goal = (id: string, lifeId?: string): Goal => ({
  id, title: id, nodes: [], ...(lifeId ? { lifeId } : {}),
});
const done = (id: string, lifeId?: string): Goal => ({ ...goal(id, lifeId), completedAt: '2026-08-01' });

describe('resolveScope', () => {
  it('keeps all, unassigned and a live life id', () => {
    const lives = [life('a', 0)];
    expect(resolveScope('all', lives)).toBe('all');
    expect(resolveScope('unassigned', lives)).toBe('unassigned');
    expect(resolveScope('a', lives)).toBe('a');
  });

  it('falls back to all when the scope names a deleted life', () => {
    expect(resolveScope('gone', [life('a', 0)])).toBe('all');
    expect(resolveScope('a', [])).toBe('all');
  });
});

describe('lifeTabs', () => {
  it('is empty when no life has been named', () => {
    expect(lifeTabs([], [goal('g')])).toEqual([]);
  });

  it('leads with All, then lives in order', () => {
    const lives = [life('b', 2), life('a', 1)];
    expect(lifeTabs(lives, [goal('g', 'a')]).map((t) => t.scope)).toEqual(['all', 'a', 'b']);
  });

  it('keeps a named life that holds nothing', () => {
    const tabs = lifeTabs([life('a', 0), life('b', 1)], [goal('g', 'a')]);
    expect(tabs.map((t) => t.scope)).toEqual(['all', 'a', 'b']);
  });

  it('adds Unassigned only when a live goal is unassigned', () => {
    const lives = [life('a', 0)];
    expect(lifeTabs(lives, [goal('g', 'a')]).map((t) => t.scope)).toEqual(['all', 'a']);
    expect(lifeTabs(lives, [goal('g', 'a'), goal('loose')]).map((t) => t.scope))
      .toEqual(['all', 'a', 'unassigned']);
  });

  it('treats a dangling lifeId as unassigned, and ignores completed goals', () => {
    const lives = [life('a', 0)];
    expect(lifeTabs(lives, [goal('g', 'a'), goal('x', 'gone')]).map((t) => t.scope))
      .toEqual(['all', 'a', 'unassigned']);
    expect(lifeTabs(lives, [goal('g', 'a'), done('old')]).map((t) => t.scope))
      .toEqual(['all', 'a']);
  });

  it('labels All and Unassigned, and uses the life title otherwise', () => {
    const tabs = lifeTabs([life('a', 0)], [goal('g', 'a'), goal('loose')]);
    expect(tabs.map((t) => t.label)).toEqual(['All', 'A', 'Unassigned']);
  });
});

describe('goalsInScope', () => {
  const lives = [life('a', 0), life('b', 1)];
  const goals = [goal('g1', 'a'), goal('g2', 'b'), goal('g3'), goal('g4', 'gone')];

  it('returns everything for all', () => {
    expect(goalsInScope(goals, 'all', lives)).toBe(goals);
  });

  it('returns one life, and never a dangling member', () => {
    expect(goalsInScope(goals, 'a', lives).map((g) => g.id)).toEqual(['g1']);
  });

  it('counts a dangling lifeId as unassigned', () => {
    expect(goalsInScope(goals, 'unassigned', lives).map((g) => g.id)).toEqual(['g3', 'g4']);
  });
});

describe('nowLimit', () => {
  const tabsFor = (n: number): { scope: string; label: string }[] =>
    [{ scope: 'all', label: 'All' }, ...Array.from({ length: n }, (_, i) => ({ scope: `l${i}`, label: `L${i}` }))];

  it('is three for any single tab', () => {
    expect(nowLimit('a', tabsFor(2))).toBe(3);
    expect(nowLimit('unassigned', tabsFor(2))).toBe(3);
  });

  it('sums the caps of the tabs beside All', () => {
    expect(nowLimit('all', tabsFor(2))).toBe(6);
    expect(nowLimit('all', tabsFor(3))).toBe(9);
  });

  it('clamps to three when there are no tabs at all', () => {
    expect(nowLimit('all', [])).toBe(3);
  });
});

describe('withScopeLife', () => {
  it('stamps the scoped life onto a new goal', () => {
    expect(withScopeLife(goal('g'), 'a').lifeId).toBe('a');
  });

  it('leaves a goal unassigned under all and unassigned', () => {
    expect(withScopeLife(goal('g'), 'all').lifeId).toBeUndefined();
    expect(withScopeLife(goal('g'), 'unassigned').lifeId).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const g = goal('g');
    withScopeLife(g, 'a');
    expect(g.lifeId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/lib/lifeScope.test.ts`
Expected: FAIL — `Failed to resolve import "./lifeScope"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/lifeScope.ts`:

```ts
import type { Goal, Life } from '../db/types';
import { lifeOf, sortedLives } from './lives';
import { NOW_WIP_LIMIT } from './plan';

/**
 * Which slice of the board is on screen: every goal, one named life, or the
 * goals that belong to no life at all.
 *
 * A bare `string` is a `Life.id`. It MAY name a life that no longer exists —
 * `removeLife` can delete the one you are looking at — and `resolveScope` is
 * what turns that into `'all'` at read time, the same licence `Goal.lifeId`
 * and `Session.nodeId` already hold.
 */
export type LifeScope = 'all' | 'unassigned' | string;

export interface LifeTab {
  scope: LifeScope;
  label: string;
}

/** True when a goal belongs to no life, INCLUDING one whose life was deleted. */
function isUnassigned(goal: Goal, lives: Life[]): boolean {
  return lifeOf(goal, lives) === null;
}

export function resolveScope(current: LifeScope, lives: Life[]): LifeScope {
  if (current === 'all' || current === 'unassigned') return current;
  return lives.some((l) => l.id === current) ? current : 'all';
}

/**
 * The strip: All, then each life, then Unassigned when it holds something.
 *
 * Empty when no life has been named — a lone `All` tab is chrome that explains
 * nothing to someone who has never made a life, and `Goals.tsx` renders no
 * strip at all in that case.
 *
 * A named life is kept even when empty (you made it); the unassigned group is
 * omitted when empty (it is not a life). That asymmetry is not invented here —
 * it is the semantics slice 1 wrote down for the `groupByLife` it deliberately
 * did not build.
 *
 * Completed goals do not summon the Unassigned tab. They live in their own
 * collapsed section, and a tab that exists only to hold finished work is a tab
 * you open once.
 */
export function lifeTabs(lives: Life[], goals: Goal[]): LifeTab[] {
  if (lives.length === 0) return [];
  const tabs: LifeTab[] = [{ scope: 'all', label: 'All' }];
  for (const l of sortedLives(lives)) tabs.push({ scope: l.id, label: l.title });
  if (goals.some((g) => !g.completedAt && isUnassigned(g, lives))) {
    tabs.push({ scope: 'unassigned', label: 'Unassigned' });
  }
  return tabs;
}

/** Identity for `'all'` — the caller's array, not a copy, so memo keys hold. */
export function goalsInScope(goals: Goal[], scope: LifeScope, lives: Life[]): Goal[] {
  if (scope === 'all') return goals;
  if (scope === 'unassigned') return goals.filter((g) => isUnassigned(g, lives));
  return goals.filter((g) => lifeOf(g, lives)?.id === scope);
}

/**
 * Three per life — and for `All`, the sum of the caps of the tabs beside it.
 *
 * Stated that way so the figure on `All` is the arithmetic of the tabs you can
 * see and can be checked by eye rather than believed. It moves when you add a
 * life or empty the unassigned group, which is honest: the groups on the board
 * changed.
 *
 * The clamp is load-bearing, not defensive. `lifeTabs` returns an EMPTY array
 * when no life has been named — the common case for anyone who has not used
 * this feature — and the bare product would be `3 × -1`.
 */
export function nowLimit(scope: LifeScope, tabs: LifeTab[]): number {
  if (scope !== 'all') return NOW_WIP_LIMIT;
  return Math.max(NOW_WIP_LIMIT, NOW_WIP_LIMIT * (tabs.length - 1));
}

/**
 * A goal created on the Startup board belongs to Startup.
 *
 * Applied at the composer's callback in `Goals.tsx` rather than inside
 * `NewGoalModal`, so the modal stays a pure builder and there is one place
 * that knows what the board is currently showing.
 */
export function withScopeLife<T extends Goal>(goal: T, scope: LifeScope): T {
  if (scope === 'all' || scope === 'unassigned') return goal;
  return { ...goal, lifeId: scope };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/lifeScope.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 5: Typecheck, then commit**

```bash
npx tsc -b
git checkout -b goals-life-switcher
git add src/lib/lifeScope.ts src/lib/lifeScope.test.ts
git commit -m "feat(lib): the vocabulary for which life the board is showing"
```

---

### Task 2: Adaptive column widths

**Files:**
- Create: `src/lib/boardTracks.ts`
- Create: `src/lib/boardTracks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const COLUMN_FLOOR_PX = 200;
  export const EMPTY_TRACK_PX = 88;
  export const COLUMN_GAP_PX = 14;
  export function columnTracks(counts: number[], opts: { dragging: boolean }): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/boardTracks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  COLUMN_FLOOR_PX, COLUMN_GAP_PX, EMPTY_TRACK_PX, columnTracks,
} from './boardTracks';

const still = { dragging: false };

describe('columnTracks', () => {
  it('gives an empty column a fixed slim track', () => {
    expect(columnTracks([0, 0, 0, 5], still))
      .toBe('88px 88px 88px minmax(200px, 5fr)');
  });

  it('weights populated columns by their card count', () => {
    expect(columnTracks([2, 1, 0, 2], still))
      .toBe('minmax(200px, 2fr) minmax(200px, 1fr) 88px minmax(200px, 2fr)');
  });

  it('equalises every column while something is in the air', () => {
    expect(columnTracks([0, 0, 0, 5], { dragging: true }))
      .toBe('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)');
    expect(columnTracks([2, 1, 0, 2], { dragging: true }))
      .toBe(columnTracks([0, 0, 0, 0], { dragging: true }));
  });

  it('handles an all-empty board without collapsing it', () => {
    expect(columnTracks([0, 0, 0, 0], still)).toBe('88px 88px 88px 88px');
  });

  /*
   * The floor is the whole reason a one-card column is not crushed beside a
   * five-card one, so it is worth pinning that four of them still fit the
   * breakpoint where the wide board begins.
   */
  it('fits four populated columns inside the 920px wide-board breakpoint', () => {
    const width = 4 * COLUMN_FLOOR_PX + 3 * COLUMN_GAP_PX;
    expect(width).toBeLessThanOrEqual(920);
  });

  it('keeps the slim track wide enough for the longest horizon label', () => {
    // 'Someday' at text-ui plus its count and the column's own padding.
    expect(EMPTY_TRACK_PX).toBeGreaterThanOrEqual(88);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/lib/boardTracks.test.ts`
Expected: FAIL — `Failed to resolve import "./boardTracks"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/boardTracks.ts`:

```ts
/**
 * How wide each horizon column is, given what it holds.
 *
 * Four equal columns were the board's geometry for as long as it had one, and
 * with five goals in Someday and nothing committed that spent three quarters
 * of the width on the words "Nothing here". This is the same failure that sank
 * the budget line, recorded in `ideas/vision.md` open question 3: *each life
 * got 93px of a 307px cell while three empty horizons kept 307px each.*
 */

/**
 * The largest floor at which four populated columns still fit the 920px
 * breakpoint where the wide board begins: 4 × 200 + 3 × 14 = 842, leaving the
 * page gutter. Pinned by a test, because the relationship is the point.
 */
export const COLUMN_FLOOR_PX = 200;

/** The smallest track on which `Someday` sets on one line beside its count. */
export const EMPTY_TRACK_PX = 88;

/** The board's column gap, in the arithmetic above and in `Goals.tsx`. */
export const COLUMN_GAP_PX = 14;

/**
 * `grid-template-columns` for the board.
 *
 * **While dragging, every column is equal.** `handleDragOver` already moves ids
 * between columns live so cards part to show the drop target, so a width that
 * tracked card count would reflow continuously under the cursor — and an empty
 * Now, the single most important drop target on the board, would be the
 * narrowest thing on screen at the exact moment you need to hit it. One
 * transition at each end of the drag, not continuous reflow.
 */
export function columnTracks(counts: number[], opts: { dragging: boolean }): string {
  if (opts.dragging) return counts.map(() => 'minmax(0, 1fr)').join(' ');
  return counts
    .map((n) => (n === 0 ? `${EMPTY_TRACK_PX}px` : `minmax(${COLUMN_FLOOR_PX}px, ${n}fr)`))
    .join(' ');
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/boardTracks.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Typecheck, then commit**

```bash
npx tsc -b
git add src/lib/boardTracks.ts src/lib/boardTracks.test.ts
git commit -m "feat(lib): a column claims width in proportion to what it holds"
```

---

### Task 3: `weaveHidden`, and a rank move that steps over what it cannot see

**Files:**
- Modify: `src/lib/board.ts:55-71`
- Modify: `src/lib/board.test.ts`
- Modify: `src/state/store.ts` (the `weaveCompleted` import and call site only)

**Interfaces:**
- Consumes: `Goal` from `src/db/types.ts`.
- Produces:
  ```ts
  export function weaveHidden(goals: Goal[], columns: string[][]): string[][]; // renamed from weaveCompleted
  export function rankMoveTarget(
    list: string[], visibleIds: Set<string>, goalId: string, delta: number,
  ): number | null;
  ```

**Why this task exists:** scoping the board makes `setGoalBoard` receive one life's ids. `weaveCompleted` already re-inserts *any* absent goal at the index it held, so ordering is safe — but its name now describes one of two reasons a goal is hidden. `moveGoalRank` is genuinely broken: it builds neighbours from every active goal, so `Alt+↑` on a University card swaps it with an off-screen Startup card, the card visibly does not move, and the toast says it did.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/board.test.ts` (keep the existing file's imports and add `rankMoveTarget`, `weaveHidden` to the import from `./board`):

```ts
describe('weaveHidden', () => {
  const g = (id: string, column: number): Goal => ({ id, title: id, nodes: [], column });

  it('pins a hidden goal at the within-column index it held', () => {
    // The scoped-board case: 'a' shows University, 's' shows Startup.
    const goals = [g('s1', 3), g('u1', 3), g('s2', 3), g('u2', 3), g('u3', 3)];
    const reordered = [[], [], [], ['u3', 'u1', 'u2']];
    expect(weaveHidden(goals, reordered)[3]).toEqual(['s1', 'u3', 's2', 'u1', 'u2']);
  });

  it('is identity when nothing is hidden', () => {
    const goals = [g('a', 0), g('b', 0)];
    expect(weaveHidden(goals, [['b', 'a'], [], [], []])[0]).toEqual(['b', 'a']);
  });
});

describe('rankMoveTarget', () => {
  const visible = (...ids: string[]) => new Set(ids);

  it('steps over a hidden neighbour', () => {
    // Full column order: u1, s1, u2. University sees [u1, u2].
    const list = ['u1', 's1', 'u2'];
    // Moving u2 up lands on u1's index, not s1's.
    expect(rankMoveTarget(list, visible('u1', 'u2'), 'u2', -1)).toBe(0);
  });

  it('moves one visible slot when everything is visible', () => {
    const list = ['a', 'b', 'c'];
    expect(rankMoveTarget(list, visible('a', 'b', 'c'), 'b', -1)).toBe(0);
    expect(rankMoveTarget(list, visible('a', 'b', 'c'), 'b', 1)).toBe(2);
  });

  it('is null at both ends of the VISIBLE list, not the full one', () => {
    const list = ['s1', 'u1', 'u2', 's2'];
    const vis = visible('u1', 'u2');
    expect(rankMoveTarget(list, vis, 'u1', -1)).toBeNull();
    expect(rankMoveTarget(list, vis, 'u2', 1)).toBeNull();
  });

  it('is null for a goal that is absent or invisible', () => {
    expect(rankMoveTarget(['a', 'b'], visible('a', 'b'), 'zz', -1)).toBeNull();
    expect(rankMoveTarget(['a', 'b'], visible('a'), 'b', -1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lib/board.test.ts`
Expected: FAIL — `weaveHidden is not defined` / `rankMoveTarget is not defined`.

- [ ] **Step 3: Rename `weaveCompleted` and add `rankMoveTarget`**

In `src/lib/board.ts`, replace lines 55-71 with:

```ts
// Rebuild a full column-major id layout from an incoming (possibly PARTIAL)
// layout, re-inserting any goal absent from `columns` at the within-column
// index it holds in `goals`. Hidden projects stay pinned in place — never
// dropped or appended — so completing a project, reordering the actives, then
// reopening it preserves its horizon and position (spec §2.5).
//
// Named for the general case on purpose. It was `weaveCompleted` when
// completion was the only reason a goal could be missing; the life switcher is
// the second, and a scoped reorder relies on exactly this behaviour to leave
// the other life's ranks alone. A name that describes one of two callers is
// how the next person writes the bug this function already prevents.
export function weaveHidden(goals: Goal[], columns: string[][]): string[][] {
  const present = new Set<string>(columns.flat());
  const out = columns.map((ids) => [...ids]);
  const n = out.length;
  for (let c = 0; c < n; c++) {
    const inColumn = goals.filter((g) => Math.min(Math.max(g.column ?? 0, 0), n - 1) === c);
    inColumn.forEach((g, i) => {
      if (!present.has(g.id)) out[c].splice(Math.min(i, out[c].length), 0, g.id);
    });
  }
  return out;
}

/**
 * Where a keyboard rank move should land, counting only what the reader can see.
 *
 * `moveGoalRank` builds its neighbour list from every active goal, so under a
 * life scope `Alt+↑` swapped a card with one that is not on screen: the card
 * visibly did not move and the toast said it did. This steps by VISIBLE
 * neighbours and returns the index of that neighbour in the FULL list, so the
 * card moves exactly one visible slot and every hidden goal keeps its place.
 *
 * `null` at either end of the visible list — which the store turns into
 * `false`, which the view reads as "do not ring the card". Ringing a card for
 * a write that never happened is the bug `moveToHorizon` already guards
 * against, and it is worse here because the highlight focuses through a
 * `requestAnimationFrame`.
 */
export function rankMoveTarget(
  list: string[],
  visibleIds: Set<string>,
  goalId: string,
  delta: number,
): number | null {
  if (!visibleIds.has(goalId)) return null;
  const visible = list.filter((id) => visibleIds.has(id));
  const from = visible.indexOf(goalId);
  if (from === -1) return null;
  const to = from + delta;
  if (to < 0 || to >= visible.length) return null;
  const target = list.indexOf(visible[to]);
  return target === -1 ? null : target;
}
```

- [ ] **Step 4: Update the one call site**

In `src/state/store.ts`, change the import of `weaveCompleted` from `../lib/board` to `weaveHidden`, and in `setGoalBoard` (around line 1409) change:

```ts
    const woven = weaveCompleted(state.goals, columns);
```

to:

```ts
    const woven = weaveHidden(state.goals, columns);
```

Then update the comment above it, replacing "Weave completed projects (hidden from the board, so absent from `columns`)" with "Weave hidden projects — completed, or outside the active life scope — back into their column at the position they held".

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run src/lib/board.test.ts src/state/store.test.ts && npx tsc -b`
Expected: PASS. `tsc -b` clean — if it reports `weaveCompleted` anywhere else, rename that reference too.

- [ ] **Step 6: Commit**

```bash
git add src/lib/board.ts src/lib/board.test.ts src/state/store.ts
git commit -m "feat(lib): a rank move steps over the cards it is not showing"
```

---

### Task 4: The scope on the store

**Files:**
- Modify: `src/state/store.ts` (UIState declaration ~line 178, defaults ~line 231, `moveGoalRank` ~line 1484, new action near `setActiveHorizon` ~line 2665)
- Modify: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `LifeScope`, `resolveScope`, `goalsInScope` from `src/lib/lifeScope.ts`; `rankMoveTarget` from `src/lib/board.ts`.
- Produces: `state.activeLifeId: LifeScope`; `actions.setGoalScope(scope: LifeScope): void`; `moveGoalRank` unchanged in signature, scope-aware in behaviour.

- [ ] **Step 1: Write the failing test**

Append to `src/state/store.test.ts`. It already has the `freshStore()` helper at
line 66, returning `{ actions, getState }`. Add `resolveScope` to the imports:

```ts
import { resolveScope } from '../lib/lifeScope';
```

```ts
describe('goal scope', () => {
  it('starts at all on every boot, because it is never persisted', async () => {
    const s = await freshStore();
    expect(s.getState().activeLifeId).toBe('all');
    // No settings row backs it — `db.ts` is untouched by this feature, so a
    // second boot cannot restore a scope. Asserted as the absence of a saver:
    // if one is ever added, this line is where the decision gets re-argued.
    expect('saveGoalScope' in (await import('../db/db'))).toBe(false);
  });

  it('falls back to all when the active life is deleted', async () => {
    const s = await freshStore();
    s.actions.addLife('Uni');
    const id = s.getState().lives[0].id;
    s.actions.setGoalScope(id);
    expect(s.getState().activeLifeId).toBe(id);
    s.actions.removeLife(id);
    expect(resolveScope(s.getState().activeLifeId, s.getState().lives)).toBe('all');
  });

  it('ranks over the visible cards only', async () => {
    const s = await freshStore();
    s.actions.addLife('Uni');
    const uni = s.getState().lives[0].id;
    // Column 0, in order: s1 (unassigned), u1, u2.
    s.actions.addGoals([
      { id: 's1', title: 's1', nodes: [], column: 0 },
      { id: 'u1', title: 'u1', nodes: [], column: 0, lifeId: uni },
      { id: 'u2', title: 'u2', nodes: [], column: 0, lifeId: uni },
    ]);
    s.actions.setGoalScope(uni);
    expect(s.actions.moveGoalRank('u2', -1)).toBe(true);
    const order = s.getState().goals.filter((g) => g.column === 0).map((g) => g.id);
    // u2 took u1's slot; s1 kept the position it held.
    expect(order).toEqual(['s1', 'u2', 'u1']);
    // u2 is now first among the VISIBLE cards, so it refuses to go further.
    expect(s.actions.moveGoalRank('u2', -1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/state/store.test.ts -t "goal scope"`
Expected: FAIL — `activeLifeId` is undefined / `setGoalScope is not a function`.

- [ ] **Step 3: Add the state field**

In `src/state/store.ts`, after the `activeHorizon` line in the UIState interface (~line 178), add:

```ts
  /**
   * Which life the Goals board is showing. In-memory only — no settings row,
   * no `ifOwner` write, and every load starts at `'all'`.
   *
   * It is `activeHorizon`, not `goalsMode`. A switcher is a mode, and the
   * failure `ideas/vision.md` D-7 named was *a mode to be lost in* — a danger
   * in proportion to how long you can sit in one without having chosen it. A
   * scope you picked this session is one you remember picking; a scope
   * restored silently from a fortnight ago is one you can mistake for the
   * whole board, and the mistake it produces is believing you have no startup
   * work.
   */
  activeLifeId: LifeScope;
```

Add to the defaults (~line 231, beside `activeHorizon: 0`):

```ts
  activeLifeId: 'all',
```

Add the import at the top of the file:

```ts
import { goalsInScope, resolveScope, type LifeScope } from '../lib/lifeScope';
```

- [ ] **Step 4: Add the action**

In `src/state/store.ts`, immediately after `setActiveHorizon` (~line 2669), add:

```ts
  setGoalScope(scope: LifeScope): void {
    const next = resolveScope(scope, state.lives);
    if (next === state.activeLifeId) return;
    set({ activeLifeId: next });
  },
```

- [ ] **Step 5: Make `moveGoalRank` scope-aware**

In `src/state/store.ts`, replace the body of `moveGoalRank` between the `cols` build and the `setGoalBoard` call. The existing lines:

```ts
    const list = cols[col];
    const from = list.indexOf(goalId);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= list.length) return false;
    list.splice(to, 0, ...list.splice(from, 1));
```

become:

```ts
    const list = cols[col];
    /*
     * Neighbours are what the reader can SEE.
     *
     * This used to step through every active goal, so under a life scope
     * `Alt+↑` swapped the card with one that is not on screen — the card
     * visibly did not move, and the toast said it did. `rankMoveTarget`
     * returns the full-list index of the neighbouring VISIBLE card, so every
     * hidden goal keeps its place and the move is exactly one slot.
     */
    const scope = resolveScope(state.activeLifeId, state.lives);
    const visibleIds = new Set(goalsInScope(state.goals, scope, state.lives).map((g) => g.id));
    const from = list.indexOf(goalId);
    const to = rankMoveTarget(list, visibleIds, goalId, delta);
    if (from === -1 || to === null) return false;
    list.splice(to, 0, ...list.splice(from, 1));
```

Add `rankMoveTarget` to the existing `../lib/board` import.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/state/store.test.ts && npx tsc -b`
Expected: PASS, `tsc -b` clean.

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(store): the board remembers which life it is showing, for this session"
```

---

### Task 5: A scoped Now cap reaches the two things that print it

**Files:**
- Modify: `src/lib/plan.ts:328` (`focusSummary` signature and the `slots` return)
- Modify: `src/lib/plan.test.ts`
- Modify: `src/views/goals/Column.tsx`

**Interfaces:**
- Consumes: `NOW_WIP_LIMIT` from `src/lib/plan.ts`.
- Produces: `focusSummary(goals: Goal[], today: string, limit?: number): FocusSummary`; `Column` gains a required `nowLimit: number` prop.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/plan.test.ts`:

```ts
describe('focusSummary limit', () => {
  const now = (id: string): Goal => ({ id, title: id, nodes: [], column: 0 });

  it('defaults to the three-slot cap', () => {
    expect(focusSummary([now('a')], '2026-08-13').slots.limit).toBe(3);
  });

  it('reports the scoped cap it is given', () => {
    expect(focusSummary([now('a')], '2026-08-13', 6).slots.limit).toBe(6);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/lib/plan.test.ts -t "focusSummary limit"`
Expected: FAIL — `limit` is 3 when 6 was asked for.

- [ ] **Step 3: Thread the limit through**

In `src/lib/plan.ts`, change the signature at line 328:

```ts
export function focusSummary(goals: Goal[], today: string, limit: number = NOW_WIP_LIMIT): FocusSummary {
```

and the `slots` line in the return object:

```ts
    slots: { used: slots.length, limit, goalIds: slots },
```

- [ ] **Step 4: Give `Column` the limit as a prop**

In `src/views/goals/Column.tsx`, remove the `NOW_WIP_LIMIT` import, add `nowLimit: number` to the props type and destructuring, and replace the two uses:

```ts
  const over = isNow && ids.length > nowLimit;
```

```tsx
          {isNow ? `${ids.length} / ${nowLimit}` : ids.length}
```

The `import { NOW_WIP_LIMIT } from '../../lib/plan';` line is deleted — the column no longer knows what the cap is, only what it was told, which is what lets it print `2 / 6` on All and `2 / 3` on a life.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/lib/plan.test.ts && npx tsc -b`
Expected: `plan.test.ts` PASSES. `tsc -b` **fails** in `Goals.tsx` with "Property 'nowLimit' is missing" — that is expected and Task 7 supplies it. To keep this commit green, pass the default through now in `src/views/Goals.tsx` at the `<Column …>` call site:

```tsx
              <Column key={col.id} col={col} index={i} ids={columns[i] ?? []} solo={!wide} nowLimit={summary.slots.limit}>
```

Re-run: `npx tsc -b` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/plan.ts src/lib/plan.test.ts src/views/goals/Column.tsx src/views/Goals.tsx
git commit -m "feat(board): the Now cap is told to the column rather than assumed"
```

---

### Task 6: The tab strip

**Files:**
- Create: `src/components/Tabs.tsx`
- Create: `src/views/goals/LifeTabs.tsx`
- Create: `src/views/goals/LifeTabs.test.tsx`

**Interfaces:**
- Consumes: `LifeTab`, `LifeScope` from `src/lib/lifeScope.ts`.
- Produces:
  ```ts
  // components/Tabs.tsx
  export interface TabItem<T extends string> { value: T; label: string }
  export function Tabs<T extends string>(props: {
    label: string; value: T; items: readonly TabItem<T>[];
    onChange: (next: T) => void; idPrefix: string; controls: string;
  }): JSX.Element;

  // views/goals/LifeTabs.tsx
  export function LifeTabs(props: {
    tabs: LifeTab[]; scope: LifeScope; onChange: (scope: LifeScope) => void;
  }): JSX.Element | null;
  ```

**Why a shared component:** `AreaPage.tsx` already implements this exact tablist — `role="tablist"`, roving `tabIndex`, Arrow/Home/End, `border-accent` on the selected tab. This would be the third hand-rolled copy. `SegmentedControl`'s own header records what happened the last time four of these grew independently and no two agreed on what "selected" looks like.

- [ ] **Step 1: Write the failing test**

Create `src/views/goals/LifeTabs.test.tsx`. **The `// @vitest-environment jsdom`
pragma on line 1 is mandatory** — `vitest.config.ts` sets `environment: 'node'`
and every component test in this repo opts in per file. `LifeTabs` is pure
presentation, so it needs no db mocks and no store boot:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LifeTabs } from './LifeTabs';
import type { LifeTab } from '../../lib/lifeScope';

const TABS: LifeTab[] = [
  { scope: 'all', label: 'All' },
  { scope: 'uni', label: 'University' },
  { scope: 'startup', label: 'Startup' },
];

afterEach(cleanup);

describe('LifeTabs', () => {
  it('renders nothing when no life has been named', () => {
    const { container } = render(<LifeTabs tabs={[]} scope="all" onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('marks exactly the active tab selected', () => {
    render(<LifeTabs tabs={TABS} scope="uni" onChange={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  });

  it('reports the scope it was clicked on', async () => {
    const onChange = vi.fn();
    render(<LifeTabs tabs={TABS} scope="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Startup' }));
    expect(onChange).toHaveBeenCalledWith('startup');
  });

  it('keeps one tab stop and moves with the arrow keys', async () => {
    const onChange = vi.fn();
    render(<LifeTabs tabs={TABS} scope="all" onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    tabs[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('uni');
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenCalledWith('startup');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/views/goals/LifeTabs.test.tsx`
Expected: FAIL — `Failed to resolve import "./LifeTabs"`.

- [ ] **Step 3: Write the shared `Tabs`**

Create `src/components/Tabs.tsx`:

```tsx
import { useRef } from 'react';

/**
 * The underline tablist — one primary axis across a page.
 *
 * Extracted from `views/project/AreaPage.tsx`, which grew it first and is
 * welcome to adopt this. It is NOT `SegmentedControl`: that is a compact pill
 * for a view toggle sitting in a toolbar, and this is the axis a page is
 * organised by. Two shapes, two altitudes — but only one of each, which is the
 * lesson `SegmentedControl`'s own header records.
 *
 * Roving `tabIndex` per the ARIA tabs pattern: one tab stop for the strip,
 * arrows to move within it.
 */

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

export function Tabs<T extends string>({
  label,
  value,
  items,
  onChange,
  idPrefix,
  controls,
}: {
  /** Names the strip for assistive tech. */
  label: string;
  value: T;
  items: readonly TabItem<T>[];
  onChange: (next: T) => void;
  /** Prefix for each tab's DOM id, so `aria-labelledby` can point at one. */
  idPrefix: string;
  /** The id of the panel this strip drives. */
  controls: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const index = items.findIndex((t) => t.value === value);

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex items-center gap-[2px] border-b border-line"
      onKeyDown={(e) => {
        let next: number | null = null;
        if (e.key === 'ArrowRight') next = (index + 1) % items.length;
        if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = items.length - 1;
        if (next === null || items.length === 0) return;
        e.preventDefault();
        const target = items[next];
        onChange(target.value);
        refs.current[target.value]?.focus();
      }}
    >
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          id={`${idPrefix}-${t.value}`}
          role="tab"
          aria-selected={t.value === value}
          aria-controls={controls}
          tabIndex={t.value === value ? 0 : -1}
          ref={(el) => { refs.current[t.value] = el; }}
          onClick={() => onChange(t.value)}
          className={`text-ui px-[12px] py-[6px] -mb-px border-b-2 max-w-[180px] truncate ${
            t.value === value
              ? 'text-ink font-semibold border-accent'
              : 'text-muted font-medium border-transparent hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write `LifeTabs`**

Create `src/views/goals/LifeTabs.tsx`:

```tsx
import { Tabs } from '../../components/Tabs';
import type { LifeScope, LifeTab } from '../../lib/lifeScope';

/**
 * Which life the board is showing.
 *
 * Renders NOTHING when no life has been named. A lone `All` tab is chrome that
 * explains nothing to someone who has never made a life, and the route in is
 * the header's ⋯ → Manage lives.
 *
 * `max-w-[180px] truncate` on the tab itself, in `Tabs`: a life named
 * "Undergraduate Research Assistantship" must not blow out the strip. `title`
 * carries the whole name for the pointer.
 */
export function LifeTabs({
  tabs,
  scope,
  onChange,
}: {
  tabs: LifeTab[];
  scope: LifeScope;
  onChange: (scope: LifeScope) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <Tabs
      label="Show life"
      value={scope}
      items={tabs.map((t) => ({ value: t.scope, label: t.label }))}
      onChange={onChange}
      idPrefix="life-tab"
      controls="goalsBoard"
    />
  );
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run src/views/goals/LifeTabs.test.tsx && npx tsc -b`
Expected: PASS — 4 tests. `tsc -b` clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/Tabs.tsx src/views/goals/LifeTabs.tsx src/views/goals/LifeTabs.test.tsx
git commit -m "feat(goals): a strip that says which life the board is showing"
```

---

### Task 7: Scope the board

**Files:**
- Modify: `src/views/Goals.tsx`
- Create: `src/views/goals/Goals.board.test.tsx`

**Interfaces:**
- Consumes: `goalsInScope`, `lifeTabs`, `nowLimit`, `resolveScope`, `withScopeLife` from `src/lib/lifeScope.ts`; `LifeTabs` from `./goals/LifeTabs`; `state.activeLifeId` and `actions.setGoalScope` from the store.
- Produces: a board that renders only in-scope goals, with `id="goalsBoard"` on the board container so the tab strip's `aria-controls` resolves. **Also produces the shared test harness `mountBoard()` that Tasks 8 and 9 append their describes to.**

**Read this before writing the test.** `Goals` reads `useAppStore()` directly, and **no test in this repo renders it yet** — this is the first. Store-backed component tests here follow a fixed harness (see `src/views/project/Project.progress.test.tsx:1-95`), and none of it is optional:

- `// @vitest-environment jsdom` on line 1. `vitest.config.ts` sets `environment: 'node'`; without the pragma there is no DOM at all.
- A `vi.hoisted` block of db mocks plus `vi.mock('../../db/db', …)` and `vi.mock('../../lib/tabLock', …)`. The store boots against the database on import.
- A `window.matchMedia` stub. jsdom does not implement it, and `Goals.tsx` calls it **unguarded** at render for `prefers-reduced-motion` — without the stub the component throws before it renders anything. `matches: true` also puts the board in its wide four-column layout, which is the one these tests are about.
- `vi.resetModules()` + a dynamic `await import('../../state/store')` per test, because the store is a module singleton and state would otherwise leak between tests.
- A `Host` component that calls `store.useAppStore()`, so tab clicks re-render.

- [ ] **Step 1: Write the failing test**

Create `src/views/goals/Goals.board.test.tsx`:

```tsx
// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Goal, Life } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[]; lives: Life[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [], lives: [],
  })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async () => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
  isCheckpointMigrationDone: vi.fn(async () => true),
  saveCheckpointMigrationSnapshot: vi.fn(async () => {}),
  loadCheckpointMigrationSnapshot: vi.fn(async () => null),
  markCheckpointMigrationDone: vi.fn(async () => {}),
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
}));
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  // jsdom implements neither. `Goals.tsx` calls matchMedia UNGUARDED at render
  // for prefers-reduced-motion, so without this the component throws; `matches:
  // true` also selects the wide four-column board, which is the one under test.
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

type Store = typeof import('../../state/store');

/**
 * Boot a fresh store holding `goals` and `lives`, and render the board.
 *
 * Lives are seeded through `loadState` rather than `addLife` so their ids are
 * predictable — the tests below name them 'uni' and 'startup'.
 */
async function mountBoard(goals: Goal[], lives: Life[] = []): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(goals), habits: [], tasks: [], sessions: [], lives: structuredClone(lives),
  });
  const store = await import('../../state/store');
  const { Goals } = await import('../Goals');
  const Host = () => { store.useAppStore(); return createElement(Goals); };
  await act(async () => { render(createElement(Host)); });
  return store;
}

const UNI: Life = { id: 'uni', title: 'University', order: 0 };
const STARTUP: Life = { id: 'startup', title: 'Startup', order: 1 };

const TWO_LIVES: Goal[] = [
  { id: 'u1', title: 'Pset 6', nodes: [], column: 0, lifeId: 'uni' },
  { id: 's1', title: 'Raise seed', nodes: [], column: 0, lifeId: 'startup' },
  { id: 'x1', title: 'Renew passport', nodes: [], column: 0 },
];

describe('Goals scoping', () => {
  it('shows every life under All, and one life once scoped', async () => {
    const store = await mountBoard(TWO_LIVES, [UNI, STARTUP]);
    expect(screen.getByText('Pset 6')).toBeTruthy();
    expect(screen.getByText('Raise seed')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Startup' }));
    expect(screen.queryByText('Pset 6')).toBeNull();
    expect(screen.getByText('Raise seed')).toBeTruthy();
    expect(store.useAppStore.getState().activeLifeId).toBe('startup');
  });

  it('offers Unassigned only while a loose goal is live', async () => {
    await mountBoard(TWO_LIVES, [UNI, STARTUP]);
    await userEvent.click(screen.getByRole('tab', { name: 'Unassigned' }));
    expect(screen.getByText('Renew passport')).toBeTruthy();
    expect(screen.queryByText('Pset 6')).toBeNull();
  });

  it('drops the Unassigned tab when nothing is loose', async () => {
    await mountBoard(TWO_LIVES.slice(0, 2), [UNI, STARTUP]);
    expect(screen.queryByRole('tab', { name: 'Unassigned' })).toBeNull();
  });

  it('renders no strip at all when no life has been named', async () => {
    await mountBoard([{ id: 'a', title: 'A', nodes: [], column: 0 }]);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('prints the summed cap on All and three on a life', async () => {
    await mountBoard(TWO_LIVES, [UNI, STARTUP]);
    // All: three tabs beside it (University, Startup, Unassigned) → 9.
    expect(screen.getByText('3 / 9')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'University' }));
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('says the scope is empty rather than offering onboarding', async () => {
    await mountBoard([{ id: 'u1', title: 'Pset 6', nodes: [], column: 0, lifeId: 'uni' }], [UNI, STARTUP]);
    await userEvent.click(screen.getByRole('tab', { name: 'Startup' }));
    expect(screen.getByText(/No goals in Startup yet/)).toBeTruthy();
    expect(screen.queryByText('Load example')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/views/goals/Goals.board.test.tsx`
Expected: FAIL — no `tab` role on the page. If it instead fails with `matchMedia is not a function` or `document is not defined`, the pragma or the `beforeAll` stub is missing.

- [ ] **Step 3: Derive the scope in `Goals.tsx`**

Add the imports:

```ts
import { LifeTabs } from './goals/LifeTabs';
import { goalsInScope, lifeTabs, nowLimit, resolveScope, withScopeLife } from '../lib/lifeScope';
```

Add `activeLifeId` to the store destructure at line 42:

```ts
  const { goals, lives, activeLifeId, dateReviewDismissed, activeHorizon, goalsMode, goalModal, actions } = useAppStore();
```

Immediately after `const goalById = …` (line 68), insert the scope derivation and replace the `active`/`unconfirmed`/`completed` memos so every one of them reads the SCOPED list:

```ts
  // The scope, and the goals it admits. Resolved rather than read: `removeLife`
  // can delete the life we are looking at, and an unknown id is 'all'.
  const scope = useMemo(() => resolveScope(activeLifeId, lives), [activeLifeId, lives]);
  const tabs = useMemo(() => lifeTabs(lives, goals), [lives, goals]);
  const scoped = useMemo(() => goalsInScope(goals, scope, lives), [goals, scope, lives]);
  const scopeLabel = tabs.find((t) => t.scope === scope)?.label ?? 'All';

  const active = useMemo(() => scoped.filter((g) => !g.completedAt), [scoped]);
  const unconfirmed = useMemo(() => active.filter(needsDateConfirmation), [active]);
  const confirmableCount = useMemo(() => confirmableDateGoalIds(active).length, [active]);
  const completed = useMemo(
    () => scoped.filter((g) => g.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [scoped],
  );
```

`goalById` stays built from the FULL `goals` array — the drag overlay and `moveToHorizon` look up by id and must still resolve a card mid-transition.

- [ ] **Step 4: Scope the summary and the two empty states**

Replace the `summary` memo (line 164):

```ts
  const summary = useMemo(
    () => focusSummary(scoped, currentDate, nowLimit(scope, tabs)),
    [scoped, currentDate, scope, tabs],
  );
```

Replace `const isEmpty = goals.length === 0;` (line 159) with the two distinct states:

```ts
  // Two different nothings. `isEmpty` is "you have never made a goal" and earns
  // the onboarding block; `scopeEmpty` is "this life holds nothing", which must
  // NOT offer Load example — the example lands in a life you are not looking at.
  const isEmpty = goals.length === 0;
  const scopeEmpty = !isEmpty && active.length === 0 && completed.length === 0;
```

Add the scoped-empty block immediately after the existing `{isEmpty && (…)}` block:

```tsx
      {scopeEmpty && (
        <div className="mt-[18px] grid place-items-center py-[36px] px-[20px] text-center">
          <p className="text-ink-soft text-lead max-w-[420px] mb-[14px] leading-[1.6]">
            No goals in {scopeLabel} yet.
          </p>
          <button
            className="text-body font-semibold text-paper bg-ink px-[14px] py-[8px] rounded-field hover:bg-ink-hover"
            onClick={() => setModal('new')}
          >
            + New goal
          </button>
        </div>
      )}
```

- [ ] **Step 5: Render the strip, and gate the board on both empties**

Directly under the header block (after the closing `</div>` of the header flex row, before `{timeline ? (`), add:

```tsx
      {tabs.length > 0 && (
        <div className="mt-[12px]">
          <LifeTabs tabs={tabs} scope={scope} onChange={actions.setGoalScope} />
        </div>
      )}
```

Change every `{!isEmpty && (` guard on the focus summary, the narrow horizon switcher and the board to `{!isEmpty && !scopeEmpty && (`, and give the board's grid container the id the strip points at:

```tsx
          <div
            id="goalsBoard"
            className={`mt-[20px] items-start pb-[8px] ${
              wide ? 'grid gap-[14px] xl:gap-[18px]' : 'flex gap-[18px]'
            }`}
          >
```

(The `grid-cols-4` class is gone — Task 8 supplies the template.)

Pass the scoped cap to each column:

```tsx
              <Column key={col.id} col={col} index={i} ids={columns[i] ?? []} solo={!wide} nowLimit={summary.slots.limit}>
```

- [ ] **Step 6: Assign the scope to a new goal**

In the `NewGoalModal` `onAdd` callback (line 509), wrap the goal:

```tsx
        onAdd={(goal) => {
          // Created on the Startup board ⇒ belongs to Startup. A goal that
          // landed in another life would be a lie told by the only surface
          // that knows which board you were standing on.
          const placed = withScopeLife(goal, scope);
          actions.addGoals([placed]);
          setModal(null);
          actions.openProject(placed.id);
        }}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run src/views/goals/Goals.board.test.tsx && npx tsc -b`
Expected: PASS — 6 tests. `tsc -b` clean.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: all green. If an existing test asserts a four-column grid class on the board, update it — Task 8 removes that class for good.

- [ ] **Step 9: Commit**

```bash
git add src/views/Goals.tsx src/views/goals/Goals.board.test.tsx
git commit -m "feat(goals): the board, its signals and its empties all answer to one life"
```

---

### Task 8: Adaptive geometry on the board

**Files:**
- Modify: `src/views/Goals.tsx`
- Modify: `src/views/goals/Column.tsx`
- Modify: `src/views/goals/Goals.board.test.tsx` (append; the harness is Task 7's)

**Interfaces:**
- Consumes: `columnTracks`, `COLUMN_GAP_PX` from `src/lib/boardTracks.ts`; `rectSortingStrategy` from `@dnd-kit/sortable`; `mountBoard` from Task 7's harness.
- Produces: `Column` gains `slim?: boolean`.

- [ ] **Step 1: Write the failing test**

Append to `src/views/goals/Goals.board.test.tsx` — it already carries the jsdom pragma, the db mocks and the `matchMedia` stub that puts the board in its wide layout:

```tsx
describe('board geometry', () => {
  it('gives the loaded column the width and slims the empty ones', async () => {
    await mountBoard([
      { id: 'a', title: 'A', nodes: [], column: 3 },
      { id: 'b', title: 'B', nodes: [], column: 3 },
    ]);
    const board = document.getElementById('goalsBoard') as HTMLElement;
    expect(board.style.gridTemplateColumns).toBe('88px 88px 88px minmax(200px, 2fr)');
  });

  it('weights two loaded columns against each other', async () => {
    await mountBoard([
      { id: 'a', title: 'A', nodes: [], column: 0 },
      { id: 'b', title: 'B', nodes: [], column: 3 },
      { id: 'c', title: 'C', nodes: [], column: 3 },
    ]);
    const board = document.getElementById('goalsBoard') as HTMLElement;
    expect(board.style.gridTemplateColumns)
      .toBe('minmax(200px, 1fr) 88px 88px minmax(200px, 2fr)');
  });

  it('draws no dashed border on an empty column', async () => {
    await mountBoard([{ id: 'a', title: 'A', nodes: [], column: 0 }]);
    expect(document.querySelector('.border-dashed')).toBeNull();
  });

  it('says nothing in a slim column — the label and the count are the whole story', async () => {
    await mountBoard([{ id: 'a', title: 'A', nodes: [], column: 0 }]);
    // Now holds the card; the other three are slim and must not each repeat it.
    expect(screen.queryAllByText('Nothing here')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/views/goals/Goals.board.test.tsx -t "board geometry"`
Expected: FAIL — `gridTemplateColumns` is empty.

- [ ] **Step 3: Apply the tracks**

In `src/views/Goals.tsx`, add the import:

```ts
import { columnTracks } from '../lib/boardTracks';
```

Compute the template beside the other derivations:

```ts
  // Widths follow what each column holds — except while something is in the
  // air, when they all equalise so an empty Now is a full-size drop target and
  // nothing moves under the cursor. See lib/boardTracks.ts.
  const gridTemplateColumns = useMemo(
    () => columnTracks(columns.map((c) => c.length), { dragging: activeId !== null }),
    [columns, activeId],
  );
```

Apply it to the board container, and give it the width transition:

```tsx
          <div
            id="goalsBoard"
            className={`mt-[20px] items-start pb-[8px] ${
              wide ? 'grid gap-[14px] xl:gap-[18px]' : 'flex gap-[18px]'
            } ${wide && !reducedMotion ? 'transition-[grid-template-columns] duration-150' : ''}`}
            style={wide ? { gridTemplateColumns } : undefined}
          >
```

- [ ] **Step 4: Let a wide column flow its cards, and switch strategy**

In `src/views/goals/Column.tsx`, change the sortable import:

```ts
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
```

and the `strategy` prop:

```tsx
      <SortableContext items={ids} strategy={rectSortingStrategy}>
```

`rectSortingStrategy` handles a single file and a wrapped grid alike, so there is no branch on how wide the column happens to be.

Change the card container so a wide column lays its cards out in more than one file:

```tsx
        <div
          ref={setNodeRef}
          className={`grid gap-[11px] min-h-[140px] rounded-card p-[6px] -m-[6px] transition-colors ${
            isOver ? 'bg-hover' : ''
          }`}
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(188px, 1fr))' }}
        >
```

`188px` is the card floor inside a 200px column track less its 6px padding on each side. This is the `repeat(auto-fill, minmax(…))` pattern `CompletedSection` already uses at the bottom of this same view.

- [ ] **Step 5: Give a slim column its quiet face**

In `src/views/goals/Column.tsx`, add `slim?: boolean` to the props type and destructuring, delete the `HINTS` constant and the `{hint && …}` block entirely, and make the empty message defer to `slim`:

```tsx
          {ids.length === 0 && !slim && (
            <p className="min-h-[80px] pt-[10px] text-faint text-meta text-center px-[10px]">
              Nothing here
            </p>
          )}
```

The two hints — *"Quiet by design — schedule pressure is hidden off Now / Next."* and *"Ideas — no 'define a task' nag until you commit them."* — are first-run explanation that rendered on every visit forever. The behaviour they describe is unchanged and still correct; it simply stops narrating itself. The header paragraph above them already follows a `goals.length <= 1` rule for exactly this reason.

In `src/views/Goals.tsx`, pass it:

```tsx
              <Column key={col.id} col={col} index={i} ids={columns[i] ?? []} solo={!wide} slim={wide && (columns[i] ?? []).length === 0} nowLimit={summary.slots.limit}>
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/views/goals/Goals.board.test.tsx && npx tsc -b`
Expected: PASS — 10 tests. `tsc -b` clean.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all green, including `designScale.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/views/Goals.tsx src/views/goals/Column.tsx src/views/goals/Goals.board.test.tsx
git commit -m "feat(board): a column claims the width its cards need, and yields it to a drag"
```

---

### Task 9: The header stops repeating itself

**Files:**
- Modify: `src/components/Icons.tsx`
- Modify: `src/state/store.ts` (settings modal state — see Step 0)
- Modify: `src/App.tsx:100,560`
- Modify: `src/views/Goals.tsx`
- Modify: `src/views/goals/Goals.board.test.tsx` (append)

**Interfaces:**
- Consumes: `Popover`, `PopoverItem` from `src/components/Popover.tsx`; `IconDots` from `src/components/Icons.tsx`; `mountBoard` from Task 7's harness.
- Produces: `IconColumns`, `IconTimeline` from `src/components/Icons.tsx`; `state.settingsOpen` and `actions.openSettings()` / `actions.closeSettings()` on the store.

- [ ] **Step 0: Lift the Settings modal into the store**

The `⋯` menu's **Manage lives** must open Settings, and today `settingsOpen` is
local `useState` in `App.tsx:100` with its only other use at `App.tsx:560`. A
page cannot reach it.

This is the same problem `goalModal` already solved, and `Goals.tsx:43` records
the answer: *"Which composer is up lives in the store: ⌘K can ask for one from
anywhere, and a modal only its own page can open is one the palette has to lie
about."* Follow it rather than drilling a prop.

In `src/state/store.ts`, add to the UIState interface beside `goalModal`:

```ts
  settingsOpen: boolean;              // the Settings dialog — in the store so any surface can open it
```

Add `settingsOpen: false,` to the defaults beside `goalModal: null,`. Add the
two actions beside `setGoalModal`:

```ts
  openSettings(): void { set({ settingsOpen: true }); },
  closeSettings(): void { set({ settingsOpen: false }); },
```

In `src/App.tsx`, delete the `const [settingsOpen, setSettingsOpen] = useState(false);`
line, read `settingsOpen` from the store alongside the other state it already
destructures, and change line 560 to:

```tsx
      <SettingsModal open={settingsOpen} onClose={actions.closeSettings} />
```

Then find every remaining `setSettingsOpen(true)` call (the top shelf's menu is
one) and change it to `actions.openSettings`. Run `npx tsc -b` — it names any
you missed.

- [ ] **Step 1: Write the failing test**

Append to `src/views/goals/Goals.board.test.tsx`:

```tsx
describe('Goals header', () => {
  const ONE: Goal[] = [{ id: 'a', title: 'A', nodes: [], column: 0 }];

  it('offers no New goal button in the page header', async () => {
    await mountBoard(ONE);
    // The top command shelf owns ⌘N; the page header must not duplicate it.
    // (The onboarding empty state keeps its own — nothing competes with it there.)
    expect(screen.queryAllByRole('button', { name: /New goal/ })).toHaveLength(0);
  });

  it('keeps the view toggle named even though it is icon-only', async () => {
    await mountBoard(ONE);
    expect(screen.getByRole('button', { name: 'Board' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Timeline' })).toBeTruthy();
  });

  it('puts Import goal and Manage lives in the overflow', async () => {
    await mountBoard(ONE);
    expect(screen.queryByText('Import goal')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Goals actions' }));
    expect(screen.getByRole('menuitem', { name: 'Import goal' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Manage lives' })).toBeTruthy();
  });

  it('opens Settings from Manage lives', async () => {
    const store = await mountBoard(ONE);
    await userEvent.click(screen.getByRole('button', { name: 'Goals actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Manage lives' }));
    expect(store.useAppStore.getState().settingsOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/views/goals/Goals.board.test.tsx -t "Goals header"`
Expected: FAIL — a `New goal` button is present and there is no `Goals actions` trigger.

- [ ] **Step 3: Add the two icons**

In `src/components/Icons.tsx`, in the section beside the other view icons, add:

```tsx
/** The Goals board — three horizon columns. Lucide `columns-3`. */
export function IconColumns(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </Icon>
  );
}

/** The Goals timeline — spans against a calendar. Lucide `gantt-chart`. */
export function IconTimeline(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 6h10M4 12h16M4 18h7" />
    </Icon>
  );
}
```

Both go through the shared `Icon` wrapper, so they inherit its `viewBox="0 0 24 24"`, `strokeWidth={1.8}`, round caps and `aria-hidden` without restating any of it.

- [ ] **Step 4: Make the view switch icon-only, but named**

In `src/views/Goals.tsx`, replace the `MODES` constant and `ViewModeSwitch`:

```tsx
const MODES = [
  { value: 'board', label: 'Board' },
  { value: 'timeline', label: 'Timeline' },
] as const;

/**
 * Board or Timeline. Icon-only now that the header carries a tab strip: two
 * words plus two more controls above the first card was the chrome soup this
 * pass exists to drain.
 *
 * `Icons.tsx` makes every glyph `aria-hidden` on purpose — an icon never
 * carries the name, the control around it does. So each segment keeps its
 * `title` for the pointer and an explicit `aria-label` for everyone else.
 * These two are the only route between the page's two modes, so losing their
 * names would be a real regression, not a cosmetic one.
 */
function ViewModeSwitch({ mode, onChange }: { mode: GoalsMode; onChange: (mode: GoalsMode) => void }) {
  return (
    <div role="group" aria-label="Goals view" className="inline-flex gap-[2px] bg-chip p-[2px] rounded-[6px]">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          title={m.label}
          aria-label={m.label}
          aria-pressed={mode === m.value}
          onClick={() => onChange(m.value)}
          className={`min-w-[28px] min-h-[24px] grid place-items-center rounded-[4px] transition-colors ${
            mode === m.value ? 'bg-raised text-ink shadow-card' : 'text-muted hover:text-ink'
          }`}
        >
          {m.value === 'board' ? <IconColumns size={13} /> : <IconTimeline size={13} />}
        </button>
      ))}
    </div>
  );
}
```

Update the imports in `Goals.tsx`: drop `SegmentedSwitch`, add `IconColumns, IconTimeline, IconDots` to the `Icons` import and `Popover, PopoverItem` from `../components/Popover`.

- [ ] **Step 5: Replace the header's button pair with the overflow**

In `src/views/Goals.tsx`, replace the two buttons in the header's right-hand group (lines 324-335) so the group reads:

```tsx
        <div className="flex-none flex items-center gap-[8px] self-start">
          <ViewModeSwitch mode={goalsMode} onChange={actions.setGoalsMode} />
          <Popover
            label="Goals actions"
            role="menu"
            align="end"
            panelWidth={184}
            triggerClassName="w-[26px] h-[26px] grid place-items-center rounded-[6px] text-muted hover:text-ink hover:bg-hover"
            trigger={<IconDots size={13} />}
          >
            {(close) => (
              <>
                <PopoverItem close={close} onSelect={() => setModal('import')}>Import goal</PopoverItem>
                <PopoverItem close={close} onSelect={actions.openSettings}>Manage lives</PopoverItem>
              </>
            )}
          </Popover>
        </div>
```

**`+ New goal` is gone from the page header.** The top command shelf already carries it with `⌘N`, and two identical primary buttons a hundred pixels apart is the one-focal-point rule broken by duplication rather than by decoration. The empty state's `+ New goal` stays — there is no shelf competing with it there, and it is the only thing on the page.

`actions.openSettings` is the action added in Step 0.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/views/goals/Goals.board.test.tsx && npx tsc -b`
Expected: PASS — 14 tests. `tsc -b` clean.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all green. Two likely breakages, both expected: any test clicking a header `+ New goal` on the Goals page (repoint it at the shelf or the empty state), and any `App` test driving Settings through the old local state (repoint at `actions.openSettings`).

- [ ] **Step 8: Commit**

```bash
git add src/components/Icons.tsx src/state/store.ts src/App.tsx src/views/Goals.tsx src/views/goals/Goals.board.test.tsx
git commit -m "feat(goals): one New goal on the page, and the rest behind a menu"
```

---

### Task 10: Make the docs agree with the code

**Files:**
- Modify: `ideas/vision.md` (D-7 ~line 148, D-8 ~line 170, Still refused ~line 533, open question 3 ~line 502)
- Modify: `CLAUDE.md` (Invariants)

**Why:** `vision.md` currently refuses a global board switcher in two places. Shipping one while the doc still forbids it is exactly the drift this codebase does not tolerate — and the refusal is not deleted, it is overturned in the open with its reasoning intact.

- [ ] **Step 1: Amend D-7**

In `ideas/vision.md`, replace the final bullet of D-7:

```markdown
- **Scoping exists only inside the planning flow** — one pass per life. There is
  **no global board switcher**, so the collision is unavoidable by construction
  and there is no mode to be lost in.
```

with:

```markdown
- **Scoping exists inside the planning flow** — one pass per life — **and on the
  Goals board.** This clause used to end "there is no global board switcher, so
  the collision is unavoidable by construction". **Overturned 2026-08-13.** The
  alternative it protected — D-16's budget line, which made the collision
  physical instead of merely unavoidable — was built as slice 2a and failed when
  rendered (open question 3). Refusing the switcher while its replacement does
  not exist buys nothing and costs the complaint this decision opened with.
  The board scopes; **the week still never does**, which is the half of this
  decision that was never in question. See
  `docs/superpowers/specs/2026-08-13-goals-life-switcher-design.md`.
```

- [ ] **Step 2: Amend D-8**

Append to D-8, after "That bill comes due in the UI, not the schema.":

```markdown
**Deferred 2026-08-13.** The cap became **three per life** rather than hours.
Three is a rule you can feel, which is precisely what this entry said the hours
had to replace — and the budget that would have measured "what fits" is the one
that failed to render. A worse mechanism that ships beats a better one that
clips every card on the board.
```

- [ ] **Step 3: Amend Still refused**

Replace the switcher bullet:

```markdown
- **A global board switcher.** A switcher is a device for not seeing the
  collision, and the collision is the point. (D-7)
```

with:

```markdown
- ~~**A global board switcher.**~~ **Adopted 2026-08-13** — see D-7. What
  survives of the objection is the scope's *lifetime*: it is in-memory and
  every load starts at `All`, so a mode is something you are in because you
  chose it this session, never something you were restored into.
```

Leave the **Per-life capacity** bullet exactly as it is. This slice does not touch it.

- [ ] **Step 4: Note the resolution on open question 3**

Append to the end of open question 3:

```markdown
   **Followed up 2026-08-13.** The geometry half was answered the other way it
   named — *a geometry where Now claims width in proportion to what it holds* —
   applied to the horizon columns rather than to card heights, and shipped with
   the life switcher. The card is unchanged; only the columns move.
```

- [ ] **Step 5: Record the invariants**

In `CLAUDE.md`, add to the Invariants list:

```markdown
- **The Goals board scopes to one life; the week never does.** `activeLifeId` is
  in-memory view state beside `activeHorizon` — never persisted, so every load
  starts at `All` — and `src/lib/lifeScope.ts` is the one vocabulary for it:
  `resolveScope` (an unknown id is `'all'`, the same dangling licence
  `Goal.lifeId` has), `lifeTabs` (empty when no life is named; a named life kept
  when empty, `Unassigned` dropped when empty), `goalsInScope`, `nowLimit` and
  `withScopeLife`. The cap is `NOW_WIP_LIMIT` per tab and, on `All`, the SUM of
  the tabs beside it — so the figure can be checked against the strip by eye.
  Today, Plan, the backlog rail and every capacity figure are deliberately NOT
  scoped: this overturns D-7's refusal of a switcher and leaves its refusal of
  per-life capacity standing.
- **A partial board layout weaves the rest back.** `weaveHidden` (`lib/board.ts`)
  re-inserts every goal absent from an incoming `setGoalBoard` layout at the
  within-column index it held — the reason a scoped reorder cannot scramble the
  other life's ranks, and why it is named for the general case rather than for
  completion. `rankMoveTarget` is the keyboard half: `moveGoalRank` steps by
  VISIBLE neighbours, so `Alt+↑` never swaps a card with one that is off screen.
- **A column claims width in proportion to what it holds** (`lib/boardTracks.ts`),
  and **every column equalises while something is in the air** — `handleDragOver`
  moves ids live, so widths that tracked card count would reflow under the
  cursor and an empty Now would be narrowest exactly when you need to hit it.
```

- [ ] **Step 6: Commit**

```bash
git add ideas/vision.md CLAUDE.md
git commit -m "docs: the board switcher is adopted, not smuggled"
```

---

### Task 11: Verify it in the real app

**Files:** none — this is a driving pass.

- [ ] **Step 1: Full suite and typecheck**

Run: `npm test && npx tsc -b`
Expected: **2787 + ~50 new tests**, all passing, across **153 test files** (the
three new ones: `lifeScope`, `boardTracks`, `LifeTabs`, plus `Goals.board` —
four, so **154**). `tsc -b` clean.

- [ ] **Step 2: Drive it**

Run: `npm run dev`, then in the browser:

- [ ] With no lives named: **no tab strip**, board looks exactly as before, Now reads `N / 3`.
- [ ] Settings → add "University" and "Startup". Strip appears with `All · University · Startup`.
- [ ] Assign a goal to each from a card's ⋯ menu. `Unassigned` appears once a loose goal exists.
- [ ] `All` reads the summed cap; each life reads `/ 3`.
- [ ] Switch to Startup — University's cards are gone; switch back — they return.
- [ ] With everything in Someday, Someday takes the width and its cards flow more than one across; Now/Next/Later are slim.
- [ ] Pick a card up: **all four columns equalise**, and an empty Now is a full-size drop target. Drop it there; widths settle.
- [ ] **Reorder inside University, then switch to Startup — its order is untouched.** (The silent regression.)
- [ ] `Alt+↑` on the topmost visible card is silent — no toast, no ring.
- [ ] Scope to an empty life: "No goals in X yet", no "Load example".
- [ ] Create a goal while scoped to Startup — its card shows the Startup chip.
- [ ] Delete the active life in Settings — the board falls back to `All` and does not crash.
- [ ] Reload the page — the board is back on `All`.
- [ ] `⋯` → Import goal and Manage lives both work; there is exactly one `+ New goal` on screen (the shelf's).
- [ ] Toggle Board/Timeline by icon; Timeline honours the active life.
- [ ] Below 920px: life tabs on top, horizon switcher beneath, one horizon at a time.

- [ ] **Step 3: Commit anything the pass turned up**

```bash
git add -A
git commit -m "fix(goals): what driving the board turned up"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 scope of the switch (board, timeline, summary, banner, completed) | 7 |
| §2 state, no persistence, dangling mid-session | 4 |
| §3 `lifeScope.ts` | 1 |
| §3 `boardTracks.ts` | 2 |
| §3 `focusSummary` limit, `Column` prop | 5 |
| §4 drag freeze, `rectSortingStrategy`, card flow, no `border-dashed` | 8 |
| §5 `weaveHidden`, `rankMoveTarget` | 3 |
| §6 header, icons, `⋯`, tabs, hints removed, zero-lives | 6, 8, 9 |
| §7 scoped-empty, long titles, create-while-scoped, delete active life | 1, 6, 7, 11 |
| §8 testing | every task |
| §9 doc amendments | 10 |

**Type consistency:** `LifeScope`/`LifeTab` are defined in Task 1 and used unchanged in 4, 6 and 7. `nowLimit(scope, tabs)` is called only in Task 7. `columnTracks(counts, {dragging})` is defined in 2, called in 8. `rankMoveTarget(list, visibleIds, goalId, delta)` is defined in 3, called in 4. `weaveHidden` is renamed in 3 with its only call site updated in the same task. `Column` gains `nowLimit` in Task 5 and `slim` in Task 8; both call sites are updated in the task that adds them. `mountBoard(goals, lives)` is defined in Task 7 and reused verbatim by 8 and 9.

**Harness corrections made during review**, because the first draft of this plan
would not have run:

- `vitest.config.ts` sets `environment: 'node'`. Every `.test.tsx` here needs
  `// @vitest-environment jsdom` on line 1; three of these files had no pragma.
- `Goals.tsx` calls `window.matchMedia` **unguarded** at render for
  `prefers-reduced-motion`, and jsdom does not implement it — the component
  throws without the `beforeAll` stub. No existing test renders `<Goals />`, so
  this was untested ground.
- `Goals` reads the store directly, so the tests need the `vi.hoisted` db-mock
  and module-reset boot from `Project.progress.test.tsx`, not a bare `render`.
- `actions.openSettings` did not exist — `settingsOpen` was local `useState` in
  `App.tsx`. Task 9 Step 0 lifts it into the store on the `goalModal` precedent.

**Known follow-on, deliberately not done here:** `AreaPage.tsx` and `Project.tsx` keep their hand-rolled tablists. Migrating them onto `components/Tabs.tsx` is a clean follow-up, but it touches two views this plan otherwise never opens.
