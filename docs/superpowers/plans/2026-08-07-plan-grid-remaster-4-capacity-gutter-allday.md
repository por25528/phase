# Plan Grid Remaster 4 — Capacity, the Gutter and the All-Day Lane

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** plan 1 (geometry) only. Task 4 (the gutter's draggable rows) is materially better with plan 2b's rail-unschedule in place, but does not require it.

**Goal:** Draw the week's commitment on the grid instead of reporting it as a number beside it — a temperature wash on each column, a gutter band holding the work that is committed but unplaced, and an all-day lane carrying checkpoints and deadlines.

**Architecture:** All three read figures `weekCapacity` already returns; none introduces new arithmetic about time. The wash is `(plannedMin + backlogMin) / freeMin`, the same comparison `isOverCommitted` makes. The gutter's membership rule lives in a pure `weekGutter.ts` derived to agree with `capacity.backlogMin` by construction, with an equality test holding the line. The all-day lane's producer is `checkpoint`/`deadline` on `GoalNode` — not calendar events, which are always `[]`.

**Tech Stack:** React 19, TypeScript, Tailwind, Vitest + @testing-library/react (no jest-dom), dnd-kit.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-02-plan-grid-remaster-design.md`, Part 4.
- **The gutter's total must equal `capacity.backlogMin`.** This is an invariant to test, not a coincidence to maintain — it is the only thing stopping the gutter drifting into a second rail.
- **"Planned" means a day AND a start minute.** `isPlacedLeaf`/`isPlacedTask` (`capacity.ts:168–174`) are the predicates; do not re-derive them.
- The temperature wash **replaces** the today tint. `DayColumn` already stacks four backgrounds; a fifth would be mud. Today keeps its accent day number and its now-line, which are sharper signals than a wash.
- Unestimated items have no honest width: render at `DEFAULT_SLOT_MIN` with the dashed border the grid already uses for guessed durations.
- Theme tokens only; no literal hex. `designScale.test.ts` fails the build on one.
- No jest-dom. `// @vitest-environment jsdom` on line 1 of component tests.
- Run `npm test` and `npx tsc -b` before committing.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/weekGutter.ts` | Create | Membership rule for the gutter, derived to agree with `backlogMin` |
| `src/lib/weekGutter.test.ts` | Create | Including the `backlogMin` equality invariant |
| `src/lib/allDayMarkers.ts` | Create | Checkpoints and deadlines falling in a week |
| `src/lib/allDayMarkers.test.ts` | Create | Its tests |
| `src/views/plan/DayColumn.tsx` | Modify | Temperature wash replaces the today tint |
| `src/views/plan/WeekGutter.tsx` | Create | The band and its draggable rows |
| `src/views/plan/AllDayLane.tsx` | Create | The sticky marker row |
| `src/views/plan/WeekGrid.tsx` | Modify | Render the lane and the gutter |
| `src/views/plan/DayBlocks.tsx` | Modify | Remove the full-height all-day block path |
| `src/views/Plan.tsx` | Modify | Feed all three |

---

### Task 1: The temperature wash

**Files:** Modify `src/views/plan/DayColumn.tsx`, `src/views/plan/WeekGrid.tsx`

**Interfaces:** `DayColumn` gains `heat?: number` (a ratio, not a class). `WeekGrid` computes it from the `dayCapacity` it already receives.

**The ratio is `(plannedMin + backlogMin) / freeMin`** — from figures `weekCapacity` already returns, so it agrees with `isOverCommitted` by construction: that predicate is `plannedMin + backlogMin > freeMin`, which is exactly `ratio > 1`.

**A day with `freeMin === 0` has no ratio.** Dividing gives `Infinity` (or `NaN` when nothing is planned either). Treat zero-free as: hot if anything is committed, neutral otherwise — never `NaN` reaching a style attribute.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/dayHeat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dayHeat } from './dayHeat';

describe('how warm a day should read', () => {
  it('is cool when little of the free time is spoken for', () => {
    expect(dayHeat({ freeMin: 480, plannedMin: 60, backlogMin: 0 })).toBeCloseTo(0.125);
  });

  it('counts committed-but-unplaced work too', () => {
    // The same comparison isOverCommitted makes — a day is not healthy just
    // because the work has not been dropped onto it yet.
    expect(dayHeat({ freeMin: 480, plannedMin: 60, backlogMin: 60 })).toBeCloseTo(0.25);
  });

  it('reaches 1 exactly at the over-commitment boundary', () => {
    expect(dayHeat({ freeMin: 480, plannedMin: 480, backlogMin: 0 })).toBe(1);
  });

  it('exceeds 1 when over-committed', () => {
    expect(dayHeat({ freeMin: 480, plannedMin: 540, backlogMin: 0 })).toBeGreaterThan(1);
  });

  it('is 0 on an empty day', () => {
    expect(dayHeat({ freeMin: 480, plannedMin: 0, backlogMin: 0 })).toBe(0);
  });

  it('never returns NaN or Infinity on a day with no free time', () => {
    // A day off, or one already spent. Both are real and both used to divide
    // by zero straight into a style attribute.
    expect(dayHeat({ freeMin: 0, plannedMin: 0, backlogMin: 0 })).toBe(0);
    expect(dayHeat({ freeMin: 0, plannedMin: 60, backlogMin: 0 })).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/views/plan/dayHeat.test.ts
```

Expected: FAIL — cannot resolve `./dayHeat`.

- [ ] **Step 3: Implement**

Create `src/views/plan/dayHeat.ts`:

```ts
import type { CapacityFigures } from './capacityLabel';

/**
 * How spoken-for a day is, as a ratio of its free time.
 *
 * `(plannedMin + backlogMin) / freeMin` — the SAME sum `isOverCommitted`
 * compares, so `heat > 1` and "over-committed" can never disagree. Work
 * committed to a day but not yet dropped onto it still has to fit.
 *
 * Capped at 2: past that the column is already fully warm and a larger number
 * only makes the interpolation below jumpy.
 */
export function dayHeat(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'>,
): number {
  const committed = c.plannedMin + c.backlogMin;
  // A day with no free time has no ratio. Dividing would give Infinity, or NaN
  // when nothing is committed either — both of which reach a style attribute
  // intact and render as nothing at all, silently.
  if (c.freeMin <= 0) return committed > 0 ? 1 : 0;
  return Math.min(2, committed / c.freeMin);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/views/plan/dayHeat.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Render it, replacing the today tint**

In `src/views/plan/DayColumn.tsx`, add `heat?: number` to the props, and change the root `className`. Remove `${isToday ? 'bg-hover/40' : ''}` entirely and add the wash as an absolutely-positioned layer before `{children}`:

```tsx
      {/*
        Capacity temperature, REPLACING the today tint (spec §4.1). Today keeps
        its accent day number and its now-line, which are sharper signals than a
        background wash — and five stacked backgrounds would be mud.

        Opacity is driven from a computed ratio rather than a class, because
        Tailwind cannot scan an interpolated opacity. The colour itself is a
        token; only the alpha is dynamic.
      */}
      {heat !== undefined && heat > 0 && (
        <div
          className="absolute inset-0 bg-warn pointer-events-none"
          style={{ opacity: Math.min(0.14, heat * 0.07) }}
          aria-hidden="true"
        />
      )}
```

In `src/views/plan/WeekGrid.tsx`, pass it from the `dayCapacity` already in hand:

```tsx
              heat={dayCapacity?.[days.indexOf(iso)] ? dayHeat(dayCapacity[days.indexOf(iso)]) : undefined}
```

> Cleaner: the `days.map((iso) => ...)` at line 274 has no index. Change it to `days.map((iso, i) => ...)` and use `dayCapacity?.[i]`, matching how the heading row at line 214 already reads its capacity.

- [ ] **Step 6: Confirm the today tint is gone, not stacked**

```bash
grep -n "bg-hover/40" src/views/plan/DayColumn.tsx
```

Expected: **no matches.** Spec Part 7, risk 2: if the loss of the tint reads badly in review, weaken the wash — do not restore both.

- [ ] **Step 7: Commit**

```bash
npm test && npx tsc -b
git add src/views/plan/dayHeat.ts src/views/plan/dayHeat.test.ts src/views/plan/DayColumn.tsx src/views/plan/WeekGrid.tsx
git commit -m "feat(plan): warm a column by what it owes"
```

---

### Task 2: `weekGutter.ts`

**Files:** Create `src/lib/weekGutter.ts`, `src/lib/weekGutter.test.ts`

**Interfaces:**
- Consumes: `isPlacedLeaf`, `isPlacedTask`, `normalizeEstimate` (`src/lib/capacity.ts`); `durationOf` (`src/lib/slot.ts`); `PlannedLeaf` (`src/lib/plan.ts`).
- Produces:

```ts
export interface GutterItem {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
  minutes: number;      // DEFAULT_SLOT_MIN when unestimated
  estimated: boolean;   // false ⇒ render dashed; the width is a guess
}
export function weekGutter(leaves: PlannedLeaf[], tasks: Task[]): GutterItem[];
```

**Its contents are exactly the items behind `capacity.backlogMin`** — committed to this week, not on a day and a start minute. It is *not* a second rendering of the rail: the rail lists everything available to plan, including work not committed to this week; the gutter lists the subset already billed to this week's capacity.

Callers pass the **same already-filtered `leaves` and `tasks` they pass `weekCapacity`**. That is what makes the totals agree by construction rather than by coincidence.

- [ ] **Step 1: Write the failing test**

Create `src/lib/weekGutter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { weekGutter } from './weekGutter';
import { weekCapacity } from './capacity';
import { DEFAULT_SLOT_MIN } from './slot';
import type { PlannedLeaf } from './plan';
import type { Task } from '../db/types';

const WEEK = '2026-07-13';
const WINDOWS = [0, 1, 2, 3, 4].map((dow) => ({ dow, startMin: 540, endMin: 1080 }));
const NOW = { date: '2026-07-15', minute: 480 };

function leaf(over: Partial<PlannedLeaf> = {}): PlannedLeaf {
  return {
    goalId: 'g1', goalTitle: 'P', nodeId: 'n1', title: 'Step',
    done: false, plannedWeek: WEEK, ...over,
  } as PlannedLeaf;
}

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Task', done: false, goalId: null, ...over } as Task;
}

describe('what belongs in the gutter', () => {
  it('holds work committed to the week but not placed on it', () => {
    const items = weekGutter([leaf({ estimateMin: 60 })], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'step', id: 'n1', minutes: 60, estimated: true });
  });

  it('excludes work that is on the grid', () => {
    const placed = leaf({ estimateMin: 60, plannedDay: '2026-07-15', plannedStartMin: 540 });
    expect(weekGutter([placed], [])).toEqual([]);
  });

  it('excludes finished work', () => {
    expect(weekGutter([leaf({ estimateMin: 60, done: true })], [])).toEqual([]);
  });

  it('gives unestimated work the default width and flags it as a guess', () => {
    const items = weekGutter([leaf()], []);
    expect(items[0].minutes).toBe(DEFAULT_SLOT_MIN);
    expect(items[0].estimated).toBe(false);
  });

  it('includes a dated task with no start minute', () => {
    // ⌘N always sets a date and never a start minute — the canonical case.
    const items = weekGutter([], [task({ date: '2026-07-15', estimateMin: 30 })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'task', id: 't1', minutes: 30 });
  });

  it('excludes a task already placed on the grid', () => {
    expect(weekGutter([], [task({ date: '2026-07-15', startMin: 600 })])).toEqual([]);
  });
});

describe('the invariant that keeps it from becoming a second rail', () => {
  it('totals exactly capacity.backlogMin for the same fixture week', () => {
    const leaves = [
      leaf({ nodeId: 'a', estimateMin: 60 }),
      leaf({ nodeId: 'b', estimateMin: 90 }),
      leaf({ nodeId: 'c', estimateMin: 45, plannedDay: '2026-07-15', plannedStartMin: 540 }),
      leaf({ nodeId: 'd', estimateMin: 30, done: true }),
    ];
    const tasks = [
      task({ id: 't1', date: '2026-07-15', estimateMin: 25 }),
      task({ id: 't2', date: '2026-07-15', startMin: 700, estimateMin: 15 }),
    ];

    const capacity = weekCapacity({
      week: WEEK, windows: WINDOWS, blocks: [], leaves, tasks,
      now: NOW, allDayBlocks: true, hasData: false,
    });
    const gutterTotal = weekGutter(leaves, tasks).reduce((sum, i) => sum + i.minutes, 0);

    // Unestimated items are excluded from BOTH sides: weekCapacity counts them
    // in `unestimated`, not `backlogMin`, so the gutter's DEFAULT_SLOT_MIN
    // fallback must not be counted here either. Every item above is priced.
    expect(gutterTotal).toBe(capacity.backlogMin);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/weekGutter.test.ts
```

Expected: FAIL — cannot resolve `./weekGutter`.

- [ ] **Step 3: Implement**

Create `src/lib/weekGutter.ts`:

```ts
import type { Task } from '../db/types';
import { isPlacedLeaf, isPlacedTask, normalizeEstimate } from './capacity';
import { DEFAULT_SLOT_MIN, durationOf } from './slot';
import type { PlannedLeaf } from './plan';

export interface GutterItem {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
  /** Width on the band. `DEFAULT_SLOT_MIN` when the item carries no estimate. */
  minutes: number;
  /** False ⇒ the width is a guess and must render dashed, as blocks do. */
  estimated: boolean;
}

/**
 * The week's committed-but-unplaced work — exactly the items behind
 * `capacity.backlogMin`.
 *
 * This is NOT a second rendering of the rail. The rail lists everything
 * available to plan, including work not committed to this week; the gutter
 * lists only the subset already billed to this week's capacity. Callers pass
 * the SAME already-filtered `leaves` and `tasks` they pass `weekCapacity`,
 * which is what makes the two totals agree by construction. Its sibling test
 * asserts that equality — if the membership rule ever drifts, that is what
 * catches it.
 */
export function weekGutter(leaves: PlannedLeaf[], tasks: Task[]): GutterItem[] {
  const out: GutterItem[] = [];

  for (const l of leaves) {
    if (l.done || isPlacedLeaf(l)) continue;
    out.push({
      kind: 'step',
      id: l.nodeId,
      goalId: l.goalId,
      title: l.title,
      minutes: durationOf(l.estimateMin),
      estimated: normalizeEstimate(l.estimateMin) !== undefined,
    });
  }

  for (const t of tasks) {
    if (t.done || isPlacedTask(t)) continue;
    out.push({
      kind: 'task',
      id: t.id,
      goalId: t.goalId,
      title: t.title,
      minutes: durationOf(t.estimateMin),
      estimated: normalizeEstimate(t.estimateMin) !== undefined,
    });
  }

  return out;
}
```

> `durationOf` returns `DEFAULT_SLOT_MIN` for an absent estimate — the same fallback the grid uses for an unestimated block, which is why the two render at the same width.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/weekGutter.test.ts
```

Expected: PASS (7 tests).

**If the equality test fails**, do not adjust the expected number. Find which item one side counts and the other does not — that disagreement *is* the bug, and it is the whole reason the test exists.

- [ ] **Step 5: Prove the invariant bites**

Temporarily drop the `l.done ||` guard. Re-run. Expected: `totals exactly capacity.backlogMin` FAILS by 30 minutes (the done leaf). **Revert.**

- [ ] **Step 6: Commit**

```bash
npm test && npx tsc -b
git add src/lib/weekGutter.ts src/lib/weekGutter.test.ts
git commit -m "feat(plan): derive the week's unplaced commitment"
```

---

### Task 3: `allDayMarkers.ts`

**Files:** Create `src/lib/allDayMarkers.ts`, `src/lib/allDayMarkers.test.ts`

**Interfaces:**
- Consumes: `walkLeaves` (`src/lib/plan.ts`), `weekDates` (`src/lib/plan.ts`).
- Produces:

```ts
export interface AllDayMarker {
  id: string;
  goalId: string;
  title: string;
  date: string;
  kind: 'checkpoint' | 'deadline';
  done: boolean;
}
export function allDayMarkers(goals: Goal[], week: string): AllDayMarker[];
```

**Checkpoints and deadlines are the producer, not calendar events** (spec §4.3). `blocks` is always `[]`, so a lane built only for busy events would ship empty — whereas `checkpoint?: boolean` and `deadline` are all-day facts already carried on `GoalNode`.

A checkpoint's date **is** its `deadline` (the migration writes `start === deadline`), so a checkpoint must be classified as `'checkpoint'` and not *also* emitted as a `'deadline'` for the same node.

- [ ] **Step 1: Write the failing test**

Create `src/lib/allDayMarkers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { allDayMarkers } from './allDayMarkers';
import type { Goal } from '../db/types';

const WEEK = '2026-07-13'; // Monday; the week runs to 2026-07-19

function goal(nodes: Goal['nodes']): Goal {
  return { id: 'g1', title: 'P', column: 0, nodes } as Goal;
}

describe('markers above the grid', () => {
  it('emits a checkpoint on its deadline date', () => {
    const g = goal([{ id: 'n1', title: 'Exam', done: false, checkpoint: true, start: '2026-07-15', deadline: '2026-07-15' }]);
    expect(allDayMarkers([g], WEEK)).toEqual([
      { id: 'n1', goalId: 'g1', title: 'Exam', date: '2026-07-15', kind: 'checkpoint', done: false },
    ]);
  });

  it('emits an ordinary deadline as a deadline', () => {
    const g = goal([{ id: 'n1', title: 'Draft', done: false, start: '2026-07-13', deadline: '2026-07-16' }]);
    expect(allDayMarkers([g], WEEK)[0]).toMatchObject({ kind: 'deadline', date: '2026-07-16' });
  });

  it('never emits one node twice', () => {
    // A checkpoint's date IS its deadline. Emitting both would double it.
    const g = goal([{ id: 'n1', title: 'Exam', done: false, checkpoint: true, start: '2026-07-15', deadline: '2026-07-15' }]);
    expect(allDayMarkers([g], WEEK)).toHaveLength(1);
  });

  it('excludes dates outside the week', () => {
    const g = goal([
      { id: 'n1', title: 'Before', done: false, checkpoint: true, start: '2026-07-12', deadline: '2026-07-12' },
      { id: 'n2', title: 'After', done: false, checkpoint: true, start: '2026-07-20', deadline: '2026-07-20' },
    ]);
    expect(allDayMarkers([g], WEEK)).toEqual([]);
  });

  it('includes both ends of the week', () => {
    const g = goal([
      { id: 'n1', title: 'Mon', done: false, checkpoint: true, start: '2026-07-13', deadline: '2026-07-13' },
      { id: 'n2', title: 'Sun', done: false, checkpoint: true, start: '2026-07-19', deadline: '2026-07-19' },
    ]);
    expect(allDayMarkers([g], WEEK)).toHaveLength(2);
  });

  it('keeps a completed checkpoint, marked done', () => {
    // It still happened. Hiding it would make the week look emptier than it was.
    const g = goal([{ id: 'n1', title: 'Exam', done: true, checkpoint: true, start: '2026-07-15', deadline: '2026-07-15' }]);
    expect(allDayMarkers([g], WEEK)[0].done).toBe(true);
  });

  it('skips archived projects', () => {
    const g = { ...goal([{ id: 'n1', title: 'Exam', done: false, checkpoint: true, start: '2026-07-15', deadline: '2026-07-15' }]), completedAt: '2026-07-01' } as Goal;
    expect(allDayMarkers([g], WEEK)).toEqual([]);
  });

  it('sorts by date', () => {
    const g = goal([
      { id: 'n2', title: 'Later', done: false, checkpoint: true, start: '2026-07-17', deadline: '2026-07-17' },
      { id: 'n1', title: 'Earlier', done: false, checkpoint: true, start: '2026-07-14', deadline: '2026-07-14' },
    ]);
    expect(allDayMarkers([g], WEEK).map((m) => m.id)).toEqual(['n1', 'n2']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/allDayMarkers.test.ts
```

Expected: FAIL — cannot resolve `./allDayMarkers`.

- [ ] **Step 3: Implement**

Create `src/lib/allDayMarkers.ts`:

```ts
import type { Goal } from '../db/types';
import { walkLeaves } from './plan';
import { weekDates } from './dates'; // NB: dates.ts, not plan.ts

/**
 * A dated fact that belongs above the grid rather than on it.
 *
 * The producer is checkpoints and deadlines, NOT calendar events: `blocks` is
 * always `[]`, so a lane built only for busy events would ship empty, whereas
 * `checkpoint` and `deadline` are all-day facts already on `GoalNode`.
 */
export interface AllDayMarker {
  id: string;
  goalId: string;
  title: string;
  date: string;
  kind: 'checkpoint' | 'deadline';
  done: boolean;
}

export function allDayMarkers(goals: Goal[], week: string): AllDayMarker[] {
  const dates = weekDates(week);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const out: AllDayMarker[] = [];

  for (const g of goals) {
    if (g.completedAt) continue; // archived projects surface nothing
    walkLeaves(g, (n) => {
      if (n.deadline === undefined) return;
      if (n.deadline < first || n.deadline > last) return;
      out.push({
        id: n.id,
        goalId: g.id,
        title: n.title,
        date: n.deadline,
        // A checkpoint's date IS its deadline — the migration writes
        // `start === deadline` — so it is classified once, here, and never
        // emitted a second time as an ordinary deadline.
        kind: n.checkpoint ? 'checkpoint' : 'deadline',
        // Kept rather than filtered: a checkpoint that has been reached still
        // happened, and hiding it would make the week look emptier than it was.
        done: !!n.done,
      });
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/allDayMarkers.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc -b
git add src/lib/allDayMarkers.ts src/lib/allDayMarkers.test.ts
git commit -m "feat(plan): collect the week's checkpoints and deadlines"
```

---

### Task 4: The gutter band

**Files:** Create `src/views/plan/WeekGutter.tsx`; modify `src/views/plan/WeekGrid.tsx`, `src/views/Plan.tsx`

**The gutter is a source, not a drop target** (spec §4.2). Its rows carry the same `PlanDragData` contract the rail's rows do, so dragging one onto the grid needs no new path. Dropping *onto* the gutter is deliberately undefined, and the rail remains the only unschedule target — because the two kinds do not land in the same place:

- Unscheduling a **step** clears `plannedDay`/`plannedStartMin` but leaves `plannedWeek` set, so it stays committed to the week and *does* reappear in the gutter.
- Unscheduling a **task** clears `date` **and** `startMin` together, so it leaves the week entirely and appears only in the rail.

A gutter that accepted drops would therefore swallow tasks that never reappear in it.

- [ ] **Step 1: Build the band**

Create `src/views/plan/WeekGutter.tsx`:

```tsx
import { useDraggable } from '@dnd-kit/core';
import { PX_PER_MINUTE } from '../../lib/grid';
import { containerDragAttributes } from '../../lib/dragAttributes';
import { formatMinutes } from './capacityLabel';
import type { GutterItem } from '../../lib/weekGutter';
import type { PlanDragData } from './dropTarget';

/**
 * The week's committed-but-unplaced work, drawn to scale beneath the grid.
 *
 * A SOURCE, not a drop target (spec §4.2). Rows carry the same `PlanDragData`
 * the rail's rows do, so dragging one onto a day needs no new path; but the
 * rail stays the only unschedule target, because unscheduling a task removes it
 * from the week entirely and it would never reappear here.
 */
export function WeekGutter({ items, total }: { items: GutterItem[]; total: number }) {
  if (items.length === 0) return null;

  return (
    <div className="border-t border-line px-[8px] py-[6px]">
      <div className="flex items-baseline gap-[8px] mb-[4px]">
        <span className="font-mono text-eyebrow tracking-[.13em] uppercase text-muted font-semibold">
          To place
        </span>
        <span className="font-mono text-eyebrow text-muted tabular-nums">
          {formatMinutes(total)}
        </span>
      </div>
      <div className="flex flex-wrap gap-[4px]">
        {items.map((item) => <GutterRow key={`${item.kind}:${item.id}`} item={item} />)}
      </div>
    </div>
  );
}

function GutterRow({ item }: { item: GutterItem }) {
  const data: PlanDragData = {
    kind: item.kind, id: item.id, goalId: item.goalId, title: item.title,
  };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    // Same id format the rail and the grid use, so one item is one draggable
    // identity wherever it is rendered.
    id: `${item.kind}:${item.id}`,
    data,
  });

  return (
    <div
      ref={setNodeRef}
      {...containerDragAttributes(attributes, { keyboardDraggable: true })}
      {...listeners}
      aria-label={`${item.title}, ${formatMinutes(item.minutes)} — drag onto a day`}
      title={`${item.title} · ${formatMinutes(item.minutes)}${item.estimated ? '' : ' · no estimate'}`}
      style={{ width: `${Math.max(item.minutes * PX_PER_MINUTE, 48)}px` }}
      className={`shrink-0 truncate rounded-[6px] border border-line-2 bg-panel px-[5px] py-[2px] text-badge text-ink cursor-grab touch-none ${
        item.estimated ? '' : 'border-dashed'
      } ${isDragging ? 'opacity-40' : 'hover:bg-hover'}`}
    >
      {item.title}
    </div>
  );
}
```

> The dashed border for unestimated items is the same signal the grid already uses for a guessed duration (`EventBlock`'s `block.estimated ? '' : 'border-dashed'`), so a guess never reads as a measurement.

> `useDraggable` ids collide by design with the rail's rows (`${kind}:${id}`). **dnd-kit requires unique droppable/draggable ids within one `DndContext`.** If an item can be in the rail *and* the gutter simultaneously, this breaks. It cannot: `backlogGroups` excludes placed work and includes committed work, and the gutter holds only committed-unplaced work — so a committed step appears in **both**. Prefix the gutter's id (`gutter:${kind}:${id}`) and strip the prefix in `handleDragEnd`, or confirm by test that the two sets are disjoint before relying on the shared id.

- [ ] **Step 2: Resolve the id collision before wiring**

Run the app with a committed-but-unplaced step and check the console for dnd-kit duplicate-id warnings. If present (expected), change the gutter's draggable id to `` `gutter:${item.kind}:${item.id}` ``. `handleDragEnd` reads `e.active.data.current`, not the id, so **no drop handler changes are needed** — the id is only an identity for dnd-kit.

- [ ] **Step 3: Render it under the grid**

In `Plan.tsx`, derive the items from the same arrays `weekCapacity` gets:

```tsx
  // The SAME leaves and tasks weekCapacity receives — that is what makes the
  // band's total and the header's "to place" figure agree by construction.
  const gutterItems = useMemo(() => weekGutter(weekLeaves, weekTasks), [weekLeaves, weekTasks]);
```

and render `<WeekGutter items={gutterItems} total={capacity.backlogMin} />` immediately after `</WeekGrid>`.

- [ ] **Step 4: Verify the totals agree on screen**

Open the app with several committed-but-unplaced items. The gutter's header figure must read the same as the week header's "to place". They come from the same number (`capacity.backlogMin`), so a mismatch means the band is rendering a different set than it is totalling.

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc -b
git add src/views/plan/WeekGutter.tsx src/views/Plan.tsx
git commit -m "feat(plan): draw the week's unplaced commitment"
```

---

### Task 5: The all-day lane

**Files:** Create `src/views/plan/AllDayLane.tsx`; modify `src/views/plan/WeekGrid.tsx`, `src/views/plan/DayBlocks.tsx`

**This replaces the current all-day path**, which renders an all-day event as a block spanning the entire visible range (`DayBlocks.tsx:89–103`) — obliterating the day rather than sitting above it. That path is unexercised today (`blocks` is always `[]`), so changing it costs nothing now and avoids shipping the wrong behaviour later.

- [ ] **Step 1: Export the axis width first**

`AXIS_WIDTH_PX` is currently a module-private `const` inside `WeekGrid.tsx` (line 26), so the lane cannot import it — and the lane's column template must match the grid's exactly or the two will not line up. Move it to `src/lib/grid.ts`, where the rest of the grid geometry already lives:

```ts
/** The hour-axis gutter. Shared by the headings, the grid and the all-day lane. */
export const AXIS_WIDTH_PX = 46;
```

Delete the local const from `WeekGrid.tsx` and add `AXIS_WIDTH_PX` to its existing `../../lib/grid` import. Its four usages (lines 137, 140, 206, 249) are unchanged.

- [ ] **Step 2: Build the lane**

Create `src/views/plan/AllDayLane.tsx`:

```tsx
import { AXIS_WIDTH_PX, Z_HEADINGS } from '../../lib/grid';
import type { AllDayMarker } from '../../lib/allDayMarkers';

/**
 * The sticky row between the day headings and the grid.
 *
 * Carries checkpoints and deadlines — all-day facts that have a date but no
 * time, and which the hour grid therefore cannot express without lying about
 * when they happen.
 */
export function AllDayLane({ days, markers }: { days: string[]; markers: AllDayMarker[] }) {
  if (markers.length === 0) return null;

  return (
    <div
      className="grid gap-0 sticky bg-bg border-b border-line"
      style={{
        gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))`,
        zIndex: Z_HEADINGS,
      }}
    >
      <span className="sticky left-0 bg-bg font-mono text-micro uppercase text-faint self-center pl-[4px]">
        all day
      </span>
      {days.map((iso) => (
        <div key={iso} className="min-w-0 border-l border-line-soft px-[2px] py-[2px] space-y-[2px]">
          {markers.filter((m) => m.date === iso).map((m) => (
            <div
              key={m.id}
              title={m.title}
              className={`truncate rounded-[4px] px-[4px] text-badge ${
                m.kind === 'checkpoint'
                  ? 'bg-accent-tint text-ink font-medium'
                  : 'bg-hover text-ink-soft'
              } ${m.done ? 'opacity-55 line-through' : ''}`}
            >
              {m.title}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

> A checkpoint is a marker the user is working *toward* — it gets the accent tint. An ordinary deadline is quieter. Both keep the `opacity-55 line-through` the grid already uses for done work, so one idiom means "finished" everywhere.

> `Z_HEADINGS` is already exported from `grid.ts` (line 134); `AXIS_WIDTH_PX` is exported by Step 1 of this task.

- [ ] **Step 3: Render it between the headings and the grid**

In `WeekGrid.tsx`, add `markers?: AllDayMarker[]` to the props and render `<AllDayLane days={days} markers={markers ?? []} />` immediately after the day-headings block (which closes at line 242) and before the hour grid (`<div ref={gridRef}` at line 245).

> Its `sticky` offset must sit **below** the headings, which are `sticky top-0`. Give the lane `style={{ top: HEADINGS_HEIGHT }}` or wrap both in one sticky container — otherwise the two overlap on scroll. Measure the headings row rather than guessing: it is `mb-[4px]` plus three text rows, one of them a fixed `h-[12px]`.

In `Plan.tsx`: `markers={useMemo(() => allDayMarkers(goals, weekStart), [goals, weekStart])}`.

- [ ] **Step 4: Remove the old all-day block path**

In `src/views/plan/DayBlocks.tsx`, delete the branch at lines 89–103 that renders an all-day event as a full-range block. Anything that filtered `blocks` for `allDay` in order to build it goes too.

```bash
grep -n "allDay" src/views/plan/DayBlocks.tsx
```

Expected after the edit: only the `allDayBlocks` **prop** (the user preference that decides whether all-day events consume a day for capacity purposes) remains. That is a different thing from rendering one and must not be removed.

- [ ] **Step 5: Typecheck, suite, commit**

```bash
npx tsc -b && npm test
git add src/lib/grid.ts src/views/plan/AllDayLane.tsx src/views/plan/WeekGrid.tsx src/views/plan/DayBlocks.tsx src/views/Plan.tsx
git commit -m "feat(plan): an all-day lane for checkpoints and deadlines"
```

---

### Task 6: Verification sweep

- [ ] **Step 1: Suite, typecheck, build**

```bash
npm test && npx tsc -b && npm run build
```

This plan adds 21 tests (6 + 7 + 8).

- [ ] **Step 2: The gutter cannot drift**

```bash
npx vitest run src/lib/weekGutter.test.ts -t "capacity.backlogMin"
```

Expected: PASS. This is the one test that keeps the gutter from becoming a second rail.

- [ ] **Step 3: Backgrounds did not stack**

```bash
grep -c "absolute inset-0" src/views/plan/DayColumn.tsx
```

Expected: the availability dims plus exactly one wash — not a wash added on top of a surviving today tint.

- [ ] **Step 4: Manual checks** — `npm run dev`:

- [ ] A day with little planned looks neutral; a day approaching its limit is visibly warm; an over-committed day is warmest. The progression must be legible, not a single step.
- [ ] Today no longer has its own background tint, but is still obvious from the accent date and the now-line.
- [ ] Toggle dark mode → the wash is still visible and still not mud.
- [ ] The gutter's "to place" figure equals the week header's "to place" figure. Change something and check they move together.
- [ ] Drag an item out of the gutter onto a day → it places, and leaves the gutter.
- [ ] Unschedule a **step** from the grid → it reappears in the gutter (still committed to the week).
- [ ] Unschedule a **task** → it does **not** appear in the gutter; it goes to the rail. This asymmetry is deliberate — confirm it, don't "fix" it.
- [ ] An unestimated item in the gutter is dashed and one hour wide.
- [ ] A checkpoint in the visible week shows in the all-day lane; scroll the grid vertically and the lane stays put beneath the day headings, not overlapping them.
- [ ] A completed checkpoint still shows, struck through.
- [ ] A week with no checkpoints or deadlines renders no lane at all — no empty band.

---

## What this plan does NOT do

- Parts 2 and 3 of the spec — plans 2a, 2b and 3.
- Google Calendar busy blocks. `blocks` stayed `[]` for this plan; the integration was shelved at the time and landed on 2026-08-30 (`docs/google-calendar-setup.md`). The all-day lane is built on checkpoints and deadlines precisely so it ships independently of that producer.
- Ghost auto-place, the now-band, estimate-vs-actual rendering, multi-select on the grid, a day/3-day view, mobile layout, or any change to `Session`.
