# Undo for a Booking Made From a Distance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scheduleNode` and `scheduleTask` arm a 5-second undo when the booking did not come from dragging an existing bar, so an accidental press on Today's free-time offer can be taken back.

**Architecture:** Two one-line branches. Each function's terminal `setAndPersist` becomes `opts.blockId ? setAndPersist(next) : withUndo(label, slice, next)`. `withUndo` is the store's existing seam — it snapshots the slice, persists the next one, and arms a non-surgical entry that both `⌘Z` and the toast's Undo button reach. No new action, no new component, no change to the undo machinery.

**Tech Stack:** React 19 + TypeScript + Vite, Vitest + Testing Library, Dexie. The store is a `useSyncExternalStore` singleton in `src/state/store.ts`.

## Global Constraints

- Branch: `schedule-undo` (off `main`; spec at commit `2d2fa29`). Do **not** commit to `lives-slice-1`.
- The working tree carries unrelated WIP: modified `ideas/README.md`, untracked `ideas/vision.md` and `docs/superpowers/plans/2026-08-11-lives-slice-1.md`. **Never `git add -A` or `git commit -a`** — stage the exact paths each step names.
- Run `npm test` and `npx tsc -b` before every commit (CLAUDE.md convention).
- The undo label is exactly `Scheduled "<title>"` — straight double quotes, from a template literal. It pairs with the existing `Unscheduled "<title>"`.
- Do not pass `ttlMs`; scheduling is not destructive, so it takes the default `UNDO_MS` (5s), never `DESTRUCTIVE_UNDO_MS`.
- Do not pass `surgical`. These entries are non-surgical, like every other `withUndo` caller.
- Line numbers are valid at commit `2d2fa29` and shift as you edit. Match on the quoted code, not the number.

---

### Task 1: `scheduleNode` arms an undo for a booking with no `blockId`

**Files:**
- Modify: `src/state/store.ts:2055` — the `setAndPersist({ goals });` that closes `scheduleNode`
- Test: `src/state/store.test.ts` — inside the existing `describe('scheduleNode / unscheduleNode', ...)` block that opens at line 1011

**Interfaces:**
- Consumes: `withUndo(label: string, key: K, next: AppState[K], ttlMs?: number, uiPatch?: Partial<UIState>): void` — `src/state/store.ts:688`. It snapshots `state[key]` *before* `next` lands, so you hand it the already-computed next slice exactly as you would hand it to `setAndPersist`.
- Produces: nothing new. `scheduleNode(goalId, nodeId, day, aimMin, opts?): boolean` keeps its signature and its return.

Fixture idiom used by every test in this block: `'2026-07-15'` is a Wednesday, the mocked availability is Mon–Fri 09:00–18:00 (540–1080), and the clock is set to 08:00 so the whole window is still ahead. Estimates are set explicitly below so slot arithmetic is deterministic rather than depending on `durationOf`'s default.

- [ ] **Step 1: Write the failing tests**

Add these four tests to `src/state/store.test.ts`, directly after the test named `'refuses with a toast naming the longest free stretch when nothing fits'` (it ends at line 1055).

```ts
    it('arms an undo when a booking did not come from moving a bar', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'Watch roblox');
      const nid = getState().goals[0].nodes[0].id;

      actions.scheduleNode(gid, nid, '2026-07-15', 600);
      expect(getState().pendingUndo?.label).toBe('Scheduled "Watch roblox"');

      actions.undoLastDelete();

      // The whole-slice snapshot reverses the commitment too, not just the block.
      const back = getState().goals[0].nodes[0];
      expect(back.plannedWeek).toBeUndefined();
      expect(back.blocks).toBeUndefined();
    });

    it('stays silent when a drag moves one existing bar', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.setNodeEstimate(nid, 60);
      actions.scheduleNode(gid, nid, '2026-07-15', 600);
      const blockId = getState().goals[0].nodes[0].blocks![0].id;

      actions.scheduleNode(gid, nid, '2026-07-15', 660, { blockId });

      expect(getState().goals[0].nodes[0].blocks![0].startMin).toBe(660);
      // The placement's own entry was swept by this ordinary write, and the
      // move armed nothing of its own — so there is no button left to press.
      expect(getState().pendingUndo).toBeNull();
    });

    it('arms nothing when the day has no room', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.setNodeEstimate(nid, 600); // longer than the whole 09:00-18:00 window
      // setNodeEstimate arms an undo of its own (`store.ts:1172`). An ordinary
      // write sweeps it — `renameGoal` (`store.ts:1410`) is a plain
      // `setAndPersist` — so the assertion below is about `scheduleNode` and
      // nothing else. Without this the test can never pass, because the refusal
      // returns before any write and so sweeps nothing.
      actions.renameGoal(gid, 'G');
      expect(getState().pendingUndo).toBeNull();

      expect(actions.scheduleNode(gid, nid, '2026-07-15', 600)).toBe(false);

      // A visible Undo over a write that never happened is worse than no button.
      expect(getState().pendingUndo).toBeNull();
    });

    it("undoing a mode:'add' sitting removes only the one it added", async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.setNodeEstimate(nid, 60);
      actions.scheduleNode(gid, nid, '2026-07-15', 540);

      actions.scheduleNode(gid, nid, '2026-07-15', 700, { mode: 'add' });
      expect(getState().goals[0].nodes[0].blocks).toHaveLength(2);

      actions.undoLastDelete();

      const left = getState().goals[0].nodes[0].blocks!;
      expect(left).toHaveLength(1);
      expect(left[0].startMin).toBe(540);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts src/state/store.test.ts -t "arms an undo when a booking"`

Expected: FAIL — `expected undefined to be 'Scheduled "Watch roblox"'`, because `scheduleNode` still calls `setAndPersist` directly.

- [ ] **Step 3: Make the write undoable**

In `src/state/store.ts`, inside `scheduleNode`, replace:

```ts
    setAndPersist({ goals });
    return true;
```

with:

```ts
    /*
     * A drag of one existing bar is DIRECT MANIPULATION: you watched it land and
     * you can drag it back, which is why `resizeNode` is silent too. Every other
     * route here books from a distance — Today's proposal row, the backlog's
     * `1`-`7` keypress, `ScheduleMenu`, TaskPage's add-a-sitting — and on Today
     * the row IS the button, so there is no way to touch that zone without
     * booking something. A press you did not mean must have a way back.
     *
     * The snapshot is the whole slice on purpose: this write sets the block AND
     * the `plannedWeek` commitment above it, and a surgical undo would have to
     * remember both, then drift the first time a third field joined them.
     */
    if (opts.blockId) setAndPersist({ goals });
    else withUndo(`Scheduled "${sourceNode.title}"`, 'goals', goals);
    return true;
```

`sourceNode` is already in scope — the function reads it at the top for its container/unknown-id guard.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts src/state/store.test.ts`

Expected: PASS — the four new tests plus the whole existing file. In particular `'unscheduleNode clears all three fields with an undo window'` (line 1057) must still pass: `scheduleNode` now pushes an entry of its own first, but `undoLastDelete` pops the LAST one, which is still the unschedule.

- [ ] **Step 5: Run the whole suite and the typechecker**

Run: `npm test && npx tsc -b`

Expected: PASS. If an unrelated test now sees a `pendingUndo` it did not before, that test was silently relying on scheduling being invisible — update it to expect the entry, and name it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(schedule): a leaf booked from a distance can be taken back"
```

---

### Task 2: `scheduleTask` takes the twin

**Files:**
- Modify: `src/state/store.ts:2092-2101` — the `setAndPersist({ tasks: ... })` that closes `scheduleTask`
- Test: `src/state/store.test.ts` — beside the Task 1 tests

**Interfaces:**
- Consumes: the same `withUndo` seam as Task 1, keyed `'tasks'`.
- Produces: nothing new. `scheduleTask(taskId, date, aimMin, opts?): boolean` is unchanged.
- `actions.addTask(title: string, date?: string | null, goalId?: string | null, estimateMin?: number): void` — `src/state/store.ts:1710`. Called with one argument it creates a loose, undated, unestimated task.

- [ ] **Step 1: Write the failing tests**

Add to `src/state/store.test.ts`, immediately after the Task 1 tests.

```ts
    it('scheduleTask arms an undo for a booking with no blockId', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addTask('Watch roblox');
      const id = getState().tasks[0].id;

      actions.scheduleTask(id, '2026-07-15', 600);
      expect(getState().pendingUndo?.label).toBe('Scheduled "Watch roblox"');

      actions.undoLastDelete();

      expect(getState().tasks[0].blocks).toBeUndefined();
    });

    it('scheduleTask stays silent when a drag moves one existing bar', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addTask('T', null, null, 60);
      const id = getState().tasks[0].id;
      actions.scheduleTask(id, '2026-07-15', 600);
      const blockId = getState().tasks[0].blocks![0].id;

      actions.scheduleTask(id, '2026-07-15', 660, { blockId });

      expect(getState().tasks[0].blocks![0].startMin).toBe(660);
      expect(getState().pendingUndo).toBeNull();
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --config vitest.config.ts src/state/store.test.ts -t "scheduleTask arms an undo"`

Expected: FAIL — `expected undefined to be 'Scheduled "Watch roblox"'`.

- [ ] **Step 3: Hoist the next slice, then branch**

`scheduleTask` builds its next slice inline inside the `setAndPersist` call, so it has to be hoisted to a `const` before `withUndo` can take it. Replace:

```ts
    setAndPersist({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const next = { ...t, date };
        if (opts.blockId) replaceBlock(next, opts.blockId, { date, startMin });
        else if (opts.mode === 'add') addBlock(next, makeBlock(date, startMin, durationMin));
        else setOnlyBlock(next, makeBlock(date, startMin, durationMin));
        return next;
      }),
    });
    return true;
```

with:

```ts
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const next = { ...t, date };
      if (opts.blockId) replaceBlock(next, opts.blockId, { date, startMin });
      else if (opts.mode === 'add') addBlock(next, makeBlock(date, startMin, durationMin));
      else setOnlyBlock(next, makeBlock(date, startMin, durationMin));
      return next;
    });
    // See `scheduleNode`: a drag of one bar is direct manipulation and stays
    // silent; every other route books from a distance and gets a way back.
    if (opts.blockId) setAndPersist({ tasks });
    else withUndo(`Scheduled "${task.title}"`, 'tasks', tasks);
    return true;
```

`task` is already in scope — the function reads it at the top for its unknown-id guard.

- [ ] **Step 4: Run to verify pass**

Run: `npm test && npx tsc -b`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(schedule): the task twin of the booking undo"
```

---

### Task 3: Today's proposal row offers the way back

**Files:**
- Test: `src/views/Today.freeTime.test.tsx` — add to the existing `describe('the free-time offer', ...)` block
- Read for context: `src/views/Today.tsx:107-108` (the `place` handler), `src/App.tsx:530-548` (the toast markup, not mounted by this file)

**Interfaces:**
- Consumes: the behaviour Tasks 1 and 2 added. No production code changes here — this pins the user-visible outcome the whole change exists for.
- Produces: nothing.
- `mountToday(over?)` — the file's own helper at line 65. It seeds the db mocks, calls `initStore()`, renders `Today`, and returns the store module (so `store.getState()` and `store.actions` are both available). Its default `goals` fixture is one project, `Thesis`, with a single 60-minute leaf `Draft the intro`. The clock is Wednesday 2026-07-15 10:00 and availability is 09:00–17:00 every day.
- Proposal rows are buttons whose accessible name is `Plan “<title>” today` — **curly** quotes, unlike the undo label's straight ones.

- [ ] **Step 1: Write the test**

Add to `src/views/Today.freeTime.test.tsx`, directly after the test named `'books the step at the next free minute, and the row leaves'`.

```tsx
  /**
   * The row IS the button, so there is no way to touch this zone without
   * booking something. A press you did not mean used to cost a trip to Plan.
   */
  it('a booking made by accident can be taken back', async () => {
    const store = await mountToday();

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Draft the intro” today' }).click();
    });
    expect(store.getState().pendingUndo?.label).toBe('Scheduled "Draft the intro"');

    await act(async () => {
      store.actions.undoLastDelete();
    });

    // Unplaced again, so `backlogGroups` re-includes it and the offer returns.
    expect(blocksOf(store.getState().goals[0].nodes[0])).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Plan “Draft the intro” today' })).toBeTruthy();
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --config vitest.config.ts src/views/Today.freeTime.test.tsx`

Expected: PASS. This is a characterization test — Tasks 1 and 2 already changed the store, so it passes on arrival.

- [ ] **Step 3: Prove the test is not vacuous**

A test that never failed has not been shown to test anything. In `src/state/store.ts`, temporarily change the `scheduleNode` branch back to unconditional:

```ts
    setAndPersist({ goals });          // TEMPORARY — revert immediately
```

Run: `npx vitest run --config vitest.config.ts src/views/Today.freeTime.test.tsx`

Expected: FAIL on `expected undefined to be 'Scheduled "Draft the intro"'`.

Then restore the branch from Task 1 Step 3 and re-run. Expected: PASS.

Confirm nothing of the temporary edit survived: `git diff src/state/store.ts` must be empty.

- [ ] **Step 4: Commit**

```bash
git add src/views/Today.freeTime.test.tsx
git commit -m "test(today): the free-time offer's row can be taken back"
```

---

### Task 4: The comment and the spec this makes false

**Files:**
- Modify: `src/views/plan/sidebar/Backlog.tsx:81-84`
- Modify: `docs/superpowers/specs/2026-08-09-today-free-time-design.md:76-78`
- Modify: `CLAUDE.md` — the invariant bullet beginning `**A task's placements are a LIST of `WorkBlock`, held inside the node or task.**`

**Interfaces:**
- Consumes: nothing. Documentation and comments only.
- Produces: nothing.

- [ ] **Step 1: Fix the Backlog comment**

Its conclusion still holds — an invisible mode must be visible while it is active — but its justification is now false. In `src/views/plan/sidebar/Backlog.tsx`, replace:

```
      // in an invisible mode where `2` schedules onto Tuesday instead of
      // switching to Goals, and `scheduleNode` has no undo. The mode has to be
      // visible for as long as it is active.
```

with:

```
      // in an invisible mode where `2` schedules onto Tuesday instead of
      // switching to Goals. That arms an undo now, but a mode still has to be
      // visible for as long as it is active — an undo is a way back, not a
      // warning, and it expires.
```

- [ ] **Step 2: Amend the free-time spec**

In `docs/superpowers/specs/2026-08-09-today-free-time-design.md`, replace:

```
- Success needs no toast. The item leaves the proposal (it is placed, so
  `backlogGroups` drops it) and reappears above in Now or Rest of today. The
  movement up the page is the feedback.
```

with:

```
- Success needs no ANNOUNCEMENT. The item leaves the proposal (it is placed, so
  `backlogGroups` drops it) and reappears above in Now or Rest of today. The
  movement up the page is the feedback.
- **Amended 2026-08-11** (see `2026-08-11-schedule-undo-design.md`): a toast does
  appear, carrying Undo. Because the whole row is the button, there is no way to
  touch this zone without booking something, so the press needs a way back. The
  toast is the handle, not the announcement.
```

- [ ] **Step 3: Add the invariant to CLAUDE.md**

Append to the end of the bullet that begins `**A task's placements are a LIST of `WorkBlock`, held inside the node or task.**`:

```
  **A booking made from a distance arms an undo; direct manipulation does not.**
  `scheduleNode`/`scheduleTask` call `withUndo` unless `opts.blockId` is present
  — `blockId` names the one bar a drag is moving, and a bar you watched land is
  a bar you can drag back, which is why `resizeNode`/`resizeTask` are silent
  too. Everything else — Today's proposal row, the backlog's `1`-`7` keypress,
  `ScheduleMenu`, `TaskPage`'s add-a-sitting — books something the user did not
  see arrive, and on Today the row IS the button, so a stray press must be
  reversible. The snapshot is the whole slice because one write sets both the
  block and the `plannedWeek` commitment.
```

- [ ] **Step 4: Run the suite**

`designScale.test.ts` gates the build on literal hexes and stray type scales. A comments-and-docs task should not trip it, but the suite is the gate.

Run: `npm test && npx tsc -b`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/sidebar/Backlog.tsx docs/superpowers/specs/2026-08-09-today-free-time-design.md CLAUDE.md
git commit -m "docs(schedule): the comment and the spec that the undo makes false"
```

---

## Manual verification

After Task 4, before opening a PR. Run `npm run dev` and open Today on a day with free time and at least one backlog candidate.

- [ ] Click a proposal row. The row leaves the offer, the item appears above, and a toast reads `Scheduled "<title>"` with an Undo button.
- [ ] Press Undo. The item returns to the offer and leaves the calendar.
- [ ] Repeat, pressing `⌘Z` instead of clicking. Same result.
- [ ] Click a row, wait 6 seconds. The toast is gone, but `⌘Z` still reverses it — the timer hides the toast, not the entry (`store.ts:632`).
- [ ] Click a row, then tick a checkbox, then press `⌘Z`. It undoes the tick, not the booking — the sweep retired the booking's entry, which is the existing rule and not a regression.
- [ ] On Plan, drag an existing bar from 9am to 11am. No toast.
- [ ] On Plan, drag an item from the backlog rail onto a day. Toast with Undo.
- [ ] On Plan, resize a bar. No toast.
- [ ] Schedule onto a full day so it refuses. The refusal toast appears with **no** Undo button beside it.
