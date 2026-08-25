# Bulk Park + Visible Task Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bulk-parking tasks a one-click verb, make `P` respect a multi-selection, and make the (already shipping, undiscoverable) multi-selection visible on screen.

**Architecture:** Everything happens in the goal tree. `src/lib/selection.ts` gains one pure predicate (`allParked`) so the Park button's LABEL and the write it performs are computed from one function over one population. `src/components/GoalTree.tsx` widens its existing `onBulk` union by one member, adds a Park button to the existing `SelectionBar`, and adds a pick circle to each row's leading control cluster. `src/lib/rowActions.ts` gains a `select` verb. **No new store actions** — `actions.setNodesStatus(ids, status)` already writes N leaves in one pass with one undo entry.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind, tested with Vitest + @testing-library/react (jsdom). All commands run from `PhaseApp/`.

## Global Constraints

Copied verbatim from `PhaseApp/CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **All commands run from `PhaseApp/`**, not the repo root. The repo also holds `PhaseWeb/`; never import across the folder boundary.
- **Verification is `npx tsc -b && npm test`.** Both must pass before any commit.
- **Views never call `db` directly.** All mutations go through `actions` in `src/state/store.ts`.
- **New logic in `src/lib/*` ships with a sibling `*.test.ts`.** `src/lib/*` is pure and side-effect-free.
- **`src/lib/status.ts` is the single vocabulary for a leaf's status.** Read status via `stepStatus(n)` / `isDone(n)`; never touch `n.status` directly outside that module.
- **A step's `status` never moves the roll-up.** Nothing in this plan may touch `src/lib/pct.ts` or `src/lib/effort.ts`.
- **Do NOT add a store action.** Both writes this plan performs already exist: `actions.setNodesStatus(ids: string[], next: StepStatus): boolean` and `actions.toggleParked(nodeId: string): void`.
- **`setNodesStatus` returns `false` and writes nothing when no leaf in the selection would change.** Callers must only clear the selection when it returns `true` — the established silent-refusal contract shared with `completeNodes` / `removeNodes` / `setNodesDemand`.
- **Row controls are `tabIndex={-1}` and `stopPropagation()` their click.** The row `<div>` is the focusable unit and owns the keyboard grammar. A tabbable child breaks ↑/↓ and ⌘]/⌘[.
- **`quiet-control` is the app's hover-revealed-control class.** It carries its own `@media (hover: hover)` gate so controls stay visible on a coarse pointer. A hand-rolled `opacity-0 group-hover:` is wrong *unless* the rule needs a state `quiet-control` does not model — which is exactly why Task 4 adds a sibling class rather than reusing it.
- **Undo copy for unpark will read `Reset N tasks`, not `Unparked N tasks`.** This is a known, accepted cost recorded in the spec. Do NOT branch `STATUS_LABEL` in `store.ts` to fix it.
- **Do not reformat or "clean up" the long explanatory comments** in `GoalTree.tsx`, `selection.ts` or `rowActions.ts`. They are load-bearing documentation. Add to them in the same voice.

**Reference spec:** `docs/superpowers/specs/2026-08-26-bulk-park-selection-design.md` (repo root, not `PhaseApp/`).

---

### Task 1: `allParked` — the predicate behind the Park button's label

The Park button toggles. Its direction must be decided by the *same* population `setNodesStatus` will write to, or the button can read "Unpark" and then park things. This task builds that predicate, pure and DOM-free.

**Files:**
- Modify: `PhaseApp/src/lib/selection.ts` (add one export at the end of the file, plus one import)
- Test: `PhaseApp/src/lib/selection.test.ts` (append one `describe` block)

**Interfaces:**
- Consumes: `openLeavesUnder(nodes: GoalNode[], ids: Set<string>): string[]` — already exported from this file. Returns every not-yet-done leaf at or under the selection, deduplicated.
- Produces: `allParked(nodes: GoalNode[], ids: Set<string>): boolean` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Append to `PhaseApp/src/lib/selection.test.ts`. Note the existing file already declares `const TREE: GoalNode[]` near the top; this block declares its own fixture so it does not depend on that one's shape.

```ts
describe('allParked', () => {
  // Its own fixture, deliberately: `TREE` above is shaped for range/removal
  // arithmetic, and a predicate about status should not silently inherit
  // whatever statuses that tree happens to carry.
  const PARKED_TREE: GoalNode[] = [
    { id: 'p1', title: 'Parked one', status: 'parked' },
    { id: 'p2', title: 'Parked two', status: 'parked' },
    { id: 'open', title: 'Untouched' },
    { id: 'fin', title: 'Finished', status: 'done', doneAt: '2026-08-01' },
    {
      id: 'grp',
      title: 'A group',
      children: [
        { id: 'k1', title: 'Kid one', status: 'parked' },
        { id: 'k2', title: 'Kid two', status: 'parked' },
      ],
    },
    {
      id: 'mixed',
      title: 'Mixed group',
      children: [
        { id: 'm1', title: 'Kid one', status: 'parked' },
        { id: 'm2', title: 'Kid two' },
      ],
    },
  ];

  it('is true when every open leaf in the selection is parked', () => {
    expect(allParked(PARKED_TREE, new Set(['p1', 'p2']))).toBe(true);
  });

  it('is false when one open leaf is not parked', () => {
    expect(allParked(PARKED_TREE, new Set(['p1', 'open']))).toBe(false);
  });

  it('reads a container through its leaves', () => {
    expect(allParked(PARKED_TREE, new Set(['grp']))).toBe(true);
    expect(allParked(PARKED_TREE, new Set(['mixed']))).toBe(false);
  });

  /**
   * A done leaf is not part of the population `setNodesStatus` would move
   * here, so it must not veto the label. Selecting a parked step and a
   * finished one still reads "Unpark" — which is what the one row you can
   * actually act on needs it to say.
   */
  it('ignores done leaves, which the write would not touch either', () => {
    expect(allParked(PARKED_TREE, new Set(['p1', 'fin']))).toBe(true);
  });

  it('is false for an empty selection — there is nothing to unpark', () => {
    expect(allParked(PARKED_TREE, new Set())).toBe(false);
  });

  it('is false for a selection holding only finished work', () => {
    expect(allParked(PARKED_TREE, new Set(['fin']))).toBe(false);
  });
});
```

Also add `allParked` to the existing import block at the top of the file, which currently reads:

```ts
import {
  visibleRowIds,
  rangeBetween,
  topLevelSelection,
  openLeavesUnder,
  allLeavesUnder,
  selectionRemovalCount,
  pruneSelection,
} from './selection';
```

Make it:

```ts
import {
  visibleRowIds,
  rangeBetween,
  topLevelSelection,
  openLeavesUnder,
  allLeavesUnder,
  allParked,
  selectionRemovalCount,
  pruneSelection,
} from './selection';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd PhaseApp && npx vitest run src/lib/selection.test.ts`

Expected: FAIL. The failure is a module resolution / TypeScript error along the lines of `"allParked" is not exported by "src/lib/selection.ts"`.

- [ ] **Step 3: Write the implementation**

In `PhaseApp/src/lib/selection.ts`, change the existing import line:

```ts
import { isDone } from './status';
```

to:

```ts
import { isDone, stepStatus } from './status';
```

Then append this to the end of the file:

```ts
/**
 * Whether every leaf a bulk status write would touch is already parked.
 *
 * This exists so the bulk bar's Park button and the write it performs cannot
 * describe different populations. The button reads `Unpark` off this and then
 * calls `setNodesStatus(ids, 'todo')`; if the predicate counted a different
 * set of rows than the action writes — done leaves, say — the button would
 * offer to unpark a selection and park it instead.
 *
 * It spends `openLeavesUnder`, so it inherits both rules that population
 * already has: a container is read through its leaves, and a finished leaf is
 * out. A done step is not something `Unpark` was ever going to move, so it
 * must not get a vote on the label either.
 *
 * An empty selection is FALSE, never vacuously true. `Unpark` over nothing is
 * a button that describes a state the user is not in.
 */
export function allParked(nodes: GoalNode[], ids: Set<string>): boolean {
  const open = new Set(openLeavesUnder(nodes, ids));
  if (open.size === 0) return false;
  let every = true;
  const walk = (list: GoalNode[]): void => {
    for (const n of list) {
      if (open.has(n.id) && stepStatus(n) !== 'parked') every = false;
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return every;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd PhaseApp && npx vitest run src/lib/selection.test.ts`

Expected: PASS — all six new tests plus every pre-existing test in the file.

- [ ] **Step 5: Typecheck and commit**

```bash
cd PhaseApp && npx tsc -b && npm test
```

Expected: no TypeScript output, full suite green.

```bash
git add PhaseApp/src/lib/selection.ts PhaseApp/src/lib/selection.test.ts
git commit -m "feat(selection): allParked, the predicate a bulk Park button toggles on"
```

---

### Task 2: `Select` in the row's `⋯` menu

The pointer-only route to a selection. `lib/rowActions.ts` is a registry of verbs plus the keyboard hint each one teaches; `RowActions.tsx` binds them to the store. The verb goes in group 0 beside Rename — picking a row is navigation, not mutation.

**Files:**
- Modify: `PhaseApp/src/lib/rowActions.ts` (add `'select'` to `RowActionId`, push the verb in `rowActions`)
- Modify: `PhaseApp/src/components/RowActions.tsx` (add an `onSelect` prop, handle the case in `run`)
- Modify: `PhaseApp/src/components/GoalTree.tsx` (pass `onSelect` at BOTH `RowActions` call sites — line ~1076 for a container, line ~1143 for a leaf)
- Test: `PhaseApp/src/lib/rowActions.test.ts` (append to the existing `describe('rowActions')` block)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `RowActions` gains a required prop `onSelect: () => void`. `RowActionId` gains the member `'select'`.

- [ ] **Step 1: Write the failing test**

Append these inside the existing `describe('rowActions', () => { ... })` block in `PhaseApp/src/lib/rowActions.test.ts`, before its closing `});`. The file already defines `const ids = (c: RowActionContext) => rowActions(c).map((a) => a.id);` and a `ctx()` helper — reuse both.

```ts
  /**
   * The selection is the tree's least discoverable capability: it has existed
   * for a long time behind ⌘-click and nothing on screen said so. The menu is
   * where a verb goes to be found, and its `hint` is what teaches the key.
   */
  it('offers Select on a leaf AND a container, since the selection takes both', () => {
    expect(ids(ctx())).toContain('select');
    expect(ids(ctx({ isContainer: true }))).toContain('select');
  });

  it('teaches Space beside Select', () => {
    const found = rowActions(ctx()).find((a) => a.id === 'select');
    expect(found?.label).toBe('Select');
    expect(found?.hint).toBe('Space');
  });

  it('groups Select with the navigational verbs, not the destructive ones', () => {
    // Group 0 is Open/Add task/Rename — the run that does not mutate the
    // subtree. Picking a row belongs there and nowhere near Delete.
    const found = rowActions(ctx()).find((a) => a.id === 'select');
    expect(found?.group).toBe(0);
  });

  it('keeps Select off the task page, which has no selection to join', () => {
    expect(taskPageActions(leaf).map((a) => a.id)).not.toContain('select');
  });
```

The last test uses `leaf`, which the file already declares for its `taskPageActions` tests. If your reading of the file shows `leaf` scoped to a different `describe`, move that one assertion into the `describe` where `leaf` lives rather than re-declaring it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd PhaseApp && npx vitest run src/lib/rowActions.test.ts`

Expected: FAIL — three failures reading `expected [ 'add-task', 'rename', ... ] to contain 'select'` and one `expected undefined to be 'Select'`. The fourth (`keeps Select off the task page`) passes already; that is fine and intended — it is a regression guard.

- [ ] **Step 3: Write the implementation**

**3a.** In `PhaseApp/src/lib/rowActions.ts`, add `'select'` to the `RowActionId` union. It currently begins:

```ts
export type RowActionId =
  | 'open'
  | 'add-task'
```

Make it:

```ts
export type RowActionId =
  | 'open'
  | 'select'
  | 'add-task'
```

**3b.** In the same file, inside `rowActions()`, the group-0 run currently reads:

```ts
  if (ctx.isContainer) out.push({ id: 'open', label: 'Open', hint: 'O', group: 0 });
  out.push({ id: 'add-task', label: 'Add task', hint: '⌘↵', group: 0 });
  out.push({ id: 'rename', label: 'Rename', hint: '↵', group: 0 });
```

Insert `select` after `open`:

```ts
  if (ctx.isContainer) out.push({ id: 'open', label: 'Open', hint: 'O', group: 0 });
  // Offered on BOTH kinds of row, because the selection takes both — the bulk
  // bar expands a container through `allLeavesUnder` and always has. This is
  // the only pointer route to a selection that does not require knowing to
  // hold ⌘, and the `hint` is what teaches the key for next time; the same
  // trade that makes `⌘]` findable without opening the shortcuts overlay.
  out.push({ id: 'select', label: 'Select', hint: 'Space', group: 0 });
  out.push({ id: 'add-task', label: 'Add task', hint: '⌘↵', group: 0 });
  out.push({ id: 'rename', label: 'Rename', hint: '↵', group: 0 });
```

Leave `taskPageActions` untouched — it builds its own list and never calls `rowActions`.

**3c.** In `PhaseApp/src/components/RowActions.tsx`, add the prop. The signature currently reads:

```ts
export function RowActions({
  node,
  isFirstSibling,
  depth,
  onRename,
  onEstimate,
  onSchedule,
}: {
  node: GoalNode;
  isFirstSibling: boolean;
  depth: number;
  /** Row-local UI, not store state — the title swaps itself for an input. */
  onRename: () => void;
  /** Bumps the row's estimate control open. */
  onEstimate: () => void;
  /** Opens the row's own schedule popover. */
  onSchedule: () => void;
}) {
```

Make it:

```ts
export function RowActions({
  node,
  isFirstSibling,
  depth,
  onRename,
  onEstimate,
  onSchedule,
  onSelect,
}: {
  node: GoalNode;
  isFirstSibling: boolean;
  depth: number;
  /** Row-local UI, not store state — the title swaps itself for an input. */
  onRename: () => void;
  /** Bumps the row's estimate control open. */
  onEstimate: () => void;
  /** Opens the row's own schedule popover. */
  onSchedule: () => void;
  /**
   * Adds this row to the tree's selection. Like `onRename`, this is not a
   * store call — the set lives in `GoalTree`, so the menu reports upward
   * rather than writing anything.
   */
  onSelect: () => void;
}) {
```

**3d.** In the same file, `run()` currently reads:

```ts
  function run(id: RowActionId): void {
    switch (id) {
      case 'open': actions.openArea(node.id); return;
```

Add the case:

```ts
  function run(id: RowActionId): void {
    switch (id) {
      case 'open': actions.openArea(node.id); return;
      case 'select': onSelect(); return;
```

TypeScript's exhaustiveness over `RowActionId` is what makes this a compile error if you skip it — `'breakdown'` is already absent from this switch because `rowActions` never emits it, so follow that precedent only for verbs the registry cannot produce.

**3e.** In `PhaseApp/src/components/GoalTree.tsx`, both `RowActions` call sites need the new prop. `GoalTreeNode` already receives `onSelect: (id: string, mode: SelectMode) => void` in its props, so bind it.

The container call site (inside the `RuleHeader` `right` slot, near line 1076) currently reads:

```tsx
                  <RowActions
                    node={n}
                    isFirstSibling={isFirstSibling}
                    depth={depth}
                    onRename={() => setEditing(true)}
                    onEstimate={() => setEstimateOpen((c) => c + 1)}
                    onSchedule={() => scheduleRef.current?.click()}
                  />
```

Add one line to it, and to the leaf call site near line 1143, which is character-for-character identical:

```tsx
                  <RowActions
                    node={n}
                    isFirstSibling={isFirstSibling}
                    depth={depth}
                    onRename={() => setEditing(true)}
                    onEstimate={() => setEstimateOpen((c) => c + 1)}
                    onSchedule={() => scheduleRef.current?.click()}
                    onSelect={() => onSelect(n.id, 'toggle')}
                  />
```

Both must be changed. Verify with `grep -n "onSelect={() => onSelect(n.id, 'toggle')}" src/components/GoalTree.tsx` — expect exactly two hits.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd PhaseApp && npx vitest run src/lib/rowActions.test.ts src/components/GoalTree.rowActions.test.tsx`

Expected: PASS. `GoalTree.rowActions.test.tsx` is included because it mounts the menu; if it asserts an exact list of menu item names it will now fail, and the correct fix is to add `Select` to that expected list — not to remove the verb.

- [ ] **Step 5: Typecheck, full suite, and commit**

```bash
cd PhaseApp && npx tsc -b && npm test
```

Expected: no TypeScript output, full suite green.

```bash
git add PhaseApp/src/lib/rowActions.ts PhaseApp/src/lib/rowActions.test.ts PhaseApp/src/components/RowActions.tsx PhaseApp/src/components/GoalTree.tsx
git commit -m "feat(tree): a Select verb in the row menu, teaching Space"
```

---

### Task 3: `P` respects the selection, and the bar gets a Park button

Two halves of one behaviour, so one task: the bulk park write, reached from a key and from a button. `X` and `⌫` already have exactly this shape; `P` is the only row key that does not.

**Files:**
- Modify: `PhaseApp/src/components/GoalTree.tsx` — `SharedProps.onBulk` type, `SelectionBar` props + Park button, `GoalTree`'s `onBulk`, the row's `P` key branch
- Test: `PhaseApp/src/components/GoalTree.selection.test.tsx` (append one `describe` block)

**Interfaces:**
- Consumes: `allParked(nodes: GoalNode[], ids: Set<string>): boolean` from Task 1. `actions.setNodesStatus(ids: string[], next: StepStatus): boolean` from the store.
- Produces: `onBulk` widens from `(action: 'complete' | 'delete') => void` to `(action: 'complete' | 'delete' | 'park') => void`.

- [ ] **Step 1: Write the failing test**

Append to `PhaseApp/src/components/GoalTree.selection.test.tsx`. The file already provides `mountTree()`, `row(title)` and `selectedIds()` helpers and mounts the `PROJECT` fixture (rows `a` "Pset 6", `b` "Pset 7", container `grp` "Pset 8" holding `c1`/`c2`, and `d` "Pset 9"), with `grp` auto-expanded.

```ts
describe('parking a selection', () => {
  /**
   * `P` was the only row key that ignored a selection: `X` completes it and
   * `⌫` deletes it, and `P` parked the focused row alone. A key that means
   * "this one" while its two neighbours mean "all of these" is the kind of
   * inconsistency that gets found by parking twelve rows one at a time.
   */
  it('parks the whole selection from P, not just the focused row', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');

    await user.keyboard('{Meta>}');
    await user.click(row('Pset 6'));
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');
    expect(selectedIds()).toEqual(['a', 'b']);

    row('Pset 6').focus();
    await user.keyboard('p');

    expect(findInAll(store.getState().goals, 'a')?.status).toBe('parked');
    expect(findInAll(store.getState().goals, 'b')?.status).toBe('parked');
    // A write that landed clears the bar, exactly as complete and delete do.
    expect(selectedIds()).toEqual([]);
  });

  it('still toggles only the focused row when nothing is selected', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');

    row('Pset 6').focus();
    await user.keyboard('p');

    expect(findInAll(store.getState().goals, 'a')?.status).toBe('parked');
    expect(findInAll(store.getState().goals, 'b')?.status).toBeUndefined();
  });

  it('parks a selected container through its leaves', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');

    await user.keyboard('{Meta>}');
    await user.click(row('Pset 8'));
    await user.keyboard('{/Meta}');

    row('Pset 8').focus();
    await user.keyboard('p');

    expect(findInAll(store.getState().goals, 'c1')?.status).toBe('parked');
    expect(findInAll(store.getState().goals, 'c2')?.status).toBe('parked');
    // A container carries no stored status of its own — `containerStatus`
    // derives one. Writing one here would be a new fact about the model.
    expect(findInAll(store.getState().goals, 'grp')?.status).toBeUndefined();
  });

  it('offers a Park button in the bar, beside Complete', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');

    await user.keyboard('{Meta>}');
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');

    await user.click(screen.getByRole('button', { name: 'Park' }));

    expect(findInAll(store.getState().goals, 'b')?.status).toBe('parked');
    expect(selectedIds()).toEqual([]);
  });

  /**
   * The button TOGGLES, matching `toggleParked`'s single-row semantics, and
   * its label is computed from the same population the write touches — so it
   * can never read "Unpark" and then park something.
   */
  it('reads Unpark and resets to todo once every selected leaf is parked', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');

    await user.keyboard('{Meta>}');
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');
    await user.click(screen.getByRole('button', { name: 'Park' }));
    expect(findInAll(store.getState().goals, 'b')?.status).toBe('parked');

    // Pick it again — now the one selected leaf is parked, so the verb flips.
    await user.keyboard('{Meta>}');
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');
    expect(screen.queryByRole('button', { name: 'Park' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Unpark' }));
    expect(findInAll(store.getState().goals, 'b')?.status).toBeUndefined();
  });

  it('parks a mixed selection rather than unparking it', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');

    await user.keyboard('{Meta>}');
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');
    await user.click(screen.getByRole('button', { name: 'Park' }));

    // One parked, one untouched — the button must read Park, and both end
    // parked. "Park what isn't parked" is the intent behind a mixed pick.
    await user.keyboard('{Meta>}');
    await user.click(row('Pset 6'));
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');
    expect(screen.getByRole('button', { name: 'Park' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Park' }));
    expect(findInAll(store.getState().goals, 'a')?.status).toBe('parked');
    expect(findInAll(store.getState().goals, 'b')?.status).toBe('parked');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd PhaseApp && npx vitest run src/components/GoalTree.selection.test.tsx`

Expected: FAIL — the P tests fail with `expected undefined to be 'parked'` for row `b`, and the button tests fail with `Unable to find an accessible element with the role "button" and name "Park"`.

- [ ] **Step 3: Write the implementation**

**3a.** In `PhaseApp/src/components/GoalTree.tsx`, widen the `SharedProps` member. It currently reads:

```ts
  /** Runs the selection's bulk action from a row's keyboard handler. */
  onBulk: (action: 'complete' | 'delete') => void;
```

Make it:

```ts
  /**
   * Runs the selection's bulk action from a row's keyboard handler.
   *
   * `park` joins `complete` and `delete` because `P` joined `X` and `⌫`: all
   * three are row keys that mean "the selection if there is one, otherwise
   * this row", and a key that stayed single-row while its neighbours went
   * plural was the one inconsistency in this grammar.
   */
  onBulk: (action: 'complete' | 'delete' | 'park') => void;
```

**3b.** Import `allParked`. The import line near the top currently reads:

```ts
import { pruneSelection, rangeBetween, visibleRowIds } from '../lib/selection';
```

Make it:

```ts
import { allParked, pruneSelection, rangeBetween, visibleRowIds } from '../lib/selection';
```

**3c.** Widen `GoalTree`'s `onBulk`. It currently reads:

```ts
  function onBulk(action: 'complete' | 'delete'): void {
    const ids = [...selected];
    if (ids.length === 0) return;
    const wrote = action === 'complete' ? actions.completeNodes(ids) : actions.removeNodes(ids);
    // Only clear if something actually happened. Both actions refuse silently —
    // a frozen (completed) project, or a selection whose leaves are all done
    // already — and dropping the bar and the highlights anyway read as "done"
    // when nothing had been.
    if (wrote) clearSelection();
  }
```

Make it:

```ts
  /**
   * What the selection is currently pointed at, for the Park verb's DIRECTION.
   *
   * Computed here rather than in the bar so the button's LABEL and the write
   * `onBulk('park')` performs come off ONE call over ONE population — the
   * rule this codebase states as "two numbers that get compared have to be one
   * derivation". A bar that decided its own wording from a second traversal
   * could say Unpark and then park.
   */
  const selectionParked = allParked(nodes, selected);

  function onBulk(action: 'complete' | 'delete' | 'park'): void {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === 'park') {
      // ONE write, ONE undo entry — never a loop over `toggleParked`, which
      // would arm N undos and let each write's sweep discard the one before.
      // Unparking lands on `'todo'`, matching `toggleParked`'s own transition;
      // the toast therefore reads `Reset N tasks`, which is accurate and flat
      // and deliberately not fixed by branching `STATUS_LABEL` on its caller.
      if (actions.setNodesStatus(ids, selectionParked ? 'todo' : 'parked')) clearSelection();
      return;
    }
    const wrote = action === 'complete' ? actions.completeNodes(ids) : actions.removeNodes(ids);
    // Only clear if something actually happened. Both actions refuse silently —
    // a frozen (completed) project, or a selection whose leaves are all done
    // already — and dropping the bar and the highlights anyway read as "done"
    // when nothing had been.
    if (wrote) clearSelection();
  }
```

**3d.** Pass the two new props to `SelectionBar`. Its call site currently reads:

```tsx
      <SelectionBar
        count={selected.size}
        onComplete={() => onBulk('complete')}
        onSetStatus={onSetStatus}
        onSetDemand={onSetDemand}
        onDelete={() => onBulk('delete')}
        onClear={clearSelection}
      />
```

Make it:

```tsx
      <SelectionBar
        count={selected.size}
        onComplete={() => onBulk('complete')}
        parked={selectionParked}
        onPark={() => onBulk('park')}
        onSetStatus={onSetStatus}
        onSetDemand={onSetDemand}
        onDelete={() => onBulk('delete')}
        onClear={clearSelection}
      />
```

**3e.** Add the button to `SelectionBar`. Its signature currently reads:

```tsx
function SelectionBar({
  count,
  onComplete,
  onSetStatus,
  onSetDemand,
  onDelete,
  onClear,
}: {
  count: number;
  onComplete: () => void;
  onSetStatus: (next: StepStatus) => void;
  onSetDemand: (next: Demand) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
```

Make it:

```tsx
function SelectionBar({
  count,
  onComplete,
  parked,
  onPark,
  onSetStatus,
  onSetDemand,
  onDelete,
  onClear,
}: {
  count: number;
  onComplete: () => void;
  /** Every open leaf under the selection is already parked — see `allParked`. */
  parked: boolean;
  onPark: () => void;
  onSetStatus: (next: StepStatus) => void;
  onSetDemand: (next: Demand) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
```

Then, immediately after the existing `Complete` button and before the `Set status…` `<select>`, insert:

```tsx
            {/* Park is one of the five statuses the select below already
                offers, and it is here as a BUTTON as well because it is the
                verb this bar is reached for. It stays in the select too: that
                control holds the whole vocabulary, and pulling one member out
                of it would leave a list that no longer means "the statuses".

                It toggles, wording itself off `parked` — the same call the
                write reads, so the label cannot promise the opposite of what
                the click does. `text-ink-soft` rather than Complete's
                `text-accent-deep`: this bar gets exactly one headline verb. */}
            <button
              type="button"
              onClick={onPark}
              className="text-compact font-semibold text-ink-soft px-[8px] py-[4px] min-h-[24px] inline-flex items-center rounded-field hover:bg-hover hover:text-ink"
            >
              {parked ? 'Unpark' : 'Park'}
            </button>
```

**3f.** Make the `P` key branch selection-aware. It currently reads:

```ts
    // P parks a leaf, or unparks one. Its own key rather than a stop on S's
    // cycle, for the reason rowActions.ts gives.
    if (plain && (e.key === 'p' || e.key === 'P') && !editing) {
      e.preventDefault();
      if (hasKids) return;
      actions.toggleParked(n.id);
      return;
    }
```

Make it:

```ts
    // P parks — the selection if there is one, otherwise this leaf. Its own key
    // rather than a stop on S's cycle, for the reason rowActions.ts gives.
    //
    // The `hasKids` guard moved INSIDE the else. `toggleParked` refuses a
    // container because a container carries no stored status; the bulk path
    // has no such problem — `setNodesStatus` expands a selected container
    // through `allLeavesUnder`, exactly as this bar's own status select
    // already did. Keeping the guard outside would have made P the one bulk
    // key that silently did nothing when the focused row happened to be a
    // group.
    if (plain && (e.key === 'p' || e.key === 'P') && !editing) {
      e.preventDefault();
      if (selected.size > 0) onBulk('park');
      else if (!hasKids) actions.toggleParked(n.id);
      return;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd PhaseApp && npx vitest run src/components/GoalTree.selection.test.tsx`

Expected: PASS — all seven new tests plus every pre-existing test in the file.

- [ ] **Step 5: Typecheck, full suite, and commit**

```bash
cd PhaseApp && npx tsc -b && npm test
```

Expected: no TypeScript output, full suite green. If `GoalTree.instrument.test.tsx` or another file asserts the bar's button list, add `Park` to its expectation.

```bash
git add PhaseApp/src/components/GoalTree.tsx PhaseApp/src/components/GoalTree.selection.test.tsx
git commit -m "feat(tree): P parks the selection, and the bulk bar gets a Park button"
```

---

### Task 4: The pick circle — a visible affordance in the row's gutter

The reason the feature was never found. A 13px **circle** before the drag handle, hidden at rest on a fine pointer and shown on hover, and shown on *every* row the moment anything is selected so the extent of a selection is legible without hovering each row.

**Files:**
- Modify: `PhaseApp/src/index.css` (add a `.pick-control` rule beside `.quiet-control`)
- Modify: `PhaseApp/src/components/GoalTree.tsx` (build `pickCircle` in `GoalTreeNode`, render it in both the leaf's leading column and the container's `RuleHeader` `lead`)
- Test: `PhaseApp/src/components/GoalTree.selection.test.tsx` (append one `describe` block)

**Interfaces:**
- Consumes: `onSelect: (id: string, mode: SelectMode) => void` and `selected: Set<string>`, both already in `SharedProps`.
- Produces: nothing consumed by a later task.

**Why a circle and not a checkbox.** The leaf already carries a 17px `rounded-[6px]` square (`LeafStatusBox`) whose fills — tick, dot, slash, bar — are this app's whole vocabulary for what the *work* is doing. A second square 9px away would put two readings of "state" in one cluster. A circle is categorically a PICK, and the drag handle physically separates the two.

- [ ] **Step 1: Write the failing test**

Append to `PhaseApp/src/components/GoalTree.selection.test.tsx`:

```ts
describe('the pick circle', () => {
  /**
   * The tree's multi-selection shipped behind ⌘-click and nothing on screen
   * said so, which is how a user came to park twelve tasks one at a time. The
   * circle is the pointer affordance; it is drawn as a circle, not a box,
   * because the box beside it already means "done".
   */
  it('adds the row to the selection without completing it', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');

    await user.click(within(row('Pset 7')).getByRole('checkbox', { name: 'Select "Pset 7"' }));

    expect(selectedIds()).toEqual(['b']);
    expect(findInAll(store.getState().goals, 'b')?.status).toBeUndefined();
  });

  it('removes the row again on a second click', async () => {
    const { user } = await mountTree();
    const pick = () => within(row('Pset 7')).getByRole('checkbox', { name: 'Select "Pset 7"' });

    await user.click(pick());
    expect(selectedIds()).toEqual(['b']);
    await user.click(pick());
    expect(selectedIds()).toEqual([]);
  });

  it('reports its own picked state', async () => {
    const { user } = await mountTree();
    const pick = () => within(row('Pset 7')).getByRole('checkbox', { name: 'Select "Pset 7"' });

    expect(pick().getAttribute('aria-checked')).toBe('false');
    await user.click(pick());
    expect(pick().getAttribute('aria-checked')).toBe('true');
  });

  it('is offered on a container too, which the selection accepts', async () => {
    const { user } = await mountTree();
    await user.click(within(row('Pset 8')).getByRole('checkbox', { name: 'Select "Pset 8"' }));
    expect(selectedIds()).toEqual(['grp']);
  });

  /**
   * Once anything is picked, EVERY row's circle comes out of hiding — the
   * extent of a selection has to be readable without hovering each row in
   * turn. `data-selecting` is what the stylesheet gates that on.
   */
  it('stops hiding on every row once a selection exists', async () => {
    const { user } = await mountTree();
    const pick = (title: string) =>
      within(row(title)).getByRole('checkbox', { name: `Select "${title}"` });

    expect(pick('Pset 6').hasAttribute('data-selecting')).toBe(false);
    await user.click(pick('Pset 7'));
    // The row that was NOT picked shows its circle too.
    expect(pick('Pset 6').hasAttribute('data-selecting')).toBe(true);
  });

  it('does not tab into the row, which owns the keyboard grammar', async () => {
    await mountTree();
    const pick = within(row('Pset 7')).getByRole('checkbox', { name: 'Select "Pset 7"' });
    expect(pick.getAttribute('tabindex')).toBe('-1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd PhaseApp && npx vitest run src/components/GoalTree.selection.test.tsx`

Expected: FAIL — `Unable to find an accessible element with the role "checkbox" and name "Select \"Pset 7\""`. Note the row's existing completion box has the accessible name `Mark "Pset 7" as done — To do`, so the two never collide in a query.

- [ ] **Step 3: Write the implementation**

**3a.** In `PhaseApp/src/index.css`, immediately after the existing `@media (hover: hover) { .group:not(:hover) .quiet-control:not(:focus-visible) { opacity: 0; } }` block, add:

```css
  /* The row's SELECT circle. A sibling of `.quiet-control` rather than a use
     of it, because it models one state that class does not: once a selection
     exists anywhere in the tree, every row's circle must stay out — the
     extent of a selection is unreadable if you have to hover each row to see
     whether it is in. `data-selecting` carries that, and it sits inside the
     `:not()` chain so it beats the hiding rule on specificity rather than on
     stylesheet order.

     Everything else matches `.quiet-control`: the 24x24 minimum target
     (WCAG 2.2 AA 2.5.8), opacity rather than `display:none` so the control
     keeps its place in the layout and the tab order, and the
     `@media (hover: hover)` gate so it stays permanently visible on a coarse
     pointer where `:hover` never resolves. */
  .pick-control {
    opacity: 1;
    transition: opacity .12s;
  }
  @media (hover: hover) {
    .group:not(:hover) .pick-control:not(:focus-visible):not([data-selecting]) { opacity: 0; }
  }
```

**3b.** In `PhaseApp/src/components/GoalTree.tsx`, inside `GoalTreeNode`, add `pickCircle` immediately before the existing `const dragHandle = (` declaration:

```tsx
  const isPicked = selected.has(n.id);
  /*
   * The row's SELECT control — a circle, deliberately.
   *
   * A leaf already carries a 17px rounded square whose fills are this app's
   * vocabulary for what the WORK is doing: tick for done, dot for doing,
   * slash for blocked, bar for parked. A second square in the same cluster
   * would put two readings of "state" 9px apart and undo the one signal the
   * row cannot afford to blur. A circle is a PICK — the radio reading — and
   * the drag handle sits physically between the two.
   *
   * It is the pointer half of `Space`; the row stays the focusable unit, so
   * this is `tabIndex={-1}` like every other control here and stops its own
   * click so the row's bubble handler never sees it as a plain click (which
   * would DISMISS the selection this button just added to).
   */
  const pickCircle = (
    <button
      type="button"
      role="checkbox"
      aria-checked={isPicked}
      aria-label={`Select "${n.title}"`}
      tabIndex={-1}
      data-selecting={selected.size > 0 ? '' : undefined}
      onClick={(e) => { e.stopPropagation(); onSelect(n.id, 'toggle'); }}
      className="pick-control w-[24px] h-[24px] -mx-[5px] flex-shrink-0 grid place-items-center rounded-[6px] hover:bg-hover"
    >
      <span
        className={`w-[13px] h-[13px] rounded-full border-[1.5px] grid place-items-center transition-all duration-100 ${
          isPicked ? 'bg-accent border-accent' : 'border-check'
        }`}
      >
        {isPicked && (
          <svg viewBox="0 0 12 12" className="w-[9px] h-[9px] stroke-accent-contrast fill-none" strokeWidth={2.6}>
            <path d="M2 6.2 4.6 9 10 3" />
          </svg>
        )}
      </span>
    </button>
  );
```

**3c.** Render it in the container's rule. The `RuleHeader` `lead` slot currently reads:

```tsx
            lead={
              <>
                {/* {listeners} on the handle, NOT the whole row, to avoid
                    colliding with row-level Space/Arrow handlers. */}
                {dragHandle}
                {twirl}
                {milestoneMark}
              </>
            }
```

Make it:

```tsx
            lead={
              <>
                {pickCircle}
                {/* {listeners} on the handle, NOT the whole row, to avoid
                    colliding with row-level Space/Arrow handlers. */}
                {dragHandle}
                {twirl}
                {milestoneMark}
              </>
            }
```

**3d.** Render it in the leaf's leading column, which currently reads:

```tsx
            {/* ── column 1: leading controls, pinned to line 1 ── */}
            <div className="flex items-center gap-[9px] min-h-[26px]">
              {dragHandle}
              {twirl}
              <LeafStatusBox
```

Make it:

```tsx
            {/* ── column 1: leading controls, pinned to line 1 ── */}
            {/* The pick circle leads, then the grip, then the status box. That
                ORDER is the design: the two boxes never touch, and the one
                that means "picked" is the one furthest from the work. */}
            <div className="flex items-center gap-[9px] min-h-[26px]">
              {pickCircle}
              {dragHandle}
              {twirl}
              <LeafStatusBox
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd PhaseApp && npx vitest run src/components/GoalTree.selection.test.tsx`

Expected: PASS — all six new tests plus everything before them.

- [ ] **Step 5: Typecheck, full suite, and commit**

```bash
cd PhaseApp && npx tsc -b && npm test
```

Expected: no TypeScript output, full suite green. `GoalTree.layout.test.tsx` may assert the leading column's child count or the row's control order; if so, update it to include the circle rather than removing the circle.

```bash
git add PhaseApp/src/index.css PhaseApp/src/components/GoalTree.tsx PhaseApp/src/components/GoalTree.selection.test.tsx
git commit -m "feat(tree): a pick circle in the row gutter, so the selection is visible"
```

---

### Task 5: Teach extension in the bar, and correct the shortcuts overlay

Two small copy changes that close the loop: once a selection exists, say how to grow it; and stop the overlay describing `P` as single-row now that it isn't.

**Files:**
- Modify: `PhaseApp/src/components/GoalTree.tsx` (`SelectionBar`'s live region)
- Modify: `PhaseApp/src/components/ShortcutsOverlay.tsx:82`
- Test: `PhaseApp/src/components/GoalTree.selection.test.tsx` (append one `describe` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `PhaseApp/src/components/GoalTree.selection.test.tsx`:

```ts
describe('the bar teaching its own extension', () => {
  /**
   * The hint sits OUTSIDE the live region's announced text. A polite region
   * that re-reads a static instruction every time you pick a row is noise —
   * the count is the only part that changes and the only part worth hearing.
   */
  it('announces the count alone, with the hint hidden from it', async () => {
    const { user } = await mountTree();

    await user.keyboard('{Meta>}');
    await user.click(row('Pset 6'));
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');

    const live = screen.getByRole('status', { name: 'Selection' });
    expect(live.textContent).toContain('2 tasks selected');
    const hint = live.querySelector('[aria-hidden="true"]');
    expect(hint?.textContent).toContain('⌘-click to add');
    expect(hint?.textContent).toContain('⇧-click for a range');
  });

  it('says nothing at all before a row is picked', async () => {
    await mountTree();
    const live = screen.getByRole('status', { name: 'Selection' });
    expect(live.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd PhaseApp && npx vitest run src/components/GoalTree.selection.test.tsx`

Expected: FAIL — `expected undefined to contain '⌘-click to add'` (there is no `aria-hidden` child inside the live region yet).

- [ ] **Step 3: Write the implementation**

**3a.** In `PhaseApp/src/components/GoalTree.tsx`, the `SelectionBar` live region currently reads:

```tsx
        <span
          role="status"
          aria-live="polite"
          aria-label="Selection"
          className="text-ui text-ink-soft flex-1 min-w-0"
        >
          {count > 0 && `${count} task${count === 1 ? '' : 's'} selected`}
        </span>
```

Make it:

```tsx
        <span
          role="status"
          aria-live="polite"
          aria-label="Selection"
          className="text-ui text-ink-soft flex-1 min-w-0"
        >
          {count > 0 && `${count} task${count === 1 ? '' : 's'} selected`}
          {/* How to GROW the selection, stated at the one moment it is useful
              and costing nothing when the bar is collapsed. `aria-hidden`
              because the region around it is `aria-live`: a polite region that
              re-reads a fixed instruction on every pick is noise, and the
              count is the only part that ever changes. */}
          {count > 0 && (
            <span aria-hidden="true" className="text-meta text-muted">
              {' · ⌘-click to add · ⇧-click for a range'}
            </span>
          )}
        </span>
```

**3b.** In `PhaseApp/src/components/ShortcutsOverlay.tsx`, line 82 currently reads:

```ts
  { keys: ['P'], label: 'Park or unpark the focused task' },
```

Make it:

```ts
  { keys: ['P'], label: 'Park or unpark the selection, or the focused task' },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd PhaseApp && npx vitest run src/components/GoalTree.selection.test.tsx src/components/ShortcutsOverlay.test.tsx`

Expected: PASS. If `ShortcutsOverlay.test.tsx` asserts the old `P` label verbatim, update the expectation to the new string.

- [ ] **Step 5: Typecheck, full suite, and commit**

```bash
cd PhaseApp && npx tsc -b && npm test
```

Expected: no TypeScript output, full suite green.

```bash
git add PhaseApp/src/components/GoalTree.tsx PhaseApp/src/components/ShortcutsOverlay.tsx PhaseApp/src/components/GoalTree.selection.test.tsx
git commit -m "feat(tree): the bar teaches ⌘-click, and P's overlay line matches P"
```

---

## Final verification

- [ ] Run the whole gate from `PhaseApp/`:

```bash
cd PhaseApp && npx tsc -b && npm test
```

Expected: no TypeScript output; the full Vitest suite green with zero failures.

- [ ] Confirm no store action was added:

```bash
cd PhaseApp && git diff main --stat -- src/state/store.ts
```

Expected: no output. `store.ts` must be untouched by this branch.

- [ ] Confirm the roll-up was not touched:

```bash
cd PhaseApp && git diff main --stat -- src/lib/pct.ts src/lib/effort.ts
```

Expected: no output.

## Notes for the reviewer

- The Park button reuses `setNodesStatus`, so unparking toasts `Reset N tasks`. Accepted and documented in the spec; not a defect to fix here.
- `cardPrimaryAction` still answers `'plan'` for a project whose every open leaf is parked. Pre-existing and documented in `PhaseApp/CLAUDE.md`; parking more rows at once makes it easier to reach, but it is out of scope.
