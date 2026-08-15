# Shelf: mark a task done — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the assistant shelf a checkbox that marks the offered task done, settling any focus session running on it in the same undoable write.

**Architecture:** One new store action, `finishWork(ref)`, builds the completion slice and the session slice and commits them through a single `withUndoSlices` call — two sequential `withUndo` calls would let the second sweep the first and leave a half-undo. The shelf reaches it through one new `AssistantAction` (`complete-work`) on the existing relay, and renders `TodayCheckbox` at the head of the card in both `FocusPanel` and `AdvicePanel`.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, Dexie, Electron.

**Spec:** `docs/superpowers/specs/2026-08-15-assistant-shelf-mark-done-design.md`

## Global Constraints

- Run `npm test` and `npx tsc -b` before every commit (CLAUDE.md).
- No literal hex colours, no arbitrary `text-[Nrem]` — `designScale.test.ts` fails the build on both.
- Undo labels must never contain the word `Undo` — `undoLabels.test.ts` greps `store.ts` for it.
- `AssistantSnapshot` and `AssistantAction` must stay plain JSON: they cross `structuredClone` to a second renderer.
- The overlay entry graph must not reach the store or Dexie — `src/assistant/entryBoundary.test.ts` proves it. Nothing added to `AssistantSurface.tsx` may import from `src/state/`.
- Hover-revealed row controls use `.quiet-control`. **Not applicable here** — the checkbox is always visible, exactly as a task row's is.

## Dependency: RESOLVED — `per-task-demand` has landed

`docs/superpowers/plans/2026-08-15-per-task-demand.md` executed to completion on this branch (`5a8c627` … `506ba38`, plus `9658d60` re-measuring the window budget). **Every task below is now written against the post-demand surface — there is no rename table to apply.** Baseline at the time of writing: 180 test files / 3168 tests passing, `tsc -b` clean.

What that plan left behind, and what this one must therefore assume:

- `src/lib/shelfDetail.ts` is **deleted**. `src/lib/focusLens.ts` owns the dial and exports `FocusLevel`.
- `FocusPanel` takes `focusLevel: FocusLevel`, and the ring reads
  `ringState(focus.expected, focus.elapsedMin, focusLevel)`.
- **`AdvicePanel` takes no level prop at all** — its signature is
  `{ snapshot, shelf, pending, onStart }`. Task 4 adds `onAction` and nothing else.
- `ready()` in `AssistantSurface.test.tsx` carries `timeLevel: 'medium'` and
  `focusLevel: 'medium'`. New fixtures must match.
- `ALTERNATIVE_CAP` is gone; `MAX_ALTERNATIVES` (2) is imported from
  `executionAdvisor`. Task 4's *"puts no checkbox on the alternatives"* test asserts
  one checkbox against a one-alternative fixture, which holds regardless.
- `AssistantAction` already carries `{ type: 'set-focus-level'; level: FocusLevel }`.
  Task 4's `complete-work` is a sibling member and conflicts with nothing.

### Task 5 is NOT dissolved

The earlier draft of this section assumed per-task-demand's own re-measurement would absorb it. It does not. `9658d60` measured the states that existed **before** this plan's checkbox, and `HEIGHT` currently reads **248**. The checkbox still has to be measured against that number, and per-task-demand left no reusable measurement script behind — so Task 5 writes `scripts/measure-shelf.cjs` as specified, and its acceptance criterion is `TALLEST ≤ 248`.

---

### Task 1: Extract `sessionFor` from `logSession`

A pure refactor with no behaviour change. `finishWork` needs to build the same `Session` row inside a multi-slice write, and a second copy of these preconditions would be a second opinion about whether a frozen project can be logged against.

**Files:**
- Modify: `src/state/store.ts` (module-level helper above `export const actions`; rewrite `logSession`'s body)

**Interfaces:**
- Produces: `sessionFor(kind: 'step' | 'task', id: string, minutes: number, date: string, focus?: 'low'): { session: Session; title: string } | null` — module-level, not exported. Returns `null` in exactly the cases `logSession` returned `false`.

- [ ] **Step 1: Run the existing suite to establish green**

Run: `npm test -- src/state`
Expected: PASS. This is a refactor; these tests are the specification.

- [ ] **Step 2: Add the helper**

Insert as a MODULE-LEVEL function above `export const actions` in `src/state/store.ts`, beside the other module helpers. It cannot go "inside" the actions object: `logSession` is a property of that object literal, and `sessionFor` is not an action.

```ts
/**
 * The `Session` one log would write, and the title its label needs — or null
 * if the target refuses one.
 *
 * Extracted so `logSession` and `finishWork` cannot drift about what a logged
 * sitting IS. The second builds the same row inside a multi-slice write, and a
 * second copy of these preconditions would be a second opinion about whether a
 * frozen project can be logged against.
 */
function sessionFor(
  kind: 'step' | 'task',
  id: string,
  minutes: number,
  date: string,
  focus?: 'low',
): { session: Session; title: string } | null {
  const normalized = normalizeEstimate(minutes);
  if (normalized === undefined || !isValidLocalDate(date)) return null;

  let title: string;
  let goalId: string | null;
  if (kind === 'step') {
    // Frozen on a completed project, exactly as `setNodeEstimate` is.
    if (!isActiveNode(id)) return null;
    const goal = goalOfNode(id);
    const node = goal ? findNode(goal.nodes, id) : null;
    // Containers hold no estimate (see `addChild`), so there is nothing for
    // logged time to be measured against.
    if (!goal || !node || node.children) return null;
    title = node.title;
    goalId = goal.id;
  } else {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return null;
    title = task.title;
    goalId = task.goalId;
  }

  return {
    title,
    session: {
      id: uid(),
      goalId,
      date,
      minutes: normalized,
      note: '',
      ...(kind === 'step' ? { nodeId: id } : { taskId: id }),
      ...(focus === undefined ? {} : { focus }),
    },
  };
}
```

- [ ] **Step 3: Rewrite `logSession` to delegate**

Replace the entire body of `logSession` in `src/state/store.ts` with:

```ts
  logSession(
    kind: 'step' | 'task',
    id: string,
    minutes: number,
    date = todayStr(),
    focus?: 'low',
  ): boolean {
    const built = sessionFor(kind, id, minutes, date, focus);
    if (!built) return false;
    withUndo(
      `Logged ${formatEstimateValue(built.session.minutes)} on "${built.title}"`,
      'sessions',
      [...state.sessions, built.session],
    );
    return true;
  },
```

- [ ] **Step 4: Verify nothing changed**

Run: `npm test -- src/state && npx tsc -b`
Expected: PASS, same test count as Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts
git commit -m "refactor(store): pull the Session row out of logSession

finishWork needs the same row inside a multi-slice write, and a second copy
of these preconditions would be a second opinion about whether a frozen
project can be logged against."
```

---

### Task 2: `finishWork` — nothing is running

**Files:**
- Modify: `src/state/store.ts` (result type above `export const actions`, which is at `store.ts:1050`; new action after `confirmFocus`, at `store.ts:2063` and before `discardFocus` at `2082`)
- Create: `src/state/store.finishWork.test.ts`

**Interfaces:**
- Consumes: `sessionFor` (Task 1) — not yet used, but the file must compile with it present.
- Produces:
  ```ts
  export type FinishWorkResult =
    | { outcome: 'done'; label: string }
    | { outcome: 'needs-confirmation'; label: string }
    | { outcome: 'refused' };

  finishWork(ref: WorkRef, nowMs?: number): FinishWorkResult
  ```
  The label is the exact string the undo toast was armed with. Returning it follows `undoLastDelete`, which returns the label it restored so one call is both the action and the honest report — and it is what stops the shelf's notice drifting from the toast.

- [ ] **Step 1: Create the test file**

Create `src/state/store.finishWork.test.ts`. **Copy lines 1–68 of `src/state/store.timeLevel.test.ts` verbatim as the preamble** — the `fake-indexeddb/auto` import, the `dbMocks` / `assetMocks` / `tabLockMocks` hoisted blocks, the three `vi.mock` calls, and the `freshStore` helper. Then append:

```ts
import { isDone } from '../lib/status';

describe('finishWork', () => {
  const MIN = 60_000;
  const t0 = 1_700_000_000_000;
  const goal: Goal = {
    id: 'g1', title: 'Algorithms',
    nodes: [{ id: 'n1', title: 'Problem set 4' }],
  };
  const ref = { kind: 'step' as const, id: 'n1', goalId: 'g1' };
  const starter = { kind: 'starter' as const, minutes: 30 as const };

  async function workStore(goals: Goal[] = [goal]) {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({
      goals: structuredClone(goals), habits: [], tasks: [], sessions: [], lives: [],
    });
    const store = await freshStore();
    await store.initStore();
    return store;
  }

  beforeEach(() => {
    tabLockMocks.acquireTabLock.mockClear();
    tabLockMocks.acquireTabLock.mockResolvedValue(true);
  });

  it('ticks a leaf and arms the same undo toggleLeaf would', async () => {
    const { actions, getState } = await workStore();

    expect(actions.finishWork(ref, t0)).toEqual({
      outcome: 'done',
      label: 'Completed "Problem set 4"',
    });
    expect(isDone(getState().goals[0].nodes[0])).toBe(true);
    expect(getState().sessions).toEqual([]);
    expect(getState().pendingUndo?.label).toBe('Completed "Problem set 4"');

    actions.undoLastDelete();
    expect(isDone(getState().goals[0].nodes[0])).toBe(false);
  });

  it('refuses a leaf that is already done, and writes nothing', async () => {
    const { actions, getState } = await workStore();
    actions.finishWork(ref, t0);

    expect(actions.finishWork(ref, t0)).toEqual({ outcome: 'refused' });
    expect(getState().sessions).toEqual([]);
  });

  it('refuses a container — a parent has no status of its own', async () => {
    const { actions } = await workStore([{
      id: 'g1', title: 'Algorithms',
      nodes: [{ id: 'p1', title: 'Unit 1', children: [{ id: 'n1', title: 'Problem set 4' }] }],
    }]);

    expect(actions.finishWork({ kind: 'step', id: 'p1', goalId: 'g1' }, t0))
      .toEqual({ outcome: 'refused' });
  });

  it('completes a loose task', async () => {
    const { actions, getState } = await freshStore();
    actions.addTask('Watch roblox');
    const taskId = getState().tasks[0].id;

    expect(actions.finishWork({ kind: 'task', id: taskId }, t0)).toEqual({
      outcome: 'done',
      label: 'Completed "Watch roblox"',
    });
    expect(getState().tasks[0].done).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/state/store.finishWork.test.ts`
Expected: FAIL — `actions.finishWork is not a function`.

- [ ] **Step 3: Add the result type**

Insert above `export const actions` in `src/state/store.ts`:

```ts
export type FinishWorkResult =
  | { outcome: 'done'; label: string }
  | { outcome: 'needs-confirmation'; label: string }
  | { outcome: 'refused' };
```

- [ ] **Step 4: Add the action**

Insert into the `actions` object in `src/state/store.ts`, immediately after `confirmFocus` (`store.ts:2063`) and before `discardFocus`:

```ts
  /**
   * Mark one piece of work finished, settling any sitting running on it.
   *
   * `completeFocus` ends a SITTING; this ends the WORK. When both happen at
   * once they are ONE write across two slices: two sequential `withUndo` calls
   * would let the second's sweep discard the first, so the toast would read
   * `Completed "X"` and restore `goals` alone — un-ticking the task while
   * keeping its logged minutes, a half-undo that leaves the data in a state
   * that is neither the old one nor the new one.
   *
   * Returns the label it armed, the way `undoLastDelete` returns the one it
   * restored: the shelf's notice and the undo toast then cannot disagree about
   * what just happened.
   */
  finishWork(ref: WorkRef, nowMs = Date.now()): FinishWorkResult {
    const today = todayStr();

    // The completion slice, built the way `toggleLeaf`/`toggleTask` build it —
    // deliberately not by CALLING them, because each arms its own `withUndo`
    // and the second would sweep the first.
    let completed: Partial<AppState>;
    let title: string;
    if (ref.kind === 'step') {
      if (!isActiveNode(ref.id)) return { outcome: 'refused' };
      const goals = cloneGoals(state.goals);
      const node = findInAll(goals, ref.id);
      if (!node || node.children?.length || isDone(node)) return { outcome: 'refused' };
      writeStatus(node, 'done', today);
      title = node.title;
      completed = { goals };
    } else {
      const task = state.tasks.find((t) => t.id === ref.id);
      if (!task || task.done) return { outcome: 'refused' };
      title = task.title;
      completed = {
        tasks: state.tasks.map((t) => (
          t.id === ref.id ? { ...t, done: true, doneAt: today } : t
        )),
      };
    }

    const label = `Completed "${title}"`;
    withUndoSlices(label, completed);
    return { outcome: 'done', label };
  },
```

`nowMs` is unused until Task 3. TypeScript will not complain about an unused parameter; if the project's lint does, add it in Task 3 rather than suppressing it here.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/state/store.finishWork.test.ts && npx tsc -b`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/state/store.ts src/state/store.finishWork.test.ts
git commit -m "feat(store): finishWork ends the work, not the sitting

Complete session logs minutes; nothing ended the task. This is the idle
half — no draft running, one slice, the same undo toggleLeaf arms."
```

---

### Task 3: `finishWork` — a session is running

Covers all three running-draft cases in one gate: a normal sitting, a stale one, and a draft about other work. They are not split, because an intermediate that logs a stale sitting or discards a parked draft is a state with a real data-loss bug in it, and no reviewer should be asked to approve that.

**Files:**
- Modify: `src/state/store.ts` (`finishWork`)
- Modify: `src/state/store.finishWork.test.ts`

**Interfaces:**
- Consumes: `sessionFor` (Task 1), `finishWork` (Task 2), `finishFocusSession` and `staleFocusLimitMin` from `src/lib/focusSession` (already imported by `store.ts`; a `starter` expectation makes the stale limit 180 minutes).
- Produces: no signature change. The `'needs-confirmation'` arm becomes reachable.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('finishWork', …)` block in `src/state/store.finishWork.test.ts`:

```ts
  it('logs the sitting and ticks the task in ONE undoable write', async () => {
    const { actions, getState } = await workStore();
    actions.startFocus(ref, starter, t0);

    expect(actions.finishWork(ref, t0 + 12 * MIN)).toEqual({
      outcome: 'done',
      label: 'Completed "Problem set 4" · logged 12m',
    });

    expect(getState().sessions).toHaveLength(1);
    expect(getState().sessions[0].minutes).toBe(12);
    expect(getState().sessions[0].nodeId).toBe('n1');
    expect(isDone(getState().goals[0].nodes[0])).toBe(true);
    expect(getState().activeFocusSession).toBeNull();
    expect(getState().pendingUndo?.label).toBe('Completed "Problem set 4" · logged 12m');
  });

  /*
   * The whole reason this action exists rather than two calls. Two sequential
   * withUndo writes would let the second sweep the first, so undo would
   * un-tick the task and leave the minutes logged.
   */
  it('undo restores BOTH slices, never half of them', async () => {
    const { actions, getState } = await workStore();
    actions.startFocus(ref, starter, t0);
    actions.finishWork(ref, t0 + 12 * MIN);

    actions.undoLastDelete();

    expect(getState().sessions).toEqual([]);
    expect(isDone(getState().goals[0].nodes[0])).toBe(false);
  });

  it('freezes the TIME level onto the session, exactly as completeFocus does', async () => {
    const { actions, getState } = await workStore();
    actions.setTimeLevel('low');
    actions.startFocus(ref, starter, t0);

    actions.finishWork(ref, t0 + 12 * MIN);

    expect(getState().sessions[0].focus).toBe('low');
  });

  /*
   * The tick is certain — you said you finished. The minutes are not: a session
   * that "ran" nine hours is more likely a laptop lid than a marathon, and
   * logging it would poison the history behind every "Usually 45-60m" the shelf
   * shows. One slice, so undo stays whole; the draft parks for its own question.
   */
  it('ticks the task but parks a stale sitting instead of logging it', async () => {
    const { actions, getState } = await workStore();
    actions.startFocus(ref, starter, t0);

    expect(actions.finishWork(ref, t0 + 200 * MIN)).toEqual({
      outcome: 'needs-confirmation',
      label: 'Completed "Problem set 4"',
    });

    expect(isDone(getState().goals[0].nodes[0])).toBe(true);
    expect(getState().sessions).toEqual([]);
    expect(getState().activeFocusSession?.phase).toBe('confirming');
    expect(getState().activeFocusSession?.proposedMinutes).toBe(200);
  });

  it('leaves a draft about other work completely alone', async () => {
    const { actions, getState } = await workStore([{
      id: 'g1', title: 'Algorithms',
      nodes: [{ id: 'n1', title: 'Problem set 4' }, { id: 'n2', title: 'Read chapter 3' }],
    }]);
    actions.startFocus({ kind: 'step', id: 'n2', goalId: 'g1' }, starter, t0);

    expect(actions.finishWork(ref, t0 + 12 * MIN)).toEqual({
      outcome: 'done',
      label: 'Completed "Problem set 4"',
    });

    expect(getState().sessions).toEqual([]);
    expect(getState().activeFocusSession?.ref.id).toBe('n2');
    expect(getState().activeFocusSession?.phase).toBe('active');
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run src/state/store.finishWork.test.ts`
Expected: FAIL on the first, third and fourth new tests — the label carries no `· logged 12m`, `sessions` stays empty, and the stale case returns `outcome: 'done'`. The "other work" test already passes; it is here to pin the guard added below.

- [ ] **Step 3: Extend the action**

In `src/state/store.ts`, replace these three closing lines of `finishWork`:

```ts
    const label = `Completed "${title}"`;
    withUndoSlices(label, completed);
    return { outcome: 'done', label };
```

with:

```ts
    const draft = state.activeFocusSession;
    // A draft about OTHER work is real occupancy this must not disturb, and a
    // `confirming` one is already a question awaiting its own answer.
    if (
      !draft
      || draft.phase === 'confirming'
      || draft.ref.kind !== ref.kind
      || draft.ref.id !== ref.id
    ) {
      const label = `Completed "${title}"`;
      withUndoSlices(label, completed);
      return { outcome: 'done', label };
    }

    const finish = finishFocusSession(draft, nowMs);
    if (finish.kind === 'needs-confirmation') {
      // One slice only, so undo stays whole. The minutes park in `confirming`
      // for the question the shelf already knows how to ask.
      const label = `Completed "${title}"`;
      withUndoSlices(label, completed);
      setFocusDraft(finish.session);
      return { outcome: 'needs-confirmation', label };
    }

    // The TIME level, never the display one — the same choice `completeFocus`
    // makes, for the same reason.
    const built = sessionFor(
      ref.kind, ref.id, finish.minutes, today,
      draft.focusLevel === 'low' ? 'low' : undefined,
    );
    const label = built
      ? `Completed "${title}" · logged ${formatEstimateValue(built.session.minutes)}`
      : `Completed "${title}"`;
    withUndoSlices(
      label,
      built ? { ...completed, sessions: [...state.sessions, built.session] } : completed,
    );
    setFocusDraft(null);
    return { outcome: 'done', label };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/state && npx tsc -b`
Expected: PASS, 9 tests in `store.finishWork.test.ts`, everything else unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/store.finishWork.test.ts
git commit -m "feat(store): finishWork settles the running sitting in the same write

One withUndoSlices across goals and sessions, because two sequential withUndo
calls would let the second sweep the first and undo would un-tick the task
while keeping its minutes. A stale sitting parks instead of being logged: the
tick is certain, the hours are not."
```

---

### Task 4: The shelf ticks work done

Protocol, host and surface land together. None of the three is independently observable — the host case cannot be exercised without a control that dispatches it, and a control that dispatches an action the union does not carry will not compile.

**Files:**
- Modify: `src/lib/assistantProtocol.ts:43-56` (the `AssistantAction` union)
- Modify: `src/components/assistant/AssistantHost.tsx` (the `onAction` switch, after `complete-focus`)
- Modify: `src/components/assistant/AssistantSurface.tsx` (`FocusPanel`, `AdvicePanel`, and the `AdvicePanel` call site)
- Modify: `src/components/assistant/AssistantSurface.test.tsx`
- Modify: `src/components/assistant/AssistantHost.test.tsx`

**Interfaces:**
- Consumes: `finishWork` / `FinishWorkResult` (Tasks 2–3); `TodayCheckbox` from `src/components/TodayCheckbox` — `{ checked: boolean; onToggle: () => void; ariaLabel?: string; disabled?: boolean }`, already purely presentational with no store or `db` import, so the overlay entry boundary holds.
- Produces: `{ type: 'complete-work'; ref: WorkRef }` on `AssistantAction`.

- [ ] **Step 1: Write the failing surface tests**

In `src/components/assistant/AssistantSurface.test.tsx`, add `AssistantFocusView` to the existing type import from `../../lib/assistantProtocol`, then add a helper beside the existing `work` / `ready` helpers:

```ts
function focusView(over: Partial<AssistantFocusView> = {}): AssistantFocusView {
  return {
    ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    title: 'Problem set 4',
    goalTitle: 'Algorithms',
    phase: 'active',
    elapsedMin: 12,
    expected: { kind: 'estimate', minutes: 45 },
    ...over,
  };
}
```

Then append this suite to the file:

```ts
describe('marking the offered work done', () => {
  it('offers a checkbox on the idle card, named for the work', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Complete "Problem set 4"' })).toBeTruthy();
  });

  it('dispatches complete-work with the primary ref', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete "Problem set 4"' }));

    expect(onAction).toHaveBeenCalledWith({
      type: 'complete-work',
      ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    });
  });

  it('offers it on a running session too — that is when you come back', () => {
    render(<AssistantSurface snapshot={ready({ activeFocus: focusView() })} onAction={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Complete "Problem set 4"' })).toBeTruthy();
  });

  it('offers it on a break', () => {
    render(<AssistantSurface
      snapshot={ready({ activeFocus: focusView({ phase: 'break' }) })}
      onAction={() => {}}
    />);
    expect(screen.getByRole('checkbox', { name: 'Complete "Problem set 4"' })).toBeTruthy();
  });

  /*
   * `confirming` is already asking "was that real work?". A tick there would
   * answer a different question than the one on screen.
   */
  it('withholds it while a session is confirming', () => {
    render(<AssistantSurface
      snapshot={ready({ activeFocus: focusView({ phase: 'confirming', proposedMinutes: 200 }) })}
      onAction={() => {}}
    />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  /*
   * The Sidecar is a list of things to PICK, and a list of choices is not a
   * commit — the same reason optionRow is not one of the dialog variants.
   */
  it('puts no checkbox on the alternatives', () => {
    render(<AssistantSurface
      snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives: [
        work({ key: 'step:n2', ref: { kind: 'step', id: 'n2', goalId: 'g1' }, title: 'Read chapter 3' }),
      ] } })}
      onAction={() => {}}
      presentation="shelf"
    />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('checkbox', { name: 'Complete "Read chapter 3"' })).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing host test**

Append to `src/components/assistant/AssistantHost.test.tsx`, inside its existing top-level `describe`. It uses the file's own `mountHost` and `TODAY` — a loose task dated today is what makes the advisor recommend something:

```ts
  it('ticks the offered work done and reports the label the write armed', async () => {
    const store = await mountHost({
      tasks: [{ id: 't1', title: 'Draft essay', done: false, goalId: null, date: TODAY }],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Complete "Draft essay"' }));
    });

    expect(store.getState().tasks[0].done).toBe(true);
    expect(screen.getByText('Completed "Draft essay"')).toBeTruthy();
  });
```

- [ ] **Step 3: Run both to confirm they fail**

Run: `npx vitest run src/components/assistant`
Expected: FAIL — `Unable to find an accessible element with the role "checkbox"`, and a type error on `complete-work`.

- [ ] **Step 4: Add the action to the protocol**

In `src/lib/assistantProtocol.ts`, add one arm to the `AssistantAction` union, between `switch-focus` and `close`:

```ts
  /** End the WORK, not the sitting. `complete-focus` is the sitting. */
  | { type: 'complete-work'; ref: WorkRef }
```

- [ ] **Step 5: Handle it in the host**

In `src/components/assistant/AssistantHost.tsx`, add a case to the `onAction` switch immediately after `complete-focus`:

```ts
      case 'complete-work': {
        const result = actions.finishWork(action.ref);
        if (result.outcome === 'refused') {
          setNotice({ tone: 'warning', text: "Couldn't complete that." });
          return;
        }
        // The label the write actually armed, so this line and the undo toast
        // cannot drift apart.
        setNotice({ tone: 'neutral', text: result.label });
        return;
      }
```

- [ ] **Step 6: Add the checkbox to `FocusPanel`**

In `src/components/assistant/AssistantSurface.tsx`, add the import:

```ts
import { TodayCheckbox } from '../TodayCheckbox';
```

Replace the `ring` constant and the `info` block at the top of `FocusPanel` with:

```ts
  // The ring and the tick share one condition: `confirming` carries neither.
  // The ring has no progress to draw against a figure still in question, and a
  // tick would answer a different question than the one on screen.
  const running = focus.phase !== 'confirming';
  const info = (
    <div className="flex min-w-0 items-center gap-3">
      {running && (
        <TodayCheckbox
          checked={false}
          ariaLabel={`Complete "${focus.title}"`}
          onToggle={() => onAction({ type: 'complete-work', ref: focus.ref })}
        />
      )}
      {running && (
        <SessionRing
          state={ringState(focus.expected, focus.elapsedMin, focusLevel)}
          paused={focus.phase === 'break'}
        />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <SectionLabel>Focus session</SectionLabel>
        <h2 className="line-clamp-2 text-h2 font-semibold text-ink">{focus.title}</h2>
        {focus.goalTitle && <p className="truncate text-meta text-muted">{focus.goalTitle}</p>}
        {focus.phase === 'confirming' ? (
          <p className="text-body text-ink">
            This session shows {fmtMinutes(focus.proposedMinutes ?? focus.elapsedMin)} — was that real work?
          </p>
        ) : (
          <p className="text-meta text-muted">
            {elapsedAgainstExpected(focus.elapsedMin, focus.expected, focusLevel)}
            {focus.phase === 'break' ? ' · On a break' : ''}
          </p>
        )}
      </div>
    </div>
  );
```

The checkbox goes **before** the ring: that is where a checkbox sits on every task row in the app, and it keeps one rule across both panels — the checkbox is always the first thing in the card. The ring stays second and stays decorative (`aria-hidden`).

- [ ] **Step 7: Add it to `AdvicePanel`**

`AdvicePanel` has no `onAction` prop today. Add it to the signature, leaving the other props and their comments as they are:

```ts
function AdvicePanel({ snapshot, shelf, pending, onAction, onStart }: {
  snapshot: Extract<AssistantSnapshot, { status: 'ready' }>;
  shelf: boolean;
  pending: boolean;
  onAction: Props['onAction'];
  onStart: (ref: RecommendedWork['ref']) => void;
}) {
```

Replace `primaryColumn` with:

```ts
  const primaryColumn = (
    <div className="flex min-w-0 items-center gap-3">
      <TodayCheckbox
        checked={false}
        ariaLabel={`Complete "${primary.title}"`}
        onToggle={() => onAction({ type: 'complete-work', ref: primary.ref })}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <SectionLabel>{REASON_WORD[primary.reason]}</SectionLabel>
        <h2 className="line-clamp-2 text-h2 font-semibold text-ink">{primary.title}</h2>
        <p className="flex min-w-0 items-baseline gap-1.5 text-meta text-muted">
          {primary.goalTitle && <span className="truncate">{primary.goalTitle}</span>}
          {primary.goalTitle && <span aria-hidden>·</span>}
          <span className="shrink-0">{expectedTimeLabel(primary.expected)}</span>
        </p>
      </div>
    </div>
  );
```

And pass it at the call site in `AssistantSurface`:

```tsx
          <AdvicePanel
            snapshot={snapshot}
            shelf={shelf}
            pending={sendoff.pending}
            onAction={onAction}
            onStart={sendoff.start}
          />
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/components/assistant && npx tsc -b`
Expected: PASS, 7 new tests.

- [ ] **Step 9: Run the whole suite — the entry boundary is the one at risk**

Run: `npm test`
Expected: PASS. `src/assistant/entryBoundary.test.ts` proves the overlay graph reaches neither the store nor Dexie; `TodayCheckbox` imports nothing, so it holds. If that test fails, the import is wrong, not the test.

- [ ] **Step 10: Commit**

```bash
git add src/lib/assistantProtocol.ts src/components/assistant/
git commit -m "feat(assistant): tick the offered work done from the shelf

TodayCheckbox at the head of the card, before the decorative ring, in both
panels — the gesture the rest of the app already spends on completion, and
the one thing that moves a number. Withheld while confirming, which is
already asking a different question. The notice reports the label finishWork
armed rather than composing a second one that could drift from the toast."
```

---

### Task 5: Re-measure the height budget

`HEIGHT` is 248, measured against `confirming` with a title long enough to hit the `line-clamp-2` cap. `confirming` is the one state that renders no checkbox, so the tallest state should be untouched — but that reasoning is not a substitute for the measurement. That file's own rule is that arithmetic against the type scale put the number 20px low once already, and a hugging card is **clipped, not scrolled**, so anything past the line is invisible rather than awkward.

**Files:**
- Create: `scripts/measure-shelf-preload.cjs`
- Create: `scripts/measure-shelf.cjs`
- Modify: `electron/assistantWindow.cjs` (the comment above `HEIGHT`; the constant only if the measurement moves it)

**Interfaces:**
- Consumes: the built `dist/assistant.html`, and `window.phaseAssistantOverlay` — the preload shape `assistantOverlayBridge` reads (`ready()`, `onSnapshot()`, `act()`, `close()`). The overlay card carries `data-shelf`.
- Produces: measured pixel heights per state on stdout.

- [ ] **Step 1: Write the stub preload**

Create `scripts/measure-shelf-preload.cjs`:

```js
// Feeds one fixed snapshot to the overlay so its card can be measured. The
// real preload relays from the app; this one answers from PHASE_SHELF_SNAPSHOT
// and never sends anything back.
const { contextBridge } = require('electron')

const snapshot = JSON.parse(process.env.PHASE_SHELF_SNAPSHOT || '{"status":"loading"}')

contextBridge.exposeInMainWorld('phaseAssistantOverlay', {
  ready: async () => snapshot,
  onSnapshot: () => () => {},
  act: () => {},
  close: () => {},
})
```

- [ ] **Step 2: Write the measurement script**

Create `scripts/measure-shelf.cjs`:

```js
// Measures the shelf card at its real width for every reachable state, so
// HEIGHT in electron/assistantWindow.cjs stays a measurement rather than a
// guess. Run after `npm run build`:
//
//   npx electron scripts/measure-shelf.cjs
//
// The card hugs its content and the window CLIPS rather than scrolls, so the
// tallest state here IS the budget.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const WIDTH = 620

// Free text with no length cap, so two wrapped lines under line-clamp-2 is the
// real worst case, not an edge case to round past.
const LONG = 'Draft the comparative literature review for the graduate seminar '
  + 'on nineteenth-century industrialization'

const work = (over = {}) => ({
  key: 'step:n1',
  ref: { kind: 'step', id: 'n1', goalId: 'g1' },
  title: LONG,
  goalTitle: 'Comparative Literature',
  reason: 'scheduled-now',
  expected: { kind: 'estimate', minutes: 45 },
  ...over,
})

const NOTICE = { tone: 'neutral', text: `Completed "${LONG}" · logged 45m` }

const base = {
  status: 'ready',
  timeLevel: 'medium',
  focusLevel: 'medium',
  activeFocus: null,
  notice: NOTICE,
  advice: { kind: 'work', primary: work(), alternatives: [] },
}

const focus = (over) => ({
  ref: { kind: 'step', id: 'n1', goalId: 'g1' },
  title: LONG,
  goalTitle: 'Comparative Literature',
  expected: { kind: 'estimate', minutes: 45 },
  ...over,
})

const STATES = {
  // The previous tallest, and the one state that renders no checkbox.
  confirming: {
    ...base,
    activeFocus: focus({ phase: 'confirming', elapsedMin: 200, proposedMinutes: 200 }),
  },
  // Gains the checkbox in this change.
  active: { ...base, activeFocus: focus({ phase: 'active', elapsedMin: 12 }) },
  sidecar: {
    ...base,
    advice: {
      kind: 'work',
      primary: work(),
      alternatives: [
        work({ key: 'step:n2', ref: { kind: 'step', id: 'n2', goalId: 'g1' } }),
        work({ key: 'step:n3', ref: { kind: 'step', id: 'n3', goalId: 'g1' } }),
      ],
    },
  },
  // beyondWindow always slices visible to one item, so alternatives is empty
  // whenever it fires — the fifth combination cannot occur.
  beyondWindow: {
    ...base,
    advice: { kind: 'work', primary: work(), alternatives: [], beyondWindow: true },
  },
}

app.whenReady().then(async () => {
  const results = {}
  for (const [name, snapshot] of Object.entries(STATES)) {
    process.env.PHASE_SHELF_SNAPSHOT = JSON.stringify(snapshot)
    const win = new BrowserWindow({
      show: false,
      width: WIDTH,
      height: 1000,
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, 'measure-shelf-preload.cjs'),
      },
    })
    await win.loadFile(path.join(__dirname, '..', 'dist', 'assistant.html'))
    await new Promise((r) => setTimeout(r, 1200))
    results[name] = await win.webContents.executeJavaScript(
      "document.querySelector('[data-shelf]')?.getBoundingClientRect().height ?? -1")
    win.destroy()
  }

  for (const [name, height] of Object.entries(results)) console.log(`${name}=${height}`)
  const tallest = Math.max(...Object.values(results))
  console.log('TALLEST=' + tallest)
  app.exit(tallest > 0 ? 0 : 1)
})
```

- [ ] **Step 3: Build and measure**

Run:
```bash
npm run build && npx electron scripts/measure-shelf.cjs
```
Expected: four `name=height` lines and a `TALLEST=` line. Every height must be a positive number — a `-1` means the card never rendered and the measurement is worthless, not that the state is small. If `active` comes back `-1` while `confirming` does not, the snapshot shape is wrong, not the shelf.

- [ ] **Step 4: Reconcile with `HEIGHT`**

If `TALLEST` ≤ 248: leave `const HEIGHT = 248` alone and update the comment in `electron/assistantWindow.cjs` to record that the checkbox was measured and did not move the budget, naming the four figures this run produced.

If `TALLEST` > 248: set `HEIGHT` to `Math.ceil(TALLEST)` and rewrite the comment to name the new tallest state and its figure. Do not round up for comfort — that comment's own standard is "a real number for a real state, not a comfortable one for a fictional one".

- [ ] **Step 5: Commit**

```bash
git add scripts/measure-shelf.cjs scripts/measure-shelf-preload.cjs electron/assistantWindow.cjs
git commit -m "chore(shelf): re-measure the budget with the checkbox in place

confirming is the one state that renders no checkbox, so the tallest state
was expected to hold — but the file's rule is that this gets measured, and a
committed script makes the next measurement cheap instead of ad hoc."
```

---

## Verification

- [ ] `npm test` — full suite green.
- [ ] `npx tsc -b` — clean.
- [ ] `npm run app:dev` — summon the shelf, tick the box on an idle recommendation; the task leaves the card and the notice names it.
- [ ] Start a session, summon the shelf, tick the box: the minutes are logged, the session ends, and `⌘Z` in the main window restores **both** the tick and the logged time.

## Self-review notes

Spec sections mapped to tasks: gesture → 4; one-tick-one-write → 1, 3; the four states → 2, 3; refusals report → 2, 4; notice and undo → 4; non-goals (no `Sidecar` checkbox) → 4; height → 5.

Two refinements against the spec, both deliberate:

1. **`finishWork` returns `FinishWorkResult`, not a bare enum.** The spec pinned `'done' | 'needs-confirmation' | 'refused'`, but the host's notice needs the exact label the write armed. Composing a second string in the host would duplicate `formatEstimateValue` and let the notice drift from the toast. Returning the label follows `undoLastDelete`, which returns the label it restored for the same reason.
2. **`sessionFor` is an extraction the spec did not name.** The spec required `finishWork` not to reimplement `logSession`'s preconditions; this is how.

One structural note: the spec's stale case and other-work case are not separate tasks. An intermediate that logs a stale sitting, or discards a parked draft, is a state with real data loss in it, and splitting there would ask a reviewer to approve that.
