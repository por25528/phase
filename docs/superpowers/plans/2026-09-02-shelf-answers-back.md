# The Shelf Answers Back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loose tasks reach the Cmd+Space shelf's alternatives, and the shelf (plus Today's Now row) can insert a "do this first" step in front of the recommended work.

**Architecture:** Part 1 is pure-lib: `proposalRows` grows a `max` param so the advisor can request a deeper pool, and `executionAdvisor` gains a loose-task last-slot swap mirroring the existing life-diversity swap. Part 2 adds a tree helper (`insertSiblingBefore`), one store action (`insertWorkBefore`, undoable), a new relay verb (`insert-before`), a `pinned` ref in the advisor (the created work must lead immediately; data ordering alone cannot make a fresh uncommitted step outrank a scheduled commitment), and small UI in `AssistantSurface` and `Today.tsx`.

**Tech Stack:** React 19 + TypeScript, Vitest, Electron. All work in `PhaseApp/`.

**Spec:** `docs/superpowers/specs/2026-09-02-shelf-answers-back-design.md`

## Global Constraints

- Run all commands from `PhaseApp/`. Before every commit: `npm test` and `npx tsc -b` must pass.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`. Views never call `db` directly; all mutations go through `actions`.
- No literal hex colours, no hand-rolled uppercase, no new `border-dashed` (`designScale.test.ts` fails the build).
- Undo label for the new write is exactly `Added "<title>" first`.
- The new relay verb is exactly `insert-before`. `electron/assistantIpc.cjs` imports nothing from `src/` — its validator is a hand-kept twin of the union in `src/lib/assistantProtocol.ts`, and `electron/assistantIpc.test.ts` walks the union, so the verb must land in all three places.
- New work created by "Do first" is title-only: no estimate, no date, no `plannedWeek`.
- Stage files explicitly for every commit (`git add <paths>`, never `git add -A`).

---

### Task 1: `insertSiblingBefore` tree helper

**Files:**
- Modify: `src/lib/tree.ts` (beside `insertSiblingAfter`, which is at ~line 147)
- Test: `src/lib/tree.test.ts`

**Interfaces:**
- Produces: `insertSiblingBefore(goals: Goal[], nodeId: string, title: string): { goals: Goal[]; newId: string } | null` — clone-and-splice, same contract as `insertSiblingAfter` but the new node lands at the anchor's own index (so it precedes it). `null` when `nodeId` is not found.

- [ ] **Step 1: Write the failing test** — add to `src/lib/tree.test.ts`, mirroring the existing `insertSiblingAfter` tests in that file (reuse whatever goal-building helpers they use):

```ts
describe('insertSiblingBefore', () => {
  it('inserts the new node immediately before the anchor, in a clone', () => {
    const goals: Goal[] = [{
      id: 'g1', title: 'G', column: 0,
      nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    } as Goal];
    const result = insertSiblingBefore(goals, 'b', 'Review');
    expect(result).not.toBeNull();
    const ids = result!.goals[0].nodes.map((n) => n.id);
    expect(ids).toEqual(['a', result!.newId, 'b']);
    expect(result!.goals[0].nodes.find((n) => n.id === result!.newId)!.title).toBe('Review');
    // the caller's array is untouched
    expect(goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('returns null for an unknown anchor', () => {
    expect(insertSiblingBefore([], 'missing', 'X')).toBeNull();
  });
});
```

Adjust the `Goal` literal to match the shape the file's existing tests build (if they use a builder like `goal(...)`, use it).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tree.test.ts --config vitest.config.ts`
Expected: FAIL — `insertSiblingBefore` is not exported.

- [ ] **Step 3: Implement** — in `src/lib/tree.ts`, directly above `insertSiblingAfter`:

```ts
/**
 * Insert a new leaf immediately BEFORE `nodeId` among its siblings.
 * The "do this first" write: the new step takes the anchor's place in the
 * queue, which is what makes the correction durable rather than ephemeral.
 */
export function insertSiblingBefore(
  goals: Goal[],
  nodeId: string,
  title: string,
): { goals: Goal[]; newId: string } | null {
  const next = cloneGoals(goals);
  const found = findParentList(next, nodeId);
  if (!found) return null;
  const newId = uid();
  found.list.splice(found.index, 0, { id: newId, title });
  return { goals: next, newId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tree.test.ts --config vitest.config.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tree.ts src/lib/tree.test.ts
git commit -m "feat(app): insertSiblingBefore — the queue can take a step in front"
```

---

### Task 2: `max` param through `proposalRows` and `todayPlan`

**Files:**
- Modify: `src/lib/todayPlan.ts`
- Test: `src/lib/todayPlan.test.ts`

**Interfaces:**
- Produces: `proposalRows(goals, tasks, week, today, exclude?, max = PROPOSAL_MAX)` — sixth optional param caps the returned rows; existing callers see no change. `TodayPlanInput` gains `max?: number`, threaded to `proposalRows`. Task 3 consumes this from the advisor.

- [ ] **Step 1: Write the failing test** — add to `src/lib/todayPlan.test.ts`, reusing that file's existing goal/task builders:

```ts
it('proposalRows honours a caller-supplied max', () => {
  // Build 7 candidates: e.g. 7 loose tasks (each loose task is its own
  // candidate), or a mix — reuse this file's builders.
  const tasks = Array.from({ length: 7 }, (_, i) =>
    ({ id: `t${i}`, title: `T${i}`, done: false, goalId: null } as Task));
  expect(proposalRows([], tasks, week, today).length).toBe(PROPOSAL_MAX);
  expect(proposalRows([], tasks, week, today, new Set(), 7).length).toBe(7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/todayPlan.test.ts --config vitest.config.ts`
Expected: FAIL — `Expected 7, received 5` (the sixth argument is ignored).

- [ ] **Step 3: Implement** — in `src/lib/todayPlan.ts`:

Change the `proposalRows` signature and the slice:

```ts
export function proposalRows(
  goals: Goal[],
  tasks: Task[],
  week: string,
  today: string,
  exclude: ReadonlySet<string> = new Set(),
  /**
   * How many rows the caller can use. Today's page keeps `PROPOSAL_MAX` —
   * five is where a list stops being a decision — but the advisor asks for
   * more, because its pool is cut twice again (the lenses, then
   * `MAX_ALTERNATIVES`) and a pool pre-cut to five starves the undated tail,
   * which is exactly where every loose task lives.
   */
  max: number = PROPOSAL_MAX,
): ProposalRow[] {
```

and at the bottom of the function replace `.slice(0, PROPOSAL_MAX)` with `.slice(0, max)`.

Add `max?: number` to `TodayPlanInput` (with a doc comment pointing at `proposalRows`), and in `todayPlan` pass it through:

```ts
const rows = proposalRows(goals, tasks, week, today, exclude, input.max);
```

(`proposalRows`'s default fires when `input.max` is `undefined`, so give the parameter a default of `undefined` handling via the existing default — i.e. declare `max` in the destructure and call `proposalRows(goals, tasks, week, today, exclude, max ?? PROPOSAL_MAX)`.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/todayPlan.test.ts --config vitest.config.ts`
Expected: PASS (new test and all existing ones — existing callers are unaffected by the defaulted param).

- [ ] **Step 5: Commit**

```bash
git add src/lib/todayPlan.ts src/lib/todayPlan.test.ts
git commit -m "feat(app): proposalRows takes a max, so the advisor can ask for a deeper pool"
```

---

### Task 3: Advisor pool ceiling + loose-task last-slot swap

**Files:**
- Modify: `src/lib/executionAdvisor.ts`
- Test: `src/lib/executionAdvisor.test.ts`

**Interfaces:**
- Consumes: `todayPlan`'s `max` (Task 2).
- Produces: exported `ADVISOR_POOL_MAX = 12`; the last alternative slot swaps in a loose task when none is visible. Behaviour only — no signature changes.

- [ ] **Step 1: Write the failing tests** — add to `src/lib/executionAdvisor.test.ts`, reusing its existing input builders. Scenarios (build each with an unbooked day so the free-time offer fires):

```ts
describe('loose tasks reach the alternatives', () => {
  it('swaps a loose task into the last alternative slot when none is visible', () => {
    // 5+ project goals, each with one open leaf carrying a near deadline,
    // plus one undated loose task. Without the swap the loose task is cut
    // by sortByDue + the caps.
    const advice = executionAdvice(input);
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    const shown = [advice.primary, ...advice.alternatives];
    expect(shown.some((w) => w.ref.kind === 'task' && w.ref.goalId === null)).toBe(true);
    // it took the LAST slot; primary and earlier alternatives never move
    expect(advice.alternatives.at(-1)!.ref.goalId).toBeNull();
  });

  it('does not fire when a loose task is already visible', () => {
    // 1 project goal + 1 loose task → the loose task is already an
    // alternative on its own; assert the alternatives are the advisor's
    // natural order, unswapped.
  });

  it('wins over the life-diversity swap', () => {
    // Overflow containing BOTH a loose task and a candidate from an
    // uncovered life; the last slot gets the loose task.
  });

  it('respects the lenses: a loose task filtered out stays out', () => {
    // timeLevel 'low' + a loose task whose expected time the lens refuses →
    // no loose task appears.
  });
});
```

Write real bodies for all four using the file's builders; the comments above are the scenario spec, not the finished test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/executionAdvisor.test.ts --config vitest.config.ts`
Expected: the first and third FAIL; the second and fourth may already pass (they pin current behaviour — keep them).

- [ ] **Step 3: Implement** — in `src/lib/executionAdvisor.ts`:

Below `MAX_ALTERNATIVES` add:

```ts
/**
 * How deep the advisor's free-time pool goes. `PROPOSAL_MAX` (5) is Today's
 * cap and is right there — five rows on a page. The advisor cuts its pool
 * twice more (the two lenses, then `MAX_ALTERNATIVES`), and a pool pre-cut
 * to five starves the undated tail, where every loose task sorts. Twelve is
 * headroom, not a display count: nothing renders more rows than before.
 */
export const ADVISOR_POOL_MAX = 12;
```

In `orderedCandidates`, pass it to `todayPlan`:

```ts
const plan = todayPlan({
  goals, tasks, blocks, placedOn, allDayBlocks, today, week, now,
  exclude: seen,
  max: ADVISOR_POOL_MAX,
});
```

In `executionAdvice`, replace the life-diversity block (the `if (rest.length > MAX_ALTERNATIVES)` block) with:

```ts
if (rest.length > MAX_ALTERNATIVES) {
  const last = MAX_ALTERNATIVES - 1;
  const overflow = rest.slice(MAX_ALTERNATIVES);
  /*
   * The LAST alternative slot may be swapped, and two rules compete for it.
   * The loose-task rule wins: a whole bucket absent beats a life
   * under-represented — and a loose task carries no lifeId, so the two
   * rules cannot both be satisfied by one row anyway. Like the life swap:
   * the primary and the earlier alternatives never move, and no claim is
   * made in copy.
   */
  const isLoose = (w: RecommendedWork): boolean =>
    w.ref.kind === 'task' && w.ref.goalId === null;
  const looseVisible = [primary, ...alternatives].some(isLoose);
  const loose = looseVisible ? undefined : overflow.find(isLoose);
  if (loose && alternatives[last]) {
    alternatives[last] = loose;
  } else {
    /*
     * The life-diversity swap, unchanged: the first later candidate from a
     * life the primary and the earlier alternatives do not already cover.
     */
    const covered = new Set([primary.lifeId, ...alternatives.slice(0, last).map((a) => a.lifeId)]);
    const other = overflow.find(
      (c) => c.lifeId !== undefined && !covered.has(c.lifeId),
    );
    if (other && alternatives[last] && covered.has(alternatives[last].lifeId)) {
      alternatives[last] = other;
    }
  }
}
```

- [ ] **Step 4: Run the advisor tests, then the whole suite**

Run: `npx vitest run src/lib/executionAdvisor.test.ts --config vitest.config.ts` → PASS.
Run: `npm test` → PASS (the deeper pool must not break Today's tests; `todayPlan` callers other than the advisor are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/executionAdvisor.ts src/lib/executionAdvisor.test.ts
git commit -m "feat(app): the shelf's last slot learns to hold a loose task"
```

---

### Task 4: `sameWorkRef` + `pinned` in the advisor

**Files:**
- Modify: `src/lib/expectedTime.ts` (add `sameWorkRef` beside `WorkRef`)
- Modify: `src/lib/pickWork.ts` (re-export; delete its local `sameRef` body)
- Modify: `src/lib/executionAdvisor.ts`
- Test: `src/lib/executionAdvisor.test.ts`

**Interfaces:**
- Produces: `sameWorkRef(a: WorkRef, b: WorkRef): boolean` in `expectedTime.ts`; `pickWork.ts` keeps exporting `sameRef` (as a re-export) so `AssistantHost` and other callers do not move. `ExecutionAdviceInput` gains `pinned?: WorkRef`: when the pinned ref is found in the advisor's queue it becomes `primary`, is exempt from both lenses, suppresses `beyondWindow`/`beyondFocus`, and the admitted rest fills `alternatives`. A pinned ref NOT in the queue (completed, deleted, out of horizon) is silently ignored.

- [ ] **Step 1: Write the failing tests** — add to `src/lib/executionAdvisor.test.ts`:

```ts
describe('pinned', () => {
  it('a pinned ref found in the queue leads, whatever the ordering said', () => {
    // Build a scheduled commitment plus a free-time step; pin the step.
    const advice = executionAdvice({ ...input, pinned: { kind: 'step', id: 'review', goalId: 'g1' } });
    if (advice.kind !== 'work') throw new Error('expected work');
    expect(advice.primary.ref.id).toBe('review');
    // the old primary is now among the alternatives, not duplicated
    const keys = advice.alternatives.map((a) => a.ref.id);
    expect(keys).not.toContain('review');
  });

  it('a pinned ref survives a lens that would filter it, and suppresses beyond flags', () => {
    const advice = executionAdvice({ ...input, timeLevel: 'low', pinned: pinnedRef });
    if (advice.kind !== 'work') throw new Error('expected work');
    expect(advice.primary.ref.id).toBe(pinnedRef.id);
    expect(advice.beyondWindow).toBeUndefined();
    expect(advice.beyondFocus).toBeUndefined();
  });

  it('a pinned ref absent from the queue is ignored', () => {
    const advice = executionAdvice({ ...input, pinned: { kind: 'step', id: 'gone', goalId: 'g1' } });
    // identical to the unpinned answer
    expect(advice).toEqual(executionAdvice(input));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/executionAdvisor.test.ts --config vitest.config.ts`
Expected: FAIL — `pinned` is not a known input and TypeScript refuses it.

- [ ] **Step 3: Implement**

In `src/lib/expectedTime.ts`, beside the `WorkRef` type:

```ts
/** Same work, whatever else the two rows disagree about. */
export function sameWorkRef(a: WorkRef, b: WorkRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}
```

In `src/lib/pickWork.ts`, delete the local `sameRef` function and replace with:

```ts
export { sameWorkRef as sameRef } from './expectedTime';
```

(keep the doc comment, moved onto the re-export line; `promoteWork` and `switchCandidates` import nothing new — they already call `sameRef` in-module, so change their call sites to use the imported name: `import { sameWorkRef } from './expectedTime';` and call `sameWorkRef` internally.)

In `src/lib/executionAdvisor.ts`:

Add to `ExecutionAdviceInput`:

```ts
/**
 * Work the user explicitly put at the head — the "do this first" insert.
 * When found in the queue it LEADS, exempt from both lenses (an explicit
 * "this first" is the strongest fact a queue can carry, stronger than the
 * scheduled-now facts the lenses already never filter), and the beyond
 * flags are suppressed: they describe an emptied queue, and this primary
 * was chosen, not defaulted to. A ref not in the queue (completed since,
 * deleted, out of horizon) is silently ignored — same fallback rule as
 * `promoteWork`.
 */
pinned?: WorkRef;
```

Import `sameWorkRef` from `./expectedTime`. In `executionAdvice`, replace the block from `const beyondWindow = ...` through `const [primary, ...rest] = visible;` with:

```ts
const pinnedWork = input.pinned === undefined
  ? undefined
  : queue.find((w) => sameWorkRef(w.ref, input.pinned!));

// Attribute the emptiness to the dial that caused it — unless the user
// pinned the head themselves, in which case nothing was defaulted to.
const beyondWindow = pinnedWork === undefined && inWindow.length === 0;
const beyondFocus = pinnedWork === undefined && !beyondWindow && admitted.length === 0;
const visible = admitted.length === 0 ? queue.slice(0, 1) : admitted;

let primary: RecommendedWork;
let rest: RecommendedWork[];
if (pinnedWork !== undefined) {
  primary = pinnedWork;
  rest = admitted.filter((w) => !sameWorkRef(w.ref, pinnedWork.ref));
} else {
  [primary, ...rest] = visible;
}
```

(`const alternatives = rest.slice(0, MAX_ALTERNATIVES);` and the Task 3 swap block continue unchanged below.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/executionAdvisor.test.ts src/lib/pickWork.test.ts --config vitest.config.ts` → PASS.
Run: `npx tsc -b` → clean (catches any `sameRef` import drift).

- [ ] **Step 5: Commit**

```bash
git add src/lib/expectedTime.ts src/lib/pickWork.ts src/lib/executionAdvisor.ts src/lib/executionAdvisor.test.ts
git commit -m "feat(app): the advisor takes a pinned ref — chosen work leads, lenses stand aside"
```

---

### Task 5: Store action `insertWorkBefore`

**Files:**
- Modify: `src/state/store.ts` (beside `insertSiblingAfter`, ~line 1660)
- Test: Create `src/state/store.insertWorkBefore.test.ts`

**Interfaces:**
- Consumes: `insertSiblingBefore` (Task 1), `sameWorkRef` not needed here.
- Produces: `actions.insertWorkBefore(ref: WorkRef, title: string): WorkRef | null` — for a step ref, inserts a sibling before it (one `withUndo('goals')` write); for a task ref, splices a new task (with the ANCHOR's `goalId` — `null` stays loose) before it in the tasks array (one `withUndo('tasks')` write). Undo label: `Added "<title>" first`. Returns the new ref, or `null` on refusal (blank title, anchor gone). Never reports success on a refusal.

- [ ] **Step 1: Write the failing test** — create `src/state/store.insertWorkBefore.test.ts`. Copy the entire `vi.hoisted` mock block, `vi.mock` calls and store-init helper from `src/state/store.finishWork.test.ts` verbatim (it is the canonical harness — every db mock feeding `initStore` must be present or hydration hangs). Then:

```ts
describe('insertWorkBefore', () => {
  it('step anchor: inserts before the sibling, arms an undo that restores goals', async () => {
    // seed one goal: nodes [{id:'a'},{id:'b'}] via the harness's load mocks
    const ref = getState().actions.insertWorkBefore({ kind: 'step', id: 'b', goalId: 'g1' }, 'Review ch 3');
    expect(ref).not.toBeNull();
    const ids = getState().goals[0].nodes.map((n) => n.id);
    expect(ids).toEqual(['a', ref!.id, 'b']);
    expect(getState().pendingUndo?.label).toBe('Added "Review ch 3" first');
    getState().actions.undoLast();          // use the harness's undo call
    expect(getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('task anchor: splices a new task before it, carrying the anchor goalId', async () => {
    // seed tasks [{id:'t1', goalId:null}]
    const ref = getState().actions.insertWorkBefore({ kind: 'task', id: 't1', goalId: null }, 'Buy tape');
    expect(ref).toEqual({ kind: 'task', id: expect.any(String), goalId: null });
    expect(getState().tasks.map((t) => t.id)).toEqual([ref!.id, 't1']);
    expect(getState().tasks[0]).not.toHaveProperty('date');
    expect(getState().tasks[0]).not.toHaveProperty('estimateMin');
  });

  it('refuses a gone anchor and a blank title', async () => {
    expect(getState().actions.insertWorkBefore({ kind: 'step', id: 'nope', goalId: 'g1' }, 'X')).toBeNull();
    expect(getState().actions.insertWorkBefore({ kind: 'task', id: 't1', goalId: null }, '   ')).toBeNull();
    expect(getState().pendingUndo).toBeFalsy();
  });
});
```

Mirror the exact seeding/undo idioms the harness file uses (`loadState` mock return, hydration await, how it invokes undo — follow `store.finishWork.test.ts`'s own assertions for `pendingUndo`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/store.insertWorkBefore.test.ts --config vitest.config.ts`
Expected: FAIL — `insertWorkBefore` is not a function.

- [ ] **Step 3: Implement** — in `src/state/store.ts`, import `insertSiblingBefore as treeInsertSiblingBefore` from `../lib/tree` (beside the existing `insertSiblingAfter as treeInsertSiblingAfter` import) and `WorkRef` type from `../lib/expectedTime` if not already imported. Add the action beside `insertSiblingAfter`:

```ts
/**
 * "Do this first" — the shelf's and Today's correction verb. A DISTANCE
 * write: the tree is not visible from either caller, so both paths arm an
 * undo. One write each; returns the new ref, or null on refusal — callers
 * must not report success on a refusal.
 *
 * A step lands BEFORE its anchor among the siblings, which is what makes
 * the correction durable — the project's queue genuinely leads with it. A
 * task anchor gets a new task spliced before it, carrying the anchor's
 * goalId (null stays loose): tasks have no tree, so array order is the only
 * "before" there is.
 */
insertWorkBefore(ref: WorkRef, title: string): WorkRef | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (ref.kind === 'step') {
    const result = treeInsertSiblingBefore(state.goals, ref.id, trimmed);
    if (!result) return null;
    withUndo(`Added "${trimmed}" first`, 'goals', result.goals);
    return { kind: 'step', id: result.newId, goalId: ref.goalId };
  }
  const index = state.tasks.findIndex((t) => t.id === ref.id);
  if (index === -1) return null;
  const task: Task = { id: uid(), title: trimmed, done: false, goalId: ref.goalId };
  const tasks = [...state.tasks];
  tasks.splice(index, 0, task);
  withUndo(`Added "${trimmed}" first`, 'tasks', tasks);
  return { kind: 'task', id: task.id, goalId: ref.goalId };
},
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/state/store.insertWorkBefore.test.ts --config vitest.config.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/lib/tree.ts src/state/store.insertWorkBefore.test.ts
git commit -m "feat(app): insertWorkBefore — an undoable step in front of the named work"
```

---

### Task 6: Protocol verb `insert-before`

**Files:**
- Modify: `src/lib/assistantProtocol.ts` (the `AssistantAction` union)
- Modify: `electron/assistantIpc.cjs` (`validAction`)
- Test: `electron/assistantIpc.test.ts` (the `SAMPLES` table — the test auto-reads the protocol file, so a missing row fails loudly)

**Interfaces:**
- Produces: `{ type: 'insert-before'; ref: WorkRef; title: string }` accepted by the relay. Tasks 7–8 dispatch it.

- [ ] **Step 1: Add the verb to the union** — in `src/lib/assistantProtocol.ts`, after `park-work`:

```ts
  /** Insert new work BEFORE `ref` and pin it as the primary. Title-only. */
  | { type: 'insert-before'; ref: WorkRef; title: string }
```

- [ ] **Step 2: Run the relay test to watch it fail**

Run: `npx vitest run electron/assistantIpc.test.ts --config vitest.config.ts`
Expected: FAIL — the union walker finds `insert-before` with no `SAMPLES` row / the validator drops it.

- [ ] **Step 3: Implement the validator** — in `electron/assistantIpc.cjs`'s `validAction` switch, add beside `park-work`:

```js
    // Inserts new work before the ref and pins it. The title crosses the
    // seam, so it is bounded like every other string here — and empty is
    // refused at the seam, not left for the store to trim away.
    case 'insert-before':
      return validRef(action.ref) && shortString(action.title) && action.title.trim().length > 0;
```

Add the sample row in `electron/assistantIpc.test.ts`:

```ts
    'insert-before': { type: 'insert-before', ref: { kind: 'step', id: 'n1', goalId: 'g1' }, title: 'Review ch 3' },
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run electron/assistantIpc.test.ts --config vitest.config.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistantProtocol.ts electron/assistantIpc.cjs electron/assistantIpc.test.ts
git commit -m "feat(app): the relay learns insert-before"
```

---

### Task 7: `AssistantHost` — pinned state and the verb's handler

**Files:**
- Modify: `src/components/assistant/AssistantHost.tsx`
- Test: `src/components/assistant/AssistantHost.test.tsx`

**Interfaces:**
- Consumes: `actions.insertWorkBefore` (Task 5), `pinned` advisor input (Task 4), the `insert-before` action (Task 6).
- Produces: the host executes the verb; the created ref is pinned so the next snapshot leads with it. Pinned clears exactly where `chosen` clears: session start, `switch-focus` (a pick overrides a pin), and `close`.

- [ ] **Step 1: Write the failing test** — extend `AssistantHost.test.tsx` using its existing mount/seed helpers:

```ts
it('insert-before creates the work, pins it as primary, and notices the undo label', async () => {
  // seed: one goal 'g1' with open steps a, b (a is the advisor primary)
  // dispatch through the surface or by invoking onAction via the bridge mock,
  // following this file's existing action-dispatch idiom:
  act(() => dispatchAction({ type: 'insert-before', ref: primaryRef, title: 'Review ch 3' }));
  // the next published snapshot's advice.primary is the NEW step
  expect(lastSnapshot().advice.primary.title).toBe('Review ch 3');
  expect(lastSnapshot().notice?.text).toBe('Added "Review ch 3" first');
});

it('insert-before on a gone anchor warns and pins nothing', async () => {
  act(() => dispatchAction({ type: 'insert-before', ref: { kind: 'step', id: 'gone', goalId: 'g1' }, title: 'X' }));
  expect(lastSnapshot().notice?.tone).toBe('warning');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/assistant/AssistantHost.test.tsx --config vitest.config.ts`
Expected: FAIL — unknown action falls through the switch.

- [ ] **Step 3: Implement** — in `AssistantHost.tsx`:

```ts
// Work the user inserted with "Do first…". Pinned so the very next
// snapshot leads with it — a fresh uncommitted step cannot outrank a
// scheduled commitment by data order alone. Same lifecycle as `chosen`.
const [pinned, setPinned] = useState<WorkRef | null>(null);
```

Thread it into the advice call inside the snapshot memo:

```ts
const advice = promoteWork(executionAdvice({
  goals, tasks, sessions, blocks: busyBlocks,
  placedOn: (date: string) => spansOn(goals, tasks, date),
  allDayBlocks,
  today, week: weekOf(today), now: { date: today, minute: nowMinute() },
  timeLevel,
  focusLevel,
  ...(pinned ? { pinned } : {}),
}), chosen);
```

Add `pinned` to the memo's dependency array. Clear it beside every `setChosen(null)`: in `start-focus` success (`else { setChosen(null); setPinned(null); }`), in `close` (before `onClose()`), and in `switch-focus` add `setPinned(null);` beside `setChosen(action.ref);`. Add the case:

```ts
case 'insert-before': {
  const created = actions.insertWorkBefore(action.ref, action.title);
  if (!created) {
    setNotice({ tone: 'warning', text: "Couldn't add that." });
    return;
  }
  // The label the write actually armed — same rule as complete-work.
  const armed = getState().pendingUndo?.label;
  setNotice(armed ? { tone: 'neutral', text: armed } : null);
  setPinned(created);
  return;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/assistant/AssistantHost.test.tsx --config vitest.config.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/assistant/AssistantHost.tsx src/components/assistant/AssistantHost.test.tsx
git commit -m "feat(app): the host executes insert-before and pins what it made"
```

---

### Task 8: `AssistantSurface` — the "Do first…" control and the key guards

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx`
- Modify: `src/components/assistant/AssistantHost.tsx` (Escape guard only)
- Test: `src/components/assistant/AssistantSurface.test.tsx`
- Possibly modify: `electron/assistantWindow.cjs` (`HEIGHT` — measured, Step 6)

**Interfaces:**
- Consumes: the `insert-before` action (Task 6).
- Produces: an `InsertFirst` row between the work band and the alternatives band, in both presentations. CRITICAL: the shelf's number-key dial bindings assume "no text field for the number row to be stolen from" — that assumption dies here, so the window keydown handler must ignore events originating in an input.

- [ ] **Step 1: Write the failing tests** — in `AssistantSurface.test.tsx`, using its existing render helpers:

```ts
it('Do first… reveals an input and Enter dispatches insert-before', () => {
  render(surfaceWithIdleAdvice());
  fireEvent.click(screen.getByRole('button', { name: 'Do first…' }));
  const input = screen.getByLabelText('Do this first');
  fireEvent.change(input, { target: { value: 'Review ch 3' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onAction).toHaveBeenCalledWith({ type: 'insert-before', ref: primaryRef, title: 'Review ch 3' });
});

it('typing digits in the input does not turn the dials', () => {
  render(surfaceWithIdleAdvice());
  fireEvent.click(screen.getByRole('button', { name: 'Do first…' }));
  const input = screen.getByLabelText('Do this first');
  fireEvent.keyDown(input, { key: '1' });
  expect(onAction).not.toHaveBeenCalledWith({ type: 'set-time-level', level: expect.anything() });
});

it('Escape in the input closes the input, not the shelf', () => {
  render(surfaceWithIdleAdvice());
  fireEvent.click(screen.getByRole('button', { name: 'Do first…' }));
  fireEvent.keyDown(screen.getByLabelText('Do this first'), { key: 'Escape' });
  expect(screen.queryByLabelText('Do this first')).toBeNull();
  expect(onAction).not.toHaveBeenCalledWith({ type: 'close' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/assistant/AssistantSurface.test.tsx --config vitest.config.ts`
Expected: FAIL — no such button.

- [ ] **Step 3: Implement** — in `AssistantSurface.tsx`:

Add the component (import `useState` if not present, `fieldCls` from `../dialogStyles`, `ghostBtn` is already imported):

```tsx
/**
 * "No — this first." One field, one meaning: a TITLE, inserted before the
 * primary and pinned by the host. Not a sentence parser — ⌘K is the one
 * place a sentence becomes a task, and this field never grows grammar.
 * The wrapper's data attribute is how the host's capture-phase Escape
 * listener knows to stand aside; see AssistantHost.
 */
function InsertFirst({ refTarget, disabled, shelf, onAction }: {
  refTarget: WorkRef;
  disabled: boolean;
  shelf: boolean;
  onAction: (action: AssistantAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const close = () => { setOpen(false); setTitle(''); };
  return (
    <div className={`${bandCls(shelf)} pt-0`} data-insert-first>
      {open ? (
        <input
          autoFocus
          value={title}
          aria-label="Do this first"
          placeholder="e.g. Review chapter 3"
          className={fieldCls}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const trimmed = title.trim();
              if (trimmed) onAction({ type: 'insert-before', ref: refTarget, title: trimmed });
              close();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
          onBlur={close}
        />
      ) : (
        <button type="button" className={ghostBtn} disabled={disabled} onClick={() => setOpen(true)}>
          Do first…
        </button>
      )}
    </div>
  );
}
```

Render it in the idle-work return, between `<WorkBand …/>` and the alternatives band:

```tsx
<InsertFirst refTarget={primary.ref} disabled={pending} shelf={shelf} onAction={onAction} />
```

Guard the surface's window keydown handler (the one reading `KEY_TO_TIME_LEVEL`) — first lines of `onKey`:

```ts
const target = event.target as HTMLElement | null;
if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
```

In `AssistantHost.tsx`, guard the CAPTURE-phase Escape listener (React's `stopPropagation` in the input cannot reach it):

```ts
const onKey = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  const target = event.target as HTMLElement | null;
  // The Do-first input owns its own Escape; a capture listener would
  // close the whole panel before the input ever saw the key.
  if (target?.closest?.('[data-insert-first]')) return;
  event.stopPropagation();
  onClose();
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/assistant/AssistantSurface.test.tsx src/components/assistant/AssistantHost.test.tsx --config vitest.config.ts` → PASS.

- [ ] **Step 5: Re-measure the shelf HEIGHT.** The idle state grew by one row and `HEIGHT` in `electron/assistantWindow.cjs` is a MEASURED budget — a hugging card is clipped by the window edge, so a stale budget hides the alternatives band. Read the header comments of `scripts/measure-shelf.cjs`, run it (`node scripts/measure-shelf.cjs`), and set `HEIGHT` to the tallest reported state. jsdom cannot see this; only the Electron measurement counts.

- [ ] **Step 6: Commit**

```bash
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx src/components/assistant/AssistantHost.tsx electron/assistantWindow.cjs
git commit -m "feat(app): Do first — the shelf takes a correction in one line"
```

---

### Task 9: Today's Now row gets the same verb

**Files:**
- Modify: `src/views/Today.tsx`
- Test: Create `src/views/Today.doFirst.test.tsx`

**Interfaces:**
- Consumes: `actions.insertWorkBefore` (Task 5), `pinned` advisor input (Task 4).
- Produces: a `Do first` control on the Now section; on commit the new work leads the page. Today calls `executionAdvice` directly (see ~line 80), so it threads its own local `pinned` state — the shelf's pin must NOT leak here (a mood set in a café must not rewrite the Today page; same boundary, same reason).

- [ ] **Step 1: Write the failing test** — create `src/views/Today.doFirst.test.tsx`, copying the store-mock harness from `src/views/Today.freeTime.test.tsx` (whichever of the Today tests seeds a committed step most directly):

```tsx
it('Do first inserts before the primary and the new step leads the page', async () => {
  // seed: goal g1, steps [write (committed today), submit]
  render(<Today />);
  fireEvent.click(screen.getByRole('button', { name: 'Do first' }));
  const input = screen.getByLabelText('Do this first');
  fireEvent.change(input, { target: { value: 'Review notes' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  // the Now row now names the inserted step
  expect(within(screen.getByRole('region', { name: 'Now' })).getByText('Review notes')).toBeInTheDocument();
});
```

(`aria-label="Now"` is on the section; use `getByLabelText`/`within` per the file's existing idiom.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/Today.doFirst.test.tsx --config vitest.config.ts`
Expected: FAIL — no `Do first` button.

- [ ] **Step 3: Implement** — in `src/views/Today.tsx`:

```ts
// "Do this first" — the same pin the shelf holds, view-local for the same
// reason the shelf's dials are: surfaces do not share ephemeral lenses.
const [pinned, setPinned] = useState<WorkRef | null>(null);
const [doFirstOpen, setDoFirstOpen] = useState(false);
```

Thread `...(pinned ? { pinned } : {})` into the page's `executionAdvice` input (the `useMemo` around line 80) and add `pinned` to its deps. Render the control inside the Now section, after the primary `TaskRow`'s wrapper (both branches share it, so place it once, just before the section's closing tag, gated on `primary`):

```tsx
{primary && (
  <div className="px-[10px] pt-[6px]">
    {doFirstOpen ? (
      <input
        autoFocus
        aria-label="Do this first"
        placeholder="e.g. Review chapter 3"
        className={fieldCls}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const title = (e.target as HTMLInputElement).value.trim();
            if (title) {
              const created = actions.insertWorkBefore(primary.ref, title);
              if (created) setPinned(created);
            }
            setDoFirstOpen(false);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setDoFirstOpen(false);
          }
        }}
        onBlur={() => setDoFirstOpen(false)}
      />
    ) : (
      <button type="button" className={`${rowBtn} quiet-control`} onClick={() => setDoFirstOpen(true)}>
        Do first
      </button>
    )}
  </div>
)}
```

Import `fieldCls` from `../components/dialogStyles` and `WorkRef` from `../lib/expectedTime` as needed. NOTE: `.quiet-control` needs a literal `group` ancestor — if the Now section has none, drop `quiet-control` and keep the plain `rowBtn` (an always-visible quiet button beats an unreachable hidden one).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/views/Today.doFirst.test.tsx --config vitest.config.ts` → PASS.
Run: `npx vitest run src/views --config vitest.config.ts` → all Today tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/Today.tsx src/views/Today.doFirst.test.tsx
git commit -m "feat(app): Today's Now row takes a Do-first, through the same write"
```

---

### Task 10: Full verification

- [ ] **Step 1:** `npm test` — entire suite green.
- [ ] **Step 2:** `npx tsc -b` — clean.
- [ ] **Step 3:** Manual smoke in the real app (`npm run app:dev`): summon the shelf, confirm a loose task appears among alternatives when projects crowd the queue; type a "Do first…" title on the primary and confirm the shelf re-leads with it and the undo toast names it. Check the shelf card's bottom edge — nothing clipped (the HEIGHT re-measure from Task 8).
- [ ] **Step 4:** Commit anything the smoke shook out; otherwise done.

---

## Self-review notes

- Spec coverage: Part 1 → Tasks 2–3; Part 2 → Tasks 1, 4–9; testing section → per-task tests; sequencing → task order matches (Part 1 lands complete before Part 2 begins).
- The spec's "promoted via `chosen`/`promoteWork`" is implemented as the advisor-level `pinned` instead: `promoteWork` can only reorder rows the advice already SHOWS (primary + 3 alternatives), and a fresh uncommitted step is not guaranteed to be among them — discovered during planning; `pinned` is the same idea moved to the layer that holds the full queue. The spec's intent (the new work leads immediately, stale refs fall back silently) is preserved exactly.
- The spec's error copy "the shelf's notice line says so" → `Couldn't add that.` (warning tone), Task 7.
