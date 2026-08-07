# Plan Grid Remaster 2a — Create on the Canvas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag or click on empty grid space to create a block, name it inline, and have it land as a real scheduled task in one undoable write.

**Architecture:** A transparent canvas layer inside each `DayColumn` captures the pointer and converts it to day-content coordinates by measuring its own live rect — the column's border box *is* the day's content box, so no scroll term is involved. The existing pure `canvasSpan()` turns the anchor/current pair into a snapped `{startMin, durationMin}`. On release, `Plan` opens a `BlockComposer` positioned as a provisional block; committing calls one new store action, `createTaskAt`, which resolves the slot *before* writing anything.

**Tech Stack:** React 19, TypeScript, Tailwind, Vitest + @testing-library/react (no jest-dom), dnd-kit (untouched by this plan).

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-02-plan-grid-remaster-design.md`, Part 2 §2.1–2.3. §2.4–2.8 are **plan 2b** and are out of scope here.
- Snap grain is `SLOT_GRANULARITY_MIN` (5). Default click length is `DEFAULT_SLOT_MIN` (60). Both already exist in `src/lib/slot.ts` — do not redefine.
- `PX_PER_MINUTE = 1` today. Never assume it: always convert via `minuteToPx()` / `pxToMinute()` / `* PX_PER_MINUTE`, never by treating pixels as minutes.
- Visual identity is locked. Colours come from theme tokens only. `src/lib/designScale.test.ts` fails the build on a literal hex and on an arbitrary `text-[Nrem]`.
- New pure logic goes in `src/lib` with a sibling test. Views stay thin and delegate to `actions`.
- Component tests must click the child a person actually hits, not the container (CLAUDE.md).
- This repo has **no jest-dom**. Use `toBeTruthy()`, `toBeNull()`, `toBe()`, `toEqual()`, and direct property reads. `toBeInTheDocument()` does not exist here.
- Component test files opt into jsdom with a `// @vitest-environment jsdom` pragma on line 1. The global default is `node`.
- Run `npm test` and `npx tsc -b` before committing.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/state/store.ts` | Modify | Add the `createTaskAt` action |
| `src/state/store.test.ts` | Modify | Cover create, refusal, and the single undo entry |
| `src/views/plan/DayColumn.tsx` | Modify | Add the private `DayCanvas` gesture layer + `onCreate` prop |
| `src/views/plan/DayColumn.test.tsx` | Create | Pointer gesture → emitted span |
| `src/views/plan/BlockComposer.tsx` | Create | The inline title field and its commit/cancel rules |
| `src/views/plan/BlockComposer.test.tsx` | Create | Commit, Esc, blur, empty-title |
| `src/views/plan/WeekGrid.tsx` | Modify | Thread `onCreate` through to `DayColumn` |
| `src/views/Plan.tsx` | Modify | Hold the draft, render the composer, call `createTaskAt`, bail the keydown |

`canvasSpan()` and `snapMinute()` already exist in `src/lib/canvasCreate.ts`, fully tested, with no production caller. **This plan is the caller they were written for.** Do not modify that module.

---

### Task 1: The `createTaskAt` action

**Files:**
- Modify: `src/state/store.ts` (add to the `actions` object, which begins at line 758; place the new action immediately after `scheduleTask`, which ends around line 1775)
- Test: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `resolveSlot`, `freeIntervals`, `NO_PAST_LIMIT` (imported at `store.ts:31`); `spansOn` (`store.ts:32`); `normalizeEstimate` (`store.ts:29`); `isValidLocalDate` (`store.ts:17`); `uid` (from `../lib/tree`); the file-local `nowMoment()` (line 609), `describeNoRoom()` (line 629), and `withUndo()` (line 556).
- Produces: `actions.createTaskAt(title: string, date: string, startMin: number, durationMin: number): boolean` — consumed by Task 4.

**Why one action rather than composing three (spec §2.3):** `addTask` → `scheduleTask` → `setTaskEstimate` is wrong twice over. Three writes arm three undo entries and each write's sweep discards the ones before it, so the toast would offer to undo only the estimate — the exact failure CLAUDE.md documents for bulk edits. And `scheduleTask` returns `false` when no gap fits, which would strand an undated, unwanted task in the backlog after a gesture that visibly failed.

- [ ] **Step 1: Write the failing tests**

Add this block to `src/state/store.test.ts`, alongside the existing `describe('scheduleNode / unscheduleNode', ...)`:

```ts
  describe('createTaskAt', () => {
    // '2026-07-15' is a Wednesday; the module default availability
    // (Mon-Fri 09:00-18:00) covers it, so resolveSlot has somewhere to place it.
    it('creates a placed task in one undoable write', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      expect(actions.createTaskAt('Read the Raft paper', '2026-07-15', 600, 90)).toBe(true);

      const task = getState().tasks[0];
      expect(task.title).toBe('Read the Raft paper');
      expect(task.date).toBe('2026-07-15');
      expect(task.startMin).toBe(600);
      expect(task.estimateMin).toBe(90);
      expect(task.goalId).toBeNull();
      expect(task.done).toBe(false);
      // ONE entry, and it is the creation — not an estimate change left behind
      // by a three-write composition.
      expect(getState().pendingUndo?.label).toBe('Created "Read the Raft paper"');
    });

    it('undo removes the task it created', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      actions.createTaskAt('Read the Raft paper', '2026-07-15', 600, 90);
      expect(getState().tasks).toHaveLength(1);

      actions.undoLastDelete();
      expect(getState().tasks).toEqual([]);
    });

    it('creates nothing and returns false when the day has no room', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      // 600 minutes is longer than the whole 09:00-18:00 window.
      expect(actions.createTaskAt('Too big', '2026-07-15', 600, 600)).toBe(false);

      expect(getState().tasks).toEqual([]);
      expect(getState().toast).toBe('No 10h gap left that day — longest free stretch is 9h');
      expect(getState().pendingUndo).toBeNull();
    });

    it('refuses a blank title without touching the day', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      expect(actions.createTaskAt('   ', '2026-07-15', 600, 60)).toBe(false);
      expect(getState().tasks).toEqual([]);
      expect(getState().pendingUndo).toBeNull();
    });

    it('honours the day\'s real gaps rather than the minute it was handed', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      actions.createTaskAt('First', '2026-07-15', 540, 120);  // 09:00-11:00
      // Aims into the middle of what is now occupied. The only gap left that
      // day is 11:00-18:00, so this must land on its near edge rather than at
      // the minute the gesture asked for.
      actions.createTaskAt('Second', '2026-07-15', 600, 60);

      const second = getState().tasks.find((t) => t.title === 'Second')!;
      expect(second.startMin).toBe(660);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/state/store.test.ts -t createTaskAt
```

Expected: FAIL — `actions.createTaskAt is not a function`.

- [ ] **Step 3: Implement the action**

In `src/state/store.ts`, inside the `actions` object, immediately after `scheduleTask`:

```ts
  /**
   * Create a loose task directly on the grid, from a canvas gesture.
   *
   * ONE write, deliberately. Composing addTask → scheduleTask →
   * setTaskEstimate arms three undo entries, and each write's sweep discards
   * the ones before it, so the toast would offer to undo only the estimate —
   * the same failure CLAUDE.md documents for bulk edits. It would also strand
   * an undated task in the backlog whenever `scheduleTask` refused, after a
   * gesture the user watched fail.
   *
   * The slot is resolved BEFORE anything is written, so a refusal creates
   * nothing at all and the caller can drop its draft.
   */
  createTaskAt(title: string, date: string, startMin: number, durationMin: number): boolean {
    const trimmed = title.trim();
    if (!trimmed || !isValidLocalDate(date)) return false;

    const minutes = normalizeEstimate(durationMin);
    if (minutes === undefined) return false;

    /*
     * A brand-new block IS a new booking, so the wall clock applies — unlike
     * `scheduleNode`/`scheduleTask`, which pass `NO_PAST_LIMIT` when moving
     * something already on the grid because that is an adjustment. Drawing a
     * block across a morning that has already happened should refuse, exactly
     * as dragging a fresh item from the rail onto it does.
     */
    const now = nowMoment();
    const placed = spansOn(state.goals, state.tasks, date);
    const resolved = resolveSlot({
      date,
      aimMin: startMin,
      durationMin: minutes,
      windows: state.availability,
      blocks: [],
      placed,
      now,
      allDayBlocks: state.allDayBlocks,
    });
    if (resolved === null) {
      // Same `now` as the search above, or the refusal describes gaps the
      // search was never allowed to use.
      const gaps = freeIntervals(date, state.availability, [], placed, now, state.allDayBlocks);
      actions.showToast(describeNoRoom(minutes, gaps));
      return false;
    }

    const task: Task = {
      id: uid(),
      title: trimmed,
      date,
      startMin: resolved,
      done: false,
      goalId: null,
      estimateMin: minutes,
    };
    withUndo(`Created "${trimmed}"`, 'tasks', [...state.tasks, task]);
    return true;
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/state/store.test.ts -t createTaskAt
```

Expected: PASS (5 tests).

- [ ] **Step 5: Prove the single-write claim can fail**

Temporarily replace the `withUndo(...)` line with the three-write composition the comment forbids:

```ts
    actions.addTask(trimmed, date, null);
    const created = state.tasks[state.tasks.length - 1];
    actions.scheduleTask(created.id, date, resolved);
    actions.setTaskEstimate(created.id, minutes);
    return true;
```

Run the tests again. Expected: the `pendingUndo?.label` assertion FAILS — it reports the estimate change, not `Created "…"`. **Revert to the `withUndo` version.** This is the check that the test is actually pinning the invariant rather than passing by luck.

- [ ] **Step 6: Run the full suite and typecheck**

```bash
npm test && npx tsc -b
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(plan): create a placed task in one write"
```

---

### Task 2: The canvas gesture layer

**Files:**
- Modify: `src/views/plan/DayColumn.tsx`
- Test: `src/views/plan/DayColumn.test.tsx` (create)

**Interfaces:**
- Consumes: `canvasSpan`, `type CanvasSpan` from `../../lib/canvasCreate`; `minuteToPx`, `PX_PER_MINUTE`, `Z_RULES` from `../../lib/grid`.
- Produces: `DayColumn` gains `onCreate?: (span: CanvasSpan) => void`, consumed by Task 4 via `WeekGrid`.

**The coordinate decision — read this before writing code.** `WeekGrid` renders the hour grid as a CSS grid with `height: DAY_HEIGHT_PX` (`WeekGrid.tsx:245–251`), and each `DayColumn` is a grid item in that row. A column's border box is therefore *exactly* the day's content box: its top edge is minute 0 and it is `DAY_HEIGHT_PX` tall. So:

```
contentY = event.clientY - canvasElement.getBoundingClientRect().top
```

`getBoundingClientRect()` is live and already reflects the scroller's position, which is why **there is no `scrollTop` term here**. Do not import `aimMinuteFor` or reuse its formula: that function exists for dnd-kit drops, where the input is a *translated ghost rect* rather than a live element, and it needs `scrollTop` + `gridOffsetPx` precisely because it has no element of its own to measure. Adding a scroll term here would double-count it.

Use pointer capture, matching `ResizeHandle` (`EventBlock.tsx:186–231`) and `SpanBar.tsx:71`: capture ties the remaining pointer events to this element and to React's own handlers, so there is nothing to leak — no `pointercancel` gap, no unmount-without-cleanup case, and no stray `pointerup` elsewhere committing a phantom block.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/DayColumn.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { CanvasSpan } from '../../lib/canvasCreate';
import { DayColumn } from './DayColumn';

// jsdom implements neither pointer capture nor layout. Both are stubbed
// rather than worked around: the component is correct to use capture (see
// ResizeHandle), and a zero rect makes contentY equal clientY, which keeps
// the arithmetic in the test readable.
beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => cleanup());

const WINDOW = { dow: 2, startMin: 540, endMin: 1080 };

function mount(onCreate: (span: CanvasSpan) => void) {
  render(createElement(DayColumn, {
    date: '2026-07-15',
    isToday: false,
    availabilityWindow: WINDOW,
    nowMinute: null,
    onCreate,
    children: null,
  }));
  return screen.getByTestId('day-canvas-2026-07-15');
}

describe('creating a block by gesture', () => {
  it('reports the dragged span, snapped to the grain', () => {
    const onCreate = vi.fn();
    const canvas = mount(onCreate);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientY: 540 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientY: 632 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientY: 632 });

    // 632 snaps to 630 — the 5-minute grain, not the raw pixel.
    expect(onCreate).toHaveBeenCalledWith({ startMin: 540, durationMin: 90 });
  });

  it('treats a gesture under the click threshold as a default-length block', () => {
    const onCreate = vi.fn();
    const canvas = mount(onCreate);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientY: 540 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientY: 542 });

    expect(onCreate).toHaveBeenCalledWith({ startMin: 540, durationMin: 60 });
  });

  it('draws a preview while the pointer is down, and clears it on release', () => {
    const canvas = mount(vi.fn());

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientY: 540 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientY: 660 });
    expect(screen.queryByTestId('canvas-preview')).not.toBeNull();

    fireEvent.pointerUp(canvas, { pointerId: 1, clientY: 660 });
    expect(screen.queryByTestId('canvas-preview')).toBeNull();
  });

  it('abandons the gesture on cancel without reporting anything', () => {
    const onCreate = vi.fn();
    const canvas = mount(onCreate);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientY: 540 });
    fireEvent.pointerCancel(canvas, { pointerId: 1 });

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-preview')).toBeNull();
  });

  it('ignores a non-primary button', () => {
    const onCreate = vi.fn();
    const canvas = mount(onCreate);

    fireEvent.pointerDown(canvas, { button: 2, pointerId: 1, clientY: 540 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientY: 700 });

    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('when the day refuses work', () => {
  it('renders no canvas on a day with no working hours', () => {
    render(createElement(DayColumn, {
      date: '2026-07-19', isToday: false, availabilityWindow: null,
      nowMinute: null, onCreate: vi.fn(), children: null,
    }));
    expect(screen.queryByTestId('day-canvas-2026-07-19')).toBeNull();
  });

  it('renders no canvas on a past week', () => {
    render(createElement(DayColumn, {
      date: '2026-07-15', isToday: false, availabilityWindow: WINDOW,
      nowMinute: null, readOnly: true, onCreate: vi.fn(), children: null,
    }));
    expect(screen.queryByTestId('day-canvas-2026-07-15')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/views/plan/DayColumn.test.tsx
```

Expected: FAIL — `Unable to find an element by: [data-testid="day-canvas-2026-07-15"]`.

- [ ] **Step 3: Implement the canvas layer**

In `src/views/plan/DayColumn.tsx`, extend the imports:

```tsx
import { useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { AvailabilityWindow } from '../../db/types';
import { minuteToPx, DAY_HEIGHT_PX, PX_PER_MINUTE, Z_NOW_LINE, Z_RULES } from '../../lib/grid';
import { canvasSpan, type CanvasSpan } from '../../lib/canvasCreate';
import { fmtD } from '../../lib/dates';
```

Add the private component at the bottom of the file:

```tsx
/**
 * The empty-canvas gesture layer.
 *
 * Sits BENEATH the blocks (`Z_RULES`, and rendered before `children`) so a
 * pointerdown on a block reaches the block, not this. "Empty canvas" is
 * therefore a real DOM target rather than a target-vs-currentTarget test,
 * which would have to be re-derived every time a block grows a new child.
 *
 * Content coordinates come from this element's own live rect. The column's
 * border box IS the day's content box — `WeekGrid` gives the hour grid
 * `height: DAY_HEIGHT_PX` and each column is a grid item in that row — so the
 * rect's top is minute 0 and no scroll term is involved. `aimMinuteFor` needs
 * one only because dnd-kit hands it a translated ghost rect instead of an
 * element; reusing its formula here would count scroll twice.
 *
 * Pointer capture, as in `ResizeHandle` and `SpanBar`: it ties the remaining
 * events to this element and to React's own handlers, so there is nothing to
 * leak and no stray `pointerup` elsewhere can commit a phantom block.
 */
function DayCanvas({ date, onCreate }: { date: string; onCreate: (span: CanvasSpan) => void }) {
  const [anchorY, setAnchorY] = useState<number | null>(null);
  const [preview, setPreview] = useState<CanvasSpan | null>(null);

  function contentY(e: ReactPointerEvent<HTMLDivElement>): number {
    return e.clientY - e.currentTarget.getBoundingClientRect().top;
  }

  function end(): void {
    setAnchorY(null);
    setPreview(null);
  }

  return (
    <div
      data-testid={`day-canvas-${date}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const y = contentY(e);
        setAnchorY(y);
        setPreview(canvasSpan(y, y));
      }}
      onPointerMove={(e) => {
        if (anchorY === null) return;
        setPreview(canvasSpan(anchorY, contentY(e)));
      }}
      onPointerUp={(e) => {
        if (anchorY === null) return;
        const span = canvasSpan(anchorY, contentY(e));
        end();
        onCreate(span);
      }}
      onPointerCancel={end}
      className="absolute inset-0 touch-none"
      style={{ zIndex: Z_RULES }}
      aria-hidden="true"
    >
      {preview && (
        <div
          data-testid="canvas-preview"
          className="absolute left-[2px] right-[2px] rounded-[6px] border border-dashed border-accent bg-accent/10 pointer-events-none"
          style={{
            top: `${minuteToPx(preview.startMin)}px`,
            height: `${preview.durationMin * PX_PER_MINUTE}px`,
          }}
        />
      )}
    </div>
  );
}
```

Add the prop to `DayColumn`'s signature, after `readOnly`:

```tsx
  /** Draw a block here. Absent on days that refuse work. */
  onCreate?: (span: CanvasSpan) => void;
```

and destructure it: `date, isToday, availabilityWindow, nowMinute, readOnly, onCreate, children`.

Render it inside the column, **immediately before `{children}`**:

```tsx
      {/* Gated on exactly what the droppable is gated on: a day with no
          window, or a week already spent, refuses a drawn block for the same
          reason it refuses a dropped one. */}
      {onCreate && availabilityWindow && !readOnly && (
        <DayCanvas date={date} onCreate={onCreate} />
      )}

      {children}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/views/plan/DayColumn.test.tsx
```

Expected: PASS (7 tests).

- [ ] **Step 5: Prove the gating can fail**

Temporarily change the render gate to `{onCreate && (` — dropping the `availabilityWindow && !readOnly` terms. Re-run. Expected: both tests in the `when the day refuses work` block FAIL. **Restore the full gate.**

- [ ] **Step 6: Commit**

```bash
git add src/views/plan/DayColumn.tsx src/views/plan/DayColumn.test.tsx
git commit -m "feat(plan): draw a span on the empty canvas"
```

---

### Task 3: The block composer

**Files:**
- Create: `src/views/plan/BlockComposer.tsx`
- Test: `src/views/plan/BlockComposer.test.tsx`

**Interfaces:**
- Consumes: `minuteToPx`, `PX_PER_MINUTE`, `Z_BLOCK_REVEALED` from `../../lib/grid`; `clockLabel` from `../../lib/clock`.
- Produces:

```ts
export function BlockComposer(props: {
  startMin: number;
  durationMin: number;
  onCommit: (title: string) => void;
  onCancel: () => void;
}): JSX.Element
```

**It writes nothing (spec §2.2).** The field is local component state. A stray click therefore costs an empty field that `Esc` or blur dismisses, and committing an empty title cancels rather than creating "Untitled". That is what makes click-to-create safe without a confirmation step, and it is the reason the gesture is allowed to be this cheap.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/BlockComposer.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockComposer } from './BlockComposer';

afterEach(() => cleanup());

function mount() {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(createElement(BlockComposer, {
    startMin: 600, durationMin: 90, onCommit, onCancel,
  }));
  return { onCommit, onCancel, user: userEvent.setup(), field: screen.getByRole('textbox') };
}

describe('naming a new block', () => {
  it('focuses the field so the gesture flows straight into typing', () => {
    const { field } = mount();
    expect(document.activeElement).toBe(field);
  });

  it('commits the trimmed title on Enter', async () => {
    const { onCommit, onCancel, user } = mount();
    await user.keyboard('  Office hours  {Enter}');
    expect(onCommit).toHaveBeenCalledWith('Office hours');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on Escape without committing', async () => {
    const { onCommit, onCancel, user } = mount();
    await user.keyboard('Office hours{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('cancels rather than creating "Untitled" when the title is empty', async () => {
    const { onCommit, onCancel, user } = mount();
    await user.keyboard('   {Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('cancels on blur', async () => {
    const { onCommit, onCancel, field } = mount();
    field.blur();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('resolves exactly once — a commit does not also fire the blur cancel', async () => {
    const { onCommit, onCancel, user, field } = mount();
    await user.keyboard('Office hours{Enter}');
    field.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows the span it is about to create', () => {
    mount();
    // 600 → 690. clockLabel honours the locale's hour cycle, so match loosely
    // on the digits rather than pinning a 12h/24h rendering.
    expect(screen.getByTestId('composer-span').textContent).toMatch(/10.*11/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/views/plan/BlockComposer.test.tsx
```

Expected: FAIL — cannot resolve `./BlockComposer`.

- [ ] **Step 3: Implement the composer**

Create `src/views/plan/BlockComposer.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { minuteToPx, PX_PER_MINUTE, Z_BLOCK_REVEALED } from '../../lib/grid';
import { clockLabel } from '../../lib/clock';

/**
 * The inline title field for a block being drawn.
 *
 * It writes NOTHING. The field is local state and the parent only hears about
 * it through `onCommit`, so a stray click costs an empty field that Esc or
 * blur dismisses. Committing an empty title cancels rather than creating
 * "Untitled" — that is what lets the create gesture be a single click with no
 * confirmation step.
 *
 * `resolved` guards the three exits against each other: committing unmounts
 * the field, which fires `blur`, which would otherwise cancel the commit that
 * had just succeeded.
 */
export function BlockComposer({
  startMin, durationMin, onCommit, onCancel,
}: {
  startMin: number;
  durationMin: number;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const resolved = useRef(false);

  useEffect(() => { fieldRef.current?.focus(); }, []);

  function finish(commit: boolean): void {
    if (resolved.current) return;
    resolved.current = true;
    const title = fieldRef.current?.value.trim() ?? '';
    if (commit && title) onCommit(title);
    else onCancel();
  }

  return (
    <div
      className="absolute left-[2px] right-[2px] rounded-[6px] border border-accent bg-panel px-[5px] py-[2px] overflow-hidden text-badge leading-[1.2]"
      style={{
        top: `${minuteToPx(startMin)}px`,
        height: `${durationMin * PX_PER_MINUTE}px`,
        zIndex: Z_BLOCK_REVEALED,
      }}
      // The blocks' own buttons do this so a pointerdown does not start a drag
      // (EventBlock.tsx:137, :153). Typing in a field inside the grid needs the
      // same protection.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={fieldRef}
        type="text"
        aria-label="Title for the new block"
        placeholder="What is this?"
        className="w-full bg-transparent outline-none font-medium text-ink placeholder:text-faint"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        }}
        onBlur={() => finish(false)}
      />
      <div data-testid="composer-span" className="truncate text-muted text-tiny tabular-nums">
        {clockLabel(startMin)}–{clockLabel(startMin + durationMin)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/views/plan/BlockComposer.test.tsx
```

Expected: PASS (7 tests).

- [ ] **Step 5: Prove the double-resolve guard can fail**

Temporarily delete the two `resolved.current` lines from `finish`. Re-run. Expected: `resolves exactly once` FAILS — `onCancel` fires after the successful commit. **Restore the guard.**

- [ ] **Step 6: Commit**

```bash
git add src/views/plan/BlockComposer.tsx src/views/plan/BlockComposer.test.tsx
git commit -m "feat(plan): name a drawn block inline"
```

---

### Task 4: Wire the gesture into Plan

**Files:**
- Modify: `src/views/plan/WeekGrid.tsx`
- Modify: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `DayColumn`'s `onCreate` (Task 2), `BlockComposer` (Task 3), `actions.createTaskAt` (Task 1).
- Produces: nothing further — this is the top of the stack.

**No unit test for the interaction.** *(Corrected after execution: this originally claimed nothing renders `Plan.tsx`. That was wrong — `src/views/views.smoke.test.ts` renders it with `renderToStaticMarkup`. What the repo lacks is an **interactive** harness: static markup has no hydration and no event handlers, so a keydown or a pointer gesture cannot be driven through it.)*

The composer-open keydown bail therefore stays manual. The behaviour that *can* be unit-tested was pushed down into Tasks 1–3, which is why they carry the assertions. This task is verified by the typechecker, by grep, and by the manual checks in Task 5.

- [ ] **Step 1: Thread `onCreate` through WeekGrid**

In `src/views/plan/WeekGrid.tsx`, add to the props type after `dayCapacity`:

```tsx
  /** Draw a block on a day's empty canvas. Absent ⇒ the canvas is not rendered. */
  onCreate?: (date: string, span: CanvasSpan) => void;
```

Add the import:

```tsx
import type { CanvasSpan } from '../../lib/canvasCreate';
```

Destructure `onCreate` alongside the other props, and pass it to each `DayColumn` (around line 275):

```tsx
            <DayColumn
              key={iso}
              date={iso}
              isToday={iso === today}
              availabilityWindow={windowForDate(iso, windows)}
              nowMinute={iso === today ? nowMinute : null}
              readOnly={readOnly}
              onCreate={onCreate ? (span) => onCreate(iso, span) : undefined}
            >
              {children(iso)}
            </DayColumn>
```

- [ ] **Step 2: Hold the draft in Plan**

In `src/views/Plan.tsx`, add the import and the state (place it beside the other `useState` calls, near `focusedItem`):

```tsx
import { BlockComposer } from './plan/BlockComposer';
import type { CanvasSpan } from '../lib/canvasCreate';

// The block being drawn: a gesture that has landed but not yet been named.
// Ephemeral view state, like `lastViewedWeek` — never in the store.
const [draft, setDraft] = useState<{ date: string; span: CanvasSpan } | null>(null);
```

- [ ] **Step 3: Bail the keydown listener while the composer is open**

This is the subtle one. `Plan`'s listener is registered on `window` in the **capture** phase (`Plan.tsx:336`), so it runs *before* the composer's own `onKeyDown`. A `stopPropagation` inside the field cannot prevent it — the bail has to be here.

At the very top of `onKey` inside the `useEffect` at `Plan.tsx:264`, before `resolvePlanKey`:

```tsx
    function onKey(e: KeyboardEvent) {
      /*
       * The composer owns the keyboard while it is open.
       *
       * This listener is capture-phase on `window`, so it sees every key
       * before the field does and a `stopPropagation` inside the field cannot
       * hold it off. Without this bail, typing a digit into a title places a
       * backlog row on that weekday and an arrow key navigates the week out
       * from under the field.
       */
      if (draft) return;

      const command = resolvePlanKey(e);
      if (!command) return;
```

Add `draft` to that effect's dependency array, which currently reads `[focusedItem, weekStart, availability, isPast]`:

```tsx
  }, [focusedItem, weekStart, availability, isPast, draft]);
```

- [ ] **Step 4: Render the composer and commit through the action**

Pass `onCreate` to `WeekGrid` (the element around `Plan.tsx:523`):

```tsx
            onCreate={(date, span) => setDraft({ date, span })}
```

Inside the `children` render-callback, after `<DayBlocks ... />`, add:

```tsx
              {draft?.date === date && (
                <BlockComposer
                  startMin={draft.span.startMin}
                  durationMin={draft.span.durationMin}
                  onCommit={(title) => {
                    /*
                     * The draft clears either way. On refusal `createTaskAt`
                     * has already shown a toast naming the day's longest free
                     * stretch and created nothing, so leaving the composer
                     * open would just re-offer a span that cannot fit.
                     */
                    actions.createTaskAt(title, draft.date, draft.span.startMin, draft.span.durationMin);
                    setDraft(null);
                  }}
                  onCancel={() => setDraft(null)}
                />
              )}
```

- [ ] **Step 5: Clear a stale draft on week change**

A draft belongs to a date in the week that was on screen. Add, beside the other effects:

```tsx
  // A draft is anchored to a date in the visible week; navigating away would
  // otherwise leave a composer mounted on a day that is no longer rendered.
  useEffect(() => { setDraft(null); }, [weekStart]);
```

- [ ] **Step 6: Typecheck and run the suite**

```bash
npx tsc -b && npm test
```

Expected: both green, with no change in test count from Task 3 (this task adds none).

- [ ] **Step 7: Commit**

```bash
git add src/views/plan/WeekGrid.tsx src/views/Plan.tsx
git commit -m "feat(plan): draw, name and place a block on the week grid"
```

---

### Task 5: Verification sweep

**Files:** none modified — this task only observes.

- [ ] **Step 1: Full suite and typecheck**

```bash
npm test && npx tsc -b
```

Expected: all files pass. The suite stood at **82 files / 1670 tests** when this plan was written, and this plan adds 19 (5 + 7 + 7) across two new files — so **84 files / 1689 tests**. A different number means a test was dropped or duplicated; find out which before moving on.

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 3: `canvasCreate` now has a production caller**

```bash
grep -rn "canvasCreate" src/ | grep -v "src/lib/canvasCreate"
```

Expected: at least `src/views/plan/DayColumn.tsx` and `src/views/Plan.tsx`. Before this plan this grep was empty — that emptiness is what the module's header comment was describing, so **update that comment** (`src/lib/canvasCreate.ts:4–9`) to name its callers instead of predicting them. A stale rationale is worse than none (spec Part 7, risk 3).

- [ ] **Step 4: No second coordinate formula**

```bash
grep -rn "scrollTop" src/views/plan/DayColumn.tsx
```

Expected: **no matches.** The canvas measures its own live rect; a `scrollTop` term here would double-count scroll.

- [ ] **Step 5: Manual checks** — `npm run dev`, then on the Plan view:

- [ ] Drag down an empty part of a working day → a dashed preview follows the pointer, and on release a field appears inside it. Type a name, press Enter → a real block appears at that time.
- [ ] Check the created block's time against where you released. They must match — this is the arithmetic the spec calls its highest risk.
- [ ] Click (don't drag) empty space → a 1-hour composer.
- [ ] Press Esc with the field open → it vanishes, nothing is created.
- [ ] Open a composer and type `3` → the digit lands **in the field**; no backlog row is placed on Wednesday. Then press `→` → the week does **not** change.
- [ ] Scroll the grid to the evening, then drag out a block → it lands at the hour you drew it, not offset by the scroll distance.
- [ ] Drag across a region already full of blocks → a toast naming the longest free stretch, and no block created.
- [ ] Drag on a **day off** (hatched column) → nothing happens. Same on a past week.
- [ ] Press pointerdown on an existing block and drag → it still *moves* the block; it must not draw a new one.
- [ ] Create a block, then hit Undo in the toast → the block disappears. One press, not three.

- [ ] **Step 6: Commit the comment fix from Step 3**

```bash
git add src/lib/canvasCreate.ts
git commit -m "docs(plan): canvasCreate names its callers"
```

---

## What this plan does NOT do

Deliberately deferred to **plan 2b** (spec §2.4–2.8), so this one stays shippable on its own:

- `resizeFromStart` and the top-edge resize handle (§2.4)
- Block selection and the selected-block keyboard — `↑`/`↓` move, `⇧↑`/`⇧↓` resize, `⌫` unschedule, `Space` complete, `⏎` open project (§2.5)
- The live `11:00 – 12:15 · 1h 15m` readout during move and resize (§2.6). The composer shows its own span, but dragging an existing block still has no readout.
- Capacity feedback on the aimed column during a drag (§2.7)
- Drag-to-rail to unschedule (§2.8)

And out of the whole remaster: colour and project identity (Part 3), the capacity gutter and all-day lane (Part 4), and motion (Part 5).
