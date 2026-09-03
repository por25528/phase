# Study Topics and Confidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A study goal's topics carry a confidence instead of a checkbox, the shelf asks for it when a sitting on a topic ends, and the weakest topic of the nearest exam leads Today, the shelf and the advisor.

**Architecture:** Two optional fields on `GoalNode` (`confidence`, `confidenceAt`) and one container flag (`topics`), read through a single vocabulary module `src/lib/confidence.ts`. A topic is never `done`; its completion fraction in the roll-up is its confidence weight. Ordering rides the existing `sortByDue` by giving every topic the exam date as its due. The rating moment is a fourth focus-draft phase, `'rating'`, entered only after a session on a topic has been logged. Spec: `docs/superpowers/specs/2026-09-03-study-confidence-design.md` — read it first.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind, Dexie, Electron; Vitest (`npm test` from `PhaseApp/`), `npx tsc -b`, `npm run build`.

## Global Constraints

- All work happens inside `PhaseApp/`. Run every command from `PhaseApp/`.
- `PhaseApp/CLAUDE.md` is the authority. Read its **Layers** and **Invariants** sections before Task 1. Match its comment density and voice — comments say WHY, in full sentences.
- `src/lib/*` is pure and every new module ships a sibling `*.test.ts`. `src/lib` never imports `src/views` or `src/components`.
- Views never call `db` directly; every mutation is a store action calling `setAndPersist` / `withUndo` / `withUndoSlices`.
- Absent is never written as a default: `confidence`/`confidenceAt` are deleted, never set to `undefined` or `null`; `topics` is `true` or absent.
- A topic never carries `status: 'done'` or `doneAt`. Logged time never moves a number; a rating does.
- The three confidence words are `shaky` / `okay` / `solid` in storage AND in copy (`CONFIDENCE_WORD` capitalises for buttons). Absent is "not rated yet".
- Every refusal is a returned value (`false`, `'refused'`, `errorResponse`), never a throw.
- New assistant actions and snapshot fields must be added to BOTH `src/lib/assistantProtocol.ts` and `electron/assistantIpc.cjs`; `electron/assistantIpc.test.ts` walks the union and fails otherwise.
- New agent tools must be added to `AGENT_TOOLS` in `src/lib/agentProtocol.ts`, `validAgentRequest`, `agentWrites.ts`, and `mcp/server.js`; `agentProtocol.test.ts` pins the server's list.
- The PhasePhone companion is out of scope; do not touch `PhasePhone/`.
- Commit after every task with a message in the repo's style (`feat(app): …`, `test(app): …`, `docs(app): …`), lower-case, one line that says what changed and why it reads that way.

## File map

| File | Responsibility in this change |
|---|---|
| `src/db/types.ts` | `Confidence` type; `topics`, `confidence`, `confidenceAt` on `GoalNode` |
| `src/lib/confidence.ts` (new) | The one vocabulary: words, ranks, weights, `topicIds`, `sortForReview`, `readiness`, `applyConfidence` |
| `src/lib/pct.ts` | Topic completion fraction = confidence weight |
| `src/lib/board.ts` | `leafCount`: a topic is never done |
| `src/lib/effort.ts` | `readiness` on `GoalEffort`; topic-aware describers |
| `src/lib/backlog.ts` | Topic items ordered for review, exam date as due, `topic`/`confidence` on items |
| `src/lib/todayPlan.ts` | `ProposalRow` carries `topic`/`confidence` through |
| `src/lib/executionAdvisor.ts` | `'review'` reason; `topic`/`confidence` on `RecommendedWork` |
| `src/lib/dailyWork.ts` | `topic`/`confidence` on `DailyWorkItem` |
| `src/lib/focusSession.ts`, `src/lib/focusStatus.ts` | `'rating'` phase |
| `src/lib/migrateNodeStatus.ts` | Drop half a rating on load/import |
| `src/state/store.ts` | `rateTopic`, `setTopicsArea`, `rateFocus`, refusals, `addRootNodes` flags, rating transition |
| `src/lib/agentProtocol.ts`, `src/lib/agentWrites.ts`, `src/lib/agentReads.ts`, `mcp/server.js`, `src/lib/sync/replay.ts` | `rate_topic`; topic refusals mirrored |
| `src/lib/assistantProtocol.ts`, `electron/assistantIpc.cjs` | `rate-focus` action, `topic`/`confidence` fields, `'rating'` phase, `'review'` reason |
| `electron/shellIpc.cjs`, `electron/idleWatch.cjs`, `electron/overlayWindow.cjs`, `electron/menuBar.cjs` | `'rating'` treated exactly as `'confirming'` |
| `src/components/assistant/AssistantSurface.tsx`, `AssistantHost.tsx` | Rating band; topic rows without a tick; host dispatch |
| `scripts/measure-shelf.cjs`, `electron/assistantWindow.cjs` | `rating` state measured; `HEIGHT` ledger |
| `src/components/StatusMark.tsx` | `ConfidenceMark` |
| `src/components/GoalTree.tsx`, `src/components/RowActions.tsx` | `ConfidenceBox` on topic rows; Topics chip; Treat as topics |
| `src/views/project/TaskPage.tsx` | Confidence property line (the correction surface) |
| `src/views/plan/sidebar/Backlog.tsx`, `src/views/Today.tsx` | Confidence mark instead of checkbox on topic rows |
| `src/lib/goalType.ts`, `src/views/project/StepsTab.tsx` | Study template creates a flagged `Topics` area |
| `src/views/project/ProjectHeader.tsx`, `OverviewTab.tsx` | `describeReadiness` beside the percentage |
| `PhaseApp/CLAUDE.md` | One invariant paragraph on topics |

---

### Task 1: Types and the confidence vocabulary

**Files:**
- Modify: `src/db/types.ts` (the `GoalNode` interface, after `notes?: string;`)
- Create: `src/lib/confidence.ts`
- Test: `src/lib/confidence.test.ts`

**Interfaces:**
- Produces: `Confidence`, `CONFIDENCES`, `CONFIDENCE_WORD`, `CONFIDENCE_RANK`, `CONFIDENCE_WEIGHT`, `isConfidence`, `topicIds(g)`, `isTopic(g, id)`, `topicConfidence(n)`, `confidenceRank(n)`, `sortForReview(topics)`, `readiness(g)`, `describeReadiness(r)`, `applyConfidence(n, next, today)`, `topicAgeLabel(n, today)`.

- [ ] **Step 1: Add the fields to `GoalNode`**

In `src/db/types.ts`, add near the top (after `StepStatus`):

```ts
/**
 * How ready a TOPIC is to be examined on. Stored on a leaf beneath a topics
 * area, with the day it was rated; absent means not yet studied, and absent
 * is never written as a fourth word — the same rule `status` follows for
 * `'todo'`. Read through `src/lib/confidence.ts`, never directly.
 */
export type Confidence = 'shaky' | 'okay' | 'solid';
```

And inside `GoalNode`, after `notes?: string;`:

```ts
  /**
   * A topics area: every LEAF beneath this node, at any depth, is a topic —
   * a thing you are studying for an exam rather than a thing you tick. A
   * topic carries `confidence` instead of ever reaching `status: 'done'`.
   * Set on a container, or on a leaf about to become one (the study template
   * creates the area empty). Where a leaf lives says what it is: drag a row
   * out and it is a step again.
   */
  topics?: true;
  /**
   * A topic's confidence and the day it was rated. Both present or both
   * absent, written together by `rateTopic` and nothing else. Never affects
   * scheduling metadata; it is what a study goal's roll-up reads instead of
   * `status`. A leaf dragged out of a topics area keeps a stale pair —
   * nothing reads it there, and it comes back with the row.
   */
  confidence?: Confidence;
  confidenceAt?: string; // 'YYYY-MM-DD' local
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/confidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import {
  CONFIDENCE_RANK, CONFIDENCE_WEIGHT, isConfidence, topicIds, isTopic, topicConfidence,
  confidenceRank, sortForReview, readiness, describeReadiness, applyConfidence, topicAgeLabel,
} from './confidence';

const TODAY = '2026-09-03';

function leaf(over: Partial<GoalNode> & { id: string }): GoalNode {
  return { title: over.id, ...over };
}
function goal(nodes: GoalNode[]): Goal {
  return { id: 'g1', title: 'Algorithms', type: 'study', deadline: '2026-09-20', datesConfirmed: true, nodes };
}
/** Topics area with three topics, plus an ordinary Practice step beside it. */
function subject(): Goal {
  return goal([
    { id: 'area', title: 'Topics', topics: true, children: [
      leaf({ id: 'dp', title: 'Dynamic programming' }),
      leaf({ id: 'graphs', title: 'Graphs', confidence: 'shaky', confidenceAt: '2026-09-01' }),
      { id: 'sub', title: 'Sorting', children: [
        leaf({ id: 'merge', title: 'Merge sort', confidence: 'solid', confidenceAt: '2026-08-20' }),
      ] },
    ] },
    { id: 'practice', title: 'Practice', children: [leaf({ id: 'ps1', title: 'Problem set 1' })] },
  ]);
}

describe('vocabulary', () => {
  it('ranks and weights are monotone', () => {
    expect(CONFIDENCE_RANK.shaky).toBeLessThan(CONFIDENCE_RANK.okay);
    expect(CONFIDENCE_RANK.okay).toBeLessThan(CONFIDENCE_RANK.solid);
    expect(CONFIDENCE_WEIGHT.solid).toBe(1);
    expect(CONFIDENCE_WEIGHT.shaky).toBeCloseTo(1 / 3);
  });
  it('isConfidence admits the three words only', () => {
    expect(isConfidence('okay')).toBe(true);
    expect(isConfidence('done')).toBe(false);
    expect(isConfidence(undefined)).toBe(false);
  });
});

describe('topicIds / isTopic', () => {
  it('collects every leaf beneath a topics area, at any depth, and nothing else', () => {
    expect([...topicIds(subject())].sort()).toEqual(['dp', 'graphs', 'merge']);
    expect(isTopic(subject(), 'merge')).toBe(true);
    expect(isTopic(subject(), 'ps1')).toBe(false);
    expect(isTopic(subject(), 'area')).toBe(false); // the area itself is a container
  });
  it('an empty topics area (a leaf with the flag) is not a topic itself', () => {
    const g = goal([leaf({ id: 'area', title: 'Topics', topics: true })]);
    expect(topicIds(g).size).toBe(0);
  });
  it('a goal with no topics area has no topics', () => {
    expect(topicIds(goal([leaf({ id: 'a' })])).size).toBe(0);
  });
});

describe('topicConfidence / confidenceRank', () => {
  it('reads the pair and treats unrated as null / rank 0', () => {
    expect(topicConfidence(leaf({ id: 'a' }))).toBeNull();
    expect(confidenceRank(leaf({ id: 'a' }))).toBe(0);
    expect(topicConfidence(leaf({ id: 'a', confidence: 'okay', confidenceAt: TODAY }))).toBe('okay');
    expect(confidenceRank(leaf({ id: 'a', confidence: 'solid', confidenceAt: TODAY }))).toBe(3);
  });
  it('half a rating reads as unrated', () => {
    expect(topicConfidence(leaf({ id: 'a', confidence: 'okay' }))).toBeNull();
    expect(topicConfidence(leaf({ id: 'a', confidenceAt: TODAY }))).toBeNull();
  });
});

describe('sortForReview', () => {
  it('unrated first, then shaky, okay, solid', () => {
    const t = [
      leaf({ id: 'solid', confidence: 'solid', confidenceAt: TODAY }),
      leaf({ id: 'okay', confidence: 'okay', confidenceAt: TODAY }),
      leaf({ id: 'none' }),
      leaf({ id: 'shaky', confidence: 'shaky', confidenceAt: TODAY }),
    ];
    expect(sortForReview(t).map((n) => n.id)).toEqual(['none', 'shaky', 'okay', 'solid']);
  });
  it('inside a tier the oldest rating comes first; ties keep tree order', () => {
    const t = [
      leaf({ id: 'newer', confidence: 'okay', confidenceAt: '2026-09-02' }),
      leaf({ id: 'older', confidence: 'okay', confidenceAt: '2026-08-20' }),
      leaf({ id: 'same-a', confidence: 'okay', confidenceAt: '2026-09-02' }),
    ];
    expect(sortForReview(t).map((n) => n.id)).toEqual(['older', 'newer', 'same-a']);
  });
  it('does not mutate its input', () => {
    const t = [leaf({ id: 'b', confidence: 'solid', confidenceAt: TODAY }), leaf({ id: 'a' })];
    sortForReview(t);
    expect(t.map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('readiness / describeReadiness', () => {
  it('counts each tier over the goal\'s topics only', () => {
    expect(readiness(subject())).toEqual({ topics: 3, unrated: 1, shaky: 1, okay: 0, solid: 1 });
  });
  it('phrases the count', () => {
    expect(describeReadiness({ topics: 0, unrated: 0, shaky: 0, okay: 0, solid: 0 })).toBeNull();
    expect(describeReadiness({ topics: 8, unrated: 8, shaky: 0, okay: 0, solid: 0 })).toBe('8 topics, none rated yet');
    expect(describeReadiness({ topics: 8, unrated: 2, shaky: 1, okay: 2, solid: 3 })).toBe('3 of 8 topics solid');
    expect(describeReadiness({ topics: 8, unrated: 0, shaky: 0, okay: 0, solid: 8 })).toBe('All 8 topics solid');
    expect(describeReadiness({ topics: 1, unrated: 0, shaky: 0, okay: 0, solid: 1 })).toBe('All 1 topic solid');
  });
});

describe('applyConfidence', () => {
  it('writes both fields and clears both fields', () => {
    const rated = applyConfidence(leaf({ id: 'a' }), 'okay', TODAY);
    expect(rated).toEqual({ id: 'a', title: 'a', confidence: 'okay', confidenceAt: TODAY });
    const cleared = applyConfidence(rated, null, TODAY);
    expect(cleared).toEqual({ id: 'a', title: 'a' });
    expect('confidence' in cleared).toBe(false);
    expect('confidenceAt' in cleared).toBe(false);
  });
  it('returns a copy', () => {
    const n = leaf({ id: 'a' });
    applyConfidence(n, 'solid', TODAY);
    expect(n.confidence).toBeUndefined();
  });
});

describe('topicAgeLabel', () => {
  it('says when a topic was rated, or that it was not', () => {
    expect(topicAgeLabel(leaf({ id: 'a' }), TODAY)).toBe('not rated yet');
    expect(topicAgeLabel(leaf({ id: 'a', confidence: 'okay', confidenceAt: TODAY }), TODAY)).toBe('okay, rated today');
    expect(topicAgeLabel(leaf({ id: 'a', confidence: 'okay', confidenceAt: '2026-09-02' }), TODAY)).toBe('okay, rated yesterday');
    expect(topicAgeLabel(leaf({ id: 'a', confidence: 'solid', confidenceAt: '2026-08-31' }), TODAY)).toBe('solid, rated 3 days ago');
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/confidence.test.ts`
Expected: FAIL — `Cannot find module './confidence'`.

- [ ] **Step 4: Write `src/lib/confidence.ts`**

```ts
import type { Confidence, Goal, GoalNode } from '../db/types';
import { daysBetween } from './dates';

export type { Confidence };

/**
 * The one vocabulary for a topic's confidence, the way `status.ts` is the one
 * vocabulary for a step's status. Readers go through this module and never
 * touch `confidence` / `confidenceAt` directly.
 *
 * A topic is a leaf beneath a node carrying `topics: true`. It is never done;
 * it is `shaky`, `okay` or `solid`, or it has not been rated. The words are
 * about the STUDENT ("how solid is this now?"), not the work, which is why
 * they are not the demand words or the focus words.
 */

/** Ascending, and the order every control renders in. */
export const CONFIDENCES: readonly Confidence[] = ['shaky', 'okay', 'solid'];

export const CONFIDENCE_WORD: Record<Confidence, string> = {
  shaky: 'Shaky',
  okay: 'Okay',
  solid: 'Solid',
};

/** Unrated is 0 and is not in this table — see `confidenceRank`. Monotone. */
export const CONFIDENCE_RANK: Record<Confidence, number> = {
  shaky: 1,
  okay: 2,
  solid: 3,
};

/**
 * What a topic is worth to the roll-up: the fraction of "done" a rating
 * stands for. Linear on purpose — three even steps are the only reading a
 * three-word scale can defend.
 */
export const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  shaky: 1 / 3,
  okay: 2 / 3,
  solid: 1,
};

export function isConfidence(raw: unknown): raw is Confidence {
  return raw === 'shaky' || raw === 'okay' || raw === 'solid';
}

function isLeaf(n: GoalNode): boolean {
  return !n.children || n.children.length === 0;
}

/**
 * The ids of every topic in a goal — every LEAF beneath a `topics` node, at
 * any depth. The flag on an empty (leaf) area names nothing: an area with no
 * rows in it has no topics yet.
 */
export function topicIds(g: Goal): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: GoalNode[], inTopics: boolean): void => {
    for (const n of nodes) {
      const here = inTopics || n.topics === true;
      if (isLeaf(n)) {
        if (here && n.topics !== true) out.add(n.id);
        continue;
      }
      walk(n.children!, here);
    }
  };
  walk(g.nodes, false);
  return out;
}

export function isTopic(g: Goal, nodeId: string): boolean {
  return topicIds(g).has(nodeId);
}

/** `null` for an unrated topic — and for half a rating, which is not one. */
export function topicConfidence(n: GoalNode): Confidence | null {
  if (!isConfidence(n.confidence) || typeof n.confidenceAt !== 'string') return null;
  return n.confidence;
}

/** Unrated → 0, then `CONFIDENCE_RANK`. */
export function confidenceRank(n: GoalNode): number {
  const c = topicConfidence(n);
  return c === null ? 0 : CONFIDENCE_RANK[c];
}

/**
 * The review order within ONE subject: unrated first, then shaky, okay,
 * solid; inside a tier the OLDEST rating first; ties keep the order given
 * (tree order). This is the only ranking the feature adds, and it ranks
 * inside a subject — which subject leads is `sortByDue`'s call, fed the exam
 * date, so there is never a second cross-project opinion.
 */
export function sortForReview(topics: GoalNode[]): GoalNode[] {
  return [...topics].sort((a, b) => {
    const byRank = confidenceRank(a) - confidenceRank(b);
    if (byRank !== 0) return byRank;
    const aAt = topicConfidence(a) === null ? '' : a.confidenceAt!;
    const bAt = topicConfidence(b) === null ? '' : b.confidenceAt!;
    return aAt < bAt ? -1 : aAt > bAt ? 1 : 0;
  });
}

export interface Readiness {
  topics: number;
  unrated: number;
  shaky: number;
  okay: number;
  solid: number;
}

export function readiness(g: Goal): Readiness {
  const ids = topicIds(g);
  const r: Readiness = { topics: 0, unrated: 0, shaky: 0, okay: 0, solid: 0 };
  const walk = (nodes: GoalNode[]): void => {
    for (const n of nodes) {
      if (!isLeaf(n)) { walk(n.children!); continue; }
      if (!ids.has(n.id)) continue;
      r.topics += 1;
      const c = topicConfidence(n);
      if (c === null) r.unrated += 1;
      else r[c] += 1;
    }
  };
  walk(g.nodes);
  return r;
}

/** `3 of 8 topics solid` · `All 8 topics solid` · `8 topics, none rated yet` — `null` with no topics. */
export function describeReadiness(r: Readiness): string | null {
  if (r.topics === 0) return null;
  const noun = `topic${r.topics === 1 ? '' : 's'}`;
  if (r.solid === r.topics) return `All ${r.topics} ${noun} solid`;
  if (r.unrated === r.topics) return `${r.topics} ${noun}, none rated yet`;
  return `${r.solid} of ${r.topics} ${noun} solid`;
}

/**
 * Pure. Returns a copy with both fields written, or both removed for `null`.
 * The store copies the result back key by key, exactly as `writeStatus` does
 * for `applyStatus`, because assigning a copy over the live node would keep
 * the keys the copy dropped.
 */
export function applyConfidence(n: GoalNode, next: Confidence | null, today: string): GoalNode {
  const out: GoalNode = { ...n };
  if (next === null) {
    delete out.confidence;
    delete out.confidenceAt;
  } else {
    out.confidence = next;
    out.confidenceAt = today;
  }
  return out;
}

/** `solid, rated 3 days ago` / `not rated yet` — for aria labels and captions. */
export function topicAgeLabel(n: GoalNode, today: string): string {
  const c = topicConfidence(n);
  if (c === null) return 'not rated yet';
  const days = daysBetween(n.confidenceAt!, today);
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return `${c}, rated ${when}`;
}
```

Check `src/lib/dates.ts` for the day-difference helper's real name (`grep -n "^export function" src/lib/dates.ts`); if it is not `daysBetween(from, to)` returning whole days, use the one that is, or add a two-line local helper on `Date.UTC` of the two `YYYY-MM-DD` strings.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/confidence.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/db/types.ts src/lib/confidence.ts src/lib/confidence.test.ts
git commit -m "feat(app): confidence — the one vocabulary for a topic's readiness"
```

---

### Task 2: The roll-up reads confidence

**Files:**
- Modify: `src/lib/pct.ts` (`rollup`, `goalPct`, `goalPctBasis`, `nodePct`)
- Test: `src/lib/pct.test.ts`

**Interfaces:**
- Consumes: `CONFIDENCE_WEIGHT`, `topicConfidence` from Task 1.
- Produces: `goalPct(g)` unchanged in signature; a topic leaf's fraction is its weight. `nodePct(n)` gains an optional second argument `inTopics = false`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/pct.test.ts` (open it first to reuse its fixtures; add imports for `Goal` if missing):

```ts
describe('topics', () => {
  const topics = (kids: GoalNode[]): Goal => ({
    id: 'g', title: 'Algorithms', nodes: [{ id: 'area', title: 'Topics', topics: true, children: kids }],
  });
  it('an unrated topic is 0, shaky a third, okay two thirds, solid whole', () => {
    expect(goalPct(topics([{ id: 'a', title: 'A' }]))).toBe(0);
    expect(goalPct(topics([{ id: 'a', title: 'A', confidence: 'shaky', confidenceAt: '2026-09-01' }]))).toBeCloseTo(100 / 3);
    expect(goalPct(topics([{ id: 'a', title: 'A', confidence: 'okay', confidenceAt: '2026-09-01' }]))).toBeCloseTo(200 / 3);
    expect(goalPct(topics([{ id: 'a', title: 'A', confidence: 'solid', confidenceAt: '2026-09-01' }]))).toBe(100);
  });
  it('a topic ticked done by legacy data still reads its confidence, not the tick', () => {
    expect(goalPct(topics([{ id: 'a', title: 'A', status: 'done' }]))).toBe(0);
  });
  it('estimate weighting applies to topics like any leaf', () => {
    const g = topics([
      { id: 'a', title: 'A', estimateMin: 90, confidence: 'solid', confidenceAt: '2026-09-01' },
      { id: 'b', title: 'B', estimateMin: 30 },
    ]);
    expect(goalPct(g)).toBeCloseTo(75);
  });
  it('a mixed subject averages topics and steps by the same rules', () => {
    const g: Goal = {
      id: 'g', title: 'Algorithms', nodes: [
        { id: 'area', title: 'Topics', topics: true, children: [
          { id: 'a', title: 'A', confidence: 'solid', confidenceAt: '2026-09-01' },
        ] },
        { id: 'ps', title: 'Problem set' },
      ],
    };
    expect(goalPct(g)).toBe(50);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/pct.test.ts`
Expected: FAIL on the `shaky` / `solid` cases (they read 0 today).

- [ ] **Step 3: Implement**

In `src/lib/pct.ts`, import `CONFIDENCE_WEIGHT, topicConfidence` from `./confidence` and change `rollup`:

```ts
/**
 * `inTopics` is inherited down the tree from a node carrying `topics: true`.
 * A topic's fraction is its confidence weight, and its `status` is NOT read:
 * a topic never carries 'done' (the store refuses it), and a legacy tick on
 * one would otherwise flatter the subject by exactly the amount nobody rated.
 */
function rollup(n: GoalNode, inTopics = false): Rollup {
  const here = inTopics || n.topics === true;
  if (!n.children || n.children.length === 0) {
    const c = here ? topicConfidence(n) : null;
    return {
      pct: here ? (c === null ? 0 : CONFIDENCE_WEIGHT[c] * 100) : (isDone(n) ? 100 : 0),
      weight: normalizeEstimate(n.estimateMin) ?? null,
    };
  }
  return combine(n.children.map((k) => rollup(k, here)));
}

export function nodePct(n: GoalNode, inTopics = false): number {
  return rollup(n, inTopics).pct;
}
```

`goalPct` and `goalPctBasis` call `rollup` on root nodes with the default, which is correct: a root is never inside a topics area. Add to the file's header comment, after the paragraph on checkpoints: "A TOPIC (a leaf under a `topics` node) is the one leaf whose fraction is not 0 or 100: it is its confidence weight — see `confidence.ts`. That is still 'ticking moves a number' in spirit: a rating is a deliberate act on the row, and logged time still moves nothing."

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/lib/pct.test.ts` → PASS.

```bash
git add src/lib/pct.ts src/lib/pct.test.ts
git commit -m "feat(app): the roll-up reads a topic's confidence where a step's tick would be"
```

---

### Task 3: Leaf counts and effort learn topics

**Files:**
- Modify: `src/lib/board.ts` (`leafCount`)
- Modify: `src/lib/effort.ts` (`GoalEffort`, `goalEffort`, `describeEffort`, `effortPct`, `effortCount`)
- Test: `src/lib/board.test.ts`, `src/lib/effort.test.ts`, `src/lib/plan.test.ts`

**Interfaces:**
- Consumes: `readiness`, `describeReadiness`, `topicIds` from Task 1; `goalPct` from Task 2.
- Produces: `leafCount(nodes, inTopics = false)` — a topic counts in `total`, never in `done`. `GoalEffort.readiness: Readiness`. `effortPct(e, g?)` — when the goal has topics, draws `goalPct(g)`.

- [ ] **Step 1: Failing tests**

Append to `src/lib/board.test.ts`:

```ts
describe('leafCount and topics', () => {
  it('a topic counts as open whatever its confidence', () => {
    const nodes: GoalNode[] = [{ id: 'area', title: 'Topics', topics: true, children: [
      { id: 'a', title: 'A', confidence: 'solid', confidenceAt: '2026-09-01' },
      { id: 'b', title: 'B' },
    ] }, { id: 'ps', title: 'PS', status: 'done' }];
    expect(leafCount(nodes)).toEqual({ total: 3, done: 1 });
  });
});
```

Append to `src/lib/plan.test.ts` (reuse its `goal` fixture helper or build a `Goal` inline):

```ts
describe('paceStatus and a subject', () => {
  const subject = (confidence?: Confidence): Goal => ({
    id: 'g', title: 'Algorithms', start: '2026-08-01', deadline: '2026-09-30', datesConfirmed: true,
    nodes: [{ id: 'area', title: 'Topics', topics: true, children: [
      { id: 'a', title: 'A', ...(confidence ? { confidence, confidenceAt: '2026-09-01' } : {}) },
    ] }],
  });
  it('never reads complete, even with every topic solid', () => {
    expect(paceStatus(subject('solid'), '2026-09-03')).not.toBe('complete');
    expect(projectAttention(subject('solid'), '2026-09-03')).not.toBe('ready-to-complete');
  });
  it('reads behind when confidence lags the calendar', () => {
    // 33 of 60 days elapsed (~55%) against 0% confidence.
    expect(paceStatus(subject(), '2026-09-03')).toBe('behind');
  });
});
```

Append to `src/lib/effort.test.ts`:

```ts
describe('topics', () => {
  const subject: Goal = {
    id: 'g', title: 'Algorithms', nodes: [
      { id: 'area', title: 'Topics', topics: true, children: [
        { id: 'a', title: 'A', estimateMin: 45, confidence: 'solid', confidenceAt: '2026-09-01' },
        { id: 'b', title: 'B', estimateMin: 45 },
      ] },
      { id: 'ps', title: 'Problem set', estimateMin: 60 },
    ],
  };
  it('excludes topics from remaining and unestimated, and from total/done', () => {
    const e = goalEffort(subject);
    expect(e.remainingMin).toBe(60);
    expect(e.unestimated).toBe(0);
    expect(e.total).toBe(1);
    expect(e.done).toBe(0);
    expect(e.readiness).toEqual({ topics: 2, unrated: 1, shaky: 0, okay: 0, solid: 1 });
  });
  it('effortCount and describeEffort say readiness when topics exist', () => {
    const e = goalEffort(subject);
    expect(effortCount(e)).toBe('1 of 2 topics solid · 0 of 1 steps done');
    expect(describeEffort(e)).toBe('1 of 2 topics solid · 1h remaining · 0 of 1 task');
    const only = goalEffort({ ...subject, nodes: [subject.nodes[0]] });
    expect(effortCount(only)).toBe('1 of 2 topics solid');
    expect(describeEffort(only)).toBe('1 of 2 topics solid');
  });
  it('effortPct draws the confidence roll-up for a goal with topics', () => {
    expect(effortPct(goalEffort(subject), subject)).toBeCloseTo(goalPct(subject));
    const plain: Goal = { id: 'p', title: 'P', nodes: [{ id: 'x', title: 'X', status: 'done' }, { id: 'y', title: 'Y' }] };
    expect(effortPct(goalEffort(plain), plain)).toBe(50);
  });
});
```

Check `fmtMinutes(60)` prints `1h` (read `fmtMinutes` in `effort.ts`) and adjust the expected string to what it actually prints.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/board.test.ts src/lib/plan.test.ts src/lib/effort.test.ts`
Expected: FAIL (readiness undefined; `leafCount` counts the solid topic done; `complete` reached).

- [ ] **Step 3: Implement `leafCount`**

`src/lib/board.ts`:

```ts
/**
 * `inTopics` follows a `topics: true` node down. A topic is counted in
 * `total` and NEVER in `done`: a subject is not finished the day every topic
 * reads solid — that is the night before the exam, which is work to keep
 * warm — so `paceStatus` must never answer `'complete'` for it, and the rail
 * must never drop it as ready-to-complete.
 */
export function leafCount(nodes: GoalNode[], inTopics = false): { total: number; done: number } {
  let total = 0, done = 0;
  for (const n of nodes) {
    const here = inTopics || n.topics === true;
    if (n.children && n.children.length > 0) {
      const sub = leafCount(n.children, here);
      total += sub.total;
      done += sub.done;
    } else {
      total++;
      if (!here && isDone(n)) done++;
    }
  }
  return { total, done };
}
```

Then `grep -rn "leafCount(" src --include='*.ts' --include='*.tsx' | grep -v test` and confirm every caller passes root nodes (default is right). `plan.ts`'s `paceStatus` reads `leafCount(g.nodes)` — no change needed there; run the plan test to confirm `complete` is no longer reached and `behind` fires.

- [ ] **Step 4: Implement effort**

`src/lib/effort.ts`: import `goalPct` from `./pct` and `readiness, describeReadiness, topicIds, type Readiness` from `./confidence`.

```ts
export interface GoalEffort {
  remainingMin: number;
  unestimated: number;
  total: number;
  done: number;
  /** The subject's topics by tier. All zeros for a goal with no topics area. */
  readiness: Readiness;
}

export function goalEffort(g: Goal): GoalEffort {
  let remainingMin = 0;
  let unestimated = 0;
  let total = 0;
  let done = 0;
  // Topics are left out of every figure here. A topic's estimate is the
  // length of a sitting, not the effort left to finish it, and a topic is
  // never done — so counting it would print "0 of 8 done" over a subject that
  // is half solid. `readiness` is its figure.
  const topics = topicIds(g);

  const walk = (nodes: GoalNode[]): void => {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) {
        walk(n.children);
        continue;
      }
      if (topics.has(n.id)) continue;
      total += 1;
      if (isDone(n)) {
        done += 1;
        continue;
      }
      if (!countsAsEffort(n)) continue;
      const est = normalizeEstimate(n.estimateMin);
      if (est === undefined) unestimated += 1;
      else remainingMin += est;
    }
  };
  walk(g.nodes);

  return { remainingMin, unestimated, total, done, readiness: readiness(g) };
}
```

Keep the existing comment above the estimate line. Then the describers:

```ts
export function describeEffort(e: GoalEffort): string | null {
  const ready = describeReadiness(e.readiness);
  if (e.total === 0) return ready;
  const count = `${e.done} of ${e.total} task${e.total === 1 ? '' : 's'}`;
  const parts: string[] = ready ? [ready] : [];
  if (e.done === e.total) parts.push(`every task done · ${count}`);
  else {
    if (e.remainingMin > 0) parts.push(`${fmtMinutes(e.remainingMin)} remaining`);
    parts.push(count);
    if (e.unestimated > 0) parts.push(`${e.unestimated} unestimated`);
  }
  return parts.join(' · ');
}

/**
 * … (keep the existing comment) … For a goal WITH topics the flat leaf
 * count is the wrong figure — a topic is never done — so the meter draws
 * `goalPct`, which for a subject is its readiness, and `effortCount` prints
 * the same readiness beside it. The rule the card states still holds: the
 * meter says nothing the count does not.
 */
export function effortPct(e: GoalEffort, g?: Goal): number {
  if (e.readiness.topics > 0 && g) return goalPct(g);
  if (e.total === 0) return 0;
  return (e.done / e.total) * 100;
}

export function effortCount(e: GoalEffort): string {
  const ready = describeReadiness(e.readiness);
  if (ready) {
    if (e.total === 0) return ready;
    return `${ready} · ${e.done} of ${e.total} step${e.total === 1 ? '' : 's'} done`;
  }
  if (e.total > 0 && e.done === e.total) return 'Done';
  return `${e.done}/${e.total}`;
}
```

Watch the wording in the tests: `1 of 2 topics solid · 0 of 1 steps done` — make singular/plural match the test (`step${e.total === 1 ? '' : 's'}` prints `1 steps`? No: `e.total === 1` → `step`. Fix the test to `0 of 1 step done`).

Update the ONE caller of `effortPct` — `src/views/goals/BoardCard.tsx:177` — to `effortPct(effort, g)` (the card has `g` in scope; confirm the variable name).

- [ ] **Step 5: Run, typecheck, commit**

Run: `npx vitest run src/lib/board.test.ts src/lib/plan.test.ts src/lib/effort.test.ts src/views/goals` → PASS. `npx tsc -b` → clean (fix any test that constructs `GoalEffort` literals by adding `readiness`).

```bash
git add src/lib/board.ts src/lib/board.test.ts src/lib/effort.ts src/lib/effort.test.ts src/lib/plan.test.ts src/views/goals/BoardCard.tsx
git commit -m "feat(app): a topic is an open leaf that is never done; effort states readiness"
```

---

### Task 4: The queue — review order, exam date as due, `'review'` reason

**Files:**
- Modify: `src/lib/backlog.ts` (`BacklogItem`, `backlogGroups`)
- Modify: `src/lib/todayPlan.ts` (`ProposalRow`, `row`)
- Modify: `src/lib/executionAdvisor.ts` (`AdviceReason`, `RecommendedWork`, `Candidate`, free-time push)
- Modify: `src/lib/dailyWork.ts` (`DailyWorkItem`, `stepItem`)
- Test: `src/lib/backlog.test.ts`, `src/lib/todayPlan.test.ts`, `src/lib/executionAdvisor.test.ts`, `src/lib/dailyWork.test.ts`

**Interfaces:**
- Produces: `BacklogItem.topic?: true`, `BacklogItem.confidence?: Confidence`; `ProposalRow.topic?`, `.confidence?`; `RecommendedWork.topic?`, `.confidence?`; `AdviceReason` includes `'review'`; `DailyWorkItem.topic?`, `.confidence?`.

- [ ] **Step 1: Failing tests — backlog**

Append to `src/lib/backlog.test.ts`:

```ts
describe('topics in the rail', () => {
  const subject = (over: Partial<Goal> = {}): Goal => goal({
    id: 'g1', title: 'Algorithms', type: 'study', deadline: '2026-07-18', datesConfirmed: true,
    nodes: [
      { id: 'area', title: 'Topics', topics: true, children: [
        { id: 'solid', title: 'Sorting', confidence: 'solid', confidenceAt: '2026-07-01' },
        { id: 'none', title: 'Graphs' },
        { id: 'shaky', title: 'DP', confidence: 'shaky', confidenceAt: '2026-07-10' },
      ] },
      { id: 'ps', title: 'Problem set' },
    ],
    ...over,
  });
  it('orders topics for review ahead of the other steps, and marks them', () => {
    const [group] = backlogGroups([subject()], [], WEEK, TODAY);
    expect(group.items.map((i) => i.id)).toEqual(['none', 'shaky', 'solid', 'ps']);
    expect(group.items[0]).toMatchObject({ topic: true, due: '2026-07-18' });
    expect(group.items[0].confidence).toBeUndefined();
    expect(group.items[1]).toMatchObject({ topic: true, confidence: 'shaky', due: '2026-07-18' });
    expect(group.items[3].topic).toBeUndefined();
    expect(group.items[3].due).toBeUndefined();
  });
  it('an unconfirmed exam date does not become a due', () => {
    const [group] = backlogGroups([subject({ datesConfirmed: undefined })], [], WEEK, TODAY);
    expect(group.items[0].due).toBeUndefined();
  });
  it('a dated step still jumps the topics, because sortByDue runs last', () => {
    const g = subject({ nodes: [
      ...subject().nodes.slice(0, 1),
      { id: 'ps', title: 'Problem set', deadline: '2026-07-16' },
    ] });
    const [group] = backlogGroups([g], [], WEEK, TODAY);
    expect(group.items[0].id).toBe('ps');
  });
});
```

Append to `src/lib/todayPlan.test.ts` (open it for the fixtures its `proposalRows` tests use):

```ts
describe('proposalRows and subjects', () => {
  it('the nearest exam\'s weakest topic leads; each subject offers one row', () => {
    const subject = (id: string, deadline: string): Goal => ({
      id, title: id, type: 'study', deadline, datesConfirmed: true,
      nodes: [{ id: `${id}-area`, title: 'Topics', topics: true, children: [
        { id: `${id}-solid`, title: 'Solid', confidence: 'solid', confidenceAt: '2026-07-01' },
        { id: `${id}-weak`, title: 'Weak' },
      ] }],
    });
    const rows = proposalRows([subject('far', '2026-07-21'), subject('near', '2026-07-17')], [], WEEK, TODAY);
    expect(rows.map((r) => r.id)).toEqual(['near-weak', 'far-weak']);
    expect(rows[0]).toMatchObject({ topic: true, due: '2026-07-17' });
  });
});
```

- [ ] **Step 2: Failing tests — advisor and daily work**

Append to `src/lib/executionAdvisor.test.ts` (reuse its input builder — read the file's helpers first and mirror the free-time case that exists):

```ts
it('a topic offered from free time carries the review reason and its confidence', () => {
  const subject: Goal = {
    id: 'g1', title: 'Algorithms', type: 'study', deadline: '2026-07-18', datesConfirmed: true,
    nodes: [{ id: 'area', title: 'Topics', topics: true, children: [
      { id: 'weak', title: 'Graphs', confidence: 'shaky', confidenceAt: '2026-07-10' },
    ] }],
  };
  const advice = executionAdvice(input({ goals: [subject] }));
  expect(advice.kind).toBe('work');
  if (advice.kind !== 'work') return;
  expect(advice.primary).toMatchObject({ reason: 'review', topic: true, confidence: 'shaky' });
});
```

Append to `src/lib/dailyWork.test.ts`:

```ts
it('a committed topic carries topic and confidence', () => {
  const subject: Goal = {
    id: 'g1', title: 'Algorithms', nodes: [{ id: 'area', title: 'Topics', topics: true, children: [
      { id: 'weak', title: 'Graphs', plannedWeek: WEEK, confidence: 'okay', confidenceAt: '2026-07-10' },
    ] }],
  };
  const items = buildDailyWork([subject], [], TODAY, WEEK).items; // mirror the file's own call shape
  expect(items.find((i) => i.id === 'weak')).toMatchObject({ topic: true, confidence: 'okay' });
});
```

Adjust the `buildDailyWork` call to the signature the file already uses.

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run src/lib/backlog.test.ts src/lib/todayPlan.test.ts src/lib/executionAdvisor.test.ts src/lib/dailyWork.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement backlog**

`src/lib/backlog.ts` — import `sortForReview, topicIds, topicConfidence, type Confidence` from `./confidence`. Extend the item:

```ts
  /**
   * A topic — a leaf under a study goal's topics area. Never completed; its
   * `confidence` is what the row draws where a step draws its status, and
   * its `due` is the EXAM date, so `sortByDue` puts the nearest exam's
   * weakest topic at the head of every surface that reads this list.
   */
  topic?: true;
  confidence?: Confidence;
```

In `backlogGroups`, replace the per-goal `walkLeaves` block with one that collects topics separately:

```ts
  for (const g of ranked) {
    const topics = topicIds(g);
    // The exam date is a due only once it is CONFIRMED — the same gate
    // `projectAttention` applies before a date may reorder anything.
    const exam = g.datesConfirmed === true && g.deadline ? g.deadline : undefined;
    const topicNodes: GoalNode[] = [];
    const steps: BacklogItem[] = [];
    walkLeaves(g, (n) => {
      if (isDone(n)) return;
      if (isPlaced(n)) return;
      if (parked.has(g.id) && n.plannedWeek === undefined) return;
      const s = stepStatus(n);
      if ((s === 'blocked' || s === 'parked') && n.plannedWeek === undefined) return;
      if (topics.has(n.id)) { topicNodes.push(n); return; }
      steps.push({
        kind: 'step', id: n.id, goalId: g.id, title: n.title,
        ...withEstimate(n.estimateMin),
        ...(n.deadline ? { due: n.deadline } : {}),
        ...(s === 'parked' ? { parked: true as const } : {}),
      });
    });
    // Topics first, in review order; then the ordinary steps in tree order.
    // `sortByDue` below still runs over the whole group, so a step dated
    // inside the week jumps the topics — and the topics themselves carry the
    // exam as their date, so once the exam is that near they lead anyway.
    const items: BacklogItem[] = sortForReview(topicNodes).map((n) => {
      const c = topicConfidence(n);
      return {
        kind: 'step', id: n.id, goalId: g.id, title: n.title, topic: true as const,
        ...withEstimate(n.estimateMin),
        ...(exam ? { due: exam } : {}),
        ...(c === null ? {} : { confidence: c }),
        ...(stepStatus(n) === 'parked' ? { parked: true as const } : {}),
      };
    });
    items.push(...steps);
    byGoal.set(g.id, items);
  }
```

Keep the existing comments on the dropped cases. Import `GoalNode` type if not already.

- [ ] **Step 5: Implement `todayPlan.ts`**

Add to `ProposalRow`: `topic?: true; confidence?: Confidence;` and in `row()`:

```ts
    ...(item.topic ? { topic: true as const } : {}),
    ...(item.confidence === undefined ? {} : { confidence: item.confidence }),
```

- [ ] **Step 6: Implement the advisor**

`src/lib/executionAdvisor.ts`: add `| 'review'` to `AdviceReason` with the comment `/** A topic offered for review — the weakest of a subject, nearest exam first. */`. Add to `RecommendedWork` and to the private `Candidate`:

```ts
  /** A topic, with its confidence when rated. The surface draws a mark, never a tick. */
  topic?: true;
  confidence?: Confidence;
```

In the free-time push:

```ts
      push({
        key: row.key,
        ref,
        title: row.title,
        ...(row.goalTitle === '' ? {} : { goalTitle: row.goalTitle }),
        ...(lifeId === undefined ? {} : { lifeId }),
        ...withDemand(demandFor(row)),
        ...(row.topic ? { topic: true as const } : {}),
        ...(row.confidence === undefined ? {} : { confidence: row.confidence }),
        reason: row.topic ? 'review' : 'free-time',
      });
```

Also stamp `topic`/`confidence` in `toCandidate` (commitments and carry-overs) from the `DailyWorkItem` fields added in the next step — read `toCandidate` and spread them the same way.

- [ ] **Step 7: Implement `dailyWork.ts`**

`DailyWorkItem` gains `topic?: true; confidence?: Confidence;`. `stepItem` takes the goal's topic set — compute `topicIds(goal)` once per goal where `stepItem` is called (read `buildDailyWork` to find the loop; do not recompute per leaf inside a hot loop if a goal-level map is natural). In `stepItem`:

```ts
    ...(topics.has(node.id) ? { topic: true as const } : {}),
    ...(topics.has(node.id) && topicConfidence(node) !== null ? { confidence: topicConfidence(node)! } : {}),
```

- [ ] **Step 8: Run, typecheck, commit**

Run: `npx vitest run src/lib` → PASS. `npx tsc -b` → clean.

```bash
git add src/lib/backlog.ts src/lib/backlog.test.ts src/lib/todayPlan.ts src/lib/todayPlan.test.ts src/lib/executionAdvisor.ts src/lib/executionAdvisor.test.ts src/lib/dailyWork.ts src/lib/dailyWork.test.ts
git commit -m "feat(app): the weakest topic of the nearest exam leads, through the ordering that already exists"
```

---

### Task 5: Store — `rateTopic`, `setTopicsArea`, refusals, template flags, migration

**Files:**
- Modify: `src/state/store.ts` (`toggleLeaf`, `setNodeStatus`, `finishWork`, `addRootNodes`; new `rateTopic`, `setTopicsArea`)
- Modify: `src/lib/migrateNodeStatus.ts`
- Test: `src/state/store.test.ts`, `src/lib/migrateNodeStatus.test.ts`

**Interfaces:**
- Produces: `actions.rateTopic(nodeId, confidence: Confidence | null, today?): boolean`; `actions.setTopicsArea(nodeId, on: boolean): boolean`; `actions.addRootNodes(goalId, titles, flags?: ({ topics?: true } | undefined)[])`.

- [ ] **Step 1: Failing store tests**

In `src/state/store.test.ts`, add a `describe('topics', …)` block using the file's `freshStore` / `loadState` mock pattern (copy the `focusStore` helper shape from the `focus sessions` block):

```ts
describe('topics', () => {
  const TODAY = '2026-09-03';
  const subject: Goal = {
    id: 'g1', title: 'Algorithms', type: 'study',
    nodes: [
      { id: 'area', title: 'Topics', topics: true, children: [{ id: 'graphs', title: 'Graphs' }] },
      { id: 'ps', title: 'Problem set' },
    ],
  };
  async function topicStore() {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({ goals: [subject], habits: [], tasks: [], sessions: [], lives: [] });
    const store = await freshStore();
    await store.initStore();
    return store;
  }
  const topic = (s: { getState: () => { goals: Goal[] } }) => s.getState().goals[0].nodes[0].children![0];

  it('rateTopic writes both fields, arms an undo, and clears both on null', async () => {
    const { actions, getState } = await topicStore();
    expect(actions.rateTopic('graphs', 'okay', TODAY)).toBe(true);
    expect(topic({ getState })).toMatchObject({ confidence: 'okay', confidenceAt: TODAY });
    expect(getState().pendingUndo?.label).toBe('Rated "Graphs" okay');
    expect(actions.rateTopic('graphs', null, TODAY)).toBe(true);
    expect(topic({ getState }).confidence).toBeUndefined();
    expect(topic({ getState }).confidenceAt).toBeUndefined();
    expect(getState().pendingUndo?.label).toBe('Cleared rating on "Graphs"');
  });
  it('rateTopic refuses a step, a container and a frozen goal', async () => {
    const { actions } = await topicStore();
    expect(actions.rateTopic('ps', 'okay', TODAY)).toBe(false);
    expect(actions.rateTopic('area', 'okay', TODAY)).toBe(false);
    actions.completeGoal('g1'); // whatever the archive action is called — grep `completedAt` writers
    expect(actions.rateTopic('graphs', 'okay', TODAY)).toBe(false);
  });
  it('a topic cannot be completed by any route', async () => {
    const { actions, getState } = await topicStore();
    actions.toggleLeaf('graphs');
    expect(topic({ getState }).status).toBeUndefined();
    expect(actions.setNodeStatus('graphs', 'done')).toBe(false);
    expect(actions.setNodeStatus('graphs', 'doing')).toBe(true);
    expect(actions.finishWork({ kind: 'step', id: 'graphs', goalId: 'g1' })).toEqual({ outcome: 'refused' });
  });
  it('setTopicsArea toggles the flag on a container', async () => {
    const { actions, getState } = await topicStore();
    expect(actions.setTopicsArea('area', false)).toBe(true);
    expect(getState().goals[0].nodes[0].topics).toBeUndefined();
    expect(actions.setTopicsArea('area', true)).toBe(true);
    expect(getState().goals[0].nodes[0].topics).toBe(true);
  });
  it('addRootNodes carries a topics flag per title', async () => {
    const { actions, getState } = await topicStore();
    actions.addRootNodes('g1', ['Topics', 'Practice'], [{ topics: true }, undefined]);
    const added = getState().goals[0].nodes.slice(-2);
    expect(added[0]).toMatchObject({ title: 'Topics', topics: true });
    expect(added[1].topics).toBeUndefined();
  });
});
```

Find the real archive action name with `grep -n "completedAt: " src/state/store.ts` and use it.

- [ ] **Step 2: Failing migration test**

Append to `src/lib/migrateNodeStatus.test.ts`:

```ts
it('drops half a rating', () => {
  const [g] = migrateNodeStatus([goal([
    { id: 'a', title: 'A', confidence: 'okay' } as GoalNode,
    { id: 'b', title: 'B', confidenceAt: '2026-09-01' } as GoalNode,
    { id: 'c', title: 'C', confidence: 'solid', confidenceAt: '2026-09-01' },
  ])]);
  expect(g.nodes[0]).toEqual({ id: 'a', title: 'A' });
  expect(g.nodes[1]).toEqual({ id: 'b', title: 'B' });
  expect(g.nodes[2]).toMatchObject({ confidence: 'solid', confidenceAt: '2026-09-01' });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run src/state/store.test.ts -t topics; npx vitest run src/lib/migrateNodeStatus.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the store**

In `src/state/store.ts`, import `applyConfidence, isTopic, CONFIDENCE_WORD, type Confidence` from `../lib/confidence`. Add a helper beside `writeStatus`:

```ts
/** Same copy-back as `writeStatus`, for the same reason. */
function writeConfidence(n: GoalNode, next: Confidence | null, today: string): void {
  const updated = applyConfidence(n, next, today);
  for (const key of ['confidence', 'confidenceAt'] as const) {
    if (updated[key] === undefined) delete n[key];
    else (n[key] as unknown) = updated[key];
  }
}

/** Whether a node is a topic in the goal that holds it. */
function isTopicNode(nodeId: string): boolean {
  const goal = goalOfNode(nodeId);
  return goal !== undefined && goal !== null && isTopic(goal, nodeId);
}
```

(Check `goalOfNode`'s return type and adjust the null/undefined test.)

Add the actions next to `toggleParked`:

```ts
  /**
   * Rate a topic. The one writer of `confidence`/`confidenceAt`.
   *
   * Arms an undo: the rating is taken on the shelf, where the row it changes
   * is not in front of you — the distance-write rule. KNOWN COST: the
   * ordinary-edit sweep drops the `Logged 25m` entry the session just armed,
   * so after a rating the toast offers to undo the rating, not the minutes.
   * That is the rule every edit after a log already follows.
   */
  rateTopic(nodeId: string, confidence: Confidence | null, today = todayStr()): boolean {
    if (!isActiveNode(nodeId)) return false;
    if (!isTopicNode(nodeId)) return false;
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node || node.children?.length) return false;
    writeConfidence(node, confidence, today);
    withUndo(
      confidence === null
        ? `Cleared rating on "${node.title}"`
        : `Rated "${node.title}" ${confidence}`,
      'goals',
      goals,
    );
    return true;
  },

  /** Mark a container as the topics area, or unmark it. In front of you, so no undo. */
  setTopicsArea(nodeId: string, on: boolean): boolean {
    if (!isActiveNode(nodeId)) return false;
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node) return false;
    if ((node.topics === true) === on) return false;
    if (on) node.topics = true;
    else delete node.topics;
    setAndPersist({ goals });
    return true;
  },
```

Refusals:

- `toggleLeaf`: after the `if (!node || node.children?.length) return;` line add `if (isTopicNode(nodeId)) return; // a topic is rated, never ticked`.
- `setNodeStatus`: after the container check add `if (next === 'done' && isTopicNode(nodeId)) return false;`.
- `finishWork`: in the `ref.kind === 'step'` branch, after `if (!node || …) return { outcome: 'refused' };` add `if (isTopic(state.goals.find((g) => g.id === ref.goalId)!, ref.id)) return { outcome: 'refused' };` — guard the lookup with the same pattern `startFocus` uses for a missing goal.
- `addRootNodes(goalId, titles, flags?: ({ topics?: true } | undefined)[])`: build each node as `{ id: uid(), title, ...(flags?.[i]?.topics ? { topics: true as const } : {}) }` — note `clean` filters empties, so index `flags` against the ORIGINAL `titles` index; simplest is to zip first, then filter.

Check `setNodesStatus` (bulk) and `completeNodes` (bulk complete): both must skip topics for `'done'` — add `if (leafIds.has(n.id) && next === 'done' && topics.has(n.id)) return;` using a per-goal `topicIds(g)` set inside their `for (const g of goals)` loops. Add one test each in the existing bulk describe blocks: a selection containing a topic completes the steps and leaves the topic untouched.

- [ ] **Step 5: Implement the migration**

In `migrateNodeStatus.ts` `migrateNode`, add to the "has anything to fix" detection:

```ts
    const halfRating = !isContainer
      && ((n.confidence !== undefined) !== (n.confidenceAt !== undefined));
```

include `halfRating` in the early-return test, and in the fix-up: `if (halfRating) { delete out.confidence; delete out.confidenceAt; }`.

- [ ] **Step 6: Run, typecheck, commit**

Run: `npx vitest run src/state src/lib/migrateNodeStatus.test.ts` → PASS. `npx tsc -b` → clean.

```bash
git add src/state/store.ts src/state/store.test.ts src/lib/migrateNodeStatus.ts src/lib/migrateNodeStatus.test.ts
git commit -m "feat(app): rateTopic — a topic is rated, and refuses every route to done"
```

---

### Task 6: The rating moment — the `'rating'` phase

**Files:**
- Modify: `src/lib/focusSession.ts` (`ActiveFocusSession.phase`, `PHASES`, `reconcileFocusDraft`)
- Modify: `src/lib/focusStatus.ts` (`FocusStatusSnapshot.phase`)
- Modify: `src/state/store.ts` (`completeFocus`, `confirmFocus`, new `rateFocus`, every `phase === 'confirming'` guard)
- Modify: `electron/shellIpc.cjs` (`FOCUS_PHASES`), `electron/idleWatch.cjs`, `electron/overlayWindow.cjs`, `electron/menuBar.cjs`
- Test: `src/lib/focusSession.test.ts`, `src/state/store.test.ts`, `electron/shellIpc.test.ts`, `electron/idleWatch.test.ts`, `electron/overlayWindow.test.ts`, `electron/menuBar.test.ts`

**Interfaces:**
- Produces: `ActiveFocusSession.phase: 'active' | 'break' | 'confirming' | 'rating'`; `actions.rateFocus(confidence: Confidence | null): boolean`.

- [ ] **Step 1: Failing tests**

`src/lib/focusSession.test.ts` — add:

```ts
it('a rating draft round-trips and reconciles like confirming', () => {
  const draft: ActiveFocusSession = {
    id: 'f', ref: { kind: 'step', id: 'n1', goalId: 'g1' }, title: 'Graphs',
    startedAtMs: 0, activeSinceMs: null, accumulatedMs: 25 * 60_000,
    phase: 'rating', expected: { kind: 'starter', minutes: 30 }, focusLevel: 'medium',
  };
  expect(parseActiveFocusSession(serializeActiveFocusSession(draft))).toEqual(draft);
  const goals: Goal[] = [{ id: 'g1', title: 'A', nodes: [{ id: 'n1', title: 'Graphs' }] }];
  expect(reconcileFocusDraft(draft, goals, [], 1)).toBe(draft);
  expect(reconcileFocusDraft(draft, [], [], 1)).toBeNull();
});
```

`src/state/store.test.ts` — inside `describe('focus sessions')` add a topic goal variant and:

```ts
  describe('rating a topic', () => {
    const subject: Goal = {
      id: 'g1', title: 'Algorithms', type: 'study',
      nodes: [{ id: 'area', title: 'Topics', topics: true, children: [{ id: 'n1', title: 'Graphs' }] }],
    };
    async function subjectStore() {
      const { loadState } = await import('../db/db');
      vi.mocked(loadState).mockResolvedValueOnce({ goals: [subject], habits: [], tasks: [], sessions: [], lives: [] });
      const store = await freshStore();
      await store.initStore();
      return store;
    }
    it('completing a sitting on a topic logs, then asks', async () => {
      const { actions, getState } = await subjectStore();
      actions.startFocus(ref, starter, t0);
      expect(actions.completeFocus(t0 + 25 * MIN)).toBe('logged');
      expect(getState().sessions).toHaveLength(1);
      expect(getState().activeFocusSession?.phase).toBe('rating');
      expect(actions.rateFocus('okay')).toBe(true);
      expect(getState().goals[0].nodes[0].children![0].confidence).toBe('okay');
      expect(getState().activeFocusSession).toBeNull();
    });
    it('skip clears the draft and writes nothing', async () => {
      const { actions, getState } = await subjectStore();
      actions.startFocus(ref, starter, t0);
      actions.completeFocus(t0 + 25 * MIN);
      expect(actions.rateFocus(null)).toBe(true);
      expect(getState().goals[0].nodes[0].children![0].confidence).toBeUndefined();
      expect(getState().activeFocusSession).toBeNull();
    });
    it('a confirmed stale sitting asks too; "didn\'t happen" does not', async () => {
      const { actions, getState } = await subjectStore();
      actions.startFocus(ref, starter, t0);
      expect(actions.completeFocus(t0 + 200 * MIN)).toBe('needs-confirmation');
      expect(actions.confirmFocus(200)).toBe(true);
      expect(getState().activeFocusSession?.phase).toBe('rating');
      actions.rateFocus(null);
      actions.startFocus(ref, starter, t0);
      actions.completeFocus(t0 + 200 * MIN);
      expect(actions.confirmFocus(null)).toBe(true);
      expect(getState().activeFocusSession).toBeNull();
    });
    it('a sitting on an ordinary step never asks', async () => {
      const { actions, getState } = await focusStore();
      actions.startFocus(ref, starter, t0);
      actions.completeFocus(t0 + 25 * MIN);
      expect(getState().activeFocusSession).toBeNull();
      expect(actions.rateFocus('okay')).toBe(false);
    });
    it('while rating, pause, resume and complete are refused', async () => {
      const { actions } = await subjectStore();
      actions.startFocus(ref, starter, t0);
      actions.completeFocus(t0 + 25 * MIN);
      expect(actions.pauseFocus(t0 + 26 * MIN)).toBe(false);
      expect(actions.resumeFocus(t0 + 26 * MIN)).toBe(false);
      expect(actions.completeFocus(t0 + 26 * MIN)).toBe('refused');
      expect(actions.startFocus(ref, starter, t0 + 26 * MIN)).toBe(false);
    });
  });
```

Electron tests: in each of `electron/shellIpc.test.ts`, `idleWatch.test.ts`, `overlayWindow.test.ts`, `menuBar.test.ts` find the existing `confirming` case and add a sibling asserting `'rating'` behaves identically (snapshot accepted; idle poll cancelled; overlay model `null`; no session menu items).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/focusSession.test.ts src/state/store.test.ts electron` → FAIL.

- [ ] **Step 3: Implement `focusSession.ts` / `focusStatus.ts`**

- `phase: 'active' | 'break' | 'confirming' | 'rating';` in both files, with this comment on the draft type: `'rating'` — the sitting is LOGGED and the shelf is asking how solid the topic is now. Entered only by the store, only for a topic, and not running: the tray, the pill and the idle watcher all treat it as `confirming`.
- `const PHASES = new Set(['active', 'break', 'confirming', 'rating']);`
- `reconcileFocusDraft`: `if (!draft || draft.phase === 'confirming' || draft.phase === 'rating') return draft;` — keep the doc comment and add one sentence.
- `pauseFocusSession` / `resumeFocusSession`: read them; if they key on `phase === 'active'` / `'break'` they already refuse `'rating'` by returning the same draft. Confirm with the store test.

- [ ] **Step 4: Implement the store transition**

In `store.ts`, add a helper near `setFocusDraft`:

```ts
/**
 * After a sitting on a TOPIC is logged, the draft does not clear — it asks.
 * The minutes are already written; what remains is one question the shelf
 * knows how to put, and the answer goes through `rateTopic`.
 */
function settleOrAsk(draft: ActiveFocusSession, nowMs: number): void {
  if (draft.ref.kind === 'step' && isTopicNode(draft.ref.id)) {
    setFocusDraft({
      ...draft,
      accumulatedMs: draft.accumulatedMs + (draft.activeSinceMs === null ? 0 : nowMs - draft.activeSinceMs),
      activeSinceMs: null,
      phase: 'rating',
    });
    return;
  }
  setFocusDraft(null);
}
```

(Reuse `stretchMs` if `focusSession.ts` exports it; otherwise the inline arithmetic above matches it.)

- `completeFocus`: guard becomes `if (!draft || draft.phase === 'confirming' || draft.phase === 'rating') return 'refused';` and the final `setFocusDraft(null)` becomes `settleOrAsk(draft, nowMs)`.
- `confirmFocus(minutes)`: after a successful `logSession`, `settleOrAsk(draft, Date.now())` instead of `setFocusDraft(null)`; the `minutes === null` branch stays `setFocusDraft(null)`.
- `finishWork`: the "draft about other work / confirming" test adds `|| draft.phase === 'rating'`.
- `startFocus`: already refuses when any draft exists.
- `pauseFocus` / `resumeFocus` / `markFocusReturned` / `discardFocus`: grep `'confirming'` in `store.ts` and extend each guard to `'rating'` where the guard means "not a running sitting". `discardFocus` may clear a rating draft (Escape on the shelf) — leave it.
- New action:

```ts
  /**
   * Answer the rating the shelf is asking. A word rates the topic through
   * `rateTopic` (which arms the undo); `null` is Skip. Either way the draft
   * is spent — a question is not something to leave on the table.
   */
  rateFocus(confidence: Confidence | null): boolean {
    const draft = state.activeFocusSession;
    if (!draft || draft.phase !== 'rating') return false;
    if (confidence !== null && draft.ref.kind === 'step') {
      actions.rateTopic(draft.ref.id, confidence);
    }
    setFocusDraft(null);
    return true;
  },
```

- [ ] **Step 5: Electron**

- `electron/shellIpc.cjs`: `const FOCUS_PHASES = ['active', 'break', 'confirming', 'rating'];`
- `electron/idleWatch.cjs:176`: `if (status === null || status.phase === 'confirming' || status.phase === 'rating') {` — extend the comment: "or a rating the shelf is asking for".
- `electron/overlayWindow.cjs`: the `else` branch already returns `null` for anything not active/break; add `'rating'` to its comment.
- `electron/menuBar.cjs` `sessionItems`: already returns `[]` for anything not active/break; extend the doc comment to name `rating`.
- If any `.d.cts` declares the phase union, update it.

- [ ] **Step 6: Run, typecheck, commit**

Run: `npx vitest run src/lib/focusSession.test.ts src/state/store.test.ts electron` → PASS. `npx tsc -b`.

```bash
git add src/lib/focusSession.ts src/lib/focusSession.test.ts src/lib/focusStatus.ts src/state/store.ts src/state/store.test.ts electron/shellIpc.cjs electron/idleWatch.cjs electron/overlayWindow.cjs electron/menuBar.cjs electron/*.test.ts
git commit -m "feat(app): a logged sitting on a topic ends in a question — the rating phase"
```

---

### Task 7: Agent and phone seams — `rate_topic`, topic refusals mirrored

**Files:**
- Modify: `src/lib/agentProtocol.ts` (`AgentRequest`, `AGENT_TOOLS`, `validAgentRequest`)
- Modify: `src/lib/agentWrites.ts` (`set_status`, `complete_task`, new `rate_topic`)
- Modify: `src/lib/agentReads.ts` (`projectSummary`)
- Modify: `mcp/server.js` (tool declaration)
- Modify: `src/lib/sync/replay.ts` (`complete_task`, `set_status`)
- Test: `src/lib/agentProtocol.test.ts`, `src/lib/agentWrites.test.ts`, `src/lib/agentReads.test.ts`, `src/lib/sync/replay.test.ts`

- [ ] **Step 1: Failing tests**

`agentProtocol.test.ts` — add to the request-validation cases:

```ts
it('rate_topic takes a node id and a word or null', () => {
  expect(validAgentRequest({ tool: 'rate_topic', nodeId: 'n1', confidence: 'okay' })).toBe(true);
  expect(validAgentRequest({ tool: 'rate_topic', nodeId: 'n1', confidence: null })).toBe(true);
  expect(validAgentRequest({ tool: 'rate_topic', nodeId: 'n1', confidence: 'done' })).toBe(false);
  expect(validAgentRequest({ tool: 'rate_topic', nodeId: '', confidence: 'okay' })).toBe(false);
});
```

The existing "server declares every tool" test will fail until `mcp/server.js` lists it — that is the point.

`agentWrites.test.ts` — mirror the file's harness (it calls `handleAgentWrite(request, deps)` with a mocked `actions`; read the `set_status` cases and copy their shape):

```ts
describe('topics', () => {
  const subject: Goal = {
    id: 'g1', title: 'Algorithms', type: 'study',
    nodes: [{ id: 'area', title: 'Topics', topics: true, children: [{ id: 'graphs', title: 'Graphs' }] }],
  };
  it('rate_topic reaches rateTopic and reports the rating', () => {
    const res = write({ tool: 'rate_topic', nodeId: 'graphs', confidence: 'okay' }, { goals: [subject] });
    expect(actions.rateTopic).toHaveBeenCalledWith('graphs', 'okay', expect.any(String));
    expect(res).toEqual(okResponse({ nodeId: 'graphs', confidence: 'okay' }));
  });
  it('rate_topic on a step is refused in words', () => {
    const g: Goal = { id: 'g1', title: 'A', nodes: [{ id: 's', title: 'Step' }] };
    expect(write({ tool: 'rate_topic', nodeId: 's', confidence: 'okay' }, { goals: [g] }))
      .toEqual(errorResponse('"Step" is a step, not a topic — only a topic under a Topics area takes a rating.'));
  });
  it('complete_task and set_status done refuse a topic', () => {
    expect(write({ tool: 'complete_task', ref: { kind: 'step', id: 'graphs', goalId: 'g1' } }, { goals: [subject] }))
      .toEqual(errorResponse('"Graphs" is a topic — rate it instead of completing it.'));
    expect(write({ tool: 'set_status', nodeId: 'graphs', status: 'done' }, { goals: [subject] }))
      .toEqual(errorResponse('"Graphs" is a topic — rate it instead of completing it.'));
    expect(actions.toggleLeaf).not.toHaveBeenCalled();
  });
});
```

`agentReads.test.ts`: `list_projects` for a subject includes `readiness: { topics: 1, unrated: 1, shaky: 0, okay: 0, solid: 0 }`.

`sync/replay.test.ts`: a phone `complete_task` op on a topic leaves the node without `status`; a `set_status done` op on a topic likewise.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/agentProtocol.test.ts src/lib/agentWrites.test.ts src/lib/agentReads.test.ts src/lib/sync/replay.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`agentProtocol.ts`:
- `| { tool: 'rate_topic'; nodeId: string; confidence: Confidence | null }` (import the type from `../db/types`).
- Add `'rate_topic'` to `AGENT_TOOLS` after `'set_status'`.
- `validAgentRequest`: `case 'rate_topic': return id(req.nodeId) && (req.confidence === null || isConfidence(req.confidence));`

`agentWrites.ts`:
- In `set_status`, before the `'done'` routing: `if (request.status === 'done' && isTopic(target.goal, request.nodeId)) return errorResponse(\`"${target.found.title}" is a topic — rate it instead of completing it.\`);` — read what `leaf()` returns; if it has no goal, find it with `state.goals.find((g) => findNode(g.nodes, id))`.
- Same guard in `complete_task`'s step branch, before `isDone`.
- New case:

```ts
    case 'rate_topic': {
      const target = leaf(state, request.nodeId, 'only a topic under a Topics area takes a rating.');
      if (failed(target)) return errorResponse(target.error);
      const goal = state.goals.find((g) => findNode(g.nodes, request.nodeId));
      if (!goal || !isTopic(goal, request.nodeId)) {
        return errorResponse(`"${target.found.title}" is a step, not a topic — only a topic under a Topics area takes a rating.`);
      }
      if (!actions.rateTopic(request.nodeId, request.confidence, asOfDay)) {
        return errorResponse('That rating did not apply.');
      }
      return settled({ nodeId: request.nodeId, confidence: request.confidence });
    }
```

Match `leaf()`'s actual second-message convention by reading two existing calls.

`agentReads.ts` `projectSummary`: add `readiness: effort.readiness,`.

`mcp/server.js`: after `set_status`:

```js
  rate_topic: [
    'Rate how solid a study TOPIC is: shaky, okay or solid — or null to clear the rating. Topics are the steps under a study project\'s "Topics" area; they are never completed, only rated, and the weakest topic of the nearest exam is what Phase suggests next.',
    { nodeId: z.string(), confidence: z.enum(['shaky', 'okay', 'solid']).nullable() },
  ],
```

`replay.ts`: in `complete_task` (step branch) and `set_status` (when `request.status === 'done'`), after resolving the leaf, `if (isTopic(goal, leaf.id)) return;` — `activeLeaf` returns only the node; add a sibling `activeGoalOf(out, nodeId, goalId?)` or have `activeLeaf` return `{ goal, leaf }`. Mirror exactly what the Mac refuses. Add `rate_topic` to the replay switch only if `CompanionOp` can carry it — it cannot today (the phone has no rating surface); leave a one-line comment in the switch's `default` saying so.

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run src/lib/agentProtocol.test.ts src/lib/agentWrites.test.ts src/lib/agentReads.test.ts src/lib/sync/replay.test.ts` → PASS. `npx tsc -b`.

```bash
git add src/lib/agentProtocol.ts src/lib/agentProtocol.test.ts src/lib/agentWrites.ts src/lib/agentWrites.test.ts src/lib/agentReads.ts src/lib/agentReads.test.ts mcp/server.js src/lib/sync/replay.ts src/lib/sync/replay.test.ts
git commit -m "feat(app): rate_topic over the socket; complete_task refuses a topic on both sides of the sync"
```

Note for the operator (put it in the final report): the MCP server needs a rebuild AND a Claude Code restart before `rate_topic` appears.

---

### Task 8: Shelf protocol and the IPC seam

**Files:**
- Modify: `src/lib/assistantProtocol.ts` (`AssistantFocusView`, `AssistantAction`)
- Modify: `electron/assistantIpc.cjs` (`REASONS`, `validWork`, `validFocus`, `validAction`)
- Test: `electron/assistantIpc.test.ts`, `src/lib/assistantProtocol.test.ts`

- [ ] **Step 1: Failing tests**

`electron/assistantIpc.test.ts` — beside the existing `validFocus` / `validWork` / `validAction` cases:

```ts
it('accepts a topic row and a rating focus, and refuses a bad confidence', () => {
  expect(validWork({ ...WORK, topic: true, confidence: 'okay', reason: 'review' })).toBe(true);
  expect(validWork({ ...WORK, topic: 'yes' })).toBe(false);
  expect(validWork({ ...WORK, confidence: 'done' })).toBe(false);
  expect(validFocus({ ...FOCUS, phase: 'rating', topic: true })).toBe(true);
  expect(validAction({ type: 'rate-focus', confidence: 'solid' })).toBe(true);
  expect(validAction({ type: 'rate-focus', confidence: null })).toBe(true);
  expect(validAction({ type: 'rate-focus', confidence: 'done' })).toBe(false);
});
```

Use the fixture names the file already has (read it). The union-walk test covers `rate-focus` once it exists in the TypeScript union.

- [ ] **Step 2: Run to see it fail** — `npx vitest run electron/assistantIpc.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`assistantProtocol.ts`:
- `AssistantFocusView`: `phase: 'active' | 'break' | 'confirming' | 'rating';` plus `topic?: true; confidence?: Confidence;` with the comment "A topic under a study goal: the card draws a confidence mark, never a tick, and `'rating'` is the phase that asks for one."
- `AssistantAction`: `| { type: 'rate-focus'; confidence: Confidence | null }`.
- `RecommendedWork` already carries the fields from Task 4 (it is imported from `executionAdvisor.ts`).

`assistantIpc.cjs`:

```js
const REASONS = new Set([
  'scheduled-now', 'scheduled-next', 'due', 'committed-today',
  'committed-week', 'carried-over', 'free-time', 'review',
]);
const CONFIDENCES = new Set(['shaky', 'okay', 'solid']);
function optionalTopic(value) { return value === undefined || value === true; }
function optionalConfidence(value) { return value === undefined || CONFIDENCES.has(value); }
```

Add `&& optionalTopic(work.topic) && optionalConfidence(work.confidence)` to `validWork`; the same two to `validFocus`, and its phase test gains `|| focus.phase === 'rating'`. In `validAction`:

```js
    // The rating answer: one of the three words, or null for Skip.
    case 'rate-focus':
      return action.confidence === null || CONFIDENCES.has(action.confidence);
```

- [ ] **Step 4: Run, commit**

`npx vitest run electron/assistantIpc.test.ts src/lib/assistantProtocol.test.ts` → PASS.

```bash
git add src/lib/assistantProtocol.ts electron/assistantIpc.cjs electron/assistantIpc.test.ts
git commit -m "feat(app): the relay learns rate-focus, the rating phase and topic rows"
```

---

### Task 9: Shelf surface and host

**Files:**
- Modify: `src/components/StatusMark.tsx` (add `ConfidenceMark`)
- Modify: `src/components/assistant/AssistantSurface.tsx` (`REASON_WORD`, `FocusPanel`, `AdvicePanel`)
- Modify: `src/components/assistant/AssistantHost.tsx` (snapshot builder, `onAction`)
- Modify: `scripts/measure-shelf.cjs`, `electron/assistantWindow.cjs`
- Test: `src/components/assistant/AssistantSurface.test.tsx`, `AssistantHost.test.tsx`, `src/components/StatusMark.test.tsx` (create if absent)

**Interfaces:**
- Produces: `ConfidenceMark({ confidence: Confidence | null, size?: 13 })` — `role="img"`, `aria-label` = `CONFIDENCE_WORD` or `Not rated`.

- [ ] **Step 1: `ConfidenceMark`**

In `StatusMark.tsx` add:

```tsx
/**
 * The mark for a TOPIC where a step shows `StatusMark`: three bars of rising
 * height, lit to the rating. Unrated lights none; shaky one, in `warn`; okay
 * two, in `accent`; solid all three. `role="img"` — it is a readout, never a
 * control: rating happens on the shelf, and the task page is the correction
 * surface.
 */
export function ConfidenceMark({ confidence, size = 13 }: { confidence: Confidence | null; size?: number }) {
  const lit = confidence === null ? 0 : CONFIDENCE_RANK[confidence];
  const color = confidence === 'shaky' ? 'bg-warn' : 'bg-accent';
  return (
    <span
      role="img"
      aria-label={confidence === null ? 'Not rated' : CONFIDENCE_WORD[confidence]}
      className="inline-flex items-end gap-[1.5px]"
      style={{ width: size, height: size }}
    >
      {[0.45, 0.7, 1].map((h, i) => (
        <span
          key={i}
          className={`flex-1 rounded-[1px] ${i < lit ? color : 'bg-check'}`}
          style={{ height: `${h * 100}%` }}
        />
      ))}
    </span>
  );
}
```

Check `bg-check` exists as a utility (`grep -rn "border-check" src/index.css tailwind.config.*`); if only `border-check` exists, use `bg-line-soft` or whichever muted fill the theme exposes. Test: renders three bars, `aria-label` words, `Not rated` for null.

- [ ] **Step 2: Failing surface tests**

In `AssistantSurface.test.tsx` (read its `render` helper and focus fixtures):

```ts
it('a rating focus asks the question with four answers and no tick', () => {
  render(snapshotWith({ activeFocus: focus({ phase: 'rating', topic: true, title: 'Graphs' }) }));
  expect(screen.getByText('How solid is Graphs now?')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).toBeNull();
  for (const word of ['Skip', 'Shaky', 'Okay', 'Solid']) expect(screen.getByRole('button', { name: word })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Solid' }));
  expect(onAction).toHaveBeenCalledWith({ type: 'rate-focus', confidence: 'solid' });
  await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(onAction).toHaveBeenCalledWith({ type: 'rate-focus', confidence: null });
});
it('a running session on a topic has a ring and no checkbox', () => {
  render(snapshotWith({ activeFocus: focus({ phase: 'active', topic: true, confidence: 'okay' }) }));
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('img', { name: 'Okay' })).toBeInTheDocument();
});
it('a topic primary row draws the mark, not a tick, and names the reason', () => {
  render(snapshotWith({ advice: { kind: 'work', primary: work({ topic: true, reason: 'review' }), alternatives: [] } }));
  expect(screen.queryByRole('checkbox', { name: /Complete/ })).toBeNull();
  expect(screen.getByRole('img', { name: 'Not rated' })).toBeInTheDocument();
  expect(screen.getByText('Weakest topic first')).toBeInTheDocument();
});
```

`AssistantHost.test.tsx`: `rate-focus` with `'okay'` calls `actions.rateFocus('okay')` and sets the notice to the armed undo label; with `null` calls `rateFocus(null)` and sets no notice.

- [ ] **Step 3: Run to see them fail** — `npx vitest run src/components/assistant` → FAIL.

- [ ] **Step 4: Implement the surface**

`AssistantSurface.tsx`:
- `REASON_WORD`: add `review: 'Weakest topic first',`.
- `FocusPanel`: `const running = focus.phase === 'active' || focus.phase === 'break';` and replace the checkbox:

```tsx
  const checkbox = !running ? null : focus.topic ? (
    <ConfidenceMark confidence={focus.confidence ?? null} />
  ) : (
    <TodayCheckbox … as today … />
  );
```

`extra` for `'rating'`:

```tsx
  const extra = focus.phase === 'rating' ? (
    <p className="text-body text-ink">How solid is {focus.title} now?</p>
  ) : focus.phase === 'confirming' ? ( … existing … ) : ( … existing … );
```

`actions` for `'rating'`:

```tsx
  const actions = focus.phase === 'rating' ? (
    <>
      <button type="button" className={ghostBtn} onClick={() => onAction({ type: 'rate-focus', confidence: null })}>Skip</button>
      <button type="button" className={secondaryBtn} onClick={() => onAction({ type: 'rate-focus', confidence: 'shaky' })}>Shaky</button>
      <button type="button" className={secondaryBtn} onClick={() => onAction({ type: 'rate-focus', confidence: 'okay' })}>Okay</button>
      <button type="button" className={primaryBtn} onClick={() => onAction({ type: 'rate-focus', confidence: 'solid' })}>Solid</button>
    </>
  ) : focus.phase === 'confirming' ? ( … existing … ) : …
```

Add the comment: "Solid is filled because it is the answer the question hopes for — the same reasoning `confirming` gives its Log button. Skip is a ghost because a skipped rating costs nothing and must not look like a choice among four."

Wherever `ringState` / `elapsedAgainstExpected` are read for the `extra` line, they are inside the non-rating branch already.

- `AdvicePanel`: the primary `checkbox` prop becomes `primary.topic ? <ConfidenceMark confidence={primary.confidence ?? null} /> : <TodayCheckbox … />`. Check `WorkBand`'s `checkbox` slot sizing — `TodayCheckbox` is 22px; wrap the mark in a `w-[22px] h-[22px] grid place-items-center` span so the column does not shift.
- `AlternativesBand` rows: no checkbox today; leave them.

`AssistantHost.tsx`:
- Snapshot: compute `const topicsByGoal = new Map(goals.map((g) => [g.id, topicIds(g)]))` inside the `useMemo`; for `activeFocus` when `ref.kind === 'step'` and the set has the id, stamp `topic: true` and `confidence` from the node (`findNode`). `advice.primary` / `alternatives` already carry the fields from the advisor, but the `promoteWork` / pinned paths build rows from `chosen` — read `promoteWork` and make sure a promoted topic keeps `topic`/`confidence` (stamp them from the map there too).
- `onAction`:

```ts
      case 'rate-focus': {
        if (!actions.rateFocus(action.confidence)) {
          setNotice({ tone: 'warning', text: "Couldn't rate that topic." });
          return;
        }
        if (action.confidence !== null) {
          const armedUndo = getState().pendingUndo?.label;
          if (armedUndo) setNotice({ tone: 'neutral', text: armedUndo });
        }
        return;
      }
```

- [ ] **Step 5: Measure the shelf**

In `scripts/measure-shelf.cjs` `STATES`, add:

```js
  // The rating question: no ring, no elapsed line, one sentence and the
  // widest action row the card has had (Skip · Shaky · Okay · Solid).
  rating: {
    ...base,
    activeFocus: focus({ phase: 'rating', elapsedMin: 25, topic: true, confidence: 'shaky' }),
  },
```

Run `npm run build && npx electron scripts/measure-shelf.cjs` and again with `PHASE_SHELF_DENSITY=compact`. If `rating` is taller than 392.48 at 620px, set `HEIGHT` in `electron/assistantWindow.cjs` to `ceil(that)` and add a dated ledger paragraph in the comment block above `HEIGHT` in the file's own style; otherwise add a ledger paragraph recording the measured figure and that `sidecar` still rules. (If the display is unavailable to the agent, run it anyway — it uses a hidden BrowserWindow — and paste the printed table into the ledger.)

- [ ] **Step 6: Run, typecheck, commit**

`npx vitest run src/components` → PASS. `npx tsc -b`.

```bash
git add src/components/StatusMark.tsx src/components/StatusMark.test.tsx src/components/assistant scripts/measure-shelf.cjs electron/assistantWindow.cjs
git commit -m "feat(app): the shelf asks how solid a topic is, and draws a mark where a topic has no tick"
```

---

### Task 10: The tree — `ConfidenceBox`, Topics chip, Treat as topics

**Files:**
- Modify: `src/components/GoalTree.tsx`
- Modify: `src/components/RowActions.tsx`
- Test: `src/components/GoalTree.status.test.tsx`, `src/components/GoalTree.rowActions.test.tsx`

- [ ] **Step 1: Failing tests**

In `GoalTree.status.test.tsx` (use its `renderTree(goal)` helper and the `subject` fixture shape from Task 5):

```ts
describe('topics', () => {
  it('a topic row draws a confidence readout and no checkbox', async () => {
    await renderTree(subject);
    const row = screen.getByText('Graphs').closest('[data-row]')!;
    expect(within(row).queryByRole('checkbox', { name: /Mark "Graphs"/ })).toBeNull();
    expect(within(row).getByRole('img', { name: '"Graphs" — not rated yet' })).toBeInTheDocument();
  });
  it('Space on a topic row does not complete it', async () => {
    await renderTree(subject);
    const row = screen.getByText('Graphs').closest('[data-row]') as HTMLElement;
    row.focus();
    await userEvent.keyboard(' ');
    expect(getState().goals[0].nodes[0].children![0].status).toBeUndefined();
  });
  it('a topics area shows its chip', async () => {
    await renderTree(subject);
    const area = screen.getByText('Topics').closest('[data-row]')!;
    expect(within(area).getByText('Topics', { selector: '[data-topics-chip]' })).toBeInTheDocument();
  });
});
```

In `GoalTree.rowActions.test.tsx`: opening `⋯` on a container inside a study goal offers `Treat as topics` (or `Treat as steps` when flagged) and clicking it calls `setTopicsArea`.

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/components/GoalTree.status.test.tsx src/components/GoalTree.rowActions.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`GoalTree.tsx`:
- Import `topicIds, topicConfidence, topicAgeLabel, CONFIDENCE_RANK` from `../lib/confidence` and compute `const topics = useMemo(() => topicIds(goal), [goal])` where the tree has the goal (find where `g`/`goal` enters the tree component; pass the set down through the same props path `selected` travels).
- Add beside `LeafStatusBox`:

```tsx
/**
 * The topic's box: the same 17px footprint as `LeafStatusBox` so the column
 * never shifts, and a READOUT rather than a control — rating happens on the
 * shelf when a sitting ends, and the task page is where a mis-tap is
 * corrected. Three bars, lit to the rating; solid fills the box the way done
 * fills a step's, because solid IS the finished state of a topic.
 */
function ConfidenceBox({ node, today, label }: { node: GoalNode; today: string; label: string }) {
  const c = topicConfidence(node);
  const lit = c === null ? 0 : CONFIDENCE_RANK[c];
  const box = c === 'solid' ? 'bg-accent border-accent' : 'border-check';
  const bar = c === 'solid' ? 'bg-accent-contrast' : c === 'shaky' ? 'bg-warn' : 'bg-accent';
  return (
    <span
      role="img"
      aria-label={`${label} — ${topicAgeLabel(node, today)}`}
      className="w-[24px] h-[24px] -m-[3px] flex-shrink-0 grid place-items-center"
    >
      <span className={`w-[17px] h-[17px] border-[1.5px] rounded-[6px] flex items-end justify-center gap-[1.5px] p-[3px] ${box}`}>
        {[0.45, 0.7, 1].map((h, i) => (
          <span key={i} className={`w-[2px] rounded-[1px] ${i < lit ? bar : 'bg-transparent'}`} style={{ height: `${h * 100}%` }} />
        ))}
      </span>
    </span>
  );
}
```

- In the leaf row: `topics.has(n.id) ? <ConfidenceBox node={n} today={todayStr()} label={`"${n.title}"`} /> : <LeafStatusBox … />`.
- Row keyboard handler at ~`GoalTree.tsx:876` (`else if (!hasKids) actions.toggleLeaf(n.id);`): add `&& !topics.has(n.id)`. The strikethrough on `isDone(n)` never fires for a topic — no change.
- Container title row: when `n.topics === true`, render `<span data-topics-chip className="text-meta text-muted px-[6px] rounded-full border border-line-soft">Topics</span>` after the title, matching the milestone mark's placement.

`RowActions.tsx`: read how the menu builds its items (`isParked`, `case 'park'`). Add `isContainer` and `isTopicsArea: node.topics === true`; an item `{ id: 'topics', label: node.topics ? 'Treat as steps' : 'Treat as topics' }` shown only for containers (`node.children?.length`), dispatching `actions.setTopicsArea(node.id, !node.topics)`. `RowActions` is used for every goal type; showing it on every container is fine — the label says what it does.

- [ ] **Step 4: Run, typecheck, commit**

`npx vitest run src/components` → PASS. `npx tsc -b`.

```bash
git add src/components/GoalTree.tsx src/components/RowActions.tsx src/components/GoalTree.status.test.tsx src/components/GoalTree.rowActions.test.tsx
git commit -m "feat(app): a topic row reads its confidence; a container can be the Topics area"
```

---

### Task 11: Task page, rail and Today rows

**Files:**
- Modify: `src/views/project/TaskPage.tsx`
- Modify: `src/views/plan/sidebar/Backlog.tsx`
- Modify: `src/views/Today.tsx`
- Test: `src/views/project/TaskPage.test.tsx`, `src/views/plan/sidebar/Backlog.test.tsx` (or wherever the rail is tested — `grep -rl "backlogGroups" src/views --include='*.test.tsx'`), `src/views/Today.looseTasks.test.tsx` or a new `Today.topics.test.tsx`

- [ ] **Step 1: Failing tests**

`TaskPage.test.tsx`: opening a topic shows a `Confidence` property line whose value reads `Not rated`; choosing `Okay` calls `actions.rateTopic(id, 'okay')`; the `Status` line's options do not include `done`.

Rail test: a topic item renders `role="img"` with its confidence word and no `StatusMark` check glyph.

`Today.topics.test.tsx` (copy the harness from `Today.looseTasks.test.tsx`): a subject with a topic committed to today renders the row with `role="img"` and no checkbox named `Mark "Graphs" as done`; `Start session` is still offered.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement**

`TaskPage.tsx`:
- Compute `const topic = isTopic(goal, node.id)` (the page has the goal — check its props).
- When `topic`, render BEFORE the Status line:

```tsx
<PropertyLine
  label="Confidence"
  icon={<ConfidenceMark confidence={null} />}
  valueMark={<ConfidenceMark confidence={confidence} />}
  value={confidence === null ? 'Not rated' : `${CONFIDENCE_WORD[confidence]} · rated ${ratedWhen}`}
  placeholder="Not rated"
  panelWidth={188}
>
  {(close) => (
    <>
      <PropertyOption close={close} current={confidence === null} onSelect={() => actions.rateTopic(node.id, null)}>
        <ConfidenceMark confidence={null} />Not rated
      </PropertyOption>
      {CONFIDENCES.map((c) => (
        <PropertyOption key={c} close={close} current={confidence === c} onSelect={() => actions.rateTopic(node.id, c)}>
          <ConfidenceMark confidence={c} />{CONFIDENCE_WORD[c]}
        </PropertyOption>
      ))}
    </>
  )}
</PropertyLine>
```

where `confidence = topicConfidence(node)` and `ratedWhen` is `topicAgeLabel(node, today)` with the leading word stripped (or add a `ratedWhenLabel(n, today)` to `confidence.ts` returning just `today` / `yesterday` / `3 days ago`; if you add it, test it in `confidence.test.ts`).
- The Status line: filter `STATUS_ORDER` to exclude `'done'` when `topic`, with the comment "A topic has no done — its finish is solid, on the line above."

`Backlog.tsx`: where the row draws `StatusMark` for a step (`grep -n "StatusMark" src/views/plan/sidebar/Backlog.tsx`), draw `<ConfidenceMark confidence={item.confidence ?? null} />` when `item.topic`.

`Today.tsx`: the four `TodayCheckbox` sites for step items (primary at ~408, list at ~551, carried at ~652; the done-today list at ~811 never holds a topic — leave it). Introduce one helper inside the component:

```tsx
  /** A topic has no tick: it is rated on the shelf. The mark keeps the column. */
  function lead(item: DailyWorkItem): ReactNode {
    if (item.topic) {
      return (
        <span className="w-[22px] h-[22px] grid place-items-center flex-shrink-0">
          <ConfidenceMark confidence={item.confidence ?? null} />
        </span>
      );
    }
    return <TodayCheckbox checked={false} onToggle={() => complete(item)} ariaLabel={`Mark "${item.title}" as done`} />;
  }
```

and use `lead={lead(item)}` / `lead={lead(primaryItem)}` at those sites.

- [ ] **Step 4: Run, typecheck, commit**

`npx vitest run src/views` → PASS. `npx tsc -b`.

```bash
git add src/views/project/TaskPage.tsx src/views/project/TaskPage.test.tsx src/views/plan/sidebar/Backlog.tsx src/views/Today.tsx src/views/Today.topics.test.tsx
git commit -m "feat(app): the task page corrects a rating; rail and Today rows draw the mark, not a tick"
```

(Add the rail's test file to the `git add` with its real path.)

---

### Task 12: Template, header and overview

**Files:**
- Modify: `src/lib/goalType.ts` (`TEMPLATES`, `templateNodes`)
- Modify: `src/views/project/StepsTab.tsx`
- Modify: `src/views/project/ProjectHeader.tsx`, `src/views/project/OverviewTab.tsx`
- Test: `src/lib/goalType.test.ts`, `src/views/project/ProjectHeader.test.tsx`, `src/views/project/OverviewTab.test.tsx`

- [ ] **Step 1: Failing tests**

`goalType.test.ts`:

```ts
it('the study template names a Topics area and flags it', () => {
  expect(TEMPLATES.study.areas).toEqual(['Topics', 'Practice', 'Mock exam']);
  expect(TEMPLATES.study.flags).toEqual([{ topics: true }, undefined, undefined]);
  expect(templateNodes('study')[0]).toMatchObject({ title: 'Topics', topics: true });
  expect(templateNodes('project').every((n) => n.topics === undefined)).toBe(true);
});
```

`ProjectHeader.test.tsx` / `OverviewTab.test.tsx`: for a subject with one solid topic of two, the header/overview shows `1 of 2 topics solid`; for a plain project, nothing about topics appears.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement**

`goalType.ts`:

```ts
export const TEMPLATES: Record<GoalType, { label: string; areas: string[]; flags: ({ topics?: true } | undefined)[] }> = {
  study: {
    label: 'Topics and practice',
    // `Topics` is the one area with a FLAG: every row put under it is a topic
    // — rated, never ticked — which is what makes a study goal a subject.
    areas: ['Topics', 'Practice', 'Mock exam'],
    flags: [{ topics: true }, undefined, undefined],
  },
  project: { label: 'Scope to release', areas: [ … ], flags: [undefined, undefined, undefined, undefined, undefined] },
  general: { label: 'A simple split', areas: [ … ], flags: [undefined, undefined, undefined] },
};

export function templateNodes(type: GoalType): GoalNode[] {
  const t = TEMPLATES[type];
  return t.areas.map((title, i) => ({ id: uid(), title, ...(t.flags[i]?.topics ? { topics: true as const } : {}) }));
}
```

Update the doc comment on `TEMPLATES` to mention the flag.

`StepsTab.tsx:52`: `actions.addRootNodes(g.id, TEMPLATES[goalType].areas, TEMPLATES[goalType].flags)`.

`ProjectHeader.tsx`: where `pct` / `effort` are printed (read the JSX below line 75), add `{describeReadiness(effort.readiness) && <span className="text-meta text-muted">{describeReadiness(effort.readiness)}</span>}` beside the percentage — pick the exact slot after reading the header's existing caption and match its classes.

`OverviewTab.tsx` Progress section: replace `{o.effort.done} / {o.effort.total}` with `{effortCount(o.effort)}` (already readiness-aware) and change `<ProgressBar pct={pct} />` to keep `pct` (it is `goalPct`, which is readiness for a subject).

- [ ] **Step 4: Run, typecheck, commit**

`npx vitest run src/lib/goalType.test.ts src/views/project` → PASS. `npx tsc -b`.

```bash
git add src/lib/goalType.ts src/lib/goalType.test.ts src/views/project/StepsTab.tsx src/views/project/ProjectHeader.tsx src/views/project/ProjectHeader.test.tsx src/views/project/OverviewTab.tsx src/views/project/OverviewTab.test.tsx
git commit -m "feat(app): the study template opens with a Topics area; the header states readiness"
```

---

### Task 13: Whole-suite verification, docs, and the ledger

**Files:**
- Modify: `PhaseApp/CLAUDE.md` (Invariants)
- Everything above

- [ ] **Step 1: The full suite**

Run from `PhaseApp/`:

```bash
npm test
npx tsc -b
npm run build
```

Expected: all green. Fix anything that fails in the task that owns it, with its own commit.

- [ ] **Step 2: A physical pass**

Run `npm run app:dev`, create a goal titled `Algorithms midterm` (it infers Study), accept `Start with Topics · Practice · Mock exam`, add two topics under Topics, set an exam date a week out. Check: the topic rows show the bar box and no checkbox; Today's free-time offer leads with the first topic with `Weakest topic first`; ⌘Space → Start session → Complete session → the shelf asks `How solid is … now?`; `Okay` lights two bars on the row and the toast reads `Rated "…" okay`; the task page's Confidence line shows `Okay · rated today`. Record what you saw in the final report (a sentence each).

- [ ] **Step 3: CLAUDE.md**

Add to the **Invariants** list of `PhaseApp/CLAUDE.md`, after the `'parked'` paragraph:

> - **A topic is rated, never ticked.** A leaf under a node carrying `topics: true` is a topic: `src/lib/confidence.ts` is its one vocabulary (`topicIds`, `topicConfidence`, `sortForReview`, `readiness`), and `rateTopic` is the only writer of `confidence`/`confidenceAt`, which are written and cleared together. A topic never carries `status: 'done'` — `toggleLeaf`, `setNodeStatus('done')`, `finishWork`, the agent's `complete_task`/`set_status` and the phone's replay all refuse it. Its fraction in `pct.ts` is `CONFIDENCE_WEIGHT`; `leafCount` counts it open forever, so a subject never reads `ready-to-complete` and stays on the rail until archived; `goalEffort` leaves it out of every figure and states `readiness` instead. Its `due` in `backlogGroups` is the CONFIRMED exam date, which is how the nearest exam's weakest topic leads every surface through `sortByDue` with no second ranking. The rating moment is the focus draft's `'rating'` phase — entered only after a sitting on a topic is LOGGED, treated as not-running by the tray, the pill and the idle watcher — and its known cost is that the rating's undo sweeps the log's.

- [ ] **Step 4: Commit**

```bash
git add PhaseApp/CLAUDE.md
git commit -m "docs(app): the topic invariant"
```

---

## Self-review

- **Spec coverage:** data model (T1), vocabulary (T1), store actions and refusals (T5), rating moment (T6), shelf protocol/IPC (T8), surface/host/measure (T9), queue and advisor and daily work (T4), roll-up (T2), plan/effort (T3), tree/step surfaces (T10, T11), template/creation (T12), agent + phone seams (T7), error handling (returned values throughout), testing (each task), CLAUDE.md (T13).
- **Type consistency:** `Confidence` lives in `src/db/types.ts`, re-exported from `confidence.ts`; `topic?: true` / `confidence?: Confidence` are spelled identically on `BacklogItem`, `ProposalRow`, `RecommendedWork`, `DailyWorkItem`, `AssistantFocusView`; `rateTopic(nodeId, confidence, today?)`, `rateFocus(confidence)`, `setTopicsArea(nodeId, on)`, `addRootNodes(goalId, titles, flags?)` are used with those exact shapes in T5–T12.
- **Placeholders:** none; where a file's local helper name is unknown (`daysBetween`, the archive action, `leaf()`'s message convention, fixture names in tests) the step says exactly what to grep for.
