# Step Status (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `GoalNode.done?: boolean` with a four-state `status`, so a step can be *in progress* or *blocked*, and so blocked work leaves the next-step queue.

**Architecture:** Expand-then-contract. A `stepStatus()` helper that reads BOTH the legacy `done` and the new `status` lands first; every reader migrates to it while behaviour is bit-identical; then the data migrates; then the writers flip; then `done` is deleted from the type and the fallback is removed. **The suite is green after every single task** — there is no big-bang rename commit.

**Tech Stack:** TypeScript, React 19, Vitest, Dexie, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-07-step-status-design.md`

## Global Constraints

- Run `npx vitest run --config vitest.config.ts` and `npx tsc -b` before every commit. Both must be clean.
- Baseline at branch point: **1703 tests passing, 85 files, tsc clean.** Any task that reduces the passing count has broken something.
- `pct` output must not change for any pre-existing dataset. Task 3 adds the golden test that enforces this; do not weaken it later.
- Leaf XOR container is inviolate: `status` is stored on LEAVES only, exactly where `done` was.
- No new colour tokens, no literal hex, no arbitrary `text-[Nrem]`. `designScale.test.ts` enforces this. Use the existing `warn`, `accent`, `accent-tint`, `check`.
- Hover-revealed row controls use the `.quiet-control` class, never a hand-rolled `opacity-0 group-hover:opacity-100`. It needs a literal `group` ancestor (`group/name` does not match).
- Bulk edits are ONE undoable write, never a loop over a single-node action. They return whether they wrote; callers must not report success on a refusal.
- Component tests must click the child element a person actually hits, never the row — rows are covered by children that stop propagation and modifier clicks are caught in the capture phase.
- Absent-means-default: `'todo'` is NEVER written to storage. Writers normalise it to an absent field.

## Deviation from the spec — read before Task 8

The spec says `S` "opens a four-item popover". **This plan implements `S` as a three-state cycle instead** (`todo → doing → blocked → todo`), with no popover.

Reasons: `done` stays exclusively the checkbox's job, which keeps the invariant sentence *"ticking the checkbox remains the only thing that moves a number"* literally true; a cycle needs no portal, no focus trap, and no outside-click handling inside a tree that already owns a roving-tabindex focus model; and precise selection still exists in `StepPanel`, which is also the only place `blockedOn` can be typed.

Discoverability is covered by the `.quiet-control` button on the row, the `StepPanel` control, and a new line in `ShortcutsOverlay`.

**RESOLVED 2026-08-07: the cycle governs.** The user was shown both options and chose the cycle over the specced popover. Build the cycle; do not build a popover, and do not stop to ask. The spec's "Setting `doing` and `blocked`" section is superseded on this one point only.

---

## File Structure

**Created:**
- `src/lib/status.ts` — the status vocabulary: type, `stepStatus`, `isDone`, `containerStatus`, `cycleStatus`, and the transition helper `applyStatus`. Pure, no imports from the store.
- `src/lib/status.test.ts` — sibling test.
- `src/lib/migrateNodeStatus.ts` — the idempotent `done` → `status` data migration.
- `src/lib/migrateNodeStatus.test.ts` — sibling test.

**Modified (in task order):** `src/lib/pct.ts`, `src/lib/board.ts`, `src/lib/plan.ts`, `src/lib/backlog.ts`, `src/lib/tree.ts`, `src/lib/dailyWork.ts`, `src/lib/scheduled.ts`, `src/lib/capacity.ts`, `src/lib/checkpoints.ts`, `src/lib/search.ts`, `src/lib/selection.ts`, `src/lib/velocity.ts`, `src/lib/actuals.ts`, `src/lib/roadmap.ts`, `src/lib/unestimated.ts`, `src/lib/migrateSlots.ts`, `src/lib/goalImport.ts`, `src/lib/sampleProject.ts`, `src/db/types.ts`, `src/db/db.ts`, `src/state/store.ts`, `src/components/GoalTree.tsx`, `src/components/SubtaskAiModal.tsx`, `src/components/ShortcutsOverlay.tsx`, `src/views/project/StepPanel.tsx`, `src/views/goals/BoardCard.tsx`, `src/views/goals/FocusSummary.tsx`.

---

### Task 0: Branch

**Files:** none.

- [ ] **Step 1: Cut the branch off main**

The step-status work must not sit on top of in-flight calendar work.

```bash
cd "/Users/por25528/Programming stuff/Projects/Phase"
git fetch --all
git switch -c feat/step-status main
git log --oneline -1
```

- [ ] **Step 2: Confirm the baseline is green before changing anything**

```bash
npx tsc -b && npx vitest run --config vitest.config.ts 2>&1 | tail -4
```

Expected: `tsc` silent, and `Test Files 85 passed (85)` / `Tests 1703 passed (1703)`.

If it is NOT green, STOP. Do not start on a red baseline — report what fails.

---

### Task 1: The status vocabulary

**Files:**
- Create: `src/lib/status.ts`
- Test: `src/lib/status.test.ts`

**Interfaces:**
- Consumes: `GoalNode` from `src/db/types.ts`.
- Produces: `StepStatus`, `stepStatus(n)`, `isDone(n)`, `containerStatus(n)`, `cycleStatus(s)`, `applyStatus(n, next, today, blockedOn?)`. Every later task uses these names exactly.

During this task `GoalNode` still has `done`, and `stepStatus` deliberately falls back to it. That fallback is removed in Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/lib/status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GoalNode } from '../db/types';
import { stepStatus, isDone, containerStatus, cycleStatus, applyStatus } from './status';

const leaf = (over: Partial<GoalNode> = {}): GoalNode => ({ id: 'n', title: 'n', ...over });

describe('stepStatus', () => {
  it('defaults an untouched leaf to todo', () => {
    expect(stepStatus(leaf())).toBe('todo');
  });

  it('reads the new field when present', () => {
    expect(stepStatus(leaf({ status: 'blocked' }))).toBe('blocked');
  });

  // The fallback that makes the migration a non-event: every reader can move to
  // this helper BEFORE the data changes shape, so no commit is ever half-renamed.
  it('falls back to the legacy done flag', () => {
    expect(stepStatus(leaf({ done: true }))).toBe('done');
    expect(stepStatus(leaf({ done: false }))).toBe('todo');
  });

  it('prefers the new field when both are somehow present', () => {
    expect(stepStatus(leaf({ done: true, status: 'doing' }))).toBe('doing');
  });

  it('treats an explicitly stored todo as todo', () => {
    expect(stepStatus(leaf({ status: 'todo' }))).toBe('todo');
  });
});

describe('isDone', () => {
  it('is true only for done', () => {
    expect(isDone(leaf({ status: 'done' }))).toBe(true);
    expect(isDone(leaf({ status: 'doing' }))).toBe(false);
    expect(isDone(leaf({ status: 'blocked' }))).toBe(false);
    expect(isDone(leaf())).toBe(false);
  });
});

describe('containerStatus', () => {
  const group = (...kids: GoalNode[]): GoalNode => ({ id: 'g', title: 'g', children: kids });

  it('is done when every descendant leaf is done', () => {
    expect(containerStatus(group(leaf({ status: 'done' }), leaf({ status: 'done' })))).toBe('done');
  });

  it('is doing when any descendant is doing', () => {
    expect(containerStatus(group(leaf({ status: 'doing' }), leaf()))).toBe('doing');
  });

  /**
   * Strict on purpose. One blocked child among four workable ones is not a
   * blocked container — you can still work it, and dimming it would hide four
   * available rows behind one stuck one.
   */
  it('is blocked only when EVERY open descendant is blocked', () => {
    expect(containerStatus(group(leaf({ status: 'blocked' }), leaf({ status: 'done' })))).toBe('blocked');
    expect(containerStatus(group(leaf({ status: 'blocked' }), leaf()))).toBe('todo');
  });

  it('recurses through nested containers', () => {
    expect(containerStatus(group(group(leaf({ status: 'doing' }))))).toBe('doing');
  });

  it('calls an empty container todo rather than done', () => {
    expect(containerStatus(group())).toBe('todo');
  });
});

describe('cycleStatus', () => {
  // `done` is never reachable by cycling: the checkbox remains the only thing
  // that moves a number.
  it('walks todo → doing → blocked → todo', () => {
    expect(cycleStatus('todo')).toBe('doing');
    expect(cycleStatus('doing')).toBe('blocked');
    expect(cycleStatus('blocked')).toBe('todo');
  });

  it('sends a done step back to todo, never onward to doing', () => {
    expect(cycleStatus('done')).toBe('todo');
  });
});

describe('applyStatus', () => {
  it('stamps doneAt on the way into done', () => {
    const n = applyStatus(leaf(), 'done', '2026-08-07');
    expect(n.status).toBe('done');
    expect(n.doneAt).toBe('2026-08-07');
  });

  it('clears doneAt on the way out of done', () => {
    const n = applyStatus(leaf({ status: 'done', doneAt: '2026-08-01' }), 'todo', '2026-08-07');
    expect(n.status).toBeUndefined();
    expect(n.doneAt).toBeUndefined();
  });

  it('never stores todo — an absent field IS todo', () => {
    const n = applyStatus(leaf({ status: 'doing' }), 'todo', '2026-08-07');
    expect('status' in n).toBe(false);
  });

  it('carries the blocked reason, and drops it on the way out', () => {
    const blocked = applyStatus(leaf(), 'blocked', '2026-08-07', 'waiting on the grader');
    expect(blocked.blockedOn).toBe('waiting on the grader');
    const after = applyStatus(blocked, 'doing', '2026-08-07');
    expect(after.blockedOn).toBeUndefined();
  });

  it('drops the legacy done flag as it writes', () => {
    const n = applyStatus(leaf({ done: true, doneAt: '2026-08-01' }), 'doing', '2026-08-07');
    expect('done' in n).toBe(false);
    expect(n.doneAt).toBeUndefined();
  });

  it('does not mutate the node it was given', () => {
    const before = leaf({ status: 'doing' });
    applyStatus(before, 'done', '2026-08-07');
    expect(before.status).toBe('doing');
    expect(before.doneAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run --config vitest.config.ts src/lib/status.test.ts
```

Expected: FAIL — `Failed to resolve import "./status"`.

- [ ] **Step 3: Add `status` and `blockedOn` to the type, keeping `done` for now**

In `src/db/types.ts`, inside `GoalNode`, replace the `done` / `doneAt` lines with:

```ts
  /**
   * @deprecated Superseded by `status`. Read through `stepStatus()` in
   * src/lib/status.ts, never directly — it is deleted once every writer and
   * every stored row has moved (see the step-status plan, Task 6).
   */
  done?: boolean;
  /**
   * LEAVES only, exactly where `done` was. Absent ⇒ 'todo'; 'todo' is never
   * written. Scheduling metadata never affects the pct roll-up and neither does
   * this: `pct.ts` counts 'done' and nothing else, so 'doing' and 'blocked'
   * contribute zero, exactly as an unticked box always did.
   */
  status?: StepStatus;
  /** Present only while status === 'blocked'. Cleared on any other transition. */
  blockedOn?: string;
  doneAt?: string;      // local 'YYYY-MM-DD' completion date; optional for legacy data
```

And above `GoalNode`, add:

```ts
export type StepStatus = 'todo' | 'doing' | 'blocked' | 'done';
```

- [ ] **Step 4: Write the implementation**

Create `src/lib/status.ts`:

```ts
import type { GoalNode, StepStatus } from '../db/types';

export type { StepStatus };

/**
 * A leaf's status.
 *
 * Reads the legacy `done` flag when `status` is absent, which is what lets every
 * READER in the app move onto this helper before a single stored row changes
 * shape. Once the migration has run and the writers have flipped, the fallback
 * is deleted along with the field (plan Task 6).
 */
export function stepStatus(n: GoalNode): StepStatus {
  if (n.status !== undefined) return n.status;
  return n.done ? 'done' : 'todo';
}

export function isDone(n: GoalNode): boolean {
  return stepStatus(n) === 'done';
}

function isLeaf(n: GoalNode): boolean {
  return !n.children || n.children.length === 0;
}

/**
 * A container's status, derived and never stored — a container has no `done`,
 * so it can have no `status` either without breaking leaf-XOR-container.
 *
 * `blocked` is deliberately strict: EVERY open descendant must be blocked. One
 * stuck child among four workable ones is not a stuck container.
 */
export function containerStatus(n: GoalNode): StepStatus {
  const leaves: GoalNode[] = [];
  const walk = (node: GoalNode): void => {
    if (isLeaf(node)) { leaves.push(node); return; }
    node.children!.forEach(walk);
  };
  walk(n);

  if (leaves.length === 0) return 'todo';
  const open = leaves.filter((l) => !isDone(l));
  if (open.length === 0) return 'done';
  if (open.some((l) => stepStatus(l) === 'doing')) return 'doing';
  if (open.every((l) => stepStatus(l) === 'blocked')) return 'blocked';
  return 'todo';
}

/**
 * The one place a status is put into words. Shared rather than redeclared in
 * each view: the tree's accessible label, the panel's radio group and the board
 * chip must not drift into three different vocabularies for the same state.
 */
export const STATUS_WORD: Record<StepStatus, string> = {
  todo: 'to do',
  doing: 'in progress',
  blocked: 'blocked',
  done: 'done',
};

/**
 * The row cycle. `done` is unreachable from here by design — ticking the
 * checkbox remains the only thing that moves a number.
 */
export function cycleStatus(s: StepStatus): StepStatus {
  switch (s) {
    case 'todo': return 'doing';
    case 'doing': return 'blocked';
    default: return 'todo'; // 'blocked' and 'done' both land back on todo
  }
}

/**
 * Return a COPY of `n` at `next`, with the dependent fields kept honest:
 * `doneAt` is stamped entering `done` and cleared leaving it, `blockedOn`
 * survives only while blocked, `'todo'` is stored as an absent field, and the
 * legacy `done` flag is dropped on every write.
 */
export function applyStatus(
  n: GoalNode,
  next: StepStatus,
  today: string,
  blockedOn?: string,
): GoalNode {
  const out: GoalNode = { ...n };
  delete out.done;

  if (next === 'todo') delete out.status;
  else out.status = next;

  if (next === 'done') out.doneAt = today;
  else delete out.doneAt;

  const reason = blockedOn?.trim();
  if (next === 'blocked' && reason) out.blockedOn = reason;
  else delete out.blockedOn;

  return out;
}
```

- [ ] **Step 5: Run the test and the typecheck**

```bash
npx vitest run --config vitest.config.ts src/lib/status.test.ts && npx tsc -b
```

Expected: all tests PASS, `tsc` silent.

- [ ] **Step 6: Commit**

```bash
git add src/lib/status.ts src/lib/status.test.ts src/db/types.ts
git commit -m "feat(status): the vocabulary a step needs to say where it stands

A leaf is a boolean today, so a course with six chapters open at once
reads as none of them started. Add the four-state vocabulary and the
helpers that derive it, with stepStatus() still falling back to \`done\`
so every reader can move over before any stored row changes shape.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Move every reader onto the helper

**Files (all Modify):** `src/lib/pct.ts`, `src/lib/board.ts`, `src/lib/plan.ts`, `src/lib/backlog.ts`, `src/lib/tree.ts`, `src/lib/dailyWork.ts`, `src/lib/scheduled.ts`, `src/lib/capacity.ts`, `src/lib/checkpoints.ts`, `src/lib/search.ts`, `src/lib/selection.ts`, `src/lib/velocity.ts`, `src/lib/actuals.ts`, `src/lib/roadmap.ts`, `src/lib/unestimated.ts`, `src/lib/migrateSlots.ts`, `src/components/GoalTree.tsx`, `src/components/SubtaskAiModal.tsx`

**Interfaces:**
- Consumes: `isDone` from `src/lib/status.ts`.
- Produces: no signature changes at all. This task is behaviour-preserving by construction.

**This task changes only READS.** Writers are Task 5. `Task.done` is a DIFFERENT type and must NOT be touched anywhere.

The exhaustive list of `GoalNode.done` READ sites in non-test source, with the exact rewrite:

| File:line | Current | Becomes |
|---|---|---|
| `src/lib/pct.ts:62` | `pct: n.done ? 100 : 0,` | `pct: isDone(n) ? 100 : 0,` |
| `src/lib/board.ts:12` | `if (n.done) done++;` | `if (isDone(n)) done++;` |
| `src/lib/tree.ts:41` | `} else if (!n.done) {` | `} else if (!isDone(n)) {` |
| `src/lib/backlog.ts:143` | `if (n.done) return;` | `if (isDone(n)) return;` |
| `src/lib/backlog.ts:212` | `if (!n.done && n.plannedWeek === undefined) hidden = true;` | `if (!isDone(n) && n.plannedWeek === undefined) hidden = true;` |
| `src/lib/plan.ts:71` | `done: !!n.done,` | `done: isDone(n),` |
| `src/lib/plan.ts:128` | `if (!n.done && (...))` | `if (!isDone(n) && (...))` |
| `src/lib/plan.ts:156` | `} else if (!n.done && (...)) {` | `} else if (!isDone(n) && (...)) {` |
| `src/lib/plan.ts:194` | `if (!n.done) open = true;` | `if (!isDone(n)) open = true;` |
| `src/lib/plan.ts:201` | `if (!n.done && n.plannedWeek === week)` | `if (!isDone(n) && n.plannedWeek === week)` |
| `src/lib/plan.ts:207` | `if (!n.done && n.deadline && ...)` | `if (!isDone(n) && n.deadline && ...)` |
| `src/lib/plan.ts:302` | `if (!n.done && n.plannedWeek === week)` | `if (!isDone(n) && n.plannedWeek === week)` |
| `src/lib/plan.ts:354` | `if (!n.done) open.push(n);` | `if (!isDone(n)) open.push(n);` |
| `src/lib/plan.ts:444` | `else if (node.done) nowComplete.push(e);` | `else if (isDone(node)) nowComplete.push(e);` |
| `src/lib/plan.ts:488` | `if (!n.done && n.plannedDay)` | `if (!isDone(n) && n.plannedDay)` |
| `src/lib/dailyWork.ts:92` | `done: Boolean(node.done),` | `done: isDone(node),` |
| `src/lib/dailyWork.ts:146` | `!leaf.node.done` | `!isDone(leaf.node)` |
| `src/lib/dailyWork.ts:165` | `!node.done` | `!isDone(node)` |
| `src/lib/dailyWork.ts:177` | `!node.done` | `!isDone(node)` |
| `src/lib/dailyWork.ts:204` | `if (!node.done && stale && ...)` | `if (!isDone(node) && stale && ...)` |
| `src/lib/dailyWork.ts:216` | `if (leaf.node.done === true && leaf.node.doneAt === today)` | `if (isDone(leaf.node) && leaf.node.doneAt === today)` |
| `src/lib/scheduled.ts:38` | `done: !!n.done,` | `done: isDone(n),` |
| `src/lib/scheduled.ts:88` | `done: !!n.done,` | `done: isDone(n),` |
| `src/lib/checkpoints.ts:56` | `&& !node.done` | `&& !isDone(node)` |
| `src/lib/checkpoints.ts:70` | `if (node.checkpoint && !node.done && ...)` | `if (node.checkpoint && !isDone(node) && ...)` |
| `src/lib/search.ts:59` | `done: node.done === true,` | `done: isDone(node),` |
| `src/lib/selection.ts:92` | `if (n.done \|\| seen.has(n.id)) return;` | `if (isDone(n) \|\| seen.has(n.id)) return;` |
| `src/lib/velocity.ts:79` | `if (leaf.done) {` | `if (isDone(leaf)) {` |
| `src/lib/actuals.ts:108` | `if (!leaf.done) return;` | `if (!isDone(leaf)) return;` |
| `src/lib/roadmap.ts:33` | `return !n.done;` | `return !isDone(n);` |
| `src/lib/migrateSlots.ts:87` | `if (n.done \|\| !n.plannedWeek) return;` | `if (isDone(n) \|\| !n.plannedWeek) return;` |
| `src/components/GoalTree.tsx:654` | `checked={!!n.done}` | `checked={isDone(n)}` |
| `src/components/GoalTree.tsx:671` | `: n.done ? 'line-through text-faint'` | `: isDone(n) ? 'line-through text-faint'` |
| `src/components/GoalTree.tsx:697` | `: n.done` | `: isDone(n)` |
| `src/components/SubtaskAiModal.tsx:26` | `} else if (!n.done) {` | `} else if (!isDone(n)) {` |

**Do NOT touch these — they are `Task.done`, not `GoalNode.done`:**
`backlog.ts:159`, `capacity.ts:155`, `dailyWork.ts:74,155,190,211`, `scheduled.ts:50,102`, `search.ts:95`, `migrateSlots.ts:142`, `store.ts:1467-1472`, `planner.ts:74,78,82`.

**Also do not touch** `BoardCard.tsx:79`, `Stats.tsx:15`, `ProjectHeader.tsx:77`, `planner.ts:73`, `DayBlocks.tsx:79,108`, `EventBlock.tsx:108,142`, `CommandPalette.tsx:289`, `search.ts:185`, **`capacity.ts:149`**, **`unestimated.ts:51`** — these read `.done` on `PlannedLeaf` / `ScheduledItem` / `SearchEntry`, derived structures that keep a plain boolean.

> **Corrected 2026-08-07, mid-execution.** `capacity.ts:149` and `unestimated.ts:51` were originally listed as sites to rewrite. That was wrong: `workloadOf` (`capacity.ts:144`) and `unestimatedCommitments` (`unestimated.ts:44`) both take `PlannedLeaf[]`, and `isDone()` accepts only a `GoalNode`, so the literal instruction would not have compiled. The Task 2 implementer traced the types, refused both, and was right to. `capacity.ts` and `unestimated.ts` end up with zero changes. Trust the declared parameter type over this table.

- [ ] **Step 1: Add the import to each file**

Each of the 18 files needs, alongside its existing imports:

```ts
import { isDone } from './status';       // for files in src/lib/
import { isDone } from '../lib/status';  // for files in src/components/
```

- [ ] **Step 2: Apply every rewrite in the table above**

Work file by file. After each file, run that file's sibling test if it has one.

- [ ] **Step 3: Prove no GoalNode.done reads remain in source**

```bash
grep -rn "\.done\b" src --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -vE "task\.done|t\.done|updated\.done|item\.done|block\.done|entry\.done|leaf\.done|l\.done|e\.done"
```

Read every remaining hit and confirm each is a `Task`, `PlannedLeaf`, `ScheduledItem` or `SearchEntry` — not a `GoalNode`.

- [ ] **Step 4: Run the full suite and typecheck**

```bash
npx tsc -b && npx vitest run --config vitest.config.ts 2>&1 | tail -4
```

Expected: `tsc` silent, **1703 + 12 = 1715 tests passing** (the 12 new ones from Task 1), 86 files.

Behaviour is unchanged by construction: `isDone(n)` is `n.done ? 'done' : 'todo'` compared against `'done'`, which is exactly `!!n.done`.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib src/components
git commit -m "refactor(status): read completion through one helper

Every GoalNode reader now asks stepStatus/isDone instead of touching the
boolean. Behaviour is identical — the helper still falls back to \`done\` —
which is what lets the data and the writers move in later commits without
any half-renamed state in between.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: The migration, and the golden pct-identity test

**Files:**
- Create: `src/lib/migrateNodeStatus.ts`, `src/lib/migrateNodeStatus.test.ts`
- Modify: `src/lib/pct.test.ts`

**Interfaces:**
- Consumes: `Goal`, `GoalNode`, `StepStatus`.
- Produces: `migrateNodeStatus(goals: Goal[]): Goal[]` — idempotent, identity-preserving when nothing changes.

Unlike `migrateSlots` and `migrateCheckpoints` this needs NO one-shot flag and NO pre-migration snapshot. Those migrations are interpretive and lossy; this one is a total, unambiguous field rename, so re-running it is a no-op and there is nothing to recover.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/migrateNodeStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Goal } from '../db/types';
import { migrateNodeStatus } from './migrateNodeStatus';

const goal = (nodes: Goal['nodes']): Goal => ({ id: 'g', title: 'G', nodes });

describe('migrateNodeStatus', () => {
  it('turns a ticked leaf into done, keeping doneAt', () => {
    const [g] = migrateNodeStatus([goal([{ id: 'a', title: 'A', done: true, doneAt: '2026-07-01' }])]);
    expect(g.nodes[0].status).toBe('done');
    expect(g.nodes[0].doneAt).toBe('2026-07-01');
    expect('done' in g.nodes[0]).toBe(false);
  });

  it('turns an unticked leaf into an absent status', () => {
    const [g] = migrateNodeStatus([goal([{ id: 'a', title: 'A', done: false }])]);
    expect(g.nodes[0].status).toBeUndefined();
    expect('done' in g.nodes[0]).toBe(false);
  });

  it('recurses into containers and leaves the container itself alone', () => {
    const [g] = migrateNodeStatus([goal([
      { id: 'p', title: 'P', children: [{ id: 'c', title: 'C', done: true }] },
    ])]);
    expect(g.nodes[0].status).toBeUndefined();
    expect(g.nodes[0].children![0].status).toBe('done');
  });

  it('never invents blockedOn', () => {
    const [g] = migrateNodeStatus([goal([{ id: 'a', title: 'A', done: true }])]);
    expect(g.nodes[0].blockedOn).toBeUndefined();
  });

  // Re-running must be harmless: it is called on every load AND on every
  // import, and a backup written a year ago can be imported tomorrow.
  it('is idempotent', () => {
    const once = migrateNodeStatus([goal([{ id: 'a', title: 'A', done: true }])]);
    const twice = migrateNodeStatus(once);
    expect(twice[0].nodes[0].status).toBe('done');
  });

  it('preserves object identity when there is nothing to do', () => {
    const input = [goal([{ id: 'a', title: 'A', status: 'doing' }])];
    expect(migrateNodeStatus(input)).toBe(input);
  });

  it('leaves an already-migrated status untouched', () => {
    const [g] = migrateNodeStatus([goal([{ id: 'a', title: 'A', status: 'blocked', blockedOn: 'grader' }])]);
    expect(g.nodes[0].status).toBe('blocked');
    expect(g.nodes[0].blockedOn).toBe('grader');
  });
});
```

Add to the END of `src/lib/pct.test.ts`:

```ts
import { migrateNodeStatus } from './migrateNodeStatus';

/**
 * The load-bearing test of the whole slice.
 *
 * The percentage is what the pace deficit, the board card and the rail all read
 * from. Replacing the field it is computed from is only safe if the number does
 * not move, so assert that directly rather than trusting the mapping.
 */
describe('pct survives the status migration unchanged', () => {
  const shapes: Array<{ name: string; goal: Goal }> = [
    { name: 'flat, half done', goal: { id: 'g', title: 'G', nodes: [
      { id: 'a', title: 'A', done: true }, { id: 'b', title: 'B', done: false },
    ] } },
    { name: 'nested, uneven', goal: { id: 'g', title: 'G', nodes: [
      { id: 'p', title: 'P', children: [
        { id: 'c1', title: 'C1', done: true }, { id: 'c2', title: 'C2', done: false },
        { id: 'c3', title: 'C3', done: false },
      ] },
      { id: 'q', title: 'Q', done: true },
    ] } },
    { name: 'estimate-weighted', goal: { id: 'g', title: 'G', nodes: [
      { id: 'a', title: 'A', done: true, estimateMin: 360 },
      { id: 'b', title: 'B', done: false, estimateMin: 20 },
    ] } },
    { name: 'partially estimated, falls back to equal weight', goal: { id: 'g', title: 'G', nodes: [
      { id: 'a', title: 'A', done: true, estimateMin: 360 },
      { id: 'b', title: 'B', done: false },
    ] } },
    { name: 'nothing done', goal: { id: 'g', title: 'G', nodes: [
      { id: 'a', title: 'A', done: false }, { id: 'b', title: 'B', done: false },
    ] } },
    { name: 'everything done', goal: { id: 'g', title: 'G', nodes: [
      { id: 'a', title: 'A', done: true }, { id: 'b', title: 'B', done: true },
    ] } },
    { name: 'no steps at all', goal: { id: 'g', title: 'G', nodes: [] } },
  ];

  for (const { name, goal } of shapes) {
    it(`is identical for: ${name}`, () => {
      const before = goalPct(goal);
      const [after] = migrateNodeStatus([structuredClone(goal)]);
      expect(goalPct(after)).toBe(before);
      expect(goalPctBasis(after)).toBe(goalPctBasis(goal));
    });
  }
});
```

If `pct.test.ts` does not already import `goalPctBasis` or `Goal`, add them.

- [ ] **Step 2: Run to confirm both fail**

```bash
npx vitest run --config vitest.config.ts src/lib/migrateNodeStatus.test.ts src/lib/pct.test.ts
```

Expected: FAIL — `Failed to resolve import "./migrateNodeStatus"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/migrateNodeStatus.ts`:

```ts
import type { Goal, GoalNode } from '../db/types';

/**
 * Rewrite the legacy `done` boolean as a `status`.
 *
 * Total and unambiguous — `true` is 'done', anything else is 'todo', which is
 * stored as an absent field. So unlike migrateSlots and migrateCheckpoints this
 * needs no one-shot flag and no pre-migration snapshot: re-running it cannot
 * change anything a first run did not, and there is nothing to recover to.
 *
 * A node is rebuilt only when it carries the legacy field, so a no-op migration
 * returns the very same array and the very same objects. That identity is what
 * makes it cheap enough to run on every load and every import.
 */
export function migrateNodeStatus(goals: Goal[]): Goal[] {
  let changed = false;

  const migrateNode = (n: GoalNode): GoalNode => {
    const kids = n.children?.map(migrateNode);
    const kidsChanged = kids !== undefined && kids.some((k, i) => k !== n.children![i]);
    const hasLegacy = Object.prototype.hasOwnProperty.call(n, 'done');

    if (!hasLegacy && !kidsChanged) return n;

    changed = true;
    const out: GoalNode = { ...n, ...(kids ? { children: kids } : {}) };
    if (hasLegacy) {
      // Only set `status` when the node did not already carry one: an
      // already-migrated node that somehow still holds `done` must keep the
      // newer field as the truth.
      if (out.status === undefined && out.done === true) out.status = 'done';
      delete out.done;
    }
    return out;
  };

  const next = goals.map((g) => {
    const nodes = g.nodes.map(migrateNode);
    return nodes.some((n, i) => n !== g.nodes[i]) ? { ...g, nodes } : g;
  });

  return changed ? next : goals;
}
```

- [ ] **Step 4: Run to confirm they pass**

```bash
npx vitest run --config vitest.config.ts src/lib/migrateNodeStatus.test.ts src/lib/pct.test.ts && npx tsc -b
```

Expected: PASS, `tsc` silent.

- [ ] **Step 5: Commit**

```bash
git add src/lib/migrateNodeStatus.ts src/lib/migrateNodeStatus.test.ts src/lib/pct.test.ts
git commit -m "feat(status): migrate the done flag, and prove the number does not move

The percentage is what the pace deficit, the board card and the rail read
from, so the migration ships with a golden test asserting goalPct and
goalPctBasis are identical across it for seven tree shapes.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Run the migration on load and on import

**Files:**
- Modify: `src/db/db.ts`, `src/state/store.ts`
- Test: `src/db/db.test.ts`, `src/state/store.test.ts`

**Interfaces:**
- Consumes: `migrateNodeStatus`.
- Produces: nothing new. After this task, stored data carries `status`.

Two call sites, both required. The load path covers this device; `importStateFromFile` covers a backup written before the migration existed.

**The test goes in `src/db/db.test.ts`, NOT `src/state/store.test.ts`.** `store.test.ts` mocks `importStateFromFile` (`vi.fn()` in its `dbMocks` block), so a test written there exercises the mock and would pass no matter what `db.ts` does. `db.test.ts` drives the real module.

- [ ] **Step 1: Write the failing test**

Add to `src/db/db.test.ts`, alongside the existing `importStateFromFile` tests. Match how those tests build a `File` — they hand `importStateFromFile` a real `File` containing JSON.

```ts
it('migrates a legacy done flag out of an imported backup', async () => {
  const backup = {
    goals: [{ id: 'g', title: 'G', nodes: [
      { id: 'a', title: 'A', done: true, doneAt: '2026-07-01' },
      { id: 'b', title: 'B', done: false },
      { id: 'p', title: 'P', children: [{ id: 'c', title: 'C', done: true }] },
    ] }],
    habits: [], tasks: [], sessions: [],
  };

  await importStateFromFile(new File([JSON.stringify(backup)], 'backup.json'));

  const [g] = await db.goals.toArray();
  const [a, b, p] = g.nodes;
  expect(a.status).toBe('done');
  expect(a.doneAt).toBe('2026-07-01');
  expect('done' in a).toBe(false);
  expect(b.status).toBeUndefined();
  expect('done' in b).toBe(false);
  expect(p.children[0].status).toBe('done');
});

it('migrates a legacy done flag on load', async () => {
  await db.goals.bulkPut([
    { id: 'g', title: 'G', nodes: [{ id: 'a', title: 'A', done: true }] },
  ] as never);

  const state = await loadState();

  expect(state.goals[0].nodes[0].status).toBe('done');
  expect('done' in state.goals[0].nodes[0]).toBe(false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run --config vitest.config.ts src/db/db.test.ts -t "legacy done flag"
```

Expected: FAIL — `expect(a.status).toBe('done')` receives `undefined`.

- [ ] **Step 3: Wire it into the import path**

In `src/db/db.ts`, inside `importStateFromFile`, the line currently reads:

```ts
  const { goals } = migrateCheckpoints(sanitizedGoals);
```

Change to:

```ts
  // Both migrations, in this order: migrateCheckpoints can APPEND nodes built
  // from legacy milestones, and those nodes must go through the status
  // migration too rather than entering the store carrying `done`.
  const { goals: checkpointed } = migrateCheckpoints(sanitizedGoals);
  const goals = migrateNodeStatus(checkpointed);
```

Add the import at the top of `src/db/db.ts`:

```ts
import { migrateNodeStatus } from '../lib/migrateNodeStatus';
```

- [ ] **Step 4: Wire it into the load path**

`src/db/db.ts:80-88` currently reads:

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

Change only the return:

```ts
  return { goals: migrateNodeStatus(goals), habits, tasks, sessions };
```

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npx tsc -b && npx vitest run --config vitest.config.ts 2>&1 | tail -4
```

Expected: `tsc` silent, all tests pass. Existing tests still pass because readers go through `isDone`, which handles both shapes.

- [ ] **Step 6: Commit**

```bash
git add src/db/db.ts src/db/db.test.ts
git commit -m "feat(status): migrate on load and on import

Two call sites, both required: the load path covers this device, and
importStateFromFile covers a backup written before status existed. The
checkpoint migration runs first, because the nodes it appends from legacy
milestones must be migrated too rather than entering the store with \`done\`.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Flip the writers

**Files:**
- Modify: `src/state/store.ts`, `src/lib/tree.ts`, `src/lib/goalImport.ts`, `src/lib/sampleProject.ts`
- Test: `src/state/store.test.ts`, `src/lib/tree.test.ts`, `src/lib/goalImport.test.ts`, `src/lib/sampleProject.test.ts`

**Interfaces:**
- Consumes: `applyStatus`, `stepStatus`, `isDone`.
- Produces: no signature changes.

Every site that WRITES `done` on a `GoalNode`. After this task nothing in the app writes the legacy field.

The complete list:

| Site | Current | Becomes |
|---|---|---|
| `store.ts:765-774` `toggleLeaf` | sets `node.done` true/false + `doneAt` | `applyStatus(node, isDone(node) ? 'todo' : 'done', todayStr())` |
| `store.ts:818` `addChild` guard | `node.done === true \|\| ...` | `isDone(node) \|\| ...` |
| `store.ts:822-823` `addChild` | `delete node.done; delete node.doneAt;` | `delete node.status; delete node.blockedOn; delete node.doneAt;` |
| `store.ts:852` `addChildren` guard | `node.done === true \|\| ...` | `isDone(node) \|\| ...` |
| `store.ts:855` `addChildren` | `{ id: uid(), title, done: false }` | `{ id: uid(), title }` |
| `store.ts:856-857` `addChildren` | `delete node.done; delete node.doneAt;` | `delete node.status; delete node.blockedOn; delete node.doneAt;` |
| `store.ts:1027-1028` `completeNodes` | `n.done = true; n.doneAt = today;` | `n.status = 'done'; n.doneAt = today; delete n.blockedOn;` |
| `tree.ts:120` `insertSiblingAfter` | `{ id: newId, title, done: false }` | `{ id: newId, title }` |
| `tree.ts:159-160` `indentNode` | `delete prev.done; delete prev.doneAt;` | `delete prev.status; delete prev.blockedOn; delete prev.doneAt;` |
| `tree.ts:192` `outdentNode` | `parent.done = false;` | *(delete the line — absent IS todo)* |
| `goalImport.ts:101,135` `buildNode` | `done: false` | *(omit the key)* |
| `goalImport.ts:162` `buildManualGoal` | `done: false` | *(omit the key)* |
| `sampleProject.ts:23-24` | `done: true, doneAt: ...` | `status: 'done', doneAt: ...` |
| `sampleProject.ts:29-31,34` | `done: false` | *(omit the key)* |

- [ ] **Step 1: Update the tests that assert the old shape, first**

These test assertions currently expect `done`. Rewrite each to assert `status`. The full list, from the inventory:

- `src/lib/tree.test.ts:95,195,236,265,326,519` — `expect(x.done).toBeUndefined()` → `expect(x.status).toBeUndefined()`; `expect(x.done).toBe(false)` → `expect(x.status).toBeUndefined()`.
- `src/lib/goalImport.test.ts:103,117,118,123,164,249,251` — same mapping; `done === false` becomes `status === undefined`.
- `src/lib/sampleProject.test.ts:27,38` — `container.done` → `container.status`; `!n.done` → `!isDone(n)`.
- `src/state/store.test.ts:114,116,345,448,466,751,860,863,1330,1345,1381,1384,1397,2010,2244,2260,3480,3481,3482,3484,3505,3506,3529,3581,3675` — `.done).toBe(true)` → `.status).toBe('done')`; `.done).toBe(false)` and `.done).toBeUndefined()` → `.status).toBeUndefined()`; `.done).toBeFalsy()` → `.status).toBeUndefined()`.
- `src/components/EstimateControl.test.tsx:323,416`, `src/components/GoalTree.selection.test.tsx:137,231,232,282,283,317,326`, `src/components/GoalTree.stepPanel.test.tsx:79,85` — same mapping.
- `src/lib/actuals.test.ts:130` — `goal.nodes[0].done = false;` → `delete goal.nodes[0].status;`
- `src/lib/plan.test.ts:65` — asserts `PlannedLeaf.done`, a derived boolean. **Leave unchanged.**

- [ ] **Step 2: Run to confirm they now fail**

```bash
npx vitest run --config vitest.config.ts 2>&1 | tail -4
```

Expected: many FAIL, all of the form `expected undefined to be 'done'`. That is the point — the writers have not moved yet.

- [ ] **Step 3: Apply every writer change in the table**

`applyStatus` returns a COPY, but these actions mutate a cloned tree in place. `Object.assign` alone is wrong: a key the copy DROPPED is still present on the live node afterwards, so unticking would leave a stale `doneAt` behind. Add one shared helper next to the actions and use it at every write site:

```ts
/**
 * Write a status onto a node of an already-cloned tree.
 *
 * `applyStatus` is pure and returns a copy, so assigning it over the live node
 * would keep any key the copy DROPPED — unticking a step would leave its
 * `doneAt` behind, and `doneAt` is what the week recap reads.
 */
function writeStatus(n: GoalNode, next: StepStatus, today: string, blockedOn?: string): void {
  const updated = applyStatus(n, next, today, blockedOn);
  for (const key of ['status', 'blockedOn', 'doneAt'] as const) {
    if (updated[key] === undefined) delete n[key];
    else (n[key] as unknown) = updated[key];
  }
}
```

For `toggleLeaf`, the whole body becomes:

```ts
  toggleLeaf(nodeId: string) {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node || node.children?.length) return;
    const wasDone = isDone(node);
    writeStatus(node, wasDone ? 'todo' : 'done', todayStr());
    if (wasDone) {
      // Unchecking is self-inverse and the row stays visible — no undo toast.
      setAndPersist({ goals });
    } else {
      // Completion makes the row vanish from Next up — arm the undo window.
      withUndo(`Completed "${node.title}"`, 'goals', goals);
    }
  },
```

Note that ticking a blocked step to done also clears `blockedOn`, which `writeStatus` handles — a finished step has nothing left to wait on.

- [ ] **Step 4: Run the full suite and typecheck**

```bash
npx tsc -b && npx vitest run --config vitest.config.ts 2>&1 | tail -4
```

Expected: `tsc` silent, everything passes.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(status): every writer stores a status

Nothing in the app writes the legacy boolean after this. A new leaf is
created with no status at all, because an absent field IS todo.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Delete the legacy field

**Files:** Modify `src/db/types.ts`, `src/lib/status.ts`, plus whatever `tsc` names.

**Interfaces:**
- Produces: `stepStatus` with no fallback. `GoalNode` no longer has `done`.

**Carried forward from the Task 5 review — close these here, deliberately.**

Deleting `done` from the type is what forces each of them open; do not let them close by accident and go unnoticed.

1. **`writeStatus`'s key list.** `applyStatus` unconditionally does `delete out.done`, but `writeStatus` in `store.ts` only deletes `['status','blockedOn','doneAt']`. On a node still carrying `done: true`, un-ticking left `done` behind — and `stepStatus` reads exactly that when `status` is absent, so the step read as done again. Unreachable in the app (migration runs on load and import) and dissolved by this task. Confirm the key list needs no fourth entry once the field is gone, and that no `delete n.done` remains anywhere outside `migrateNodeStatus.ts`.

2. **`migrateNodeStatus.ts` keeps reading `done`, and must.** It takes `Goal[]` but reaches for the legacy field via `Object.prototype.hasOwnProperty`. Once `done` is off the interface this still compiles, because `hasOwnProperty` does not require the key to be declared. Do NOT "fix" it by re-adding the field or by deleting the migration — raw stored JSON and old backups still carry `done`, and stripping it is this module's entire job.

3. **Three tests are vacuous on the completion half** and this task forces them open. Each is titled as asserting that a leaf→container conversion clears completion, but its fixture is legacy-shaped, so `expect(x.status).toBeUndefined()` asserts something never set:
   - `src/lib/tree.test.ts:195` — *"drops done, plannedWeek and plannedDay…"*
   - `src/state/store.test.ts:466` — *"a planned leaf that gains a child loses done/plannedWeek/plannedDay"*
   - `src/state/store.test.ts:2244` — the `addChildren` conversion case

   Convert each fixture to `status: 'done'` so the assertion bites again. The neighbouring `tree.test.ts:169-182` test was already modernised this way — follow it. If converting a fixture makes a test fail, that is the test finally doing its job: report it, do not weaken it.

4. **Rename `goalImport.test.ts:100`**, currently `it('turns a plain string into a leaf with done:false')`, which now asserts `status` is undefined. The name should describe the modern shape.

- [ ] **Step 1: Remove the fallback and the field**

In `src/lib/status.ts`:

```ts
export function stepStatus(n: GoalNode): StepStatus {
  return n.status ?? 'todo';
}
```

In `src/lib/status.ts`'s `applyStatus`, delete the `delete out.done;` line.

In `src/db/types.ts`, delete the deprecated `done?: boolean;` field and its comment.

- [ ] **Step 2: Let the typechecker find every straggler**

```bash
npx tsc -b
```

Expected: either silence, or errors naming files that still reference `GoalNode.done`. Fix each by routing through `stepStatus`/`isDone`. Do NOT re-add the field.

- [ ] **Step 3: Remove the now-dead fallback tests**

In `src/lib/status.test.ts`, delete the two tests `falls back to the legacy done flag` and `prefers the new field when both are somehow present`, and the `drops the legacy done flag as it writes` test in the `applyStatus` block. They assert behaviour that no longer exists.

`migrateNodeStatus` still reads `done` from raw stored JSON — that is correct and stays. It types its input as `Goal[]` but reaches for `done` via `hasOwnProperty`, so it does not need the field on the interface.

- [ ] **Step 4: Run the full suite and typecheck**

```bash
npx tsc -b && npx vitest run --config vitest.config.ts 2>&1 | tail -4
```

Expected: `tsc` silent, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "refactor(status): delete the done flag

One field, one truth. Two fields encoding the same thing drift silently:
a path that set status without also setting done would look finished in
the tree and count as open in the roll-up.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Blocked work leaves the next-step queue

**Files:**
- Modify: `src/lib/tree.ts`
- Test: `src/lib/tree.test.ts`

**Interfaces:**
- Produces: `firstOpenLeaf` may now return `null` even when open leaves exist. Every caller must handle it — Task 10 covers the board card, and `nextOpenAction` in `plan.ts` is covered here.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tree.test.ts`:

```ts
describe('firstOpenLeaf and status', () => {
  const leaf = (id: string, status?: StepStatus): GoalNode => ({ id, title: id, ...(status ? { status } : {}) });

  it('prefers a step already in progress over an earlier untouched one', () => {
    expect(firstOpenLeaf([leaf('a'), leaf('b', 'doing')])?.id).toBe('b');
  });

  it('takes the first doing when several are in progress', () => {
    expect(firstOpenLeaf([leaf('a', 'doing'), leaf('b', 'doing')])?.id).toBe('a');
  });

  it('skips blocked work entirely', () => {
    expect(firstOpenLeaf([leaf('a', 'blocked'), leaf('b')])?.id).toBe('b');
  });

  /**
   * The new case every caller must handle. There IS open work, but none of it
   * can be worked — so "plan the next step" is the wrong offer and the card
   * must say "unblock" instead.
   */
  it('returns null when every open leaf is blocked', () => {
    expect(firstOpenLeaf([leaf('a', 'blocked'), leaf('b', 'done')])).toBeNull();
  });

  it('finds a doing leaf across container boundaries', () => {
    expect(firstOpenLeaf([
      { id: 'p', title: 'P', children: [leaf('c1')] },
      { id: 'q', title: 'Q', children: [leaf('c2', 'doing')] },
    ])?.id).toBe('c2');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run --config vitest.config.ts src/lib/tree.test.ts -t "firstOpenLeaf and status"
```

Expected: FAIL — the first test returns `a`, not `b`.

- [ ] **Step 3: Implement**

Replace `firstOpenLeaf` in `src/lib/tree.ts`:

```ts
/**
 * The next leaf worth working: a step already in progress if there is one,
 * otherwise the first untouched one. Blocked leaves are skipped entirely.
 *
 * Two passes rather than one, because "already started" beats "earlier in the
 * document" — resuming is what a person means by "next step", and a single
 * depth-first pass cannot express a preference that spans the whole tree.
 *
 * Returns null when open work exists but ALL of it is blocked. Callers must
 * treat that as "unblock something", not as "nothing to do".
 */
export function firstOpenLeaf(nodes: GoalNode[]): GoalNode | null {
  return firstLeafMatching(nodes, (n) => stepStatus(n) === 'doing')
    ?? firstLeafMatching(nodes, (n) => stepStatus(n) === 'todo');
}

function firstLeafMatching(
  nodes: GoalNode[],
  match: (n: GoalNode) => boolean,
): GoalNode | null {
  for (const n of nodes) {
    if (n.children && n.children.length) {
      const hit = firstLeafMatching(n.children, match);
      if (hit) return hit;
    } else if (match(n)) {
      return n;
    }
  }
  return null;
}
```

Add `import { stepStatus } from './status';` if Task 2 imported only `isDone`.

- [ ] **Step 4: Run the full suite**

```bash
npx tsc -b && npx vitest run --config vitest.config.ts 2>&1 | tail -4
```

Expected: green. If `plan.ts`'s `nextOpenAction` tests fail, it is because it collects open leaves itself at line 354 rather than calling `firstOpenLeaf` — make it skip blocked the same way:

```ts
walkLeaves(g, (n) => { if (stepStatus(n) === 'todo' || stepStatus(n) === 'doing') open.push(n); });
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/tree.ts src/lib/tree.test.ts src/lib/plan.ts
git commit -m "feat(status): next step means the one you already started

firstOpenLeaf prefers a doing leaf, skips blocked entirely, and returns
null when every open leaf is blocked — a new case, and the one that lets
the board offer 'unblock' instead of pointing at work nobody can do.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: The store actions

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/store.test.ts`

**Interfaces:**
- Produces: `actions.setNodeStatus(nodeId: string, next: StepStatus, blockedOn?: string): boolean` and `actions.setNodesStatus(ids: string[], next: StepStatus): boolean`.

- [ ] **Step 1: Write the failing test**

Add to `src/state/store.test.ts`:

```ts
describe('setNodeStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('marks a leaf in progress without moving the percentage', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([{ id: 'g', title: 'G', column: 0, nodes: [
      { id: 'a', title: 'A' }, { id: 'b', title: 'B' },
    ] }]);
    const before = goalPct(getState().goals[0]);

    expect(actions.setNodeStatus('a', 'doing')).toBe(true);

    expect(findInAll(getState().goals, 'a')?.status).toBe('doing');
    expect(goalPct(getState().goals[0])).toBe(before);
  });

  it('keeps the reason a step is blocked, and drops it on the way out', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([{ id: 'g', title: 'G', column: 0, nodes: [{ id: 'a', title: 'A' }] }]);

    actions.setNodeStatus('a', 'blocked', 'waiting on the grader');
    expect(findInAll(getState().goals, 'a')?.blockedOn).toBe('waiting on the grader');

    actions.setNodeStatus('a', 'doing');
    expect(findInAll(getState().goals, 'a')?.blockedOn).toBeUndefined();
  });

  it('refuses a container and says so', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([{ id: 'g', title: 'G', column: 0, nodes: [
      { id: 'p', title: 'P', children: [{ id: 'c', title: 'C' }] },
    ] }]);

    expect(actions.setNodeStatus('p', 'doing')).toBe(false);
    expect(findInAll(getState().goals, 'p')?.status).toBeUndefined();
  });

  it('refuses a frozen project', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'Step');
    const nid = getState().goals[0].nodes[0].id;
    actions.completeGoal(gid);

    expect(actions.setNodeStatus(nid, 'doing')).toBe(false);
  });
});

describe('setNodesStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // One write, one undo entry. A loop over setNodeStatus would arm an entry per
  // node and each write's sweep would discard the ones before it.
  it('sets a whole selection under a single undo', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([{ id: 'g', title: 'G', column: 0, nodes: [
      { id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' },
    ] }]);

    expect(actions.setNodesStatus(['a', 'b'], 'doing')).toBe(true);
    expect(getState().pendingUndo?.label).toBe('Marked 2 steps in progress');

    actions.undoLastDelete();
    expect(findInAll(getState().goals, 'a')?.status).toBeUndefined();
    expect(findInAll(getState().goals, 'b')?.status).toBeUndefined();
  });

  it('reports a refusal rather than an empty success', async () => {
    const { actions } = await freshStore();
    expect(actions.setNodesStatus([], 'doing')).toBe(false);
    expect(actions.setNodesStatus(['nope'], 'doing')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run --config vitest.config.ts src/state/store.test.ts -t "setNodeStatus"
```

Expected: FAIL — `actions.setNodeStatus is not a function`.

- [ ] **Step 3: Implement**

Add to `actions` in `src/state/store.ts`, next to `toggleLeaf`:

```ts
  /**
   * Set one leaf's status. Containers are refused for the same reason they
   * carry no `done`: a container's state is derived from its children, and
   * storing one would be a second source of truth about the same work.
   */
  setNodeStatus(nodeId: string, next: StepStatus, blockedOn?: string): boolean {
    if (!isActiveNode(nodeId)) return false; // frozen on a completed project
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node || node.children?.length) return false;
    if (stepStatus(node) === next && (next !== 'blocked' || node.blockedOn === blockedOn?.trim())) {
      return false;
    }
    writeStatus(node, next, todayStr(), blockedOn);
    setAndPersist({ goals });
    return true;
  },

  /**
   * Set a whole selection in ONE write, arming ONE undo entry. A loop over
   * `setNodeStatus` would arm an entry per node and each write's sweep would
   * discard the ones before it, leaving an Undo button that restores only the
   * last step.
   */
  setNodesStatus(ids: string[], next: StepStatus): boolean {
    const wanted = new Set(ids.filter((id) => isActiveNode(id)));
    if (wanted.size === 0) return false;
    const goals = cloneGoals(state.goals);
    const today = todayStr();
    let count = 0;
    for (const g of goals) {
      walkLeaves(g, (n) => {
        if (!wanted.has(n.id) || stepStatus(n) === next) return;
        writeStatus(n, next, today);
        count++;
      });
    }
    if (count === 0) return false;
    withUndo(`${STATUS_VERB[next]} ${count} step${count === 1 ? '' : 's'}`, 'goals', goals);
    return true;
  },
```

And near the other module constants:

```ts
const STATUS_LABEL: Record<StepStatus, (n: number) => string> = {
  todo: (n) => `Reset ${n} step${n === 1 ? '' : 's'}`,
  doing: (n) => `Marked ${n} step${n === 1 ? '' : 's'} in progress`,
  blocked: (n) => `Blocked ${n} step${n === 1 ? '' : 's'}`,
  done: (n) => `Completed ${n} step${n === 1 ? '' : 's'}`,
};
```

This is the undo-toast wording only — it is NOT `STATUS_WORD` from `src/lib/status.ts`, which names a single state for a label or a button. Keep them separate; they are different registers.

- [ ] **Step 4: Run and commit**

```bash
npx tsc -b && npx vitest run --config vitest.config.ts 2>&1 | tail -4
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(status): set a step's status, one write at a time

setNodesStatus is one write arming one undo entry, not a loop — each
call would otherwise arm its own and each sweep discard the one before,
leaving Undo restoring only the last step of a selection.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: The tree row

**Files:**
- Modify: `src/components/GoalTree.tsx`, `src/components/ShortcutsOverlay.tsx`
- Test: `src/components/GoalTree.status.test.tsx` (create)

**Interfaces:**
- Consumes: `stepStatus`, `containerStatus`, `cycleStatus`, `actions.setNodeStatus`.

Read the **Deviation from the spec** section above before starting.

- [ ] **Step 1: Write the failing test**

Create `src/components/GoalTree.status.test.tsx`. Copy the `vi.hoisted` db-mock block, the `mountTree` helper and the `row(title)` query helper **verbatim** from `src/components/GoalTree.selection.test.tsx` — they are not redefined below, and hand-rolling a second mock is how these files drift.

Note the `mountTree` signature there takes the node array; if it takes a whole `Goal`, adapt the calls below to match rather than changing the helper.

```tsx
// @vitest-environment jsdom
// ... same imports and dbMocks block as GoalTree.selection.test.tsx ...

describe('a step says where it stands', () => {
  it('shows the status on the box, and a plain click still only toggles done', async () => {
    const { store, user } = await mountTree([{ id: 'a', title: 'A' }]);

    // The box is the status control, but click is unchanged: todo → done.
    await user.click(screen.getByRole('checkbox', { name: /Mark "A" as done/ }));
    expect(findInAll(store.getState().goals, 'a')?.status).toBe('done');
  });

  it('cycles todo → doing → blocked → todo on S, never reaching done', async () => {
    const { store, user } = await mountTree([{ id: 'a', title: 'A' }]);
    row('A').focus();

    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBe('doing');
    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBe('blocked');
    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBeUndefined();
  });

  it('sends a done step back to todo rather than on to doing', async () => {
    const { store, user } = await mountTree([{ id: 'a', title: 'A', status: 'done' }]);
    row('A').focus();
    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBeUndefined();
  });

  it('names the status in the checkbox label so it is not colour-only', async () => {
    await mountTree([{ id: 'a', title: 'A', status: 'blocked', blockedOn: 'the grader' }]);
    expect(screen.getByRole('checkbox', { name: /blocked/i })).toBeTruthy();
  });

  it('shows why a step is blocked', async () => {
    await mountTree([{ id: 'a', title: 'A', status: 'blocked', blockedOn: 'the grader' }]);
    expect(screen.getByText(/the grader/)).toBeTruthy();
  });

  it('leaves S alone while a rename editor is open', async () => {
    const { store, user } = await mountTree([{ id: 'a', title: 'A' }]);
    await user.dblClick(screen.getByText('A'));
    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run --config vitest.config.ts src/components/GoalTree.status.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Turn `LeafCheckbox` into the status control**

Replace the `LeafCheckbox` component in `src/components/GoalTree.tsx`:

```tsx
// STATUS_WORD is imported from src/lib/status.ts — do NOT redeclare it here.
// The tree label, the panel radio group and the board chip must name a state
// the same way.
const STATUS_BOX: Record<StepStatus, string> = {
  todo: 'border-check group-hover/cb:border-muted',
  doing: 'border-accent',
  blocked: 'border-warn bg-warn-tint',
  done: 'bg-accent border-accent',
};

function LeafStatusBox({
  status,
  onToggle,
  label,
}: {
  status: StepStatus;
  onToggle: () => void;
  label: string;
}) {
  return (
    // The 17px box sits inside a 24×24 button: WCAG 2.2 AA wants a 24px target,
    // but a 24px box would overpower the row. `border-check` clears 1.4.11's 3:1.
    <button
      type="button"
      role="checkbox"
      aria-checked={status === 'done'}
      aria-label={`${label} — ${STATUS_WORD[status]}`}
      tabIndex={-1}
      className="w-[24px] h-[24px] -m-[3px] flex-shrink-0 grid place-items-center group/cb"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      <span
        className={`w-[17px] h-[17px] border-[1.5px] rounded-[6px] grid place-items-center transition-all duration-100 ${STATUS_BOX[status]}`}
      >
        {status === 'done' && (
          <svg viewBox="0 0 12 12" className="w-[11px] h-[11px] stroke-accent-contrast fill-none" strokeWidth={2.4}>
            <path d="M2 6.2 4.6 9 10 3" />
          </svg>
        )}
        {status === 'doing' && (
          <span className="w-[7px] h-[7px] rounded-full bg-accent" aria-hidden="true" />
        )}
        {status === 'blocked' && (
          <svg viewBox="0 0 12 12" className="w-[11px] h-[11px] stroke-warn fill-none" strokeWidth={2}>
            <path d="M2.5 9.5 9.5 2.5" />
          </svg>
        )}
      </span>
    </button>
  );
}
```

The status is named in the accessible label, never conveyed by colour alone.

- [ ] **Step 4: Render it, and show the blocked reason**

At the render site (was `GoalTree.tsx:651-658`):

```tsx
        {!hasKids && (
          <LeafStatusBox
            status={stepStatus(n)}
            onToggle={() => actions.toggleLeaf(n.id)}
            label={`Mark "${n.title}" as done`}
          />
        )}
```

After the title span, add:

```tsx
        {!hasKids && stepStatus(n) === 'blocked' && n.blockedOn && (
          <span className="text-meta text-muted truncate max-w-[180px] flex-shrink" title={n.blockedOn}>
            {n.blockedOn}
          </span>
        )}
```

- [ ] **Step 5: Add the `S` binding**

In the row's `onKeyDown`, alongside the existing bare-key handlers (and inside the same `e.target === e.currentTarget` guard that protects them from firing during an inline edit):

```tsx
        if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          if (hasKids) return; // a container's status is derived, never set
          actions.setNodeStatus(n.id, cycleStatus(stepStatus(n)));
          return;
        }
```

Bare letters already bound elsewhere are `?`, `n`, `p`, `t`, `T` and digits `0`–`3`; `s` is free. Digits are NOT available — `1`/`2`/`3` are the view switches.

- [ ] **Step 6: Add the hover control**

In the existing hover-control cluster, before the delete `✕`:

```tsx
            <button
              type="button"
              tabIndex={-1}
              className="quiet-control"
              aria-label={`Change status of "${n.title}"`}
              onClick={(e) => {
                e.stopPropagation();
                actions.setNodeStatus(n.id, cycleStatus(stepStatus(n)));
              }}
            >
              ◐
            </button>
```

`.quiet-control` carries the `@media (hover: hover)` gate and the 24px floor, and needs a literal `group` ancestor — confirm the row has one, not `group//name`.

- [ ] **Step 7: Show a container's derived status**

Where the container's `%` is rendered, prefix a muted word when the derived status is `doing` or `blocked`:

```tsx
          {hasKids && containerStatus(n) === 'blocked' && (
            <span className="text-meta text-warn flex-shrink-0">blocked</span>
          )}
```

- [ ] **Step 8: Document the key**

Add a row to `src/components/ShortcutsOverlay.tsx` in the tree section: `S` — "Cycle a step: to do → in progress → blocked".

- [ ] **Step 9: Run everything and commit**

```bash
npx tsc -b && npx vitest run --config vitest.config.ts 2>&1 | tail -4
git add -A src/components
git commit -m "feat(status): the box says which of four states a step is in

One control, four states — not a checkbox plus a chip, which would show a
blocked step with an untouched box and read as 'not started'. Plain click
and Space still toggle done, so ticking the checkbox remains the only
thing that moves a number. S cycles the other three.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: The panel, the bulk bar, and the board

**Files:**
- Modify: `src/views/project/StepPanel.tsx`, `src/components/GoalTree.tsx` (selection bar), `src/lib/plan.ts`, `src/views/goals/BoardCard.tsx`, `src/views/goals/FocusSummary.tsx`
- Test: `src/views/project/StepPanel.test.tsx`, `src/components/GoalTree.selection.test.tsx`, `src/lib/plan.test.ts`

**Interfaces:**
- Consumes: `actions.setNodeStatus`, `actions.setNodesStatus`, `containerStatus`.
- Produces: `CardActionKind` gains `'unblock'`; `FocusSummary` gains `blocked: { count: number; goalIds: string[] }`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/plan.test.ts`:

```ts
describe('a project whose only open work is blocked', () => {
  const blocked = (): Goal => ({ id: 'g', title: 'G', column: 0, nodes: [
    { id: 'a', title: 'A', status: 'blocked', blockedOn: 'the grader' },
    { id: 'b', title: 'B', status: 'done' },
  ] });

  it('offers unblock, not plan', () => {
    expect(cardPrimaryAction(blocked(), TODAY)).toBe('unblock');
  });

  it('still offers plan when something is workable', () => {
    const g = blocked();
    g.nodes.push({ id: 'c', title: 'C' });
    expect(cardPrimaryAction(g, TODAY)).toBe('plan');
  });

  it('counts as a blocked project in the focus summary', () => {
    expect(focusSummary([blocked()], TODAY).blocked).toEqual({ count: 1, goalIds: ['g'] });
  });
});
```

In `src/lib/backlog.test.ts`:

```ts
describe('blocked work in the rail', () => {
  it('drops an uncommitted blocked step', () => {
    const groups = backlogGroups([{ id: 'g', title: 'G', column: 0, nodes: [
      { id: 'a', title: 'A', status: 'blocked' }, { id: 'b', title: 'B' },
    ] }], [], WEEK, TODAY);
    expect(groups[0].items.map((i) => i.id)).toEqual(['b']);
  });

  /**
   * Commitment is the exception, exactly as it is for a parked project:
   * weekCapacity bills a plannedWeek step to "to place", and a number you plan
   * against must have a row beside it.
   */
  it('keeps a blocked step that is committed to this week', () => {
    const groups = backlogGroups([{ id: 'g', title: 'G', column: 0, nodes: [
      { id: 'a', title: 'A', status: 'blocked', plannedWeek: WEEK },
    ] }], [], WEEK, TODAY);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npx vitest run --config vitest.config.ts src/lib/plan.test.ts src/lib/backlog.test.ts
```

- [ ] **Step 3: Implement `cardPrimaryAction` and `focusSummary`**

In `src/lib/plan.ts`, add a helper and extend the union:

```ts
/** Open work exists, but none of it can be worked. */
export function isFullyBlocked(g: Goal): boolean {
  let open = 0;
  let blocked = 0;
  walkLeaves(g, (n) => {
    const s = stepStatus(n);
    if (s === 'done') return;
    open++;
    if (s === 'blocked') blocked++;
  });
  return open > 0 && open === blocked;
}
```

In `cardPrimaryAction`, before the final `default`:

```ts
export function cardPrimaryAction(g: Goal, today: string): CardActionKind {
  switch (projectAttention(g, today)) {
    case 'needs-breakdown': return 'define';
    case 'ready-to-complete': return 'complete';
    case 'completed': return 'none';
    default:
      if (!isPlanningHorizon(g.column)) return 'none';
      // Withheld for a stated reason, exactly as a parked project withholds it.
      return isFullyBlocked(g) ? 'unblock' : 'plan';
  }
}
```

Add `'unblock'` to `CardActionKind`, and in `focusSummary` add the fifth signal alongside the four, exposing its `goalIds` so the board's spotlight filter stays a set-membership check:

```ts
  const blocked = active.filter(isFullyBlocked).map((g) => g.id);
  // ... in the returned object:
  blocked: { count: blocked.length, goalIds: blocked },
```

- [ ] **Step 4: Implement the rail rule**

In `src/lib/backlog.ts`, inside the `walkLeaves` at line ~143:

```ts
      if (isDone(n)) return;
      // Blocked work is not a queue you can work. Dropped, unless committed —
      // weekCapacity bills a plannedWeek step to "to place", and a number you
      // plan against must have a row beside it. Same rule as a parked project.
      if (stepStatus(n) === 'blocked' && n.plannedWeek === undefined) return;
```

- [ ] **Step 5: Add the panel control**

In `src/views/project/StepPanel.tsx`, at the top of the panel body for a leaf, render four buttons (`To do`, `In progress`, `Blocked`, `Done`) as a radio group calling `actions.setNodeStatus`, and — only while blocked — a text input bound to `blockedOn` that commits on blur:

```tsx
      <div role="radiogroup" aria-label="Status" className="flex gap-[4px]">
        {(['todo', 'doing', 'blocked', 'done'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={stepStatus(node) === s}
            onClick={() => actions.setNodeStatus(node.id, s)}
            className={`text-compact px-[9px] py-[5px] rounded-field border ${
              stepStatus(node) === s ? 'border-accent text-accent-deep bg-accent-tint' : 'border-line-2 text-ink-soft hover:bg-hover'
            }`}
          >
            {STATUS_WORD[s]}
          </button>
        ))}
      </div>
```

For a container, render the derived `containerStatus(node)` as read-only text — a container has no stored status.

- [ ] **Step 6: Add the bulk control**

In the selection bar in `GoalTree.tsx`, beside Complete and Delete, add a `Set status` control calling `actions.setNodesStatus(selectedIds, next)`. It returns a boolean; do not show a success toast when it returns false.

- [ ] **Step 7: Add the board card chip and action**

In `src/lib/board.ts`, add the count the chip needs:

```ts
/** Open leaves nobody can work. Zero for a project with nothing stuck. */
export function blockedLeafCount(nodes: GoalNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.children && node.children.length) n += blockedLeafCount(node.children);
    else if (stepStatus(node) === 'blocked') n++;
  }
  return n;
}
```

In `src/views/goals/BoardCard.tsx`, beside the existing chips:

```tsx
        {blocked > 0 && (
          <span className="text-meta text-warn whitespace-nowrap">{blocked} blocked</span>
        )}
```

with `const blocked = blockedLeafCount(goal.nodes);` alongside the other derived values.

Then wire the new action kind into the card's primary-action switch, next to `'plan'`:

```tsx
      case 'unblock':
        return { label: 'Unblock', onClick: () => onOpen(goal.id) };
```

Match the shape of the neighbouring cases exactly — if they return a different tuple or call a differently-named prop, follow that, and use the prop that opens the project (`onOpen` / `onDefine`) rather than inventing one.

In `src/views/goals/FocusSummary.tsx`, add the fifth button using the same markup as the four beside it, reading `summary.blocked`, and add `'blocked'` to the `FocusFilter` union and to the `src` map in `Goals.tsx:158-166` so the spotlight filter keeps working as a set-membership check.

- [ ] **Step 8: Assert that capacity did NOT change**

The spec says `weekCapacity` is untouched: blocked-but-scheduled work is still booked time, because it is on your calendar whether or not it is stuck. Nothing above changes it — so pin that, or a later refactor will "tidy" it away.

Add to `src/lib/capacity.test.ts`:

```ts
it('still bills a blocked step that is on the grid', () => {
  // Blocked work leaves the QUEUE, not the calendar. Quietly reclaiming its
  // time would make the capacity header disagree with the grid beside it.
  const blocked = weekCapacity([{ id: 'g', title: 'G', column: 0, nodes: [
    { id: 'a', title: 'A', status: 'blocked', estimateMin: 60,
      plannedWeek: WEEK, plannedDay: WEEK, plannedStartMin: 540 },
  ] }], [], WEEK, TODAY, AVAILABILITY);
  const open = weekCapacity([{ id: 'g', title: 'G', column: 0, nodes: [
    { id: 'a', title: 'A', estimateMin: 60,
      plannedWeek: WEEK, plannedDay: WEEK, plannedStartMin: 540 },
  ] }], [], WEEK, TODAY, AVAILABILITY);

  expect(blocked.plannedMin).toBe(open.plannedMin);
});
```

Match `weekCapacity`'s real signature and the file's existing fixture constants rather than the placeholder argument list above.

- [ ] **Step 9: Run everything and commit**

```bash
npx tsc -b && npx vitest run --config vitest.config.ts 2>&1 | tail -4
git add -A src
git commit -m "feat(status): blocked work leaves the queue and says so

A project whose only open work is blocked offers 'Unblock', not 'Plan
next step' — the rail drops the row under the same commitment rule a
parked project already uses, so a project cannot be quiet on the board
and loud in the rail.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Update the project's own documentation

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Update the invariants**

The `GoalNode` bullet and the `pct.ts` bullet both describe `done`. Rewrite them to describe `status`, keeping the existing sentence *"ticking the checkbox remains the only thing that moves a number"* — it is still literally true.

Add one bullet:

> - **A step's `status` never moves the roll-up; it moves attention.** `pct.ts` counts `'done'` and nothing else, so `doing` and `blocked` weigh exactly what an unticked box always did. What `blocked` changes is the queue: `firstOpenLeaf` skips it and may return null, `cardPrimaryAction` answers `'unblock'`, and `backlogGroups` drops the row unless it carries a `plannedWeek` — the same commitment exception a parked project gets, for the same reason.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: status is the fourth thing a step can be

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Done when

- [ ] `npx tsc -b` is silent.
- [ ] `npx vitest run --config vitest.config.ts` is fully green, with a HIGHER test count than the 1703 baseline.
- [ ] `grep -rn "GoalNode" src/db/types.ts` shows no `done` field.
- [ ] The golden `pct` identity test from Task 3 passes.
- [ ] Loading an existing database shows every previously-ticked step still ticked, and the project percentages unchanged.
