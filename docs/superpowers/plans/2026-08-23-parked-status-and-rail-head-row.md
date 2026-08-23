# Parked Status + Rail Head Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth leaf status `'parked'` ("not now, not waiting on anything") reachable from the tree, the task page, the board, the agent and the backlog rail; and make the first row of each backlog group a larger, bordered grab handle.

**Architecture:** `StepStatus` gains `'parked'`. `src/lib/status.ts` stays the one vocabulary. Parked moves ATTENTION only (queues, rail, advisor) and never the pct roll-up — exactly the `blocked` rule, minus `blockedOn`. Blocked-specific counts/verdicts stay blocked-only. The rail change is view-only in `Backlog.tsx`.

**Tech Stack:** React 19, TypeScript, Vitest (`npm test`), `npx tsc -b`. Spec: `docs/superpowers/specs/2026-08-23-parked-status-and-rail-head-row-design.md`.

## Global Constraints

- `pct.ts` is never touched; only `'done'` moves a number.
- `'todo'` is never written; `blockedOn` exists only while `status === 'blocked'`.
- No literal hex colours, no hand-rolled `uppercase`, no `border-dashed` (see `designScale.test.ts`). Use `.quiet-control` for hover-revealed row controls.
- Every status word comes from `STATUS_WORD`; never redeclare it.
- Run `npm test` and `npx tsc -b` before every commit.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK
  ```

---

### Task 1: The type and the vocabulary

**Files:**
- Modify: `src/db/types.ts:3`
- Modify: `src/lib/status.ts`
- Modify: `src/components/GoalTree.tsx:59-64` (`STATUS_BOX`)
- Modify: `src/components/StatusMark.tsx`
- Modify: `src/views/project/TaskPage.tsx:47` (`STATUS_ORDER`)
- Test: `src/lib/status.test.ts`

**Interfaces:**
- Produces: `StepStatus` includes `'parked'`; `STATUS_WORD.parked === 'parked'`; `containerStatus` returns `'parked'` when every open leaf is parked.

- [ ] **Step 1: Write the failing tests** — append inside `describe('containerStatus', …)` in `src/lib/status.test.ts`:

```ts
  it('is parked only when EVERY open leaf is parked', () => {
    expect(containerStatus(group(leaf({ status: 'parked' }), leaf({ status: 'done' })))).toBe('parked');
    expect(containerStatus(group(leaf({ status: 'parked' }), leaf()))).toBe('todo');
  });

  it('reads a mix of blocked and parked as todo — neither rule is met', () => {
    expect(containerStatus(group(leaf({ status: 'parked' }), leaf({ status: 'blocked' })))).toBe('todo');
  });
```

and a new describe at the end of the file:

```ts
describe('applyStatus → parked', () => {
  it('clears blockedOn and stores parked', () => {
    const n = applyStatus(leaf({ status: 'blocked', blockedOn: 'TA' }), 'parked', '2026-08-23');
    expect(n.status).toBe('parked');
    expect(n.blockedOn).toBeUndefined();
    expect(n.doneAt).toBeUndefined();
  });
});
```

(Import `applyStatus` from `./status` if the file does not already.)

- [ ] **Step 2: Run** `npx vitest run src/lib/status.test.ts` — Expected: FAIL (TS error: `'parked'` not assignable to `StepStatus`).

- [ ] **Step 3: Implement**

`src/db/types.ts:3`:
```ts
export type StepStatus = 'todo' | 'doing' | 'blocked' | 'parked' | 'done';
```

`src/lib/status.ts` — in `containerStatus`, after the blocked line:
```ts
  if (open.every((l) => stepStatus(l) === 'blocked')) return 'blocked';
  // Parked is "not now" rather than "waiting": a container whose every open
  // leaf is set aside is set aside. Checked AFTER blocked and as strictly —
  // one parked child beside a workable one is a workable container.
  if (open.every((l) => stepStatus(l) === 'parked')) return 'parked';
  return 'todo';
```
and in `STATUS_WORD`:
```ts
  blocked: 'blocked',
  parked: 'parked',
  done: 'done',
```
Update the `cycleStatus` comment's `default` line to read `// 'blocked', 'parked' and 'done' all land back on todo`. `applyStatus` needs no change — it already clears `blockedOn` for any non-blocked `next`.

`src/components/GoalTree.tsx` `STATUS_BOX`:
```ts
  blocked: 'border-warn bg-warn-tint',
  parked: 'border-faint',
  done: 'bg-accent border-accent',
```

`src/components/StatusMark.tsx` — replace the last line:
```tsx
  if (status === 'parked') return <IconCircle size={13} className="text-faint" />;
  return <IconCircle size={13} className={status === 'doing' ? 'text-accent' : ''} />;
```
Update its doc comment's first line to "Five states, three marks" and add: "`parked` is the ring in `faint`: set aside, neither stuck nor moving."

`src/views/project/TaskPage.tsx:47`:
```ts
const STATUS_ORDER: readonly StepStatus[] = ['todo', 'doing', 'blocked', 'parked', 'done'];
```

- [ ] **Step 4: Run** `npx vitest run src/lib/status.test.ts && npx tsc -b` — Expected: PASS, and tsc reports every remaining `Record<StepStatus, …>` that is now incomplete. Fix each by adding a `parked` entry with the obvious value (e.g. any status→class map). Do not add parked to `BOARD_COLUMNS` yet (Task 5).

- [ ] **Step 5: Run** `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/db/types.ts src/lib/status.ts src/lib/status.test.ts src/components/GoalTree.tsx src/components/StatusMark.tsx src/views/project/TaskPage.tsx
git commit -m "feat(status): 'parked' — a fifth leaf status, not now and not waiting"
```

---

### Task 2: Queues skip parked work

**Files:**
- Modify: `src/lib/tree.ts:50-66` (`firstOpenLeaf` comment only — logic already skips)
- Modify: `src/lib/plan.ts:405-431` (`nextOpenAction`)
- Test: `src/lib/tree.test.ts`, `src/lib/plan.test.ts`

**Interfaces:**
- Consumes: `StepStatus` with `'parked'` (Task 1).
- Produces: `nextOpenAction` returns `{ kind: 'open', title: 'All open tasks are blocked or parked' }` when open work exists, none is workable, and at least one leaf is parked.

- [ ] **Step 1: Failing tests.** In `src/lib/tree.test.ts` after the `'returns null when every open leaf is blocked'` test (~line 522):

```ts
  it('skips parked work like blocked, and returns null when nothing is workable', () => {
    expect(firstOpenLeaf([leaf('a', 'parked'), leaf('b')])?.id).toBe('b');
    expect(firstOpenLeaf([leaf('a', 'parked'), leaf('b', 'blocked')])).toBeNull();
  });
```

In `src/lib/plan.test.ts` beside the test at ~line 579 (copy its goal-building shape, giving the leaves `status: 'parked'` and `status: 'blocked'`):

```ts
  it('names parked work when it is why nothing is workable', () => {
    const g: Goal = { id: 'g', title: 'G', column: 0, nodes: [
      { id: 'a', title: 'A', status: 'parked' },
      { id: 'b', title: 'B', status: 'blocked' },
    ] };
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'open', title: 'All open tasks are blocked or parked' });
  });
```

- [ ] **Step 2: Run** `npx vitest run src/lib/tree.test.ts src/lib/plan.test.ts` — Expected: the plan test FAILS (it returns `'open'` with the parked leaf's title, because `todo` is empty but the function still reaches `pick`).

Wait — check: with `workable` empty, `pick` is `undefined`. Confirm actual failure output before implementing.

- [ ] **Step 3: Implement** in `src/lib/plan.ts` `nextOpenAction`, immediately after the `isFullyBlocked` early return:

```ts
  if (workable.length === 0) {
    // Open work exists and is not all blocked, yet nothing is doing/todo —
    // so something is parked. Same 'open' verdict as above, one word longer:
    // "unblock" is not the instruction when the thing set aside was set aside
    // on purpose.
    return { kind: 'open', title: 'All open tasks are blocked or parked' };
  }
```

In `src/lib/tree.ts` `firstOpenLeaf` doc comment, change "Blocked leaves are skipped entirely." to "Blocked and parked leaves are skipped entirely." and "ALL of it is blocked" to "ALL of it is blocked or parked".

- [ ] **Step 4: Run** `npx vitest run src/lib/tree.test.ts src/lib/plan.test.ts && npx tsc -b` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/tree.ts src/lib/tree.test.ts src/lib/plan.ts src/lib/plan.test.ts
git commit -m "feat(status): the queue skips parked work, and says so"
```

---

### Task 3: Rail and advisor drop parked work unless committed

**Files:**
- Modify: `src/lib/backlog.ts:152-157`
- Modify: `src/lib/executionAdvisor.ts:197`
- Test: `src/lib/backlog.test.ts`, `src/lib/executionAdvisor.test.ts`

**Interfaces:**
- Consumes: `'parked'` status.

- [ ] **Step 1: Failing tests.** In `src/lib/backlog.test.ts` inside `describe('backlogGroups', …)` (use the file's existing goal/task fixtures and `WEEK`/`TODAY` constants):

```ts
  it('drops a parked leaf, unless it carries a plannedWeek', () => {
    const g: Goal = { id: 'g', title: 'G', column: 0, nodes: [
      { id: 'p', title: 'Parked', status: 'parked' },
      { id: 'c', title: 'Committed', status: 'parked', plannedWeek: WEEK },
      { id: 'o', title: 'Open' },
    ] };
    const ids = backlogGroups([g], [], WEEK, TODAY).flatMap((grp) => grp.items.map((i) => i.id));
    expect(ids).toEqual(expect.arrayContaining(['c', 'o']));
    expect(ids).not.toContain('p');
  });
```

In `src/lib/executionAdvisor.test.ts`, inside the test at line 147, add a fifth goal:

```ts
    const parkedLeaf = goal({
      id: 'gp', title: 'Parked leaf', column: 0,
      nodes: [{ id: 'np', title: 'Set aside', status: 'parked', deadline: today, start: today }],
    });
```
include it in the `goals` array passed to `executionAdvice`, and assert alongside the existing ones:
```ts
    expect(titles).not.toContain('Set aside');
```
(Match how the test already collects titles — read the surrounding assertions and follow them.)

- [ ] **Step 2: Run** `npx vitest run src/lib/backlog.test.ts src/lib/executionAdvisor.test.ts` — Expected: FAIL, parked rows present.

- [ ] **Step 3: Implement.** `src/lib/backlog.ts` — replace the blocked line:

```ts
      // Blocked or parked work is not a queue you can work. Dropped, unless
      // committed — weekCapacity bills a plannedWeek step to "to place", and a
      // number you plan against must have a row beside it. Same exception a
      // parked PROJECT gets, just above.
      const s = stepStatus(n);
      if ((s === 'blocked' || s === 'parked') && n.plannedWeek === undefined) return;
```

`src/lib/executionAdvisor.ts:197`:
```ts
      const s = stepStatus(node);
      if (s === 'blocked' || s === 'parked') return false;
```

- [ ] **Step 4: Run** `npx vitest run src/lib/backlog.test.ts src/lib/executionAdvisor.test.ts src/lib/todayPlan.test.ts && npx tsc -b` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/backlog.ts src/lib/backlog.test.ts src/lib/executionAdvisor.ts src/lib/executionAdvisor.test.ts
git commit -m "feat(status): rail and advisor drop parked work unless committed"
```

---

### Task 4: Park / Unpark on the tree row (menu + `P`)

**Files:**
- Modify: `src/lib/rowActions.ts`
- Modify: `src/components/RowActions.tsx:44-62`
- Modify: `src/components/GoalTree.tsx` (~line 826, beside the `S` binding)
- Test: `src/lib/rowActions.test.ts`

**Interfaces:**
- Produces: `RowActionId` gains `'park'`; `RowActionContext` gains `isParked: boolean`.

- [ ] **Step 1: Failing tests.** In `src/lib/rowActions.test.ts` update `ctx` to include `isParked: false`, then add:

```ts
  it('offers Park on a leaf only, worded by its current state', () => {
    expect(ids(ctx({ isContainer: true }))).not.toContain('park');
    const off = rowActions(ctx({ isParked: false })).find((a) => a.id === 'park');
    const on = rowActions(ctx({ isParked: true })).find((a) => a.id === 'park');
    expect(off?.label).toBe('Park');
    expect(on?.label).toBe('Unpark');
    expect(off?.hint).toBe('P');
  });
```

- [ ] **Step 2: Run** `npx vitest run src/lib/rowActions.test.ts` — Expected: FAIL (tsc: `isParked` not in type).

- [ ] **Step 3: Implement.** `src/lib/rowActions.ts`:

```ts
export type RowActionId =
  | 'open' | 'add-task' | 'rename' | 'schedule' | 'estimate' | 'milestone'
  | 'park' | 'demand' | 'breakdown' | 'indent' | 'outdent' | 'delete';
```
In `RowActionContext` add after `isMilestone`:
```ts
  /** A leaf set aside. A container derives it and never sets it. */
  isParked: boolean;
```
In `rowActions`, inside the `if (!ctx.isContainer)` block after `milestone`:
```ts
    // Parking is a deliberate verb and not a step in the `S` cycle: cycling
    // through "not now" on the way to "blocked" would park things by accident.
    out.push({ id: 'park', label: ctx.isParked ? 'Unpark' : 'Park', hint: 'P', group: 1 });
```
Check `taskPageActions` (same file, below): it builds from a context too — pass `isParked` through and let `park` appear in the same group as `demand` there (the page has no park chip, so it is not a duplicate).

`src/components/RowActions.tsx` — context gains `isParked: node.status === 'parked',` and `run` gains:
```ts
      case 'park': actions.setNodeStatus(node.id, node.status === 'parked' ? 'todo' : 'parked'); return;
```
Check `TaskPage.tsx`'s action switch for the same `RowActionId` and add the identical case there.

`src/components/GoalTree.tsx` after the `S` handler:
```ts
    // P parks a leaf, or unparks one. Its own key rather than a stop on S's
    // cycle, for the reason rowActions.ts gives.
    if (plain && (e.key === 'p' || e.key === 'P') && !editing) {
      e.preventDefault();
      if (hasKids) return;
      actions.setNodeStatus(n.id, stepStatus(n) === 'parked' ? 'todo' : 'parked');
      return;
    }
```

- [ ] **Step 4: Run** `npm test && npx tsc -b` — Expected: PASS. (If `ShortcutsOverlay` lists tree keys, add `P — Park / unpark`.)

- [ ] **Step 5: Commit**
```bash
git add src/lib/rowActions.ts src/lib/rowActions.test.ts src/components/RowActions.tsx src/components/GoalTree.tsx src/views/project/TaskPage.tsx
git commit -m "feat(tree): Park / Unpark on the row menu and P"
```

---

### Task 5: Board column + agent protocol

**Files:**
- Modify: `src/lib/goalBoard.ts:22-27`
- Modify: `src/lib/agentProtocol.ts:181-185`
- Modify: `mcp/server.js:137-144`
- Modify: `src/lib/agentWrites.ts:216-219` (comment only)
- Test: `src/lib/goalBoard.test.ts`, `src/lib/agentProtocol.test.ts`

- [ ] **Step 1: Failing tests.** `src/lib/goalBoard.test.ts` — add:

```ts
describe('BOARD_COLUMNS', () => {
  it('shows every stored state — parked between blocked and done', () => {
    expect(BOARD_COLUMNS.map((c) => c.status)).toEqual(['todo', 'doing', 'blocked', 'parked', 'done']);
  });
});
```
`src/lib/agentProtocol.test.ts:42` — rename to `'accepts only the five statuses on set_status'` and add `'parked'` to the loop array. Add:
```ts
  it('refuses blockedOn on a parked request at the write, not the shape', () => {
    // Shape-valid: blockedOn is an optional string. agentWrites refuses it.
    expect(validAgentRequest({ tool: 'set_status', nodeId: 'n1', status: 'parked', blockedOn: 'x' })).toBe(true);
  });
```

- [ ] **Step 2: Run** `npx vitest run src/lib/goalBoard.test.ts src/lib/agentProtocol.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** `goalBoard.ts`:
```ts
  { status: 'blocked', title: 'Blocked', hint: 'Waiting on something else' },
  { status: 'parked', title: 'Parked', hint: 'Set aside, not now' },
  { status: 'done', title: 'Done', hint: 'Finished' },
```
Update its comment: "The columns are the five states the model actually stores."

`agentProtocol.ts` `set_status` case:
```ts
        && (req.status === 'todo' || req.status === 'doing' || req.status === 'blocked'
          || req.status === 'parked' || req.status === 'done')
```
`mcp/server.js`:
```js
    'Set a step to todo, doing, blocked, parked or done. Pass blockedOn to say what it is blocked by. Parked means set aside on purpose — it leaves the backlog and the day plan until unparked.',
    {
      nodeId: z.string(),
      status: z.enum(['todo', 'doing', 'blocked', 'parked', 'done']),
```
`agentProtocol.test.ts` pins `AGENT_TOOLS` text — update the fixture it compares against if it fails.

- [ ] **Step 4: Run** `npm test && npx tsc -b` — Expected: PASS. Check `BoardTab.tsx` renders five columns without a fixed-width assumption (grep for `grid-cols-4`; if present change to 5).

- [ ] **Step 5: Commit**
```bash
git add src/lib/goalBoard.ts src/lib/goalBoard.test.ts src/lib/agentProtocol.ts src/lib/agentProtocol.test.ts mcp/server.js src/views/project/BoardTab.tsx
git commit -m "feat(status): Parked board column; set_status accepts parked"
```

---

### Task 6: Park button on the rail row + head row

**Files:**
- Modify: `src/views/plan/sidebar/Backlog.tsx`
- Modify: `src/components/Icons.tsx` (only if no pause/park glyph exists — check first; reuse `IconDiamond`/`IconCircle` otherwise)
- Test: `src/views/plan/sidebar/Backlog.test.tsx`

**Interfaces:**
- Consumes: `actions.setNodeStatus(id, 'parked')`.

- [ ] **Step 1: Failing tests.** Append to `describe('the backlog rail', …)`:

```ts
  it('parks a step from its row, and offers no park on a loose task', async () => {
    const { store, user } = await mountRail({ goals: [PROJECT], tasks: [LOOSE] });
    await user.click(screen.getByRole('button', { name: 'Park "Estimate time for each study goal"' }));
    const node = store.getState().goals[0].nodes.find((n) => n.id === 'n2');
    expect(node?.status).toBe('parked');
    expect(screen.queryByRole('button', { name: 'Park "Estimate time for each study goal"' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Park "Buy a new keyboard"' })).toBeNull();
  });

  it('marks exactly one head row per group', async () => {
    await mountRail({ goals: [PROJECT], tasks: [LOOSE] });
    const heads = document.querySelectorAll('[data-backlog-head]');
    expect(heads.length).toBe(2);
    expect(heads[0].textContent).toContain('Break each topic into daily study goals');
  });
```

- [ ] **Step 2: Run** `npx vitest run src/views/plan/sidebar/Backlog.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement** in `Backlog.tsx`.

`BacklogRow` props gain `head: boolean`. Row className becomes:
```tsx
      className={`group flex items-center gap-[6px] text-ink-soft px-[6px] cursor-grab touch-none focus:outline-none focus:ring-2 focus:ring-accent-tint rounded-[6px] ${
        head ? 'py-[8px] text-body bg-panel border border-line-2' : 'py-[3px] text-ui'
      } ${isDragging ? 'opacity-40' : 'hover:bg-hover'} ${revealed ? 'ring-2 ring-accent bg-accent-tint' : ''}`}
```
Add `{...(head ? { 'data-backlog-head': '' } : {})}` beside `data-backlog-row`. Title span: `className={`flex-1 min-w-0 break-words ${head ? 'line-clamp-3' : 'line-clamp-2'}`}`.

Comment above the component, add a paragraph:
```
 * The HEAD of each group — its first shown row — is drawn as a card: more
 * padding, the body size, a bordered panel. It is the row most worth dragging
 * (the cap sorts by due, so it is the project's most urgent work) and the one
 * a 249px rail made no easier to grab than the rest. One per group, never
 * one per rail: each project has its own next thing.
```

Between the ✓ and the ✕ buttons, steps only:
```tsx
      {item.kind === 'step' && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            actions.setNodeStatus(item.id, 'parked');
          }}
          aria-label={`Park "${item.title}"`}
          title="Park — set aside, not now"
          className="quiet-control flex-none text-muted hover:text-ink rounded-[4px] hover:bg-hover"
        >
          <IconCircle size={13} />
        </button>
      )}
```
(Import `IconCircle` from `../../../components/Icons`; if the file has a pause glyph, prefer it.) Comment: `// Steps only: a loose Task has no status to park.`

In the group render: `group.shown.map((item, idx) => <BacklogRow … head={idx === 0} />)`.

- [ ] **Step 4: Run** `npm test && npx tsc -b` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/views/plan/sidebar/Backlog.tsx src/views/plan/sidebar/Backlog.test.tsx src/components/Icons.tsx
git commit -m "feat(rail): head row drawn as a card; Park on a step row"
```

---

### Task 7: CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — the "A step's `status` never moves the roll-up" bullet.

- [ ] **Step 1:** Append to that bullet:

> **`'parked'` is the fifth status and it is "not now", never "waiting".** It moves attention exactly as `blocked` does — `firstOpenLeaf`/`nextOpenAction` skip it, `backlogGroups` and `executionAdvisor` drop it unless it carries a `plannedWeek`, `containerStatus` reads it only when EVERY open leaf is parked — and it carries no `blockedOn`. Everything that COUNTS blocked work (`blockedLeafCount`, `isFullyBlocked`, `hiddenProjectCounts.blocked`, the focus chip) stays blocked-only: parked is not a problem to surface, which is the point of it. `cycleStatus` does not visit it; `P` and the row menu's Park/Unpark do, the rail's row has a Park button for steps only (a loose `Task` has no status), and the board draws it as its own column. The rail's first shown row per group is the HEAD and is drawn as a card — the most urgent row is the grab handle.

- [ ] **Step 2: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: parked status and the rail head row"
```
