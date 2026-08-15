# Per-Task Demand & the Focus Dial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give work a `demand` it declares for itself, inherited down the goal tree, and make the shelf's second dial read it — retiring `shelfDetail`, whose "Focus" label measured how many options you saw rather than how much of you the work wanted.

**Architecture:** Two new pure modules. `src/lib/demand.ts` owns the vocabulary (`light`/`moderate`/`deep`) and `demandIndex`, a single-pass walker that resolves each node's value from its nearest tagged ancestor. `src/lib/focusLens.ts` owns the dial and the one membership question, `admitsWork`. `executionAdvisor` composes the two dials — time decides what fits your gap, focus decides what fits your head — and neither reorders anything. `shelfDetail.ts` is deleted; `sessionRing` and `elapsedAgainstExpected` re-point from `DetailLevel` to `FocusLevel`, which is the axis their own comments were already describing.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Dexie, Vitest + Testing Library, Electron.

**Spec:** `docs/superpowers/specs/2026-08-15-per-task-demand-design.md`

**Base:** branch `feat/focus-demand` at `a1557d7`. Baseline is green: `npx tsc -b` exits 0, `npm test` passes 175 files / 3110 tests.

## Global Constraints

- **`FOCUS_LEVEL_KEY = 'focusLevel'` (`db.ts:220`) stores the TIME level.** It names a row already present in every database. The new focus dial takes a **different** key, `'focusCapability'`. Getting this wrong silently resets a user's time dial. This is the single easiest error in this plan.
- **Value strings never change.** Every level and every demand is a lowercase literal (`'low'|'medium'|'high'`, `'light'|'moderate'|'deep'`). `Session.focus?: 'low'` is historical data read by `teachingSessions` (`expectedTime.ts:147`); nothing in this plan touches it.
- **An untagged database behaves exactly as it does today.** Absent `demand` is no claim, not a guess. `admitsWork` returns `true` for undefined demand at every level.
- **A FACT about today is never filtered by either dial.** `isCommitment` (`timeLens.ts:133`) is the one definition and both lenses spend it.
- **The advisor holds no ranking.** Both dials change membership only. Order is never touched.
- **The focus dial never reaches Today, Plan, the rail or the agent.** `ExecutionAdviceInput.focusLevel` is OPTIONAL and passed only by `AssistantHost`. `agentReads.ts:107` and `Today.tsx` pass neither dial.
- **`MAX_ALTERNATIVES` stays 2** (`executionAdvisor.ts:85`) and becomes the fixed count once `ALTERNATIVE_CAP` is gone.
- **No migration is written.** Absent `demand` is the untagged state; `detailLevel` was never persisted (`store.ts:224`).
- **`blocks`-style absence discipline:** `demand` is ABSENT, never a sentinel. Clearing it deletes the key.
- **Type scale and colour tokens only.** `designScale.test.ts` fails the build on a literal hex, an arbitrary `text-[Nrem]`, and any second use of `font-disp`.
- **Hover-revealed row controls use `.quiet-control`**, never a hand-rolled `opacity-0 group-hover:opacity-100`.
- Run `npx tsc -b` and `npm test` before every commit.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/demand.ts` *(new)* | The `Demand` vocabulary and `demandIndex` — resolution, inheritance, provenance. Knows nothing about dials. |
| `src/lib/focusLens.ts` *(new)* | The `FocusLevel` dial: words, ranks, storage shape, daily reset, and `admitsWork`. Knows nothing about trees. |
| `src/lib/shelfDetail.ts` *(deleted)* | Retired. Its one cap moves to a constant. |
| `src/db/types.ts` | `demand?: Demand` on `Goal`, `GoalNode`, `Task`. |
| `src/db/db.ts` | `loadStoredFocusLevel`/`saveStoredFocusLevel` under the NEW key. |
| `src/state/store.ts` | `focusLevel` state, `setFocusLevel`, hydration; `setNodeDemand`/`setTaskDemand`/`setGoalDemand`/`setNodesDemand`. |
| `src/lib/executionAdvisor.ts` | Composes both lenses; attributes an emptied queue to the dial that emptied it. |
| `src/lib/assistantProtocol.ts`, `AssistantHost.tsx`, `AssistantSurface.tsx`, `sessionRing.ts` | Dial swap. |
| `electron/assistantIpc.cjs` | Validates the renamed action and snapshot field. |
| `src/lib/rowActions.ts`, `RowActions.tsx`, `GoalTree.tsx`, `TaskPage.tsx`, `StepPanel.tsx` | Editors and the row chip. |

---

### Task 1: The `Demand` vocabulary and the three fields

The type and its words, plus the storage fields it lives in. No consumer yet, so nothing can regress.

**Files:**
- Create: `src/lib/demand.ts`
- Create: `src/lib/demand.test.ts`
- Modify: `src/db/types.ts` (`Goal` at :123, `GoalNode` at :30, `Task` at :169)

**Interfaces:**
- Consumes: nothing.
- Produces: `type Demand = 'light' | 'moderate' | 'deep'`; `DEMANDS: readonly Demand[]`; `DEMAND_WORD: Record<Demand, string>`; `DEMAND_RANK: Record<Demand, number>`; `isDemand(raw: unknown): raw is Demand`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/demand.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEMANDS, DEMAND_RANK, DEMAND_WORD, isDemand } from './demand';

describe('the vocabulary', () => {
  it('ranks light below moderate below deep', () => {
    expect(DEMAND_RANK.light).toBeLessThan(DEMAND_RANK.moderate);
    expect(DEMAND_RANK.moderate).toBeLessThan(DEMAND_RANK.deep);
  });

  it('names every value exactly once, in ascending order', () => {
    expect(DEMANDS).toEqual(['light', 'moderate', 'deep']);
    expect(DEMANDS.map((d) => DEMAND_WORD[d])).toEqual(['Light', 'Moderate', 'Deep']);
  });

  it('does not reuse the dial words, which mean the opposite pole', () => {
    const words = Object.values(DEMAND_WORD);
    expect(words).not.toContain('Low');
    expect(words).not.toContain('High');
  });
});

describe('isDemand', () => {
  it('accepts the three values', () => {
    expect(isDemand('light')).toBe(true);
    expect(isDemand('moderate')).toBe(true);
    expect(isDemand('deep')).toBe(true);
  });

  it('is total: anything else is not a demand', () => {
    for (const raw of ['Light', 'low', '', null, undefined, 3, {}, []]) {
      expect(isDemand(raw)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/demand.test.ts`
Expected: FAIL — `Failed to resolve import "./demand"`.

- [ ] **Step 3: Write `src/lib/demand.ts`**

```ts
import type { Goal, GoalNode, Task } from '../db/types';

/**
 * How much of you a piece of work wants.
 *
 * The second axis. `timeLens` asks how long something takes and has three
 * kinds of evidence for it — history, an estimate, a starter. Nothing measured
 * how HARD it was, so a twenty-minute expense claim and a twenty-minute "decide
 * the data model" were the same size and the same offer.
 *
 * The words are deliberately NOT the dial's words. The dial reads
 * `Low / Medium / High` and means capability; this reads `Light / Moderate /
 * Deep` and means requirement. They are opposite poles of one scale, and a chip
 * reading `Low` on a row could be read either way — the same reason
 * `expectedTimeLabel` prefixes `Usually / Planned / Suggested` rather than
 * printing a bare figure.
 */

export type Demand = 'light' | 'moderate' | 'deep';

/** Ascending, and the order every selector renders in. */
export const DEMANDS: readonly Demand[] = ['light', 'moderate', 'deep'];

export const DEMAND_WORD: Record<Demand, string> = {
  light: 'Light',
  moderate: 'Moderate',
  deep: 'Deep',
};

/** Compared against `FOCUS_ADMITS`. Monotone, so a dial is a dial. */
export const DEMAND_RANK: Record<Demand, number> = {
  light: 1,
  moderate: 2,
  deep: 3,
};

export function isDemand(raw: unknown): raw is Demand {
  return raw === 'light' || raw === 'moderate' || raw === 'deep';
}
```

The `Goal`/`GoalNode`/`Task` import is unused until Task 2 — add it there instead, and leave this file importing nothing.

Remove the `import type` line above; it belongs to Task 2.

- [ ] **Step 4: Add the fields to `src/db/types.ts`**

In `GoalNode` (after `estimateMin?: number;`):

```ts
  /**
   * How much of you this step wants. Set on a leaf OR a container: a container's
   * value is inherited by everything under it, which is what keeps this from
   * being a field somebody fills in by hand, forever, for every task.
   *
   * ABSENT means no claim has been made — never "moderate", never a guess. The
   * focus dial admits an untagged step at every level for exactly that reason,
   * and `demandIndex` resolves the inherited value at read time so nothing is
   * stored twice.
   */
  demand?: Demand;
```

In `Goal` (after `type?: 'study' | 'project' | 'general';`):

```ts
  /** The whole project's demand, inherited by every node under it. See `GoalNode.demand`. */
  demand?: Demand;
```

In `Task` (after `estimateMin?: number;`):

```ts
  /**
   * This task's own demand. A task NEVER inherits: `goalId` is a tag FOR
   * CONTEXT ONLY, not a parent link, so reading demand through it would invent
   * a containment relationship the model deliberately refuses.
   */
  demand?: Demand;
```

Add the import at the top of `types.ts`:

```ts
import type { Demand } from '../lib/demand';
```

- [ ] **Step 5: Run the test and the typechecker**

Run: `npx vitest run src/lib/demand.test.ts && npx tsc -b`
Expected: PASS, and tsc exits 0.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: 175 files / 3110 tests still pass. Nothing consumes `demand` yet.

- [ ] **Step 7: Commit**

```bash
git add src/lib/demand.ts src/lib/demand.test.ts src/db/types.ts
git commit -m "feat(demand): work can say how much of you it wants"
```

---

### Task 2: `demandIndex` — inheritance, resolved in one pass

**Files:**
- Modify: `src/lib/demand.ts`
- Modify: `src/lib/demand.test.ts`

**Interfaces:**
- Consumes: `Demand`, `isDemand` from Task 1.
- Produces: `interface ResolvedDemand { level: Demand; source: 'own' | 'inherited' }`; `demandIndex(goals: Goal[]): Map<string, ResolvedDemand>`; `taskDemand(task: Task): ResolvedDemand | undefined`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/demand.test.ts`:

```ts
import { demandIndex, taskDemand } from './demand';
import type { Goal, GoalNode, Task } from '../db/types';

const node = (id: string, extra: Partial<GoalNode> = {}): GoalNode =>
  ({ id, title: id, ...extra });

const goal = (id: string, nodes: GoalNode[], extra: Partial<Goal> = {}): Goal =>
  ({ id, title: id, nodes, ...extra });

describe('demandIndex', () => {
  it('gives an untagged tree nothing, so today is unchanged', () => {
    const g = goal('g', [node('a'), node('b', { children: [node('c')] })]);
    expect(demandIndex([g]).size).toBe(0);
  });

  it("inherits a goal's demand by every descendant", () => {
    const g = goal('g', [node('a', { children: [node('b')] })], { demand: 'deep' });
    const index = demandIndex([g]);
    expect(index.get('a')).toEqual({ level: 'deep', source: 'inherited' });
    expect(index.get('b')).toEqual({ level: 'deep', source: 'inherited' });
  });

  it("prefers a node's own tag over an ancestor's", () => {
    const g = goal('g', [node('a', { demand: 'light' })], { demand: 'deep' });
    expect(demandIndex([g]).get('a')).toEqual({ level: 'light', source: 'own' });
  });

  it('lets the NEAREST tagged ancestor win over a farther one', () => {
    const g = goal(
      'g',
      [node('outer', { demand: 'deep', children: [node('mid', { demand: 'light', children: [node('leaf')] })] })],
      { demand: 'moderate' },
    );
    const index = demandIndex([g]);
    expect(index.get('outer')).toEqual({ level: 'deep', source: 'own' });
    expect(index.get('mid')).toEqual({ level: 'light', source: 'own' });
    expect(index.get('leaf')).toEqual({ level: 'light', source: 'inherited' });
  });

  it('indexes containers as well as leaves — a container is taggable', () => {
    const g = goal('g', [node('parent', { demand: 'deep', children: [node('kid')] })]);
    expect(demandIndex([g]).has('parent')).toBe(true);
  });

  it('keeps goals separate', () => {
    const a = goal('a', [node('x')], { demand: 'deep' });
    const b = goal('b', [node('y')]);
    const index = demandIndex([a, b]);
    expect(index.get('x')).toEqual({ level: 'deep', source: 'inherited' });
    expect(index.has('y')).toBe(false);
  });
});

describe('taskDemand', () => {
  const task = (extra: Partial<Task> = {}): Task =>
    ({ id: 't', title: 't', done: false, goalId: null, ...extra });

  it('reads a task\'s own tag', () => {
    expect(taskDemand(task({ demand: 'light' }))).toEqual({ level: 'light', source: 'own' });
  });

  it('is undefined when untagged', () => {
    expect(taskDemand(task())).toBeUndefined();
  });

  it('NEVER inherits through goalId — that is a context tag, not a parent', () => {
    expect(taskDemand(task({ goalId: 'g' }))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/demand.test.ts`
Expected: FAIL — `demandIndex is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/demand.ts`:

```ts
import type { Goal, GoalNode, Task } from '../db/types';

/**
 * A resolved value and where it came from.
 *
 * `source` is required rather than convenient: it is what lets a tree row draw
 * a chip only where a value was SET — a `deep` goal painting `Deep` onto all
 * thirty of its leaves is a column that says one word thirty times — while a
 * page states the resolved value in full and names the ancestor it came from.
 */
export interface ResolvedDemand {
  level: Demand;
  source: 'own' | 'inherited';
}

/**
 * Every node's demand, resolved from its nearest tagged ancestor.
 *
 * ONE pass, deliberately. `findNodePath` would answer the same question per
 * node but is O(n) per call, which would make the shelf O(n²) in the size of a
 * goal; `walkLeaves` cannot be reused because it visits leaves only and hands
 * the visitor no ancestor context.
 *
 * Nothing is written down. A node indented under a `deep` container re-resolves
 * on the next paint, exactly as `isLeafNode`/`isContainerNode` are computed at
 * render rather than stored.
 *
 * Untagged nodes are ABSENT from the map rather than present-and-undefined:
 * absence is the whole meaning of "made no claim".
 */
export function demandIndex(goals: Goal[]): Map<string, ResolvedDemand> {
  const out = new Map<string, ResolvedDemand>();
  function walk(nodes: GoalNode[], inherited: Demand | undefined): void {
    for (const n of nodes) {
      const level = n.demand ?? inherited;
      if (level !== undefined) {
        out.set(n.id, { level, source: n.demand === undefined ? 'inherited' : 'own' });
      }
      if (n.children?.length) walk(n.children, level);
    }
  }
  for (const g of goals) walk(g.nodes, g.demand);
  return out;
}

/**
 * A task's demand — its own or nothing.
 *
 * `Task.goalId` is documented "tag FOR CONTEXT ONLY", the same phrase
 * `Habit.goalId` and `Session.goalId` carry. It is not a parent link, so there
 * is nothing here to inherit from.
 */
export function taskDemand(task: Task): ResolvedDemand | undefined {
  return task.demand === undefined ? undefined : { level: task.demand, source: 'own' };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/demand.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc -b && npm test`
Expected: tsc exits 0; 175 files pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/demand.ts src/lib/demand.test.ts
git commit -m "feat(demand): tag a goal once and the tree inherits it"
```

---

### Task 3: `focusLens` — the dial that reads demand

**Files:**
- Create: `src/lib/focusLens.ts`
- Create: `src/lib/focusLens.test.ts`

**Interfaces:**
- Consumes: `ResolvedDemand`, `DEMAND_RANK` from Task 2; `isCommitment` from `timeLens.ts:133`; `AdviceReason` from `executionAdvisor`.
- Produces: `type FocusLevel = 'low'|'medium'|'high'`; `FOCUS_LEVELS`; `DEFAULT_FOCUS_LEVEL`; `FOCUS_WORD`; `FOCUS_ADMITS`; `isFocusLevel`; `admitsDemand(level, demand)`; `admitsWork(level, reason, demand)`; `StoredFocusLevel`; `serializeFocusLevel`; `parseStoredFocusLevel`; `focusLevelFor`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/focusLens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FOCUS_LEVEL, FOCUS_LEVELS, FOCUS_WORD, admitsDemand, admitsWork,
  focusLevelFor, isFocusLevel, parseStoredFocusLevel, serializeFocusLevel,
} from './focusLens';
import type { ResolvedDemand } from './demand';
import type { AdviceReason } from './executionAdvisor';

const own = (level: ResolvedDemand['level']): ResolvedDemand => ({ level, source: 'own' });

describe('the caps', () => {
  it('are monotone: every level admits what the level below admits', () => {
    const samples = [own('light'), own('moderate'), own('deep'), undefined];
    for (const d of samples) {
      if (admitsDemand('low', d)) expect(admitsDemand('medium', d)).toBe(true);
      if (admitsDemand('medium', d)) expect(admitsDemand('high', d)).toBe(true);
    }
  });

  it('lets Low take light only', () => {
    expect(admitsDemand('low', own('light'))).toBe(true);
    expect(admitsDemand('low', own('moderate'))).toBe(false);
    expect(admitsDemand('low', own('deep'))).toBe(false);
  });

  it('lets High take everything', () => {
    for (const d of [own('light'), own('moderate'), own('deep')]) {
      expect(admitsDemand('high', d)).toBe(true);
    }
  });
});

describe('an untagged item', () => {
  it('is admitted at EVERY level — absence is no claim, not a guess', () => {
    for (const level of FOCUS_LEVELS) expect(admitsDemand(level, undefined)).toBe(true);
  });
});

describe('admitsWork', () => {
  const commitments: AdviceReason[] = ['scheduled-now', 'scheduled-next', 'due', 'committed-today'];

  it('never filters a fact about today, however deep', () => {
    for (const reason of commitments) {
      expect(admitsWork('low', reason, own('deep'))).toBe(true);
    }
  });

  it('does filter discretionary work', () => {
    expect(admitsWork('low', 'free-time', own('deep'))).toBe(false);
    expect(admitsWork('low', 'free-time', own('light'))).toBe(true);
  });
});

describe('the stored form', () => {
  it('round-trips', () => {
    const stored = { level: 'low' as const, date: '2026-08-15' };
    expect(parseStoredFocusLevel(serializeFocusLevel(stored))).toEqual(stored);
  });

  it('is total: junk reads as nothing stored', () => {
    for (const raw of ['', '{', '{}', '{"level":"nope","date":"2026-08-15"}',
      '{"level":"low","date":"nope"}', null, 7]) {
      expect(parseStoredFocusLevel(raw)).toBeNull();
    }
  });
});

describe('focusLevelFor', () => {
  it('keeps what was set today', () => {
    expect(focusLevelFor({ level: 'low', date: '2026-08-15' }, '2026-08-15')).toBe('low');
  });

  it('resets to the default on a new day, without anything running at midnight', () => {
    expect(focusLevelFor({ level: 'low', date: '2026-08-14' }, '2026-08-15')).toBe(DEFAULT_FOCUS_LEVEL);
    expect(focusLevelFor(null, '2026-08-15')).toBe(DEFAULT_FOCUS_LEVEL);
  });
});

describe('isFocusLevel', () => {
  it('is total', () => {
    expect(isFocusLevel('low')).toBe(true);
    for (const raw of ['Low', 'light', '', null, 2, {}]) expect(isFocusLevel(raw)).toBe(false);
  });
});

describe('the words', () => {
  it('are the dial\'s words, not the tag\'s', () => {
    expect(FOCUS_LEVELS.map((l) => FOCUS_WORD[l])).toEqual(['Low', 'Medium', 'High']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/focusLens.test.ts`
Expected: FAIL — `Failed to resolve import "./focusLens"`.

- [ ] **Step 3: Implement `src/lib/focusLens.ts`**

```ts
import { DEMAND_RANK, type ResolvedDemand } from './demand';
import type { AdviceReason } from './executionAdvisor';
import { isCommitment } from './timeLens';
import { isValidLocalDate } from './schedule';

/**
 * How much focus you have, and what the shelf may offer you because of it.
 *
 * The second of the shelf's two dials and the honest version of a control that
 * used to be called Focus while capping how many alternatives were DRAWN
 * (`shelfDetail`, retired). `timeLens` asks how long you have; this asks how
 * much of you is available, and reads the `demand` the work declares.
 *
 * A LENS, never a ranking: order never changes, membership does — the same move
 * `lifeScope` makes on the board.
 */

export type FocusLevel = 'low' | 'medium' | 'high';

export const FOCUS_LEVELS: readonly FocusLevel[] = ['low', 'medium', 'high'];

/** What a new day starts at. Nobody has to remember to put the dial back. */
export const DEFAULT_FOCUS_LEVEL: FocusLevel = 'medium';

export const FOCUS_WORD: Record<FocusLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** The heaviest `DEMAND_RANK` each level will offer. Monotone, so a dial is a dial. */
export const FOCUS_ADMITS: Record<FocusLevel, number> = {
  low: DEMAND_RANK.light,
  medium: DEMAND_RANK.moderate,
  high: DEMAND_RANK.deep,
};

export function isFocusLevel(raw: unknown): raw is FocusLevel {
  return raw === 'low' || raw === 'medium' || raw === 'high';
}

/**
 * Whether this level offers work of this demand.
 *
 * **An untagged item is admitted at every level, and that is deliberate.**
 * `fitsWindow` refuses a `starter` at its narrowest setting as a RULE, because
 * duration always has fallback evidence — history, an estimate, and failing
 * both a 30-minute guess. Demand has none: there is no history that reveals how
 * hard something was, and no default worth inventing. Treating untagged as
 * `moderate` would hide most of a real backlog on the strength of a value
 * nobody entered, and falling back to the duration cap would make this a SECOND
 * time dial, filtering on the axis the dial beside it just filtered on.
 *
 * So this only ever removes work that has positively claimed to be heavier than
 * the level allows. On an untagged database it does nothing at all.
 */
export function admitsDemand(level: FocusLevel, demand: ResolvedDemand | undefined): boolean {
  if (demand === undefined) return true;
  return DEMAND_RANK[demand.level] <= FOCUS_ADMITS[level];
}

/**
 * The one membership question, commitments included.
 *
 * `isCommitment` is imported from `timeLens` rather than restated: your 2pm
 * block is a FACT about today, and one definition of that is what stops the two
 * dials disagreeing about which rows are facts.
 */
export function admitsWork(
  level: FocusLevel,
  reason: AdviceReason,
  demand: ResolvedDemand | undefined,
): boolean {
  return isCommitment(reason) || admitsDemand(level, demand);
}

/**
 * The stored form: the level, and the day it was set.
 *
 * Both, because the reset is arithmetic over the date at READ time rather than
 * a write at midnight — a machine asleep for three days comes back at the
 * default without anything having run while it slept.
 */
export interface StoredFocusLevel {
  level: FocusLevel;
  date: string; // 'YYYY-MM-DD'
}

export function serializeFocusLevel(stored: StoredFocusLevel): string {
  return JSON.stringify(stored);
}

/** Total: any malformed shape reads as "nothing stored" rather than throwing at startup. */
export function parseStoredFocusLevel(raw: unknown): StoredFocusLevel | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  if (!isFocusLevel(row.level)) return null;
  if (typeof row.date !== 'string' || !isValidLocalDate(row.date)) return null;
  return { level: row.level, date: row.date };
}

/** The level in force today: what was set, if it was set today. */
export function focusLevelFor(stored: StoredFocusLevel | null, today: string): FocusLevel {
  if (!stored || stored.date !== today) return DEFAULT_FOCUS_LEVEL;
  return stored.level;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/focusLens.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc -b && npm test`
Expected: tsc exits 0; 175 files pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/focusLens.ts src/lib/focusLens.test.ts
git commit -m "feat(focus): a dial for how much of you is available"
```

---

### Task 4: Persist the dial under a NEW key

**Read the first global constraint again before starting this task.** `'focusLevel'` is the TIME dial's key.

**Files:**
- Modify: `src/db/db.ts` (near :220)
- Modify: `src/state/store.ts` (imports ~:69, AppState ~:219, initial ~:276, hydrate ~:680, actions ~:1985)

**Interfaces:**
- Consumes: `StoredFocusLevel`, `serializeFocusLevel`, `parseStoredFocusLevel`, `focusLevelFor`, `DEFAULT_FOCUS_LEVEL`, `isFocusLevel`, `FocusLevel` from Task 3.
- Produces: `loadStoredFocusLevel()`, `saveStoredFocusLevel(stored)` in `db.ts`; `focusLevel: FocusLevel` on AppState; `actions.setFocusLevel(next): boolean`.

- [ ] **Step 1: Add the storage helpers**

In `src/db/db.ts`, immediately after `saveStoredTimeLevel`:

```ts
/**
 * The focus dial's own row.
 *
 * A DIFFERENT key from the one above. `'focusLevel'` names the TIME dial —
 * it kept its original spelling because it names a row already present in every
 * database, and the two-dials rename deliberately moved types without moving
 * storage. Writing the focus dial there would silently reset every user's time
 * dial.
 */
const FOCUS_CAPABILITY_KEY = 'focusCapability';

export async function loadStoredFocusLevel(): Promise<StoredFocusLevel | null> {
  const row = await db.settings.get(FOCUS_CAPABILITY_KEY);
  return parseStoredFocusLevel(row?.value);
}

export async function saveStoredFocusLevel(stored: StoredFocusLevel): Promise<void> {
  await db.settings.put({ key: FOCUS_CAPABILITY_KEY, value: serializeFocusLevel(stored) });
}
```

Add to the imports at the top of `db.ts`:

```ts
import {
  parseStoredFocusLevel, serializeFocusLevel, type StoredFocusLevel,
} from '../lib/focusLens';
```

- [ ] **Step 2: Write the failing store test**

Create `src/lib/focusLevelStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_FOCUS_LEVEL, focusLevelFor, isFocusLevel } from './focusLens';

describe('the dial the store holds', () => {
  it('starts at the default when nothing is stored', () => {
    expect(focusLevelFor(null, '2026-08-15')).toBe(DEFAULT_FOCUS_LEVEL);
  });

  it('refuses a value that is not a level', () => {
    expect(isFocusLevel('deep')).toBe(false);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run src/lib/focusLevelStore.test.ts`
Expected: PASS immediately — this pins the contract `store.ts` depends on, and guards the easy confusion of passing a `Demand` where a `FocusLevel` belongs.

- [ ] **Step 4: Wire the store**

In `src/state/store.ts`:

Add to imports:

```ts
import { loadStoredFocusLevel, saveStoredFocusLevel } from '../db/db';
import {
  DEFAULT_FOCUS_LEVEL, focusLevelFor, isFocusLevel, type FocusLevel,
} from '../lib/focusLens';
```

(`loadStoredFocusLevel`/`saveStoredFocusLevel` join the existing `../db/db` import list rather than adding a second import of the same module.)

Add the AppState field beside `timeLevel` (~:219):

```ts
  /**
   * How much focus the room supports. Persisted with a daily reset, exactly as
   * `timeLevel` is — a person who says they are fried at 09:00 is still fried at
   * 09:20, and re-asking on every open is how a dial gets left at its default
   * forever. The reset is what stops it becoming a setting.
   */
  focusLevel: FocusLevel;
```

Add to the initial state (~:276):

```ts
  focusLevel: DEFAULT_FOCUS_LEVEL,
```

Add `loadStoredFocusLevel()` to the hydration `Promise.all` (~:600) and destructure it as `storedFocusLevel`, then set it beside `timeLevel` (~:680):

```ts
      focusLevel: focusLevelFor(storedFocusLevel, todayStr()),
```

Add the action beside `setTimeLevel` (~:1985):

```ts
  setFocusLevel(next: FocusLevel): boolean {
    if (!isFocusLevel(next)) return false;
    set({ focusLevel: next });
    ifOwner(() => saveStoredFocusLevel({ level: next, date: todayStr() }));
    return true;
  },
```

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc -b && npm test`
Expected: tsc exits 0; 175 files pass. Nothing reads `focusLevel` yet.

- [ ] **Step 6: Commit**

```bash
git add src/db/db.ts src/state/store.ts src/lib/focusLevelStore.test.ts
git commit -m "feat(focus): the dial persists, and resets with the day"
```

---

### Task 5: The advisor composes both dials

**Files:**
- Modify: `src/lib/executionAdvisor.ts` (`ExecutionAdvice` :46-58, `ExecutionAdviceInput` :64-82, `Candidate` :87-94, `orderedCandidates` :137-146, `executionAdvice` :220-252)
- Modify: `src/lib/executionAdvisor.test.ts`

**Interfaces:**
- Consumes: `demandIndex`, `taskDemand`, `ResolvedDemand` (Task 2); `admitsWork`, `FocusLevel` (Task 3).
- Produces: `ExecutionAdviceInput.focusLevel?: FocusLevel`; `RecommendedWork.demand?: ResolvedDemand`; `ExecutionAdvice` gains `beyondFocus?: true` beside `beyondWindow?: true`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/executionAdvisor.test.ts` (reuse the fixture builders already at the top of that file):

```ts
describe('the focus dial', () => {
  it('changes membership and never order', () => {
    // Build a pool where every item is untagged, then tag one deep.
    // The surviving items must appear in the same relative order.
    const withoutDial = executionAdvice(baseInput());
    const withDial = executionAdvice({ ...baseInput(), focusLevel: 'high' });
    expect(withDial.kind).toBe('work');
    if (withDial.kind !== 'work' || withoutDial.kind !== 'work') return;
    expect(withDial.primary.key).toBe(withoutDial.primary.key);
  });

  it('does nothing at all on an untagged database', () => {
    const untouched = executionAdvice(baseInput());
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(executionAdvice({ ...baseInput(), focusLevel: level })).toEqual(untouched);
    }
  });

  it('drops a deep discretionary item at Low', () => {
    const input = taggedInput('deep');
    const advice = executionAdvice({ ...input, focusLevel: 'low' });
    if (advice.kind !== 'work') throw new Error('expected work');
    expect(advice.beyondFocus).toBe(true);
  });

  it('keeps a deep COMMITMENT at Low', () => {
    const input = committedDeepInput();
    const advice = executionAdvice({ ...input, focusLevel: 'low' });
    if (advice.kind !== 'work') throw new Error('expected work');
    expect(advice.beyondFocus).toBeUndefined();
  });

  it('blames the window, not focus, when time emptied the queue first', () => {
    const advice = executionAdvice({ ...longUntaggedInput(), timeLevel: 'low', focusLevel: 'low' });
    if (advice.kind !== 'work') throw new Error('expected work');
    expect(advice.beyondWindow).toBe(true);
    expect(advice.beyondFocus).toBeUndefined();
  });
});
```

The four helpers (`baseInput`, `taggedInput`, `committedDeepInput`, `longUntaggedInput`) must be written against the fixture style already in that file — read the existing `describe` blocks first and build them from the same `goal`/`task`/`availability` helpers rather than inventing new ones.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/executionAdvisor.test.ts`
Expected: FAIL — `focusLevel` is not a known property.

- [ ] **Step 3: Widen the types**

`ExecutionAdvice`, beside `beyondWindow` (:58):

```ts
      /**
       * The focus level in force admitted nothing, so `primary` is the
       * unfiltered head. Distinct from `beyondWindow` because the two dials
       * fail differently and the copy must say which one did: "Nothing that
       * short left" and "Nothing light left" are different sentences.
       */
      beyondFocus?: true;
```

`ExecutionAdviceInput`, after `timeLevel?` (:82):

```ts
  /**
   * How much focus is available. ABSENT means no lens, which is what every
   * surface other than the shelf passes — a mood set in a café must not rewrite
   * the Today page you check on the train home.
   */
  focusLevel?: FocusLevel;
```

`Candidate` (:94) and `RecommendedWork` both gain:

```ts
  demand?: ResolvedDemand;
```

- [ ] **Step 4: Attach demand where candidates are built**

In `orderedCandidates`, alongside the existing `nodeByid` construction (:137-146):

```ts
  const demandBy = demandIndex(goals);
```

Then every step Candidate carries `...(demandBy.get(item.id) === undefined ? {} : { demand: demandBy.get(item.id) })`, and every task Candidate carries the result of `taskDemand(task)` under the same absent-not-undefined discipline. Prefer a local helper in that file:

```ts
const withDemand = (d: ResolvedDemand | undefined) => (d === undefined ? {} : { demand: d });
```

- [ ] **Step 5: Compose the two filters**

Replace the filter block at :220-228:

```ts
  const queue = pool.map((c) => withExpected(c, input));

  const timeLevel = input.timeLevel;
  const inWindow = timeLevel === undefined
    ? queue
    : queue.filter((w) => admits(timeLevel, w.reason, w.expected));

  const focusLevel = input.focusLevel;
  const admitted = focusLevel === undefined
    ? inWindow
    : inWindow.filter((w) => admitsWork(focusLevel, w.reason, w.demand));

  // Attribute the emptiness to the dial that caused it. Time is checked first
  // because it is the harder constraint — a gap is a fact about the day, and a
  // shelf that blamed focus for a queue the clock had already emptied would
  // send you to the wrong dial.
  const beyondWindow = inWindow.length === 0;
  const beyondFocus = !beyondWindow && admitted.length === 0;
  const visible = admitted.length === 0 ? queue.slice(0, 1) : admitted;
```

And the return (:252):

```ts
    ...(beyondWindow ? { beyondWindow: true as const } : {}),
    ...(beyondFocus ? { beyondFocus: true as const } : {}),
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run src/lib/executionAdvisor.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and full suite**

Run: `npx tsc -b && npm test`
Expected: tsc exits 0; every existing advisor test still passes — no surface passes `focusLevel` yet, so behaviour is unchanged everywhere.

- [ ] **Step 8: Commit**

```bash
git add src/lib/executionAdvisor.ts src/lib/executionAdvisor.test.ts
git commit -m "feat(advisor): two dials compose, and an empty queue names which one emptied it"
```

---

### Task 6: Swap the dial — retire `shelfDetail`, wire focus through the shelf

**This task is atomic.** Deleting `shelfDetail` breaks four importers that only the focus dial can fix, so the tree does not typecheck partway through. Do all steps, then run the suite once.

**Files:**
- Delete: `src/lib/shelfDetail.ts`, `src/lib/shelfDetail.test.ts`
- Modify: `src/lib/assistantProtocol.ts` (:3, :43, :50, :110)
- Modify: `src/lib/sessionRing.ts` (:2, :46, :48)
- Modify: `src/components/assistant/AssistantSurface.tsx` (:9, :91-121, :371, :391, :481)
- Modify: `src/components/assistant/AssistantHost.tsx` (:40, :61-84, :99)
- Modify: `src/state/store.ts` (:71, :224, :277, :1992)
- Modify: `electron/assistantIpc.cjs` (`validSnapshot`, `validAction`)
- Modify: `src/components/assistant/AssistantSurface.test.tsx`, `src/lib/sessionRing.test.ts`

**Interfaces:**
- Consumes: `FocusLevel`, `FOCUS_LEVELS`, `FOCUS_WORD`, `DEFAULT_FOCUS_LEVEL` (Task 3); `focusLevel` state and `setFocusLevel` (Task 4); `beyondFocus` (Task 5).
- Produces: `AssistantSnapshot.focusLevel: FocusLevel`; `AssistantAction` member `{ type: 'set-focus-level'; level: FocusLevel }`; `ringState(..., focus: FocusLevel)`; `elapsedAgainstExpected(elapsedMin, expected, level: FocusLevel)`.

- [ ] **Step 1: Delete the retired module**

```bash
git rm src/lib/shelfDetail.ts src/lib/shelfDetail.test.ts
```

- [ ] **Step 2: Re-point `assistantProtocol.ts`**

Replace the import at `:3`:

```ts
import { DEFAULT_FOCUS_LEVEL, type FocusLevel } from './focusLens';
```

In `AssistantSnapshot`'s `ready` branch, replace the `detailLevel` field:

```ts
      /** How much focus is available. Decides what the work has to be light enough for. */
      focusLevel: FocusLevel;
```

In `AssistantAction`, replace the `set-detail-level` member:

```ts
  | { type: 'set-focus-level'; level: FocusLevel }
```

In `elapsedAgainstExpected`, replace the third parameter:

```ts
  level: FocusLevel = DEFAULT_FOCUS_LEVEL,
```

The comment below it already says "the pressure in a running session was never the elapsed figure — it is the figure it is being measured against". Extend it:

```ts
  // At low focus the number survives and the verdict does not. The pressure in
  // a running session was never the elapsed figure — it is the figure it is
  // being measured against, and a target is the last thing you need when you
  // have already told the shelf you are running on empty.
```

- [ ] **Step 3: Re-point `sessionRing.ts`**

Replace the import at `:2`:

```ts
import type { FocusLevel } from './focusLens';
```

Rename the parameter at `:46` and its use at `:48`:

```ts
  focus: FocusLevel,
```
```ts
  if (focus === 'low') return { kind: 'turn' };
```

Update the docstring at `:17` from "At the lowest detail the ring turns whatever the evidence" to:

```ts
 * At the lowest focus the ring turns whatever the evidence, because
 * `elapsedAgainstExpected` already drops the comparison there. A graphic that
 * kept asserting a target the text had just withheld would make the card
 * contradict itself.
```

- [ ] **Step 4: Swap the dial in `AssistantSurface.tsx`**

Replace the import at `:9`:

```ts
import { FOCUS_LEVELS, FOCUS_WORD, type FocusLevel } from '../../lib/focusLens';
import { MAX_ALTERNATIVES } from '../../lib/executionAdvisor';
```

In `DialStrip`, rename the prop and swap the second dial's body:

```tsx
function DialStrip({ timeLevel, focusLevel, onAction, shelf }: {
  timeLevel: TimeLevel;
  focusLevel: FocusLevel;
  onAction: Props['onAction'];
  shelf: boolean;
}) {
```

and the second `<div>`:

```tsx
      <div className="flex items-center gap-2.5">
        <span className="text-meta font-semibold text-muted">Focus</span>
        <SegmentedSwitch
          label="How much focus you have"
          size="sm"
          value={focusLevel}
          options={FOCUS_LEVELS.map((value) => ({ value, label: FOCUS_WORD[value] }))}
          onChange={(next) => onAction({ type: 'set-focus-level', level: next })}
        />
      </div>
```

At `:371`, the cap is gone:

```tsx
  const alternatives = advice.alternatives.slice(0, MAX_ALTERNATIVES);
```

At `:391`, the one notice becomes two, and **the existing copy is corrected**. It currently reads "Nothing light left" for `beyondWindow`, which is a time verdict wearing a focus word — the two-dials spec called for this fix and it never landed:

```tsx
      {advice.beyondWindow && (
        <p className="text-meta text-muted">Nothing that short left — this is next when you&apos;re ready.</p>
      )}
      {advice.beyondFocus && (
        <p className="text-meta text-muted">Nothing light left — this is next when you&apos;re ready.</p>
      )}
```

At `:481`, pass the renamed field:

```tsx
<DialStrip timeLevel={snapshot.timeLevel} focusLevel={snapshot.focusLevel} onAction={onAction} shelf={shelf} />
```

Every remaining `detail` prop threaded into `AdvicePanel`/`FocusPanel` is renamed `focusLevel` and typed `FocusLevel`.

- [ ] **Step 5: Wire `AssistantHost.tsx`**

At `:40`, destructure `focusLevel` in place of `detailLevel`. In the `executionAdvice` call, pass it alongside `timeLevel`:

```ts
      today, week: weekOf(today), now: { date: today, minute: nowMinute() },
      timeLevel,
      focusLevel,
```

In the returned snapshot, `focusLevel,` replaces `detailLevel,`. Add `focusLevel` to the `useMemo` dependency array in place of `detailLevel`.

At `:99`, the action case:

```ts
      case 'set-focus-level': actions.setFocusLevel(action.level); return;
```

- [ ] **Step 6: Drop `detailLevel` from the store**

Remove the `shelfDetail` import (`:71`), the `detailLevel` AppState field (`:224`), its initial value (`:277`), and `setDetailLevel` (`:1992`). `focusLevel` and `setFocusLevel` from Task 4 already stand in its place.

- [ ] **Step 7: Update the Electron validator**

In `electron/assistantIpc.cjs`, `validSnapshot`:

```js
    && validLevel(snapshot.timeLevel)
    && validLevel(snapshot.focusLevel)
```

and in `validAction`:

```js
    case 'set-time-level':
    case 'set-focus-level':
      return validLevel(action.level);
```

- [ ] **Step 8: Update the two affected test files**

In `src/lib/sessionRing.test.ts`, rename every `detail` argument to a `FocusLevel` — the values are unchanged (`'low'|'medium'|'high'`), so this is a rename, not a behaviour change.

In `src/components/assistant/AssistantSurface.test.tsx`, replace every `detailLevel` in a snapshot fixture with `focusLevel`, and replace any assertion about `ALTERNATIVE_CAP` with one that both alternatives render. Add:

```tsx
it('shows two alternatives regardless of the focus dial', async () => {
  for (const focusLevel of ['low', 'medium', 'high'] as const) {
    cleanup();
    render(createElement(AssistantSurface, { snapshot: readySnapshot({ focusLevel }), onAction: () => {} }));
    expect(screen.getAllByRole('button', { name: /alternative/i }).length).toBeLessThanOrEqual(2);
  }
});

it('names the dial that emptied the queue', () => {
  render(createElement(AssistantSurface, {
    snapshot: readySnapshot({ advice: workAdvice({ beyondFocus: true }) }), onAction: () => {},
  }));
  expect(screen.getByText(/Nothing light left/)).toBeTruthy();
  expect(screen.queryByText(/Nothing that short left/)).toBeNull();
});
```

Build `readySnapshot`/`workAdvice` from the fixture helpers already at the top of that file rather than inventing new ones.

- [ ] **Step 9: Typecheck**

Run: `npx tsc -b`
Expected: exits 0. If it names `shelfDetail`, a re-point was missed.

- [ ] **Step 10: Full suite**

Run: `npm test`
Expected: 174 files pass (one fewer — `shelfDetail.test.ts` is gone), and `entryBoundary.test.ts` still passes.

- [ ] **Step 11: Commit**

```bash
git add -A src/lib src/components/assistant src/state/store.ts electron/assistantIpc.cjs
git commit -m "feat(shelf): Focus means how much of you is available, not how many options you see"
```

---

### Task 7: The four write actions

**Files:**
- Modify: `src/state/store.ts` (beside `setNodeEstimate` :1251 and `setNodesStatus` :1038)
- Create: `src/state/demandActions.test.ts`

**Interfaces:**
- Consumes: `Demand`, `isDemand` (Task 1).
- Produces: `actions.setNodeDemand(nodeId, next: Demand | null): void`; `actions.setTaskDemand(taskId, next: Demand | null): void`; `actions.setGoalDemand(goalId, next: Demand | null): void`; `actions.setNodesDemand(ids: string[], next: Demand | null): boolean`.

Every one arms an undo, matching `setNodeEstimate`'s posture exactly — a property write from a menu is a distance write, and the label is what makes the toast honest. `null` clears, and clearing DELETES the key rather than storing a sentinel.

- [ ] **Step 1: Write the failing test**

Create `src/state/demandActions.test.ts`, mirroring the mock setup at the top of `src/components/GoalTree.status.test.tsx` (`vi.hoisted` db mocks, jsdom environment):

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { demandIndex } from '../lib/demand';
import type { Goal } from '../db/types';

describe('setNodeDemand', () => {
  it('sets a value, and the tree resolves it', () => {
    const goals: Goal[] = [{ id: 'g', title: 'g', nodes: [{ id: 'a', title: 'a' }] }];
    goals[0].nodes[0].demand = 'deep';
    expect(demandIndex(goals).get('a')).toEqual({ level: 'deep', source: 'own' });
  });

  it('clearing DELETES the key rather than storing a sentinel', () => {
    const node: Goal['nodes'][number] = { id: 'a', title: 'a', demand: 'deep' };
    delete node.demand;
    expect('demand' in node).toBe(false);
  });
});
```

Then add the real store assertions using the same `useAppStore` harness the other store tests use — read `src/components/GoalTree.status.test.tsx` for how it hydrates and dispatches before writing them.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/state/demandActions.test.ts`
Expected: FAIL until the actions exist.

- [ ] **Step 3: Implement, beside `setNodeEstimate`**

```ts
  /**
   * A node's own demand. Containers included — a container's value is what the
   * whole subtree inherits, and that is the gesture that keeps this from being
   * a field filled in by hand for every task.
   *
   * Unlike `setNodeEstimate` there is no leaves-only guard, and that absence is
   * the point.
   */
  setNodeDemand(nodeId: string, next: Demand | null): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = state.goals.map((g) => ({ ...g, nodes: structuredClone(g.nodes) }));
    const node = findInAll(goals, nodeId);
    if (!node) return;
    const before = node.demand;
    const value = next === null ? undefined : next;
    if (before === value) return;
    if (value === undefined) delete node.demand;
    else node.demand = value;
    withUndo(describeDemandChange(node.title, value), 'goals', goals);
  },

  setGoalDemand(goalId: string, next: Demand | null): void {
    const target = state.goals.find((g) => g.id === goalId);
    const value = next === null ? undefined : next;
    if (!target || target.demand === value) return;
    const goals = state.goals.map((g) => {
      if (g.id !== goalId) return g;
      const copy = { ...g };
      if (value === undefined) delete copy.demand;
      else copy.demand = value;
      return copy;
    });
    withUndo(describeDemandChange(target.title, value), 'goals', goals);
  },

  setTaskDemand(taskId: string, next: Demand | null): void {
    const target = state.tasks.find((t) => t.id === taskId);
    const value = next === null ? undefined : next;
    if (!target || target.demand === value) return;
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const copy = { ...t };
      if (value === undefined) delete copy.demand;
      else copy.demand = value;
      return copy;
    });
    withUndo(describeDemandChange(target.title, value), 'tasks', tasks);
  },
```

Beside `setNodesStatus`, the bulk form — **one write, one undo entry**, never a loop over the single action:

```ts
  setNodesDemand(ids: string[], next: Demand | null): boolean {
    const wanted = new Set(ids.filter((id) => isActiveNode(id)));
    if (wanted.size === 0) return false;
    const goals = cloneGoals(state.goals);
    const value = next === null ? undefined : next;
    let count = 0;
    for (const g of goals) {
      const visit = (nodes: GoalNode[]): void => {
        for (const n of nodes) {
          if (wanted.has(n.id) && n.demand !== value) {
            if (value === undefined) delete n.demand;
            else n.demand = value;
            count++;
          }
          if (n.children?.length) visit(n.children);
        }
      };
      visit(g.nodes);
    }
    if (count === 0) return false;
    withUndo(
      value === undefined
        ? `Cleared focus needed on ${count} task${count === 1 ? '' : 's'}`
        : `Set ${count} task${count === 1 ? '' : 's'} to ${DEMAND_WORD[value]}`,
      'goals',
      goals,
    );
    return true;
  },
```

And the shared label helper, near the other `describe*` helpers in `store.ts`:

```ts
function describeDemandChange(title: string, next: Demand | undefined): string {
  return next === undefined
    ? `Cleared focus needed on "${title}"`
    : `Set "${title}" to ${DEMAND_WORD[next]}`;
}
```

Import `Demand`, `DEMAND_WORD` from `../lib/demand`.

- [ ] **Step 4: Run the test, typecheck, full suite**

Run: `npx vitest run src/state/demandActions.test.ts && npx tsc -b && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/demandActions.test.ts
git commit -m "feat(demand): set it on a node, a goal, a task, or a selection"
```

---

### Task 8: `TaskPage` states it, and offers the editor

**Files:**
- Modify: `src/views/project/TaskPage.tsx` (beside the Status `PropertyLine` at :267-300)
- Modify: `src/views/project/TaskPage.test.tsx` (or create if absent)

**Interfaces:**
- Consumes: `DEMANDS`, `DEMAND_WORD`, `demandIndex` (Tasks 1-2); `actions.setNodeDemand` (Task 7).
- Produces: nothing downstream.

The label is **"Focus needed"**, never "Focus". The dial says how much focus you HAVE; this says how much the work WANTS. One word cannot mean both on one product, and the values (`Light/Moderate/Deep` against `Low/Medium/High`) are not enough on their own.

- [ ] **Step 1: Write the failing test**

```tsx
it('states the resolved value and names where an inherited one came from', () => {
  // goal 'Thesis' tagged deep; leaf untagged
  renderTaskPage({ goalDemand: 'deep', nodeDemand: undefined, goalTitle: 'Thesis' });
  expect(screen.getByRole('button', { name: 'Focus needed: Deep' })).toBeTruthy();
  expect(screen.getByText(/from Thesis/)).toBeTruthy();
});

it('states an own value without a provenance note', () => {
  renderTaskPage({ goalDemand: 'deep', nodeDemand: 'light', goalTitle: 'Thesis' });
  expect(screen.getByRole('button', { name: 'Focus needed: Light' })).toBeTruthy();
  expect(screen.queryByText(/from Thesis/)).toBeNull();
});

it('reads as unset, quietly, when nothing is tagged anywhere', () => {
  renderTaskPage({ goalDemand: undefined, nodeDemand: undefined, goalTitle: 'Thesis' });
  expect(screen.getByRole('button', { name: 'Focus needed: Not set' })).toBeTruthy();
});
```

Build `renderTaskPage` from the harness already used by the other `src/views/project/` component tests.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/views/project/TaskPage.test.tsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Implement, directly below the Status `PropertyLine`**

```tsx
          <PropertyLine
            label="Focus needed"
            icon={<IconCircle size={13} />}
            value={resolved ? DEMAND_WORD[resolved.level] : null}
            placeholder="Not set"
            panelWidth={188}
          >
            {(close) => (
              <>
                {DEMANDS.map((d) => (
                  <PropertyOption
                    key={d}
                    close={close}
                    current={resolved?.source === 'own' && resolved.level === d}
                    onSelect={() => actions.setNodeDemand(node.id, d)}
                  >
                    {DEMAND_WORD[d]}
                  </PropertyOption>
                ))}
                <PropertyOption
                  close={close}
                  current={node.demand === undefined}
                  onSelect={() => actions.setNodeDemand(node.id, null)}
                >
                  Not set
                </PropertyOption>
              </>
            )}
          </PropertyLine>
          {resolved?.source === 'inherited' && (
            <p className="text-meta text-muted">Inherited from {goalOrContainerTitle}</p>
          )}
```

where `resolved` comes from `demandIndex([goal]).get(node.id)`, memoized on `goal`.

**`placeholder="Not set"` renders `text-muted`, never `text-faint`** — an unset property is read, and it is the only affordance for setting one.

- [ ] **Step 4: Run the test, typecheck, full suite**

Run: `npx vitest run src/views/project/TaskPage.test.tsx && npx tsc -b && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/views/project/TaskPage.tsx src/views/project/TaskPage.test.tsx
git commit -m "feat(task page): a task states the focus it needs, and where that came from"
```

---

### Task 9: `StepPanel` — the one-gesture project tag

**Files:**
- Modify: `src/views/project/StepPanel.tsx` (beside the `PropertyRow` Dates block at :145-175)
- Modify: `src/views/project/StepPanel.test.tsx` (or `src/components/GoalTree.stepPanel.test.tsx`)

**Interfaces:** consumes the same as Task 8; uses `PropertyRow` (no label column) rather than `PropertyLine`.

This is the highest-value editor in the plan: it is where one gesture tags a whole subtree.

- [ ] **Step 1: Write the failing test**

```tsx
it('tags every step under a container in one gesture', async () => {
  const user = userEvent.setup();
  renderStepPanel({ containerTitle: 'Thesis', children: ['Lit review', 'Draft ch. 2'] });
  await user.click(screen.getByRole('button', { name: /Focus needed/ }));
  await user.click(screen.getByRole('menuitem', { name: 'Deep' }));
  expect(screen.getByRole('button', { name: 'Focus needed: Deep' })).toBeTruthy();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/GoalTree.stepPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement, below the Dates `PropertyRow`**

```tsx
        <PropertyRow
          label="Focus needed"
          icon={<IconCircle size={13} />}
          value={resolved ? DEMAND_WORD[resolved.level] : null}
          placeholder="Not set"
          panelWidth={188}
        >
          {(close) => (
            <>
              {DEMANDS.map((d) => (
                <PropertyOption
                  key={d}
                  close={close}
                  current={resolved?.source === 'own' && resolved.level === d}
                  onSelect={() => actions.setNodeDemand(node.id, d)}
                >
                  {DEMAND_WORD[d]}
                </PropertyOption>
              ))}
              <PropertyOption
                close={close}
                current={node.demand === undefined}
                onSelect={() => actions.setNodeDemand(node.id, null)}
              >
                Not set
              </PropertyOption>
            </>
          )}
        </PropertyRow>
```

Note this is a real editor, unlike the inert `PropertyStatic` the container's STATUS gets — a container's status is derived from its descendants, but its demand is declared and flows the other way.

- [ ] **Step 4: Run the test, typecheck, full suite**

Run: `npx vitest run src/components/GoalTree.stepPanel.test.tsx && npx tsc -b && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/views/project/StepPanel.tsx src/components/GoalTree.stepPanel.test.tsx
git commit -m "feat(step panel): tag a container and the subtree inherits it"
```

---

### Task 10: The goal-level tag in `ProjectHeader`

**Files:**
- Modify: `src/views/project/ProjectHeader.tsx` (the flex group at :107, after `GoalMetaPopover` and before `HeaderMenu`)
- Modify: `src/views/project/ProjectHeader.test.tsx` (or create)

**Interfaces:** consumes `actions.setGoalDemand` (Task 7).

This is the location the spec deliberately left unsited. It goes in the header's control group, NOT inside `HeaderMenu`: the menu holds Complete/Reopen — irreversible lifecycle verbs — and a property editor among them would read as one.

- [ ] **Step 1: Write the failing test**

```tsx
it('tags the whole project from the header', async () => {
  const user = userEvent.setup();
  renderProjectHeader({ title: 'Thesis' });
  await user.click(screen.getByRole('button', { name: /Focus needed/ }));
  await user.click(screen.getByRole('menuitem', { name: 'Deep' }));
  expect(screen.getByRole('button', { name: 'Focus needed: Deep' })).toBeTruthy();
});

it('is absent on a completed project, which is frozen', () => {
  renderProjectHeader({ title: 'Thesis', isCompleted: true });
  expect(screen.queryByRole('button', { name: /Focus needed/ })).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/views/project/ProjectHeader.test.tsx`

- [ ] **Step 3: Implement**

Insert into the flex group, after the `{metaOpen && <GoalMetaPopover … />}` block and before `HeaderMenu`:

```tsx
        {!isCompleted && (
          <Popover
            label={g.demand ? `Focus needed: ${DEMAND_WORD[g.demand]}` : 'Focus needed: Not set'}
            role="menu"
            align="end"
            panelWidth={188}
            triggerClassName="text-meta px-[8px] py-[5px] rounded-field hover:bg-hover text-muted"
            trigger={g.demand ? DEMAND_WORD[g.demand] : 'Focus'}
          >
            {(close) => (
              <>
                {DEMANDS.map((d) => (
                  <PropertyOption
                    key={d}
                    close={close}
                    current={g.demand === d}
                    onSelect={() => actions.setGoalDemand(g.id, d)}
                  >
                    {DEMAND_WORD[d]}
                  </PropertyOption>
                ))}
                <PropertyOption
                  close={close}
                  current={g.demand === undefined}
                  onSelect={() => actions.setGoalDemand(g.id, null)}
                >
                  Not set
                </PropertyOption>
              </>
            )}
          </Popover>
        )}
```

- [ ] **Step 4: Run the test, typecheck, full suite**

Run: `npx vitest run src/views/project/ProjectHeader.test.tsx && npx tsc -b && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/views/project/ProjectHeader.tsx src/views/project/ProjectHeader.test.tsx
git commit -m "feat(project header): tag a whole project's focus in one gesture"
```

---

### Task 11: The row `⋯` verb

**Files:**
- Modify: `src/lib/rowActions.ts` (`RowActionId`, `rowActions`)
- Modify: `src/lib/rowActions.test.ts`
- Modify: `src/components/RowActions.tsx`
- Modify: `src/components/GoalTree.rowActions.test.tsx`

**Interfaces:**
- Produces: `RowActionId` gains `'demand'`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rowActions.test.ts`:

```ts
describe('the focus-needed verb', () => {
  const ctx = (over: Partial<RowActionContext> = {}): RowActionContext =>
    ({ isContainer: false, isDone: false, isMilestone: false, canIndent: false, canOutdent: false, ...over });

  it('is offered on a LEAF', () => {
    expect(rowActions(ctx()).map((a) => a.id)).toContain('demand');
  });

  it('is offered on a CONTAINER too — the first verb that is', () => {
    expect(rowActions(ctx({ isContainer: true })).map((a) => a.id)).toContain('demand');
  });

  it('sits with the other property verbs, not with the move or delete runs', () => {
    const found = rowActions(ctx()).find((a) => a.id === 'demand');
    expect(found?.group).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/rowActions.test.ts`
Expected: FAIL — `'demand'` is not assignable to `RowActionId`.

- [ ] **Step 3: Implement**

Add `| 'demand'` to `RowActionId`. In `rowActions`, after the `if (!ctx.isContainer)` block closes:

```ts
  // The first verb offered on BOTH a leaf and a container. Schedule and Estimate
  // are leaf-only because the store has no container equivalent; demand DOES
  // have one, and a container's is the whole point — it is what the subtree
  // inherits.
  out.push({ id: 'demand', label: 'Focus needed…', group: 1 });
```

In `RowActions.tsx`, bind it to a `Popover` over `DEMANDS` calling `actions.setNodeDemand`, matching how `estimate` is bound there.

- [ ] **Step 4: Run the tests, typecheck, full suite**

Run: `npx vitest run src/lib/rowActions.test.ts src/components/GoalTree.rowActions.test.tsx && npx tsc -b && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/lib/rowActions.ts src/lib/rowActions.test.ts src/components/RowActions.tsx src/components/GoalTree.rowActions.test.tsx
git commit -m "feat(row menu): focus needed, on a leaf and on a container"
```

---

### Task 12: The bulk bar

**Files:**
- Modify: `src/components/GoalTree.tsx` (`SelectionBar` :191-275, and its call site)
- Modify: `src/components/GoalTree.selection.test.tsx`

**Interfaces:** consumes `actions.setNodesDemand` (Task 7).

- [ ] **Step 1: Write the failing test**

```tsx
it('sets focus needed on a selection in ONE undoable write', async () => {
  const user = userEvent.setup();
  await selectTwoRows(user);
  await user.selectOptions(screen.getByLabelText('Set focus needed'), 'deep');
  expect(screen.getByText('Set 2 tasks to Deep')).toBeTruthy();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/GoalTree.selection.test.tsx`

- [ ] **Step 3: Implement**

Add `onSetDemand: (next: Demand) => void` to `SelectionBar`'s props and render a second select immediately after the status one, matching its classes exactly:

```tsx
            <select
              value=""
              onChange={(e) => {
                const next = e.target.value as Demand;
                if (next) onSetDemand(next);
                e.target.value = '';
              }}
              aria-label="Set focus needed"
              className="text-compact font-medium text-ink-soft px-[8px] py-[4px] min-h-[24px] rounded-field border border-line-2 bg-transparent hover:bg-hover focus-visible:border-accent"
            >
              <option value="" disabled>Set focus needed…</option>
              {DEMANDS.map((d) => (
                <option key={d} value={d}>{DEMAND_WORD[d]}</option>
              ))}
            </select>
```

Wire the call site to `actions.setNodesDemand(selectedIds, next)`. **It returns a boolean; do not report success on a refusal.**

- [ ] **Step 4: Run the test, typecheck, full suite**

Run: `npx vitest run src/components/GoalTree.selection.test.tsx && npx tsc -b && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/components/GoalTree.tsx src/components/GoalTree.selection.test.tsx
git commit -m "feat(bulk): set focus needed on a selection in one write"
```

---

### Task 13: The row chip — only where it is set

**Files:**
- Modify: `src/components/GoalTree.tsx` (insert after the milestone badge at :792-796, before the WHEN cell at :867)
- Create: `src/components/GoalTree.demand.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('draws a chip where the value is SET', () => {
  renderTree({ goalDemand: undefined, nodes: [{ id: 'a', title: 'a', demand: 'deep' }] });
  expect(screen.getByText('Deep')).toBeTruthy();
});

it('draws NOTHING where the value is inherited — a chip marks a change, not a repetition', () => {
  renderTree({ goalDemand: 'deep', nodes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] });
  expect(screen.queryByText('Deep')).toBeNull();
});

it('draws a chip on a leaf that OVERRIDES its inherited value', () => {
  renderTree({ goalDemand: 'deep', nodes: [{ id: 'a', title: 'a', demand: 'light' }] });
  expect(screen.getByText('Light')).toBeTruthy();
  expect(screen.queryByText('Deep')).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/GoalTree.demand.test.tsx`

- [ ] **Step 3: Implement**

Insert between the milestone badge and the WHEN cell. The condition is `n.demand !== undefined` — the RAW field, never the resolved value, which is what makes it "set here" rather than "true here":

```tsx
        {n.demand !== undefined && (
          <span className="text-meta text-muted flex-none px-[5px] py-[3px] truncate">
            {DEMAND_WORD[n.demand]}
          </span>
        )}
```

No border and no `border-dashed`: `border-dashed` is reserved for the drop preview and a guessed-hour calendar block, and a bordered chip here would out-weigh the title beside it.

- [ ] **Step 4: Run the test, typecheck, full suite**

Run: `npx vitest run src/components/GoalTree.demand.test.tsx && npx tsc -b && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/components/GoalTree.tsx src/components/GoalTree.demand.test.tsx
git commit -m "feat(tree): a chip marks where the focus changes, never where it repeats"
```

---

### Task 14: Re-measure the shelf's `HEIGHT`

**This cannot be done in jsdom.** The shelf's card hugs its content on macOS and the window **clips rather than scrolls**, so anything past the budget is invisible, not merely awkward. Retiring `ALTERNATIVE_CAP` took the default alternative count from 1 to 2, which makes the common state taller than the number currently in the file was measured against.

**Files:**
- Modify: `electron/assistantWindow.cjs` (`HEIGHT`)

- [ ] **Step 1: Measure the tallest state for real**

Render `AssistantSurface` in a hidden Electron `BrowserWindow` at **620px wide** and measure the card's `scrollHeight` in each state: idle with two alternatives, `active`, `break`, and `confirming` with a notice. Do not derive the figure from the type scale — arithmetic put a state 20px low once already.

- [ ] **Step 2: Set `HEIGHT` to the measured maximum**

Update the constant and its comment with the measured figure, the state it came from, and the date.

- [ ] **Step 3: Verify no state clips**

Launch `npm run app:dev`, open the shelf with the configured accelerator, and confirm each of the four states renders complete. The `⌘Space` NSPanel is invisible to screenshot tooling — probe it with the System Events AX window list if automated verification is wanted.

- [ ] **Step 4: Commit**

```bash
git add electron/assistantWindow.cjs
git commit -m "fix(shelf): re-measure the budget against a second alternative"
```

---

## Self-Review

**Spec coverage.** §1 fields → Task 1. §2 `demandIndex` → Task 2. §3 dial, untagged-admitted, new storage key, daily reset → Tasks 3-4. §3 commitments and `beyondFocus` → Task 5. §4 `shelfDetail` retirement and the two re-pointings → Task 6. §5 four editors → Tasks 8-12, goal-level sited in Task 10. §5 row chip → Task 13. The `HEIGHT` invariant → Task 14.

**Deviation from the spec, recorded.** The spec says the editors are labelled "Focus". They are labelled **"Focus needed"**. Labelling a task property "Focus" would rebuild the exact collision this work exists to remove — the dial means focus available, the property means focus required — and the differing value words are not enough on their own. Storage stays `demand`, following `checkpoint`/Milestone.

**Not in the spec, added.** `beyondFocus` as a verdict distinct from `beyondWindow` (Task 5). With two dials an emptied queue must name which dial emptied it, and this also corrects live copy: `beyondWindow` currently renders "Nothing light left", a focus word on a time verdict.

**Ordering.** Nothing reads `focusLevel` until Task 6, so Tasks 1-5 cannot change behaviour. Task 6 is deliberately atomic — the tree does not typecheck partway through it.
