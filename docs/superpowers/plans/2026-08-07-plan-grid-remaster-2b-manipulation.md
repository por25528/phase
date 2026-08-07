# Plan Grid Remaster 2b — Manipulating Blocks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** plan 2a (`2026-08-07-plan-grid-remaster-2a-canvas-create.md`) must be complete. This plan assumes blocks can be created on the canvas.

**Goal:** Make a block on the grid a first-class object — resizable from either edge, selectable and drivable from the keyboard, unschedulable by dragging it to the rail, and honest about what a drop will cost.

**Architecture:** One new store action (`resizeFromStart`) reusing the existing `clampResize`; a second resize grip on the block's top edge; ephemeral selection state in `Plan` threaded down the same path `reveal` already travels; the rail promoted to a dnd-kit droppable; and a live drag readout that warms the aimed column when the drop would over-commit it.

**Tech Stack:** React 19, TypeScript, Tailwind, Vitest + @testing-library/react (no jest-dom), dnd-kit.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-02-plan-grid-remaster-design.md`, Part 2 §2.4–2.8.
- Snap grain is `SLOT_GRANULARITY_MIN` (5). Use `snapMinute()` from `src/lib/canvasCreate.ts`; do not re-implement rounding.
- Moving or resizing something **already on the grid is an adjustment, not a new booking** — it uses `NO_PAST_LIMIT`, never the wall clock (CLAUDE.md). `clampResize` already does this internally.
- Selection is **ephemeral component state in `Plan`**, never in the store — like `lastViewedWeek`. It must not persist.
- Visual identity is locked; theme tokens only. `designScale.test.ts` fails the build on a literal hex and an arbitrary `text-[Nrem]`.
- Hover-revealed row controls use `.quiet-control`, never a hand-rolled `opacity-0 group-hover:opacity-100`. It needs a literal `group` ancestor (`group/name` does not match).
- No jest-dom. Use `toBeTruthy()`, `toBeNull()`, `toBe()`, `toEqual()` and direct property reads.
- Component test files need `// @vitest-environment jsdom` on line 1.
- Run `npm test` and `npx tsc -b` before committing.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/state/scheduleActions.ts` | Modify | Correct `ClampResizeInput.startMin`'s doc comment |
| `src/state/store.ts` | Modify | Add `resizeFromStart` |
| `src/state/store.test.ts` | Modify | Cover the new action |
| `src/views/plan/EventBlock.tsx` | Modify | Top-edge grip, resize readout, `selected` styling |
| `src/views/plan/EventBlock.test.tsx` | Create | Grip arithmetic and readout |
| `src/views/plan/DayBlocks.tsx` | Modify | Thread `selectedKey` and `onResizeFromStart` |
| `src/views/plan/PlanSidebar.tsx` | Modify | The rail becomes a droppable |
| `src/views/plan/WeekGrid.tsx` | Modify | Thread `warmDate` to the aimed column |
| `src/views/plan/DayColumn.tsx` | Modify | Render the over-commit warning during a drag |
| `src/views/Plan.tsx` | Modify | Selection state, keyboard, rail drop, drag readout |
| `src/lib/blockKeys.ts` | Create | Pure key → intent mapping for a selected block |
| `src/lib/blockKeys.test.ts` | Create | Its tests |

---

### Task 1: `resizeFromStart`

**Files:**
- Modify: `src/state/scheduleActions.ts:28` (doc comment only)
- Modify: `src/state/store.ts` — add after `resizeTask` (which ends around line 1918)
- Test: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `clampResize`, `setPlannedSlot` (`store.ts:34`); `spansOn` (`:32`); `snapMinute` (new import from `../lib/canvasCreate`); file-local `describeResizeRefused`, `isActiveNode`, `goalOfNode`, `findNode`, `cloneGoals`.
- Produces: `actions.resizeFromStart(kind: 'step' | 'task', id: string, newStartMin: number, newMinutes: number): boolean` — consumed by Task 2.

**No new pure module is needed, contrary to what spec §2.4 implies.** The spec says "`clampResize` must validate the new **start** as well as the new end". It already does: it looks up *the gap containing `startMin`* and clamps the duration to `gap.endMin - startMin`. Passing the **new** start as `startMin` validates it for free — if the new start lands inside another block, no gap contains it and the function returns `null`. The only thing missing is snapping the start to the grain, which the action does before calling.

What *is* now wrong is the doc comment on `ClampResizeInput.startMin`, which reads `// where the block currently starts — unchanged by a resize`. A top-edge drag changes it. A stale rationale is worse than none.

**No undo entry, deliberately.** `resizeNode` and `resizeTask` both use `setAndPersist` with no undo, as does `scheduleNode` for a move. A resize discards no user data — it changes two numbers that are both visible on screen and both re-adjustable by the same gesture — so this matches its siblings rather than inventing a third convention. (Contrast `unscheduleNode`, which *is* undoable: it removes the block from the grid entirely.)

- [ ] **Step 1: Fix the stale doc comment**

In `src/state/scheduleActions.ts`, replace line 28:

```ts
  startMin: number;      // where the block currently starts — unchanged by a resize
```

with:

```ts
  /*
   * The start the block will have. A bottom-edge resize passes the block's
   * existing start; `resizeFromStart` passes the new one, which is exactly how
   * a top-edge drag gets its new start validated — the gap lookup below is
   * against THIS value, so a start dragged into another block finds no gap and
   * the whole resize is refused.
   */
  startMin: number;
```

- [ ] **Step 2: Write the failing tests**

Add to `src/state/store.test.ts`:

```ts
  describe('resizeFromStart', () => {
    async function seedTask(startMin: number, minutes: number) {
      const store = await freshStore();
      store.actions.createTaskAt('Pset', '2026-07-15', startMin, minutes);
      return store;
    }

    it('moves the start and shortens the block in one write', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await seedTask(600, 120); // 10:00-12:00
      const id = getState().tasks[0].id;

      expect(actions.resizeFromStart('task', id, 660, 60)).toBe(true);

      const task = getState().tasks[0];
      expect(task.startMin).toBe(660);   // 11:00
      expect(task.estimateMin).toBe(60); // through to 12:00
    });

    it('snaps the new start to the grain', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await seedTask(600, 120);
      const id = getState().tasks[0].id;

      actions.resizeFromStart('task', id, 632, 88);

      expect(getState().tasks[0].startMin).toBe(630);
    });

    it('refuses a start dragged into another block, changing nothing', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.createTaskAt('Earlier', '2026-07-15', 540, 60);  // 09:00-10:00
      actions.createTaskAt('Later', '2026-07-15', 600, 120);   // 10:00-12:00
      const later = getState().tasks.find((t) => t.title === 'Later')!;

      // 09:30 is inside "Earlier" — no free gap contains it.
      expect(actions.resizeFromStart('task', later.id, 570, 150)).toBe(false);

      const after = getState().tasks.find((t) => t.title === 'Later')!;
      expect(after.startMin).toBe(600);
      expect(after.estimateMin).toBe(120);
      expect(getState().toast).toBeTruthy();
    });

    it('clamps a duration that would run past the next block', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.createTaskAt('First', '2026-07-15', 540, 60);   // 09:00-10:00
      actions.createTaskAt('Second', '2026-07-15', 660, 60);  // 11:00-12:00
      const second = getState().tasks.find((t) => t.title === 'Second')!;

      // Drag the top edge up to 10:00 and ask for four hours.
      expect(actions.resizeFromStart('task', second.id, 600, 240)).toBe(true);

      const after = getState().tasks.find((t) => t.title === 'Second')!;
      expect(after.startMin).toBe(600);
      // 10:00 → 18:00 is the free gap; the ask is clamped to what it holds.
      expect(after.estimateMin).toBe(480);
    });

    it('resizes a step and keeps its slot fields consistent', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.setNodeEstimate(nid, 120);
      actions.scheduleNode(gid, nid, '2026-07-15', 600);

      expect(actions.resizeFromStart('step', nid, 660, 60)).toBe(true);

      const node = getState().goals[0].nodes[0];
      expect(node.plannedStartMin).toBe(660);
      expect(node.estimateMin).toBe(60);
      // setPlannedSlot is the single writer — the three fields never disagree.
      expect(node.plannedDay).toBe('2026-07-15');
      expect(node.plannedWeek).toBe('2026-07-13');
    });

    it('is a no-op on an unscheduled item', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addTask('Loose', '2026-07-15', null);
      const id = getState().tasks[0].id;

      expect(actions.resizeFromStart('task', id, 600, 60)).toBe(false);
      expect(getState().tasks[0].startMin).toBeUndefined();
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/state/store.test.ts -t resizeFromStart
```

Expected: FAIL — `actions.resizeFromStart is not a function`.

- [ ] **Step 4: Implement**

Add `snapMinute` to the `canvasCreate` import in `store.ts` (add the import line beside the other `../lib/*` imports):

```ts
import { snapMinute } from '../lib/canvasCreate';
```

Add the action after `resizeTask`:

```ts
  /**
   * Move a block's START while changing its duration — the gesture a top-edge
   * drag makes, which `resizeNode`/`resizeTask` cannot express because they
   * write `estimateMin` alone.
   *
   * `clampResize` validates the NEW start, not just the new end: it looks up
   * the free gap containing the start it is given, so a start dragged into a
   * neighbouring block finds no gap and the resize is refused whole. That is
   * why no separate start-validation exists here.
   *
   * Like its siblings this uses NO_PAST_LIMIT (inside `clampResize`) and takes
   * no undo entry: adjusting a block already on the grid discards nothing.
   */
  resizeFromStart(kind: 'step' | 'task', id: string, newStartMin: number, newMinutes: number): boolean {
    const startMin = snapMinute(newStartMin);

    if (kind === 'task') {
      const task = state.tasks.find((t) => t.id === id);
      if (!task || task.date === undefined || task.startMin === undefined) return false;

      const clamped = clampResize({
        date: task.date,
        startMin,
        requestedMin: newMinutes,
        windows: state.availability,
        blocks: [],
        placed: spansOn(state.goals, state.tasks, task.date, id),
        allDayBlocks: state.allDayBlocks,
      });
      if (clamped === null) {
        actions.showToast(describeResizeRefused(task.title));
        return false;
      }

      setAndPersist({
        tasks: state.tasks.map((t) => (t.id === id ? { ...t, startMin, estimateMin: clamped } : t)),
      });
      return true;
    }

    if (!isActiveNode(id)) return false;
    const goal = goalOfNode(id);
    const node = goal ? findNode(goal.nodes, id) : null;
    if (!goal || !node || node.plannedDay === undefined || node.plannedStartMin === undefined) return false;

    const clamped = clampResize({
      date: node.plannedDay,
      startMin,
      requestedMin: newMinutes,
      windows: state.availability,
      blocks: [],
      placed: spansOn(state.goals, state.tasks, node.plannedDay, id),
      allDayBlocks: state.allDayBlocks,
    });
    if (clamped === null) {
      actions.showToast(describeResizeRefused(node.title));
      return false;
    }

    const goals = cloneGoals(state.goals);
    const target = findNode(goals.find((g) => g.id === goal.id)!.nodes, id)!;
    // The single writer for a slot — never assign the three fields separately.
    setPlannedSlot(target, node.plannedDay, startMin);
    target.estimateMin = clamped;
    setAndPersist({ goals });
    return true;
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/state/store.test.ts -t resizeFromStart
```

Expected: PASS (6 tests).

- [ ] **Step 6: Prove the start really is validated**

Temporarily change the task branch to pass `startMin: task.startMin` (the OLD start) instead of the new one. Re-run. Expected: `refuses a start dragged into another block` FAILS — the resize is allowed, because the gap lookup is now against a start that was already free. **Revert.** This is the check that the reuse of `clampResize` is doing the work the spec asked for.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
npm test && npx tsc -b
git add src/state/store.ts src/state/store.test.ts src/state/scheduleActions.ts
git commit -m "feat(plan): resize a block from its top edge"
```

---

### Task 2: The top-edge grip and the live readout

**Files:**
- Modify: `src/views/plan/EventBlock.tsx`
- Modify: `src/views/plan/DayBlocks.tsx`
- Test: `src/views/plan/EventBlock.test.tsx` (create)

**Interfaces:**
- Consumes: `actions.resizeFromStart` (Task 1), via a callback prop.
- Produces: `EventBlock` gains `onResizeFromStart?: (startMin: number, minutes: number) => void`; `DayBlocks` gains `onResizeFromStart?: (kind, id, startMin, minutes) => void`.

**Existing state to extend.** `EventBlock` already holds `previewMinutes` (line 81) and derives `minutes`/`heightPx` from it (lines 84–89). A top-edge drag changes the **top** as well as the height, so a second piece of preview state is needed for the start. Both feed the same readout.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/EventBlock.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EventBlock, type GridBlock } from './EventBlock';

beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => cleanup());

// GridBlock is declared in EventBlock.tsx:15 — not in lib/grid.ts — and its
// `kind` is 'step' | 'task' | 'busy'.
const BLOCK: GridBlock = {
  kind: 'task', key: 'task:t1', title: 'Pset', startMin: 600, endMin: 720,
  done: false, estimated: true,
};

function mount(extra: Record<string, unknown> = {}) {
  const onResizeFromStart = vi.fn();
  render(createElement(EventBlock, {
    block: BLOCK, lane: 0, laneCount: 1,
    drag: { kind: 'task', id: 't1', goalId: null, title: 'Pset' },
    onResize: vi.fn(),
    onResizeFromStart,
    ...extra,
  }));
  return { onResizeFromStart };
}

describe('resizing from the top edge', () => {
  it('reports a new start and the duration that keeps the end fixed', () => {
    const { onResizeFromStart } = mount();
    const grip = screen.getByTestId('resize-top');

    // Drag the top edge down by 60px = 60 minutes at PX_PER_MINUTE = 1.
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 0 });
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 60 });

    // 10:00-12:00 became 11:00-12:00: start +60, duration -60.
    expect(onResizeFromStart).toHaveBeenCalledWith(660, 60);
  });

  it('shows a live readout of the span while dragging, and hides it after', () => {
    mount();
    const grip = screen.getByTestId('resize-top');

    expect(screen.queryByTestId('block-readout')).toBeNull();

    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 0 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 60 });

    const readout = screen.getByTestId('block-readout');
    // "11:00 – 12:00 · 1h" in 24h, "11 – 12pm · 1h" in 12h. Match the duration,
    // which clockLabel does not affect.
    expect(readout.textContent).toContain('1h');

    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 60 });
    expect(screen.queryByTestId('block-readout')).toBeNull();
  });

  it('abandons a top-edge drag on cancel', () => {
    const { onResizeFromStart } = mount();
    const grip = screen.getByTestId('resize-top');

    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 0 });
    fireEvent.pointerCancel(grip, { pointerId: 1 });

    expect(onResizeFromStart).not.toHaveBeenCalled();
    expect(screen.queryByTestId('block-readout')).toBeNull();
  });

  it('offers no grips on a read-only block', () => {
    render(createElement(EventBlock, {
      block: BLOCK, lane: 0, laneCount: 1,
      drag: { kind: 'task', id: 't1', goalId: null, title: 'Pset' },
    }));
    expect(screen.queryByTestId('resize-top')).toBeNull();
  });
});

describe('a selected block', () => {
  it('marks itself distinguishably from a revealed one', () => {
    render(createElement(EventBlock, {
      block: BLOCK, lane: 0, laneCount: 1, selected: true,
      drag: { kind: 'task', id: 't1', goalId: null, title: 'Pset' },
    }));
    const el = screen.getByTestId('event-block');
    expect(el.getAttribute('aria-current')).toBe('true');
  });

  it('is not marked when merely revealed', () => {
    render(createElement(EventBlock, {
      block: BLOCK, lane: 0, laneCount: 1, revealed: true,
      drag: { kind: 'task', id: 't1', goalId: null, title: 'Pset' },
    }));
    expect(screen.getByTestId('event-block').getAttribute('aria-current')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/views/plan/EventBlock.test.tsx
```

Expected: FAIL — no `resize-top` test id.

- [ ] **Step 3: Generalise the resize grip**

In `src/views/plan/EventBlock.tsx`, replace the `ResizeHandle` component (lines 186–231) with an edge-aware version:

```tsx
/**
 * A resize grip. `edge: 'bottom'` changes the duration alone; `edge: 'top'`
 * moves the start and changes the duration together, keeping the END fixed —
 * which is what a top-edge drag means and what `resizeFromStart` exists for.
 *
 * Pointer capture, as before: it ties the remaining pointer events to this
 * element and to React's own handlers, so there is nothing to leak — no
 * `pointercancel` gap, no unmount-without-cleanup case, and no way for a stray
 * `pointerup` anywhere else on the page to commit a phantom resize against
 * stale closed-over state.
 */
function ResizeHandle({
  edge,
  startMin,
  startDuration,
  pxPerMinute,
  onPreview,
  onCommit,
}: {
  edge: 'top' | 'bottom';
  startMin: number;
  startDuration: number;
  pxPerMinute: number;
  onPreview: (next: { startMin: number; minutes: number } | null) => void;
  onCommit: (next: { startMin: number; minutes: number }) => void;
}) {
  const [anchorY, setAnchorY] = useState<number | null>(null);

  function spanFor(clientY: number): { startMin: number; minutes: number } {
    const deltaMin = Math.round((clientY - anchorY!) / pxPerMinute);
    if (edge === 'bottom') return { startMin, minutes: startDuration + deltaMin };
    // The end is what stays put, so the duration absorbs the whole delta.
    return { startMin: startMin + deltaMin, minutes: startDuration - deltaMin };
  }

  return (
    <div
      data-testid={`resize-${edge}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setAnchorY(e.clientY);
      }}
      onPointerMove={(e) => {
        if (anchorY === null) return;
        onPreview(spanFor(e.clientY));
      }}
      onPointerUp={(e) => {
        if (anchorY === null) return;
        onCommit(spanFor(e.clientY));
        setAnchorY(null);
        onPreview(null);
      }}
      onPointerCancel={() => {
        if (anchorY === null) return;
        setAnchorY(null);
        onPreview(null);
      }}
      className={`absolute left-0 right-0 h-[6px] cursor-ns-resize touch-none ${edge === 'top' ? 'top-0' : 'bottom-0'}`}
      aria-hidden="true"
    />
  );
}
```

- [ ] **Step 4: Wire both grips and the readout into `EventBlock`**

Replace the preview state (line 81) with one that carries both fields:

```tsx
  // Live resize preview: while dragging a grip, the block's own geometry tracks
  // the pointer instead of waiting for the commit — same idea as SpanBar's
  // onPreview, held locally since only this block's geometry reacts to it.
  // Carries the START as well as the duration, because a top-edge drag moves
  // both and previewing only the height would slide the block's bottom edge.
  const [preview, setPreview] = useState<{ startMin: number; minutes: number } | null>(null);
```

Replace the derived geometry (lines 83–89):

```tsx
  const committedMinutes = block.endMin - block.startMin;
  const startMin = preview?.startMin ?? block.startMin;
  const minutes = preview?.minutes ?? committedMinutes;
  const top = minuteToPx(startMin);
  const heightPx = Math.max(minutes * PX_PER_MINUTE, MIN_BLOCK_PX);
```

Add `data-testid="event-block"` and the selection marker to the root element. Extend its `className` with the selected ring, and add the attribute:

```tsx
      data-testid="event-block"
      aria-current={selected ? 'true' : undefined}
```

and in the className, after the `revealed` clause:

```tsx
      ${selected ? 'ring-2 ring-accent-deep shadow-today' : ''}
```

> Selection and reveal must render **distinguishably** (spec §2.5): reveal is a transient pointer from the command palette, selection is a persistent user choice. `revealed` keeps `ring-inset ring-accent`; `selected` uses the deeper accent plus the raised shadow.

Add the two props to the signature:

```tsx
  /** Top-edge resize. Absent ⇒ no top grip, same rule as `onResize`. */
  onResizeFromStart?: (startMin: number, minutes: number) => void;
  /** The user has picked this block. Distinct from `revealed` — see §2.5. */
  selected?: boolean;
```

Replace the grip render (lines 165–172):

```tsx
      {onResizeFromStart && !isBusy && (
        <ResizeHandle
          edge="top"
          startMin={block.startMin}
          startDuration={committedMinutes}
          pxPerMinute={PX_PER_MINUTE}
          onPreview={setPreview}
          onCommit={(next) => onResizeFromStart(next.startMin, next.minutes)}
        />
      )}
      {onResize && !isBusy && (
        <ResizeHandle
          edge="bottom"
          startMin={block.startMin}
          startDuration={committedMinutes}
          pxPerMinute={PX_PER_MINUTE}
          onPreview={setPreview}
          onCommit={(next) => onResize(next.minutes)}
        />
      )}
      {preview && (
        <div
          data-testid="block-readout"
          className="absolute right-[4px] top-[2px] rounded-[4px] bg-fill text-bg px-[4px] font-mono text-tiny tabular-nums pointer-events-none"
        >
          {clockLabel(startMin)} – {clockLabel(startMin + minutes)} · {formatMinutes(minutes)}
        </div>
      )}
```

Add the import for the duration formatter:

```tsx
import { formatMinutes } from './capacityLabel';
```

- [ ] **Step 5: Thread it through `DayBlocks`**

In `src/views/plan/DayBlocks.tsx`, add to the props type beside `onResize`:

```tsx
  /** Top-edge resize. Suppressed on a past week, exactly as `onResize` is. */
  onResizeFromStart?: (kind: 'step' | 'task', id: string, startMin: number, minutes: number) => void;
  /** `${kind}:${id}` of the selected block, or null. */
  selectedKey?: string | null;
```

and on the `EventBlock` it renders (near line 134), add:

```tsx
                selected={selectedKey === `${item.kind}:${item.id}`}
                onResizeFromStart={
                  readOnly || !onResizeFromStart
                    ? undefined
                    : (startMin, minutes) =>
                        onResizeFromStart(item.kind as 'step' | 'task', item.id!, startMin, minutes)
                }
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run src/views/plan/EventBlock.test.tsx
```

Expected: PASS (6 tests).

- [ ] **Step 7: Prove the top-edge arithmetic can fail**

Temporarily change the `edge === 'top'` branch to `{ startMin: startMin + deltaMin, minutes: startDuration }` — moving the block instead of resizing it. Re-run. Expected: `reports a new start and the duration that keeps the end fixed` FAILS (it reports `(660, 120)`, sliding the end to 13:00). **Revert.**

- [ ] **Step 8: Commit**

```bash
npm test && npx tsc -b
git add src/views/plan/EventBlock.tsx src/views/plan/EventBlock.test.tsx src/views/plan/DayBlocks.tsx
git commit -m "feat(plan): a top-edge grip and a live span readout"
```

---

### Task 3: Selection and the selected-block keyboard

**Files:**
- Create: `src/lib/blockKeys.ts`, `src/lib/blockKeys.test.ts`
- Modify: `src/views/Plan.tsx`, `src/views/plan/WeekGrid.tsx`

**Interfaces:**
- Produces:

```ts
export type BlockIntent =
  | { kind: 'move'; deltaMin: number }
  | { kind: 'resize'; deltaMin: number }
  | { kind: 'unschedule' }
  | { kind: 'complete' }
  | { kind: 'open' }
  | { kind: 'deselect' };

export function resolveBlockKey(e: KeyboardEvent): BlockIntent | null;
```

The pure mapping lives in `src/lib` with its own test, exactly as `resolvePlanKey` does — the view stays thin.

- [ ] **Step 1: Write the failing test**

Create `src/lib/blockKeys.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveBlockKey } from './blockKeys';
import { SLOT_GRANULARITY_MIN } from './slot';

function key(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('driving a selected block from the keyboard', () => {
  it('moves by one grain on the arrows', () => {
    expect(resolveBlockKey(key({ key: 'ArrowDown' })))
      .toEqual({ kind: 'move', deltaMin: SLOT_GRANULARITY_MIN });
    expect(resolveBlockKey(key({ key: 'ArrowUp' })))
      .toEqual({ kind: 'move', deltaMin: -SLOT_GRANULARITY_MIN });
  });

  it('resizes by one grain when shifted', () => {
    expect(resolveBlockKey(key({ key: 'ArrowDown', shiftKey: true })))
      .toEqual({ kind: 'resize', deltaMin: SLOT_GRANULARITY_MIN });
    expect(resolveBlockKey(key({ key: 'ArrowUp', shiftKey: true })))
      .toEqual({ kind: 'resize', deltaMin: -SLOT_GRANULARITY_MIN });
  });

  it('maps the remaining verbs', () => {
    expect(resolveBlockKey(key({ key: 'Backspace' }))).toEqual({ kind: 'unschedule' });
    expect(resolveBlockKey(key({ key: 'Delete' }))).toEqual({ kind: 'unschedule' });
    expect(resolveBlockKey(key({ key: ' ' }))).toEqual({ kind: 'complete' });
    expect(resolveBlockKey(key({ key: 'Enter' }))).toEqual({ kind: 'open' });
    expect(resolveBlockKey(key({ key: 'Escape' }))).toEqual({ kind: 'deselect' });
  });

  it('ignores keys carrying a command or control modifier', () => {
    // ⌘↓ and ⌃↓ belong to the OS and to the app's own shortcuts; claiming them
    // for a 5-minute nudge would shadow both.
    expect(resolveBlockKey(key({ key: 'ArrowDown', metaKey: true }))).toBeNull();
    expect(resolveBlockKey(key({ key: 'ArrowDown', ctrlKey: true }))).toBeNull();
  });

  it('ignores anything it does not define', () => {
    expect(resolveBlockKey(key({ key: 'a' }))).toBeNull();
    expect(resolveBlockKey(key({ key: 'ArrowLeft' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/blockKeys.test.ts
```

Expected: FAIL — cannot resolve `./blockKeys`.

- [ ] **Step 3: Implement**

Create `src/lib/blockKeys.ts`:

```ts
import { SLOT_GRANULARITY_MIN } from './slot';

/**
 * What a key means to the block the user has selected.
 *
 * Pure, and separate from `resolvePlanKey`, because the two answer different
 * questions about the same keystroke: `resolvePlanKey` is about the WEEK (nav,
 * weekday placement) and this is about one block. Keeping them apart is what
 * lets `Plan` try the block mapping first and fall through when nothing is
 * selected.
 *
 * `ArrowLeft`/`ArrowRight` are deliberately unmapped. Moving a block across
 * days is a re-placement that must go through `resolveSlot` against the target
 * day's own gaps, and expressing that as a 1-day nudge would silently drop it
 * wherever the day happened to have room — a drag is the honest gesture for it.
 */
export type BlockIntent =
  | { kind: 'move'; deltaMin: number }
  | { kind: 'resize'; deltaMin: number }
  | { kind: 'unschedule' }
  | { kind: 'complete' }
  | { kind: 'open' }
  | { kind: 'deselect' };

export function resolveBlockKey(e: KeyboardEvent): BlockIntent | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;

  switch (e.key) {
    case 'ArrowDown':
      return e.shiftKey
        ? { kind: 'resize', deltaMin: SLOT_GRANULARITY_MIN }
        : { kind: 'move', deltaMin: SLOT_GRANULARITY_MIN };
    case 'ArrowUp':
      return e.shiftKey
        ? { kind: 'resize', deltaMin: -SLOT_GRANULARITY_MIN }
        : { kind: 'move', deltaMin: -SLOT_GRANULARITY_MIN };
    case 'Backspace':
    case 'Delete':
      return { kind: 'unschedule' };
    case ' ':
      return { kind: 'complete' };
    case 'Enter':
      return { kind: 'open' };
    case 'Escape':
      return { kind: 'deselect' };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/blockKeys.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Hold the selection in `Plan` and act on it**

In `src/views/Plan.tsx`, add the state beside `draft`:

```tsx
  // `${kind}:${id}` of the picked block. Ephemeral view state like
  // `lastViewedWeek` — a selection is not data and must not survive a reload.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
```

Clear it on week change, alongside the draft clear from plan 2a:

```tsx
  useEffect(() => { setDraft(null); setSelectedKey(null); }, [weekStart]);
```

Inside the existing `onKey` handler, **after** the composer bail and **before** `resolvePlanKey`:

```tsx
      // A selected block claims the keyboard before the week does. Nothing is
      // selected on first paint, so this costs the week shortcuts nothing.
      if (selectedKey) {
        const intent = resolveBlockKey(e);
        if (intent) {
          e.preventDefault();
          e.stopPropagation();
          const [kind, id] = selectedKey.split(':') as ['step' | 'task', string];
          applyBlockIntent(kind, id, intent);
          return;
        }
      }
```

Add the handler above the effect (it needs `scheduledByDay` and `actions`):

```tsx
  function applyBlockIntent(kind: 'step' | 'task', id: string, intent: BlockIntent): void {
    // The block's current geometry comes from the same derived list the grid
    // renders, so the keyboard and the pixels can never disagree about where
    // a block is.
    const item = [...scheduledByDay.values()].flat().find((i) => i.kind === kind && i.id === id);
    if (!item) { setSelectedKey(null); return; }
    const minutes = item.endMin - item.startMin;

    switch (intent.kind) {
      case 'deselect':
        setSelectedKey(null);
        return;
      case 'move':
        // A move is a re-placement, so it goes through the scheduling actions
        // and their `resolveSlot` — a nudge into an occupied five minutes is
        // refused with the same toast a drag would get.
        if (kind === 'task') actions.scheduleTask(id, item.date, item.startMin + intent.deltaMin);
        else if (item.goalId) actions.scheduleNode(item.goalId, id, item.date, item.startMin + intent.deltaMin);
        return;
      case 'resize':
        actions.resizeFromStart(kind, id, item.startMin, minutes + intent.deltaMin);
        return;
      case 'unschedule':
        if (kind === 'task') actions.unscheduleTask(id);
        else if (item.goalId) actions.unscheduleNode(item.goalId, id);
        setSelectedKey(null);
        return;
      case 'complete':
        if (kind === 'task') actions.toggleTask(id);
        else actions.toggleLeaf(id);
        return;
      case 'open':
        if (item.goalId) actions.openProject(item.goalId);
        return;
    }
  }
```

> All three actions exist as written: `toggleLeaf(nodeId)` (`store.ts:760`), `toggleTask(taskId)` (`:1462`) and `openProject(goalId, nodeId?)` (`:1985`). Both toggles key off the id alone, which is why neither takes a `goalId`.

Add `selectedKey` and `scheduledByDay` to the effect's dependency array, and the imports:

```tsx
import { resolveBlockKey, type BlockIntent } from '../lib/blockKeys';
```

- [ ] **Step 6: Select a block on click, and thread the key down**

Pass `selectedKey` into the `children` callback's `DayBlocks`:

```tsx
              selectedKey={selectedKey}
              onSelect={(kind, id) => setSelectedKey(`${kind}:${id}`)}
              onResizeFromStart={(kind, id, startMin, minutes) =>
                actions.resizeFromStart(kind, id, startMin, minutes)}
```

In `DayBlocks.tsx`, add `onSelect?: (kind: 'step' | 'task', id: string) => void` to the props and pass `onSelect={() => onSelect?.(item.kind as 'step' | 'task', item.id!)}` to `EventBlock`. In `EventBlock`, add `onSelect?: () => void` and call it from an `onClick` on the root element.

> **The capture-phase trap applies here** (CLAUDE.md): the block's own buttons stop propagation, so a click on ✓ or ✕ must not also select. Those buttons already call `e.stopPropagation()` on `pointerdown` (`EventBlock.tsx:137`, `:153`); add `onClick={(e) => e.stopPropagation()}` to them as well, since `onClick` is a separate event from `pointerdown` and is not covered by the existing guard.

- [ ] **Step 7: Typecheck, run the suite, commit**

```bash
npx tsc -b && npm test
git add src/lib/blockKeys.ts src/lib/blockKeys.test.ts src/views/Plan.tsx src/views/plan/DayBlocks.tsx src/views/plan/EventBlock.tsx
git commit -m "feat(plan): a selected block answers the keyboard"
```

---

### Task 4: The rail unschedules

**Files:**
- Modify: `src/views/plan/PlanSidebar.tsx`
- Modify: `src/views/Plan.tsx`

**Interfaces:** consumes `actions.unscheduleNode` / `actions.unscheduleTask` — both already undoable and both already calling `revealInPlan`, so the row is highlighted where it lands.

**Put the droppable on the OUTER wrapper, not the scroller.** `railRef` is attached to the inner scrolling div (`PlanSidebar.tsx:72`), and dnd-kit's `setNodeRef` is a callback ref — combining the two on one element needs a merge helper for no benefit. The outer `<div>` is the rail's whole footprint, which is the target the spec describes.

- [ ] **Step 1: Make the rail a droppable**

In `src/views/plan/PlanSidebar.tsx`:

```tsx
import { useDroppable } from '@dnd-kit/core';

export const RAIL_DROPPABLE_ID = 'rail';

export function PlanSidebar({ children, railRef }: { children: ReactNode; railRef?: Ref<HTMLDivElement> }) {
  // The whole rail is the target, so this sits on the outer wrapper rather
  // than the inner scroller — which already carries `railRef`, and combining a
  // callback ref with a forwarded one buys nothing here.
  const { setNodeRef, isOver } = useDroppable({ id: RAIL_DROPPABLE_ID });

  return (
    <div
      ref={setNodeRef}
      className={`min-w-0 md:relative md:border-r md:border-line ${isOver ? 'bg-accent/5' : ''}`}
    >
      <aside className="flex flex-col min-h-0 md:absolute md:inset-y-0 md:left-0 md:right-[18px]">
        <div ref={railRef} className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Handle the drop**

In `src/views/Plan.tsx`'s `handleDragEnd` (line 348), replace the guard at line 352:

```tsx
    if (!data || !e.over || !overId?.startsWith('day:')) return;
```

with:

```tsx
    if (!data || !overId) return;

    /*
     * Dropping on the rail unschedules. Both actions are already undoable and
     * both already reveal the row where it lands, so there is nothing to add.
     *
     * A row dragged from the rail BACK to the rail hits this too — harmlessly:
     * `unscheduleTask`/`unscheduleNode` both return early when the item has no
     * placement to clear.
     */
    if (overId === RAIL_DROPPABLE_ID) {
      if (data.kind === 'task') actions.unscheduleTask(data.id);
      else if (data.goalId) actions.unscheduleNode(data.goalId, data.id);
      return;
    }

    if (!overId.startsWith('day:')) return;
```

Add the import:

```tsx
import { PlanSidebar, RAIL_DROPPABLE_ID } from './plan/PlanSidebar';
```

> **Dropping outside any droppable must stay a no-op** (spec §2.8). The `if (!data || !overId) return;` above preserves that: an unschedule triggered by a missed drop is a gesture whose failure mode is silently losing a placement.

- [ ] **Step 3: Verify the collision detection reaches the rail**

`collisionDetection` (`Plan.tsx:62`) is `pointerWithin` with a `rectIntersection` fallback — generic over all droppables, so the rail participates without change. Confirm by grep that nothing filters droppable ids:

```bash
grep -n "startsWith('day:')" src/views/Plan.tsx
```

Expected: exactly one match, inside `handleDragEnd` — not in the collision function.

- [ ] **Step 4: Typecheck, suite, commit**

```bash
npx tsc -b && npm test
git add src/views/plan/PlanSidebar.tsx src/views/Plan.tsx
git commit -m "feat(plan): drag a block to the rail to unschedule it"
```

---

### Task 5: What the drop will cost

**Files:**
- Modify: `src/views/Plan.tsx`, `src/views/plan/WeekGrid.tsx`, `src/views/plan/DayColumn.tsx`

**Interfaces:** `WeekGrid` gains `warnDate?: string | null`; `DayColumn` gains `warnDrop?: boolean`.

**The predicate is `isOverCommitted`'s, not a new one** (spec §2.7, §4.1): a column warms when `plannedMin + backlogMin + draggedDuration > freeMin` for that day. Reusing the comparison is what stops the drag preview and the day heading from disagreeing.

- [ ] **Step 1: Track the dragged duration and the aimed day**

In `Plan.tsx`, add state and extend `handleDragStart`:

```tsx
  const [dragAim, setDragAim] = useState<{ date: string; durationMin: number } | null>(null);
```

```tsx
  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as PlanDragData | undefined;
    setDragTitle(data?.title ?? null);
    setDragAim(null);
  }
```

Add an `onDragOver` handler and register it on the `DndContext`:

```tsx
  /*
   * The cost of the day under the pointer, recomputed only when that day
   * changes — `onDragOver` fires far less often than `onDragMove`, and the
   * warmth is a property of WHICH day is aimed at, not of the exact minute.
   */
  function handleDragOver(e: DragOverEvent) {
    const data = e.active.data.current as PlanDragData | undefined;
    const overId = typeof e.over?.id === 'string' ? e.over.id : null;
    if (!data || !overId?.startsWith('day:')) { setDragAim(null); return; }
    setDragAim({ date: overId.slice('day:'.length), durationMin: durationOfDrag(data) });
  }

  /** The minutes a dragged item will occupy — its estimate, or the fallback. */
  function durationOfDrag(data: PlanDragData): number {
    if (data.kind === 'task') {
      return durationOf(tasks.find((t) => t.id === data.id)?.estimateMin);
    }
    const goal = goals.find((g) => g.id === data.goalId);
    let found: number | undefined;
    if (goal) walkLeaves(goal, (n) => { if (n.id === data.id) found = n.estimateMin; });
    return durationOf(found);
  }
```

Clear it in both `handleDragEnd` and `handleDragCancel`:

```tsx
    setDragAim(null);
```

Add imports: `durationOf` from `../lib/slot`, `walkLeaves` from `../lib/plan`, and `DragOverEvent` from `@dnd-kit/core`.

- [ ] **Step 2: Derive the warning day**

Beside the other derived values in `Plan`:

```tsx
  /*
   * The day whose column should warn: the aimed one, if adding the dragged
   * item would tip it over. Same comparison as `isOverCommitted`, so the
   * column and the day heading above it can never disagree.
   *
   * Memoised on the pair the spec names — the aimed date and the dragged
   * duration — because it runs on every dragover.
   */
  const warnDate = useMemo(() => {
    if (!dragAim) return null;
    const day = capacity.days.find((d) => d.date === dragAim.date);
    if (!day) return null;
    return isOverCommitted({
      freeMin: day.freeMin,
      plannedMin: day.plannedMin + dragAim.durationMin,
      backlogMin: day.backlogMin,
    }) ? dragAim.date : null;
  }, [dragAim, capacity.days]);
```

Pass it to `WeekGrid`: `warnDate={warnDate}`.

- [ ] **Step 3: Render it**

In `WeekGrid.tsx`, add `warnDate?: string | null` to the props, destructure it, and pass `warnDrop={iso === warnDate}` to each `DayColumn`.

In `DayColumn.tsx`, add `warnDrop?: boolean` to the props and extend the root `className`:

```tsx
      } ${isOver && availabilityWindow ? (warnDrop ? 'bg-warn-tint' : 'bg-accent/5') : ''}`}
```

> The warning **replaces** the neutral drop tint rather than stacking with it. `DayColumn` already carries four background layers (spec §4.1); a fifth would be mud.

- [ ] **Step 4: Typecheck, suite, commit**

```bash
npx tsc -b && npm test
git add src/views/Plan.tsx src/views/plan/WeekGrid.tsx src/views/plan/DayColumn.tsx
git commit -m "feat(plan): warn the day a drop would over-commit"
```

---

### Task 6: Verification sweep

- [ ] **Step 1: Suite, typecheck, build**

```bash
npm test && npx tsc -b && npm run build
```

Expected: all green, build exits 0. This plan adds 17 tests (6 + 6 + 5) across two new files.

- [ ] **Step 2: The old resize path is gone, not duplicated**

```bash
grep -n "startDuration\|ResizeHandle" src/views/plan/EventBlock.tsx
```

Expected: one `ResizeHandle` definition and exactly two usages (`edge="top"`, `edge="bottom"`). If a second handle component survives, the generalisation was added alongside the old one rather than replacing it.

- [ ] **Step 3: Selection did not leak into the store**

```bash
grep -n "selectedKey\|selectedBlock" src/state/store.ts src/db/types.ts
```

Expected: **no matches.** Selection is ephemeral view state (spec §2.5).

- [ ] **Step 4: Manual checks** — `npm run dev`, Plan view:

- [ ] Drag a block's **top** edge down → the start moves, the bottom edge stays put, and a readout shows the new span. Release → it commits.
- [ ] Drag a top edge up into the block above → refused with a toast; nothing moves.
- [ ] Drag a bottom edge → still behaves exactly as before this plan.
- [ ] Click a block → it marks itself. Press `↓` five times → it walks down in 5-minute steps. `⇧↓` → it grows instead.
- [ ] With a block selected press `⌫` → it leaves the grid and appears in the rail, with an Undo toast. Press Undo → it comes back.
- [ ] Press `Space` on a selected block → it ticks. `⏎` → its project opens.
- [ ] Press `Esc` → deselected. Then `→` navigates the week again.
- [ ] Reveal a block from the command palette, then click a different one — the two must look **different**, not both ringed identically.
- [ ] Drag a block onto the rail → unscheduled, undoable. Drag one onto blank page space outside any column → **nothing happens**.
- [ ] Drag a long item over a nearly-full day → that column turns warn-coloured before you release. Over an empty day → the ordinary tint.
- [ ] Open a composer (plan 2a) and press `↓` → the caret moves in the field; **no block moves**.

---

## What this plan does NOT do

Everything in Parts 3–5 of the spec, which are plans of their own:

- Colour and project identity, state on the fill (Part 3)
- The capacity gutter, the temperature wash, the all-day lane (Part 4)
- The motion scale (Part 5)

And, still explicitly out of the whole remaster: ghost auto-place, the now-band, estimate-vs-actual rendering, multi-select on the grid, a day/3-day view, mobile layout, Google Calendar pull, and any change to `Session`.
