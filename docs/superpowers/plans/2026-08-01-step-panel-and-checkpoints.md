# Step Panel and Checkpoints Implementation Plan (2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a step its own detail panel, then fold `Milestone` into a `checkpoint` flag on `GoalNode`.

**Architecture:** Part A adds `StepPanel` beside the tree in the Steps tab, driven by the `openStepId` that plan 1 already maintains. It surfaces `start`/`deadline`/`plannedWeek`/`estimateMin` — fields `GoalNode` has always carried with nowhere to show them. Part B then deletes the `Milestone` type, replacing it with `GoalNode.checkpoint`, and migrates existing data through the snapshot-and-done-flag pattern `migrateSlots` established.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Dexie, Vitest.

**Source spec:** `docs/superpowers/specs/2026-08-01-project-page-and-notes-design.md` Part 2.

**This is plan 2 of 3.** Plan 1 (`2026-08-01-project-page.md`) has landed — the project page, its tabs, and `openStepId` all exist. Plan 3 (notes editor and image assets) is written after this lands.

**Part A ships alone.** If checkpoints are deferred, the step panel is still a complete, useful change. Part B is the only part that touches stored data.

## Global Constraints

- Run `npm test` and `npx tsc -b` before every commit (`CLAUDE.md`, Conventions).
- Visual identity is locked. No new colours, no literal hex, no arbitrary `text-[Nrem]` — `designScale.test.ts` fails the build on all three.
- Hover-revealed controls use `.quiet-control`, never a hand-rolled `opacity-0 group-hover:opacity-100`. It needs a literal `group` ancestor (`group/name` does not match).
- Row-level modifier clicks are caught in the capture phase. Component tests must click the child a person actually hits, never the row element.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`. Views never call `db` directly.
- Deletes and any edit that discards user data must be undoable via `scheduleUndo`.
- Bulk edits are ONE undoable write, never a loop over the single-node action.
- `GoalTree.tsx` has exactly one consumer (`src/views/project/StepsTab.tsx`). Verified — changes to it cannot affect another surface.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/views/project/StepPanel.tsx` (create) | One step's detail: title, checkpoint, span, plan, estimate, logged time |
| `src/components/GoalTree.tsx` (modify) | The `◈` opener and the persistent `◆` checkpoint badge |
| `src/views/project/StepsTab.tsx` (modify) | Two-column layout; panel below `md` becomes a sheet |
| `src/state/store.ts` (modify) | `openStep`/`closeStep`, `toggleCheckpoint`; delete the three milestone actions |
| `src/lib/checkpoints.ts` (create) | Pure: checkpoint dates, `checkpointWithin`, milestone→node conversion |
| `src/lib/migrateCheckpoints.ts` (create) | The one-time data migration |
| `src/db/types.ts` (modify) | `GoalNode.checkpoint`; delete `Milestone` and `Goal.milestones` |
| `src/db/db.ts` (modify) | Migration done-flag + snapshot, mirroring the slot migration |
| `src/lib/plan.ts` (modify) | `milestoneWithin` → `checkpointWithin`; verdict rename |
| `src/lib/roadmap.ts` (modify) | `milestone-unplanned` → `checkpoint-unplanned`; date collection |
| `src/views/timeline/GoalRow.tsx` (modify) | `◆` markers read checkpoint nodes |
| `src/views/project/NotesTab.tsx` (modify) | Delete `MilestonesSection` |
| `src/lib/goalImport.ts` (modify) | Drop `milestones` from the import schema |

---

# PART A — The step panel

## Task 1: Store — opening and closing a step

**Files:**
- Modify: `src/state/store.ts` (beside `setProjectTab`)
- Test: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `openStepId`, `openProject`, `closeProject` (plan 1).
- Produces: `openStep(nodeId: string): void`, `closeStep(): void`.

`openStepId` already exists, is set by `openProject`, cleared by `closeProject`/`setView`/node deletion, and is read by `StepsTab` for the subtask modal's default. This task adds the two actions that let the tree drive it.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('openProject node focus (T8)', …)` block in `src/state/store.test.ts`:

```ts
  it('openStep selects a node without disturbing the page or the tab', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp');
    actions.setProjectTab('notes');

    actions.openStep('leaf');
    const s = getState();
    expect(s.openStepId).toBe('leaf');
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    // Opening a step is a selection, not a navigation: it must not yank the
    // user back to another tab.
    expect(s.projectTab).toBe('notes');
    // And it is NOT a pulse — that belongs to arriving from elsewhere.
    expect(s.focusNodeId).toBeNull();
  });

  it('closeStep clears only the selection', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp', 'leaf');
    actions.closeStep();
    const s = getState();
    expect(s.openStepId).toBeNull();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
  });

  it('openStep ignores an unknown node id', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp');
    actions.openStep('ghost');
    expect(getState().openStepId).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/state/store.test.ts -t "openStep"`
Expected: FAIL — `actions.openStep is not a function`.

- [ ] **Step 3: Add the actions**

In `src/state/store.ts`, directly after `clearFocusNode`:

```ts
  /**
   * Select a step for the detail panel.
   *
   * Distinct from `openProject(goalId, nodeId)`: that is an ARRIVAL, and it
   * pulses the row and forces the steps tab because the user came from
   * somewhere else. This is a selection made by someone already on the page,
   * so it changes nothing but the selection.
   */
  openStep(nodeId: string) {
    if (!findNodePath(state.goals, nodeId)) return;
    set({ openStepId: nodeId });
  },

  closeStep() {
    if (state.openStepId === null) return;
    set({ openStepId: null });
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/state/store.test.ts -t "openStep"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the suite and typecheck**

Run: `npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(store): add openStep and closeStep"
```

---

## Task 2: The `◈` opener on a step row

**Files:**
- Modify: `src/components/GoalTree.tsx` (the trailing control cluster, after the `✎` rename button around line 741)
- Test: `src/components/GoalTree.stepPanel.test.tsx` (create)

**Interfaces:**
- Consumes: `openStep` (task 1).
- Produces: a `◈` button on every row, labelled `Open details for "<title>"`.

**No existing gesture may be reassigned.** Plain click still toggles done (`GoalTree.tsx:458`), double-click still renames, ⌘/⇧-click still selects through the capture phase. The panel gets its own control, placed between `✎` and `+ sub`, following the exact pattern those two already use: `type="button"`, `tabIndex={-1}`, `.quiet-control`, and `e.stopPropagation()` in the handler.

- [ ] **Step 1: Write the failing test**

Create `src/components/GoalTree.stepPanel.test.tsx`. Copy the `vi.hoisted` db mock block, the `tabLock` mock and the `matchMedia`/`scrollIntoView` stubs from `src/components/GoalTree.selection.test.tsx` verbatim — that file is the closest existing harness.

```tsx
// @vitest-environment jsdom
// … mocks copied from GoalTree.selection.test.tsx …

describe('opening a step from its row', () => {
  it('the ◈ control selects that step and nothing else', async () => {
    const { store, user } = await mountTree();
    const before = store.getState().goals[0].nodes[0].done;

    await user.click(screen.getByRole('button', { name: 'Open details for "Alpha"' }));

    expect(store.getState().openStepId).toBe('a');
    // The click must not have leaked to the row's toggle.
    expect(store.getState().goals[0].nodes[0].done).toBe(before);
  });

  it('a plain row click still toggles done, not the panel', async () => {
    const { store, user } = await mountTree();

    await user.click(screen.getByText('Alpha'));

    expect(store.getState().openStepId).toBeNull();
  });
});
```

Adjust the node ids and titles to whatever `mountTree`'s fixture uses. Note the second test clicks the **title span**, which stops propagation — per `CLAUDE.md`, click the child a person actually hits.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/GoalTree.stepPanel.test.tsx`
Expected: FAIL — no button with that accessible name.

- [ ] **Step 3: Add the control**

In `src/components/GoalTree.tsx`, immediately BEFORE the `✎` rename button:

```tsx
        {/* Open the detail panel. `GoalNode` has carried `start`, `deadline`,
            `plannedWeek` and `estimateMin` for a long time with almost nowhere
            to show them; this is that place. It is a separate control rather
            than a row click because the row click is the completion gesture,
            and reassigning the single action that moves every number in the
            product would be a bad trade for a disclosure affordance. */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Open details for "${n.title}"`}
          title="Details"
          className="quiet-control text-faint text-compact flex-shrink-0 rounded-[4px] hover:text-accent hover:bg-hover"
          onClick={(e) => {
            e.stopPropagation();
            actions.openStep(n.id);
          }}
        >
          ◈
        </button>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/GoalTree.stepPanel.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/GoalTree.tsx src/components/GoalTree.stepPanel.test.tsx
git commit -m "feat(tree): add the step-detail opener"
```

---

## Task 3: `StepPanel`

**Files:**
- Create: `src/views/project/StepPanel.tsx`
- Test: `src/views/project/StepPanel.test.tsx`

**Interfaces:**
- Consumes: `openStep`/`closeStep` (task 1); existing actions `renameNode`, `setNodeDates`, `setNodeEstimate`, `unscheduleNode`, `logSession`, `clearSessionsFor`.
- Produces:

```ts
export function StepPanel({ goal, node, actions }: {
  goal: Goal;
  node: GoalNode;
  actions: ReturnType<typeof useAppStore>['actions'];
}): JSX.Element
```

**Span and plan are different things and the panel must say so.** `start`/`deadline` are a *span* — the window the work belongs to, shown on the Timeline. `plannedWeek`/`plannedDay` are a *plan* — a commitment in a specific week. `docs/audits/2026-07-22-usability-audit.md` #4 records that "span ≠ plan is never explained anywhere". Two labelled sections, never merged.

**Containers versus leaves.** `estimateMin` and logged time are LEAVES only, matching `setNodeEstimate`'s own guard and the tree's rendering — a container's duration is the sum of its children's. A container's panel shows title, span and its rolled-up percentage, and omits the estimate and time controls entirely rather than disabling them.

- [ ] **Step 1: Write the failing test**

Create `src/views/project/StepPanel.test.tsx`, using the same harness shape as `src/views/project/Project.progress.test.tsx` (hoisted db mocks, `tabLock` mock, `matchMedia` stub, dynamic store import after `vi.resetModules()`):

```tsx
describe('StepPanel', () => {
  it('shows the step title and its span, labelled as a span', async () => {
    const store = await mountPanel(leafWithDates);
    expect(screen.getByRole('heading', { name: 'Wire up auth' })).toBeTruthy();
    expect(screen.getByText(/Span/i)).toBeTruthy();
    expect(screen.getByLabelText('Span start')).toBeTruthy();
  });

  it('labels a week commitment as a plan, separately from the span', async () => {
    await mountPanel(leafPlannedThisWeek);
    expect(screen.getByText(/Plan/i)).toBeTruthy();
  });

  it('edits the estimate through the shared control', async () => {
    const store = await mountPanel(leafWithDates);
    // EstimateControl's own accessible name is derived from the label prop.
    expect(screen.getByLabelText(/Estimate for "Wire up auth"/i)).toBeTruthy();
  });

  it('omits estimate and logged time on a container', async () => {
    await mountPanel(containerNode);
    expect(screen.queryByLabelText(/Estimate for/i)).toBeNull();
    expect(screen.queryByLabelText(/Log time for/i)).toBeNull();
  });

  it('closes with the close button', async () => {
    const store = await mountPanel(leafWithDates);
    fireEvent.click(screen.getByRole('button', { name: 'Close step details' }));
    expect(store.getState().openStepId).toBeNull();
  });
});
```

Read `src/components/EstimateControl.tsx` and `src/components/LogTimeControl.tsx` first and use their REAL accessible names in the assertions rather than the approximations above.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/views/project/StepPanel.test.tsx`
Expected: FAIL — cannot resolve `./StepPanel`.

- [ ] **Step 3: Write `StepPanel.tsx`**

Build it from primitives already in the repo — `InlineEdit`, `DateField`, `EstimateControl`, `LogTimeControl`, `loggedForNode` — and reuse `ProjectHeader`'s `SectionLabel` styling (`text-meta font-[550] uppercase tracking-[0.08em] text-muted`) so the panel reads as part of the same system. Required contents:

| Section | Content |
|---|---|
| Header | Title via `InlineEdit`, wrapped in an `h2`; a `Close step details` button |
| — | Checkpoint toggle — **add in Part B, task 7. Omit for now.** |
| Span | Two `DateField`s, `Span start` / `Span end`, committing through `actions.setNodeDates(goal.id, node.id, start, deadline)` |
| Plan | If `plannedWeek`: the week (and `plannedDay` if present) as text, plus an `Unschedule` button calling `actions.unscheduleNode(goal.id, node.id)`. If absent: "Not planned — use the Plan view to commit this to a week." |
| Estimate | Leaves only. `EstimateControl` wired to `actions.setNodeEstimate(node.id, minutes)` |
| Time logged | Leaves only. `LogTimeControl` with `loggedForNode(sessions, node.id)`, `onLog={(m) => actions.logSession('step', node.id, m)}`, `onClear={() => actions.clearSessionsFor('step', node.id)}` |
| Progress | Containers only: `Math.round(nodePct(node))%` |

`setNodeDates` takes two required strings. Clearing one date must therefore go through whatever the existing signature supports — read the action before wiring the DateFields, and if it cannot express "clear", state that in your report rather than widening the action in this task.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/views/project/StepPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/project/StepPanel.tsx src/views/project/StepPanel.test.tsx
git commit -m "feat(project): add the step detail panel"
```

---

## Task 4: Put the panel beside the tree

**Files:**
- Modify: `src/views/project/StepsTab.tsx`, `src/views/Project.tsx`
- Test: `src/views/project/Project.progress.test.tsx`

**Interfaces:**
- Consumes: `StepPanel` (task 3), `openStepId` (plan 1).
- Produces: no new exports.

`StepsTab` already receives `openStepId`. When it names a node in this goal, render `StepPanel` beside the tree.

- [ ] **Step 1: Write the failing test**

Add to `src/views/project/Project.progress.test.tsx`:

```tsx
  it('shows the step panel when a step is open, and the tree stays visible', async () => {
    const store = await mountPage();
    store.actions.openStep('n1');
    // re-render happens through the store subscription
    expect(await screen.findByRole('heading', { name: 'Define the topics' })).toBeTruthy();
    expect(screen.getByText('Order the topics')).toBeTruthy(); // tree still there
  });

  it('hides the panel when the step is closed', async () => {
    const store = await mountPage();
    store.actions.openStep('n1');
    store.actions.closeStep();
    expect(screen.queryByRole('button', { name: 'Close step details' })).toBeNull();
  });

  it('drops the panel when its step is deleted', async () => {
    const store = await mountPage();
    store.actions.openStep('n1');
    store.actions.removeNode('n1');
    expect(store.getState().openStepId).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close step details' })).toBeNull();
  });
```

The third test guards the pointer-clearing that plan 1's repair added; it must keep working now that something renders from it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/views/project/Project.progress.test.tsx -t "step panel"`
Expected: FAIL.

- [ ] **Step 3: Implement the layout**

In `StepsTab`, find the open node with `findNodePath`-style lookup over `goal.nodes` (there is an existing tree helper — read `src/lib/tree.ts` and reuse rather than writing a new walker). When found, wrap the tree and the panel in a flex row: the tree takes the remaining width, the panel is `w-[300px] flex-none` with a left border.

Below `md`, the panel must become a full-width sheet rather than a 300px column, so the tree is not crushed on a phone. Use the existing `useMediaQuery` hook — `src/views/Goals.tsx` already uses it for exactly this kind of fold.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/views/project/Project.progress.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/project/StepsTab.tsx src/views/Project.tsx src/views/project/Project.progress.test.tsx
git commit -m "feat(project): render the step panel beside the tree"
```

---

## Task 5: Escape closes the panel before the page

**Files:**
- Modify: `src/lib/appKeyboard.ts`, `src/App.tsx`
- Test: `src/lib/appKeyboard.test.ts`

Spec §1.1: "When the step panel is open, Escape closes the panel first." Plan 1 built `shouldLeaveProjectPage(command, view, modalOpen)`; it now needs to know about the panel.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/appKeyboard.test.ts`:

```ts
  it('does not leave the page while a step panel is open', () => {
    expect(shouldLeaveProjectPage('close-drawer', 'project', false, true)).toBe(false);
  });

  it('leaves the page once the panel is closed', () => {
    expect(shouldLeaveProjectPage('close-drawer', 'project', false, false)).toBe(true);
  });
```

Plus a sibling predicate:

```ts
  it('closes the step panel on Escape when one is open and no modal is up', () => {
    expect(shouldCloseStepPanel('close-drawer', 'project', false, true)).toBe(true);
    expect(shouldCloseStepPanel('close-drawer', 'project', true, true)).toBe(false); // modal wins
    expect(shouldCloseStepPanel('close-drawer', 'project', false, false)).toBe(false);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/appKeyboard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add a fourth `stepPanelOpen: boolean` parameter to `shouldLeaveProjectPage`, returning `false` when it is true. Add `shouldCloseStepPanel` with the same signature, true only when a panel is open, the command is `close-drawer`, and no modal is up. Update the existing call in `App.tsx` to pass `openStepId !== null`, and add the panel branch before it.

Escape's order of precedence, top down: modal → step panel → project page. Write that ordering as a comment where the branches sit.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/appKeyboard.test.ts && npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/appKeyboard.ts src/lib/appKeyboard.test.ts src/App.tsx
git commit -m "feat: Escape closes the step panel before the page"
```

**Part A is complete and shippable here.**

---

# PART B — Checkpoints

## Task 6: `src/lib/checkpoints.ts`

**Files:**
- Create: `src/lib/checkpoints.ts`, `src/lib/checkpoints.test.ts`
- Modify: `src/db/types.ts`

**Interfaces:**
- Produces:

```ts
export function checkpointDates(g: Goal): string[];
export function checkpointWithin(g: Goal, days: number, today: string): boolean;
export function nextCheckpoint(g: Goal, today: string): { title: string; date: string } | null;
export function milestonesToCheckpointNodes(g: Goal): GoalNode[];
```

A checkpoint's date is its `deadline`. The migration sets `start` and `deadline` to the same day, so a checkpoint is a zero-length span — which is exactly what a marker is.

- [ ] **Step 1: Add the type change**

In `src/db/types.ts`, add to `GoalNode`:

```ts
  /**
   * A dated marker the user is working TOWARD — an exam, a submission, a demo.
   *
   * Unlike the `Milestone` this replaces, a checkpoint is a real node, so it
   * counts in the pct roll-up and can be ticked. That is deliberate: a marker
   * that never moved a number was the complaint that retired `Milestone`.
   * Its date is its `deadline`; the migration writes `start === deadline`.
   */
  checkpoint?: boolean;
```

Leave `Milestone` and `Goal.milestones` in place for now — task 9 removes them, after every consumer has moved.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/checkpoints.test.ts` covering:
- `checkpointDates` returns the `deadline` of every checkpoint node at any depth, ignoring non-checkpoints and checkpoints with no deadline.
- `checkpointWithin` is inclusive at both ends of `today .. today+days`, and false for a checkpoint in the past.
- `checkpointWithin` ignores DONE checkpoints — a marker you have already hit is not "soon".
- `nextCheckpoint` returns the earliest open checkpoint on or after today, or null.
- `milestonesToCheckpointNodes` maps each `Milestone` to `{ id, title, checkpoint: true, done: false, start: m.date, deadline: m.date }`, sorted by date, and returns `[]` when there are none.

- [ ] **Step 3: Run to verify they fail, then implement, then verify they pass**

Run: `npx vitest run src/lib/checkpoints.test.ts`

Implement with a depth-first walk. There is an existing leaf walker in `src/lib/plan.ts` (`walkLeaves`) — read it and reuse if it fits.

**Decision, already taken: only a leaf may be a checkpoint.** A checkpoint is a thing you tick, and containers have no `done` — a container checkpoint could never be reached, which is the dead-marker problem `Milestone` was retired for. This is enforced in three places, all of which are in scope:

1. `toggleCheckpoint` refuses containers (task 7).
2. `addChild` must `delete n.checkpoint` when it converts a leaf into a container, exactly as it already deletes `done`, `doneAt` and `estimateMin`. **This is a data-discarding edit and `CLAUDE.md` requires it to be undoable** — `addChild` already arms an undo entry for the same reason; extend that snapshot rather than adding a second one.
3. `milestonesToCheckpointNodes` only ever produces leaves.

Write the leaf-only rule into the `checkpoint` doc comment in `types.ts`.

**Behaviour change to state plainly:** `checkpointWithin` ignores DONE checkpoints, where `milestoneWithin` had no notion of done — a `Milestone` could never be completed. So a project whose only near-term marker has been ticked will now stop showing "checkpoint soon", where before it warned forever. That is the intended improvement, but it IS a change in when the board warns, and task 8's tests must assert it rather than let it slip through.

- [ ] **Step 4: Commit**

```bash
git add src/lib/checkpoints.ts src/lib/checkpoints.test.ts src/db/types.ts
git commit -m "feat(lib): add checkpoint predicates"
```

---

## Task 7: `toggleCheckpoint` and the panel control

**Files:**
- Modify: `src/state/store.ts`, `src/views/project/StepPanel.tsx`, `src/components/GoalTree.tsx`
- Test: `src/state/store.test.ts`, `src/views/project/StepPanel.test.tsx`

**Interfaces:**
- Produces: `toggleCheckpoint(nodeId: string): void`.

- [ ] **Step 1: Write the failing tests**

In `src/state/store.test.ts`:
- toggling on a leaf sets `checkpoint: true`; toggling again removes the field entirely (not `false` — absent means absent, matching how `done` and `estimateMin` are handled).
- toggling a CONTAINER is refused and writes nothing.
- a checkpoint leaf still counts in `goalPct` and `leafCount`, and ticking it moves the percentage.

That last assertion is the point of the whole change and must be explicit.

- [ ] **Step 2: Implement**

`toggleCheckpoint` refuses containers, mirroring `setNodeEstimate`'s guard. It is an ordinary `setAndPersist` write and needs no undo entry — it discards no user data, unlike `indentNode` or `addChild`.

**Also close the leaf-only invariant in `addChild` (`src/state/store.ts:606-628`).** Converting a checkpoint leaf into a container must drop the flag, or the tree holds a container checkpoint that `toggleCheckpoint` would refuse to create. Two edits, both inside the existing logic — do not add a second undo entry:

- Add `checkpoint` to the `carried` predicate at line 627, so the conversion arms undo when a checkpoint is about to be lost:

```ts
    const carried = converts
      && (node.done === true || node.plannedWeek !== undefined
        || node.estimateMin !== undefined || node.checkpoint === true);
```

- Add `delete node.checkpoint;` beside the existing `delete`s that run on conversion.

Add a store test: adding a child to a checkpoint leaf clears `checkpoint`, arms an undo, and undoing restores both the leaf and its flag.

Add to `StepPanel` a checkpoint toggle in the header region, leaves only, labelled `Mark "<title>" as a checkpoint` / `Remove checkpoint from "<title>"`.

Add to `GoalTree`'s row a **persistent** `◆` badge when `n.checkpoint` — not a `.quiet-control`. A checkpoint that only appears on hover is a marker you cannot see, which is the failure mode being fixed. Use `text-accent`, matching the existing markers in `GoalRow.tsx:186`.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc -b && npm test`

```bash
git add -u && git commit -m "feat: checkpoints on steps"
```

---

## Task 8: Move every milestone consumer to checkpoints

**Files:**
- Modify: `src/lib/plan.ts`, `src/lib/roadmap.ts`, `src/views/timeline/GoalRow.tsx`
- Test: `src/lib/plan.test.ts`, `src/lib/roadmap.test.ts`

**This is the task the spec under-specified.** Milestones are not only `◆` markers; they drive three separate signals. Every one must move, or deleting `Milestone` silently deletes a board warning:

| Site | Now | Becomes |
|---|---|---|
| `plan.ts:186` | `MILESTONE_SOON_DAYS = 14` | `CHECKPOINT_SOON_DAYS = 14` |
| `plan.ts:193` | `milestoneWithin` | delete; use `checkpointWithin` from `src/lib/checkpoints.ts` |
| `plan.ts:232,242,265` | `'milestone-soon'` verdict | `'checkpoint-soon'`, same position in the priority order |
| `plan.ts:404` | label `Milestone in Nd` from `g.milestones` | `Checkpoint in Nd` from `nextCheckpoint` |
| `roadmap.ts:69` | `milestoneWithin` | `checkpointWithin` |
| `roadmap.ts:20,70` | `'milestone-unplanned'` + copy | `'checkpoint-unplanned'`, `Checkpoint soon, nothing planned this week` |
| `roadmap.ts:139` | `g.milestones` dates into the timeline range | `checkpointDates(g)` |
| `GoalRow.tsx:182-192` | `◆` from `g.milestones` | `◆` from checkpoint nodes; tooltip `title · date` unchanged in shape |

- [ ] **Step 1: Update the tests first**

`src/lib/plan.test.ts` and `src/lib/roadmap.test.ts` already reference milestones. Rewrite those fixtures to use checkpoint nodes and rename the expected verdict strings. **Do not weaken an assertion to make it pass** — if a verdict no longer fires, that is a real behaviour change and must be reported, not absorbed.

- [ ] **Step 2: Run them, watch them fail, then make each change in the table above**

- [ ] **Step 3: Verify and commit**

Run: `npx tsc -b && npm test`

```bash
git add -u && git commit -m "refactor: milestone signals now read checkpoints"
```

---

## Task 9: The migration, and deleting `Milestone`

**Files:**
- Create: `src/lib/migrateCheckpoints.ts`, `src/lib/migrateCheckpoints.test.ts`
- Modify: `src/db/db.ts`, `src/db/types.ts`, `src/state/store.ts`, `src/lib/goalImport.ts`, `src/views/project/NotesTab.tsx`

**Follow the established precedent.** `migrateSlots.ts` plus `isSlotMigrationDone` / `saveSlotMigrationSnapshot` / `loadSlotMigrationSnapshot` / `markSlotMigrationDone` / `resetSlotMigration` in `db.ts` is the pattern for a one-time data migration in this codebase, including the write-once snapshot for recovery. Read all of it and mirror its shape and its guarantees.

- [ ] **Step 1: Write `migrateCheckpoints.test.ts` first**

Cover:
- Each `Milestone` becomes a root-level node with `checkpoint: true`, `done: false`, `start === deadline === m.date`.
- Migrated checkpoints are appended AFTER existing root nodes, in date order, so no existing step's position changes.
- The migration is **idempotent**: running it twice produces the same tree.
- A goal with no milestones is returned untouched (identity, so no needless write).
- The report counts goals and checkpoints converted.

- [ ] **Step 2: Implement the migration and wire it into `initStore`**

Mirror the slot migration exactly: snapshot before, migrate, mark done. It must run once per device and never again.

- [ ] **Step 3: Delete `Milestone`**

Remove: `Milestone` and `Goal.milestones` from `src/db/types.ts`; `addMilestone`/`updateMilestone`/`removeMilestone` from `src/state/store.ts` (around line 1638); `milestones` from `src/lib/goalImport.ts`'s schema, its sanitiser, and its documented example; `MilestonesSection` from `src/views/project/NotesTab.tsx`, leaving `NotesTab` rendering only the notes field.

Update the two stale comments at `store.ts:981` and `store.ts:1247` that still say "milestone".

- [ ] **Step 4: Update `CLAUDE.md`**

The Invariants section currently reads:

> `Milestone`s and node `start`/`deadline` are display/scheduling metadata only — they never affect the pct roll-up in `src/lib/pct.ts`.

Replace with a statement that node `start`/`deadline`/`plannedWeek`/`plannedDay`/`plannedStartMin`/`estimateMin` are scheduling metadata that never affect the roll-up, and that a **checkpoint is not metadata — it is a real node and it counts**, which is the deliberate difference from the `Milestone` it replaced.

Also update the pct.ts doc comment, which asserts "`Milestone`s never affect this."

- [ ] **Step 5: Verify**

Run: `npx tsc -b && npm test && npm run build`

Then run `grep -rn "ilestone" src` and confirm every remaining hit is prose describing the history, not live code.

- [ ] **Step 6: Manual check**

Run `npm run dev` and confirm, with a project that had milestones before the migration:
1. Old milestones appear as `◆` checkpoint steps at the end of the step list.
2. The project percentage changed, and the header states its basis.
3. The Timeline still draws `◆` markers at the right dates.
4. A checkpoint within 14 days with nothing planned still raises the board warning.
5. Export, then import that file, and confirm the checkpoints survive and no `milestones` key appears.

- [ ] **Step 7: Commit**

```bash
git add -A src/ CLAUDE.md && git commit -m "feat: fold milestones into checkpoints"
```

---

## Known consequences, accepted

1. **Existing percentages change once.** A 6-step project with 2 milestones becomes 0/8. This is the spec's decision (§2.3) and the audit's recommendation — "users expect hitting it to count."
2. **`goalPctBasis` may flip from `weighted` to `equal`** on fully-estimated projects, because migrated checkpoints carry no estimate. The basis is already disclosed beside the number, so the figure does not become misleading. A user can restore weighting by estimating the checkpoints.
3. **Step notes are not in this plan.** The panel gains its notes editor in plan 3; spec §2.1 lists it there.

## Self-review notes

| Spec requirement | Task |
|---|---|
| §2.1 panel opened by `◈`, no gesture reassigned | 2 |
| §2.1 panel shows span, plan, estimate, logged time | 3 |
| §2.1 span vs plan labelled distinctly (audit #4, #7) | 3 |
| §2.1 sheet below ~900px | 4 |
| §1.1 Escape closes the panel first | 5 |
| §2.2 `GoalNode.checkpoint`, `Milestone` deleted | 6, 7, 9 |
| §2.2 migration to dated checkpoint nodes | 9 |
| §2.2 Timeline `◆` reads the flag | 8 |
| §2.3 checkpoints count in the roll-up | 7 |
| §2.3 basis flip disclosed | accepted, no code needed |
| leaf-only invariant held through `addChild` | 6 (decision), 7 (enforcement) |

**Beyond the spec, and required:** the spec named only the `◆` markers as milestone consumers. `milestone-soon` (board attention) and `milestone-unplanned` (Timeline warning) are two more, and the timeline date range is a third. Task 8 exists because of them. Without it, deleting `Milestone` would silently remove a board warning users currently rely on.
