# Calendar Grid Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the planner's day-stack with a real calendar hour grid — steps and tasks gain clock times, snap to the nearest gap that fits, and render on a week grid at a new `Plan` view.

**Architecture:** Three new pure modules in `src/lib` (`slot.ts` for gap-finding, `grid.ts` for geometry, `migrateSlots.ts` for the one-shot data rewrite) carry all the logic and all the tests. A new `src/views/Plan.tsx` plus `src/views/plan/` components render them. Plan is added as a **fourth** nav item; `Today` and `PlanWeekOverlay` remain fully working and untouched throughout this plan.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 3, Dexie/IndexedDB, `@dnd-kit/core`, Vitest (`environment: 'node'`).

## Scope

This is **plan 1 of 2**. It delivers the working grid behind a fourth nav item. Plan 2 covers the sidebar accordion and its five panels, the inline recap, keyboard shortcuts, and the flip that makes Plan the home view and deletes `Today`.

Spec: `docs/superpowers/specs/2026-07-29-plan-week-calendar-redesign-design.md`

## Global Constraints

- **`npm`, `npx` and `node` are broken in this shell.** They are zsh functions wrapping a missing `_load_nvm`. They fail with `command not found: _load_nvm` and `maximum nested function level reached`, and **`$?` after a pipe reports 0, so a failing build looks like a pass.** Always run the binaries directly:
  - Tests: `./node_modules/.bin/vitest run --config vitest.config.ts`
  - Typecheck: `./node_modules/.bin/tsc -b`
  - Never trust an `echo "EXIT=$?"` placed after a pipe or `tail`.
- **Never stage, modify, or commit `src/components/GoalTree.tsx`.** It holds unrelated uncommitted user work. **Never use `git add -A` or `git add .`** — stage every file explicitly by path.
- `dow` is `0 = Monday … 6 = Sunday`, matching `weekDates()` and `dowOf()`.
- Minutes are integers from local midnight, `0..1440`, **end exclusive**.
- `DEFAULT_SLOT_MIN = 60`. `SLOT_GRANULARITY_MIN = 5`. Both named exports from `src/lib/slot.ts` — never inline literals.
- Pure modules in `src/lib` must not read the clock. The current moment arrives as the existing `Now` interface from `capacity.ts`.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`.
- Views never call `db` directly. App-data mutations go through `actions` → `setAndPersist`. Device preferences use `set()` plus their own save, like `setAvailability`.
- Visual identity is locked (`CLAUDE.md`). Use existing Tailwind tokens (`text-ink`, `text-muted`, `text-faint`, `bg-panel`, `border-line`, `border-line-2`, `text-accent`, `text-warn`, `bg-hover`). Do not introduce new colours.
- Vitest runs with `environment: 'node'` — **there is no DOM**. React components cannot be unit-tested; they are covered by `tsc -b` plus the explicit manual smoke checks each view task lists.
- Run `./node_modules/.bin/tsc -b` and the full suite before every commit.

---

### Task 1: Schema fields and optional `Task.date`

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/lib/dailyWork.ts:302-313`
- Modify: `src/views/plan/PlanWeekOverlay.tsx:226`
- Test: `src/lib/dailyWork.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GoalNode.plannedStartMin?: number`, `Task.date?: string`, `Task.startMin?: number`.

`Task.date` becomes optional so an unscheduled task has somewhere to live. `isValidLocalDate(value: unknown): value is string` already narrows `string | undefined`, so most call sites need no change.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/dailyWork.test.ts`:

```ts
it('excludes a task with no date from the week', () => {
  const dated: Task = { id: 't1', title: 'Dated', date: '2026-07-15', done: false, goalId: null };
  const undated: Task = { id: 't2', title: 'Undated', done: false, goalId: null };
  expect(tasksForWeek([dated, undated], '2026-07-13').map((t) => t.id)).toEqual(['t1']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/dailyWork.test.ts`
Expected: FAIL — TypeScript rejects the `undated` literal because `date` is required.

- [ ] **Step 3: Add the fields**

In `src/db/types.ts`, inside `GoalNode`, directly after `plannedDay`:

```ts
  plannedStartMin?: number; // minutes from local midnight, 0..1440. Never present
                            // without plannedDay. Scheduling metadata: never
                            // affects the pct roll-up.
```

Replace the `date` line in `Task` and add `startMin`:

```ts
  date?: string; // 'YYYY-MM-DD'. ABSENT = unscheduled — the task lives in the
                 // sidebar backlog, not on any day.
  startMin?: number; // minutes from local midnight. Never present without `date`.
```

- [ ] **Step 4: Fix the two sites TypeScript flags**

In `src/lib/dailyWork.ts`, `tasksForWeek` filters with `isValidLocalDate` but TypeScript does not carry that narrowing into `.sort`. Replace the sort comparator (line ~312):

```ts
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.title.localeCompare(b.title));
```

In `src/views/plan/PlanWeekOverlay.tsx` line 226:

```ts
  for (const task of weekTasks) if (task.date) tasksByDay.get(task.date)?.push(task);
```

- [ ] **Step 5: Run the full suite and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS, including the new case.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/db/types.ts src/lib/dailyWork.ts src/lib/dailyWork.test.ts src/views/plan/PlanWeekOverlay.tsx
git commit -m "feat(types): add plannedStartMin/startMin, make Task.date optional"
```

---

### Task 2: `freeIntervals` — the gaps in a day

**Files:**
- Create: `src/lib/slot.ts`
- Create: `src/lib/slot.test.ts`
- Modify: `src/lib/capacity.ts:43` (export `remainingWindow`)

**Interfaces:**
- Consumes: `Now`, `Interval`, `mergeIntervals`, `normalizeEstimate` from `src/lib/capacity.ts`; `windowForDate` from `src/lib/availability.ts`.
- Produces:
  - `DEFAULT_SLOT_MIN: 60`, `SLOT_GRANULARITY_MIN: 5`
  - `durationOf(estimateMin: number | undefined): number`
  - `interface PlacedSpan { startMin: number; endMin: number }`
  - `freeIntervals(date: string, windows: AvailabilityWindow[], blocks: BusyBlock[], placed: PlacedSpan[], now: Now, allDayBlocks: boolean): Interval[]`

`remainingWindow` is exported rather than reimplemented — the "today starts at now, the past is not capacity" rule must have exactly one definition.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/slot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, BusyBlock } from '../db/types';
import { durationOf, freeIntervals, DEFAULT_SLOT_MIN } from './slot';
import type { Now } from './capacity';

// 2026-07-15 is a Wednesday → dow 2.
const WED = '2026-07-15';
const WINDOWS: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1080 }]; // 09:00–18:00
const EARLY: Now = { date: '2026-07-01', minute: 0 }; // before WED — no past-clamping

function busy(startMin: number, endMin: number, allDay = false): BusyBlock {
  return { date: WED, startMin, endMin, title: 'Lecture', allDay };
}

describe('durationOf', () => {
  it('uses the estimate when it is usable', () => {
    expect(durationOf(90)).toBe(90);
  });
  it('falls back to DEFAULT_SLOT_MIN for absent or unusable estimates', () => {
    expect(durationOf(undefined)).toBe(DEFAULT_SLOT_MIN);
    expect(durationOf(0)).toBe(DEFAULT_SLOT_MIN);
    expect(durationOf(-30)).toBe(DEFAULT_SLOT_MIN);
  });
});

describe('freeIntervals', () => {
  it('returns the whole window when the day is empty', () => {
    expect(freeIntervals(WED, WINDOWS, [], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 1080 }]);
  });

  it('returns nothing for a day with no availability window', () => {
    expect(freeIntervals('2026-07-18', WINDOWS, [], [], EARLY, true)).toEqual([]); // Saturday
  });

  it('splits the window around a busy block', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(600, 690)], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 690, endMin: 1080 }]);
  });

  it('subtracts already-placed work as well as calendar events', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(600, 690)], [{ startMin: 690, endMin: 780 }], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 780, endMin: 1080 }]);
  });

  it('merges overlapping busy blocks instead of double-subtracting', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(600, 700), busy(650, 720)], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 720, endMin: 1080 }]);
  });

  it('clips busy blocks that overhang the window', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(480, 600), busy(1020, 1200)], [], EARLY, true))
      .toEqual([{ startMin: 600, endMin: 1020 }]);
  });

  it('returns nothing when an all-day event consumes the day and the pref is on', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(0, 1440, true)], [], EARLY, true)).toEqual([]);
  });

  it('ignores an all-day event when the pref is off', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(0, 1440, true)], [], EARLY, false))
      .toEqual([{ startMin: 540, endMin: 1080 }]);
  });

  it('starts today at the current minute — the past is not capacity', () => {
    const now: Now = { date: WED, minute: 700 };
    expect(freeIntervals(WED, WINDOWS, [], [], now, true))
      .toEqual([{ startMin: 700, endMin: 1080 }]);
  });

  it('returns nothing for a day already past', () => {
    const now: Now = { date: '2026-07-16', minute: 0 };
    expect(freeIntervals(WED, WINDOWS, [], [], now, true)).toEqual([]);
  });

  it('returns nothing once today’s window has closed', () => {
    const now: Now = { date: WED, minute: 1100 };
    expect(freeIntervals(WED, WINDOWS, [], [], now, true)).toEqual([]);
  });

  it('ignores busy blocks belonging to other days', () => {
    const other: BusyBlock = { date: '2026-07-16', startMin: 600, endMin: 690, title: 'x', allDay: false };
    expect(freeIntervals(WED, WINDOWS, [other], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 1080 }]);
  });

  it('drops a gap that closes to zero width', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(540, 700), busy(700, 1080)], [], EARLY, true))
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/slot.test.ts`
Expected: FAIL — `Failed to resolve import "./slot"`.

- [ ] **Step 3: Export `remainingWindow` from `capacity.ts`**

In `src/lib/capacity.ts`, change line 43 from `function remainingWindow(` to:

```ts
export function remainingWindow(
```

Leave its body and doc comment unchanged.

- [ ] **Step 4: Write `src/lib/slot.ts`**

```ts
import type { AvailabilityWindow, BusyBlock } from '../db/types';
import {
  mergeIntervals,
  normalizeEstimate,
  remainingWindow,
  type Interval,
  type Now,
} from './capacity';

/** Height of a block whose step carries no usable estimate. */
export const DEFAULT_SLOT_MIN = 60;

/** Start times are snapped to this grid before searching for a gap. */
export const SLOT_GRANULARITY_MIN = 5;

/** A span already occupying part of a day. */
export interface PlacedSpan {
  startMin: number;
  endMin: number;
}

/**
 * How tall a block is. An absent or unusable estimate yields DEFAULT_SLOT_MIN;
 * the caller renders that case with a dashed border so a guessed hour never
 * reads as a real estimate.
 */
export function durationOf(estimateMin: number | undefined): number {
  return normalizeEstimate(estimateMin) ?? DEFAULT_SLOT_MIN;
}

/**
 * The disjoint, ascending free gaps on `date`: the remaining availability
 * window minus calendar events minus work already placed.
 *
 * Busy blocks and placed spans are merged together before subtraction — two
 * overlapping meetings must contribute their UNION, or the overlap is
 * subtracted twice and free time is understated (same reasoning as
 * `freeMinutes` in capacity.ts, which this deliberately mirrors).
 */
export function freeIntervals(
  date: string,
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  placed: PlacedSpan[],
  now: Now,
  allDayBlocks: boolean,
): Interval[] {
  const win = remainingWindow(date, windows, now);
  if (!win) return [];

  const dayBlocks = blocks.filter((b) => b.date === date && (allDayBlocks || !b.allDay));
  if (dayBlocks.some((b) => b.allDay)) return []; // an all-day event consumes the day

  const busy = mergeIntervals([
    ...dayBlocks.map((b) => ({ startMin: b.startMin, endMin: b.endMin })),
    ...placed.map((p) => ({ startMin: p.startMin, endMin: p.endMin })),
  ]);

  const out: Interval[] = [];
  let cursor = win.startMin;
  for (const b of busy) {
    if (b.endMin <= cursor) continue;      // entirely behind the cursor
    if (b.startMin >= win.endMin) break;   // past the window — nothing left to cut
    if (b.startMin > cursor) out.push({ startMin: cursor, endMin: Math.min(b.startMin, win.endMin) });
    cursor = Math.max(cursor, b.endMin);
    if (cursor >= win.endMin) break;
  }
  if (cursor < win.endMin) out.push({ startMin: cursor, endMin: win.endMin });

  return out.filter((i) => i.endMin > i.startMin);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/slot.test.ts`
Expected: PASS, 15 tests.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/slot.ts src/lib/slot.test.ts src/lib/capacity.ts
git commit -m "feat(slot): free-interval computation for a day"
```

---

### Task 3: `resolveSlot` — snap to the nearest gap that fits

**Files:**
- Modify: `src/lib/slot.ts`
- Modify: `src/lib/slot.test.ts`

**Interfaces:**
- Consumes: `freeIntervals`, `SLOT_GRANULARITY_MIN` from Task 2.
- Produces:
  - `interface ResolveSlotInput { date: string; aimMin: number; durationMin: number; windows: AvailabilityWindow[]; blocks: BusyBlock[]; placed: PlacedSpan[]; now: Now; allDayBlocks: boolean }`
  - `resolveSlot(input: ResolveSlotInput): number | null`

**Rounding rule.** The *aim* is rounded to `SLOT_GRANULARITY_MIN` **before** the search. A result clamped to an interval edge may therefore not be a multiple of 5 — deliberately: a step butting against a meeting that ends at 10:47 should start at 10:47, not waste three minutes. Rounding after clamping would be wrong, because rounding up can push the block past the end of the gap that accepted it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/slot.test.ts`:

```ts
import { resolveSlot } from './slot';

describe('resolveSlot', () => {
  function call(over: Partial<Parameters<typeof resolveSlot>[0]> = {}) {
    return resolveSlot({
      date: WED, aimMin: 540, durationMin: 60,
      windows: WINDOWS, blocks: [], placed: [], now: EARLY, allDayBlocks: true,
      ...over,
    });
  }

  it('honours an aim that already sits in a free gap', () => {
    expect(call({ aimMin: 720 })).toBe(720);
  });

  it('slides forward past a busy block to the first gap that fits', () => {
    // aim 10:30 (630) lands inside a 10:00–11:30 lecture; 1h30 fits from 11:30.
    expect(call({ aimMin: 630, durationMin: 90, blocks: [busy(600, 690)] })).toBe(690);
  });

  it('slides backward when the earlier gap is nearer than the later one', () => {
    // gap A 09:00–10:00, lecture 10:00–15:00, gap B 15:00–18:00. Aim 09:50.
    expect(call({ aimMin: 590, durationMin: 60, blocks: [busy(600, 900)] })).toBe(540);
  });

  it('clamps to the end of a gap rather than overflowing it', () => {
    // gap 09:00–11:00, aim 10:45, duration 60 → latest legal start is 10:00.
    expect(call({ aimMin: 645, durationMin: 60, blocks: [busy(660, 900)] })).toBe(600);
  });

  it('skips a gap too small and uses the next one that fits', () => {
    // gaps: 09:00–09:30 (too small), 11:00–18:00.
    expect(call({ aimMin: 540, durationMin: 60, blocks: [busy(570, 660)] })).toBe(660);
  });

  it('returns null when nothing fits anywhere in the day', () => {
    expect(call({ durationMin: 600, blocks: [busy(600, 660)] })).toBeNull();
  });

  it('returns null for a day that is off', () => {
    expect(call({ date: '2026-07-18' })).toBeNull(); // Saturday
  });

  it('returns null for a non-positive or non-finite duration', () => {
    expect(call({ durationMin: 0 })).toBeNull();
    expect(call({ durationMin: -30 })).toBeNull();
    expect(call({ durationMin: Number.NaN })).toBeNull();
  });

  it('rounds the aim to the 5-minute grid before searching', () => {
    expect(call({ aimMin: 722 })).toBe(720);
    expect(call({ aimMin: 723 })).toBe(725);
  });

  it('lets a clamp to a gap edge win over the 5-minute grid', () => {
    // lecture ends 10:47; aim 10:00; the gap before it is too small for 60m.
    expect(call({ aimMin: 600, durationMin: 60, blocks: [busy(540, 647)] })).toBe(647);
  });

  it('will not schedule into hours that have already passed today', () => {
    expect(call({ aimMin: 540, now: { date: WED, minute: 700 } })).toBe(700);
  });

  it('breaks an exact tie toward the earlier start', () => {
    // gaps 09:00–10:00 and 11:00–12:00; aim 10:30 is 30m from each edge.
    expect(call({ aimMin: 630, durationMin: 60, blocks: [busy(600, 660)] })).toBe(540);
  });

  it('treats already-placed work as occupied', () => {
    expect(call({ aimMin: 540, placed: [{ startMin: 540, endMin: 600 }] })).toBe(600);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/slot.test.ts`
Expected: FAIL — `resolveSlot is not a function`.

- [ ] **Step 3: Implement `resolveSlot`**

Append to `src/lib/slot.ts`:

```ts
export interface ResolveSlotInput {
  date: string;
  aimMin: number;        // where the user pointed, or where a migration starts looking
  durationMin: number;
  windows: AvailabilityWindow[];
  blocks: BusyBlock[];
  placed: PlacedSpan[];
  now: Now;
  allDayBlocks: boolean;
}

/**
 * The start minute a block should take on `date`, or null if it does not fit.
 *
 * The aim is snapped to SLOT_GRANULARITY_MIN BEFORE the search; the winning
 * candidate is then clamped inside its gap and returned as-is. A clamped result
 * can therefore be off-grid — that is intended. Rounding after clamping would
 * be a bug: rounding up can push the block past the end of the very gap that
 * accepted it.
 */
export function resolveSlot(input: ResolveSlotInput): number | null {
  const { date, durationMin, windows, blocks, placed, now, allDayBlocks } = input;
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;

  const aim = Math.round(input.aimMin / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
  const gaps = freeIntervals(date, windows, blocks, placed, now, allDayBlocks);

  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const gap of gaps) {
    if (gap.endMin - gap.startMin < durationMin) continue;
    const candidate = Math.min(Math.max(aim, gap.startMin), gap.endMin - durationMin);
    const distance = Math.abs(candidate - aim);
    // Ties break toward the earlier start, so the result is deterministic.
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/slot.test.ts`
Expected: PASS, 28 tests.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slot.ts src/lib/slot.test.ts
git commit -m "feat(slot): resolveSlot snaps a block to the nearest gap that fits"
```

---

### Task 4: `grid.ts` — visible range and minute↔percentage geometry

**Files:**
- Create: `src/lib/grid.ts`
- Create: `src/lib/grid.test.ts`

**Interfaces:**
- Consumes: `Interval` from `capacity.ts`, `windowForDate` from `availability.ts`.
- Produces:
  - `MIN_VISIBLE_START: 480`, `MIN_VISIBLE_END: 1200`
  - `visibleRange(dates: string[], windows: AvailabilityWindow[], blocks: BusyBlock[], allDayBlocks: boolean): Interval`
  - `minuteToPct(minute: number, range: Interval): number`
  - `pctToMinute(pct: number, range: Interval): number`
  - `hourMarks(range: Interval): number[]`

Percentages rather than pixels keep this module pure and testable; components multiply by their own measured height.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, BusyBlock } from '../db/types';
import {
  visibleRange, minuteToPct, pctToMinute, hourMarks,
  MIN_VISIBLE_START, MIN_VISIBLE_END,
} from './grid';

const WEEK = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];
const NINE_TO_SIX: AvailabilityWindow[] = [0, 1, 2, 3, 4].map((dow) => ({ dow, startMin: 540, endMin: 1080 }));

function block(date: string, startMin: number, endMin: number, allDay = false): BusyBlock {
  return { date, startMin, endMin, title: 'x', allDay };
}

describe('visibleRange', () => {
  it('never shrinks below the 08:00–20:00 floor', () => {
    expect(visibleRange(WEEK, NINE_TO_SIX, [], true))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('grows to cover an early availability window, floored to the hour', () => {
    const early: AvailabilityWindow[] = [{ dow: 2, startMin: 415, endMin: 1080 }]; // 06:55
    expect(visibleRange(WEEK, early, [], true).startMin).toBe(360); // 06:00
  });

  it('grows to cover a late availability window, ceiled to the hour', () => {
    const late: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1330 }]; // 22:10
    expect(visibleRange(WEEK, late, [], true).endMin).toBe(1380); // 23:00
  });

  it('grows to cover a timed calendar event outside the window', () => {
    expect(visibleRange(WEEK, NINE_TO_SIX, [block('2026-07-15', 420, 480)], true).startMin).toBe(420);
  });

  it('ignores all-day events, which would otherwise blow the range to the whole day', () => {
    expect(visibleRange(WEEK, NINE_TO_SIX, [block('2026-07-15', 0, 1440, true)], true))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('ignores events belonging to other weeks', () => {
    expect(visibleRange(WEEK, NINE_TO_SIX, [block('2026-08-01', 60, 120)], true))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });
});

describe('minute ↔ percentage', () => {
  const range = { startMin: 480, endMin: 1200 };

  it('maps the range ends to 0 and 100', () => {
    expect(minuteToPct(480, range)).toBe(0);
    expect(minuteToPct(1200, range)).toBe(100);
  });

  it('maps the midpoint to 50', () => {
    expect(minuteToPct(840, range)).toBe(50);
  });

  it('round-trips every minute in the range', () => {
    const failures: string[] = [];
    for (let m = range.startMin; m <= range.endMin; m++) {
      const back = pctToMinute(minuteToPct(m, range), range);
      if (Math.abs(back - m) > 1e-6) failures.push(`${m} -> ${back}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('hourMarks', () => {
  it('lists every whole hour from the range start to its end', () => {
    expect(hourMarks({ startMin: 480, endMin: 720 })).toEqual([480, 540, 600, 660, 720]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/grid.test.ts`
Expected: FAIL — `Failed to resolve import "./grid"`.

- [ ] **Step 3: Write `src/lib/grid.ts`**

```ts
import type { AvailabilityWindow, BusyBlock } from '../db/types';
import { windowForDate } from './availability';
import type { Interval } from './capacity';

const MINUTES_PER_HOUR = 60;

/** The grid always shows at least 08:00–20:00, so it never collapses to a sliver. */
export const MIN_VISIBLE_START = 480;
export const MIN_VISIBLE_END = 1200;

function floorToHour(minute: number): number {
  return Math.floor(minute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}
function ceilToHour(minute: number): number {
  return Math.ceil(minute / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}

/**
 * The hours the grid draws: the union of the week's availability windows and
 * its TIMED calendar events, expanded outward to whole hours, then expanded
 * again if needed to include 08:00–20:00.
 *
 * All-day events are excluded on purpose. They typically span 0..1440, so
 * including them would stretch every week containing one to a full 24 hours.
 * Their effect on capacity is handled by `freeIntervals`, not by geometry.
 */
export function visibleRange(
  dates: string[],
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  allDayBlocks: boolean,
): Interval {
  let startMin = MIN_VISIBLE_START;
  let endMin = MIN_VISIBLE_END;

  for (const date of dates) {
    const w = windowForDate(date, windows);
    if (!w) continue;
    startMin = Math.min(startMin, w.startMin);
    endMin = Math.max(endMin, w.endMin);
  }

  const dateSet = new Set(dates);
  for (const b of blocks) {
    if (!dateSet.has(b.date)) continue;
    if (b.allDay) continue; // see doc comment — never widens the grid
    if (!allDayBlocks && b.allDay) continue;
    startMin = Math.min(startMin, b.startMin);
    endMin = Math.max(endMin, b.endMin);
  }

  return { startMin: floorToHour(startMin), endMin: ceilToHour(endMin) };
}

/** Vertical position of `minute` within `range`, as a percentage. */
export function minuteToPct(minute: number, range: Interval): number {
  return ((minute - range.startMin) / (range.endMin - range.startMin)) * 100;
}

/** Inverse of `minuteToPct` — used to turn a drop position into a time. */
export function pctToMinute(pct: number, range: Interval): number {
  return range.startMin + (pct / 100) * (range.endMin - range.startMin);
}

/** Every whole hour the axis should label, inclusive of both ends. */
export function hourMarks(range: Interval): number[] {
  const out: number[] = [];
  for (let m = ceilToHour(range.startMin); m <= range.endMin; m += MINUTES_PER_HOUR) out.push(m);
  return out;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/grid.test.ts`
Expected: PASS, 11 tests.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/grid.ts src/lib/grid.test.ts
git commit -m "feat(grid): visible range and minute/percentage geometry"
```

---

### Task 5: `assignLanes` — side-by-side rendering for overlapping blocks

**Files:**
- Modify: `src/lib/grid.ts`
- Modify: `src/lib/grid.test.ts`

**Interfaces:**
- Produces:
  - `interface LaneSpan { startMin: number; endMin: number }`
  - `interface Laid<T> { item: T; lane: number; laneCount: number }`
  - `assignLanes<T extends LaneSpan>(items: T[]): Laid<T>[]`

Two Google calendar events can genuinely overlap even though placed work never does, so the grid must be able to draw them side by side. `laneCount` is per *cluster* of mutually-overlapping items, not per day — a single 09:00 conflict must not make a 16:00 block half-width.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/grid.test.ts`:

```ts
import { assignLanes } from './grid';

describe('assignLanes', () => {
  const span = (id: string, startMin: number, endMin: number) => ({ id, startMin, endMin });

  it('gives a lone block the full width', () => {
    expect(assignLanes([span('a', 540, 600)]))
      .toEqual([{ item: span('a', 540, 600), lane: 0, laneCount: 1 }]);
  });

  it('puts two overlapping blocks in adjacent lanes', () => {
    const laid = assignLanes([span('a', 540, 660), span('b', 600, 720)]);
    expect(laid.map((l) => [l.item.id, l.lane, l.laneCount]))
      .toEqual([['a', 0, 2], ['b', 1, 2]]);
  });

  it('keeps touching-but-not-overlapping blocks in one lane', () => {
    // end is EXCLUSIVE, so 600–660 does not overlap 540–600.
    const laid = assignLanes([span('a', 540, 600), span('b', 600, 660)]);
    expect(laid.map((l) => [l.lane, l.laneCount])).toEqual([[0, 1], [0, 1]]);
  });

  it('scopes laneCount to the cluster, not the whole day', () => {
    const laid = assignLanes([span('a', 540, 660), span('b', 600, 720), span('c', 900, 960)]);
    expect(laid.map((l) => [l.item.id, l.lane, l.laneCount]))
      .toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 1]]);
  });

  it('reuses a lane freed by an earlier block in the same cluster', () => {
    const laid = assignLanes([span('a', 540, 600), span('b', 550, 700), span('c', 610, 660)]);
    expect(laid.map((l) => [l.item.id, l.lane])).toEqual([['a', 0], ['b', 1], ['c', 0]]);
    expect(laid.every((l) => l.laneCount === 2)).toBe(true);
  });

  it('returns an empty array unchanged', () => {
    expect(assignLanes([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/grid.test.ts`
Expected: FAIL — `assignLanes is not a function`.

- [ ] **Step 3: Implement `assignLanes`**

Append to `src/lib/grid.ts`:

```ts
export interface LaneSpan {
  startMin: number;
  endMin: number;
}

export interface Laid<T> {
  item: T;
  lane: number;      // 0-based column within its cluster
  laneCount: number; // how many columns that cluster needs
}

/**
 * Pack overlapping spans into side-by-side lanes, Google-Calendar style.
 *
 * `laneCount` is scoped to the CLUSTER — a maximal run of spans connected by
 * overlap — rather than to the day, so one 09:00 conflict does not halve the
 * width of an unrelated 16:00 block.
 *
 * Ends are exclusive: 09:00–10:00 and 10:00–11:00 do not overlap.
 */
export function assignLanes<T extends LaneSpan>(items: T[]): Laid<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Laid<T>[] = [];

  let cluster: Laid<T>[] = [];
  let laneEnds: number[] = []; // laneEnds[i] = when lane i next becomes free
  let clusterEnd = -Infinity;

  function closeCluster() {
    const laneCount = laneEnds.length;
    for (const entry of cluster) out.push({ ...entry, laneCount });
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  }

  for (const item of sorted) {
    if (item.startMin >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }

    cluster.push({ item, lane, laneCount: 0 }); // laneCount filled in by closeCluster
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  closeCluster();

  return out;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/grid.test.ts`
Expected: PASS, 17 tests.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/grid.ts src/lib/grid.test.ts
git commit -m "feat(grid): lane assignment for overlapping blocks"
```

---

### Task 6: `scheduled.ts` — reading scheduled work out of app state

**Files:**
- Create: `src/lib/scheduled.ts`
- Create: `src/lib/scheduled.test.ts`

**Interfaces:**
- Consumes: `durationOf`, `PlacedSpan` from `src/lib/slot.ts`.
- Produces:
  - `interface ScheduledItem { kind: 'step' | 'task'; id: string; goalId: string | null; goalTitle: string; title: string; done: boolean; date: string; startMin: number; endMin: number; estimated: boolean }`
  - `scheduledOn(goals: Goal[], tasks: Task[], date: string): ScheduledItem[]`
  - `spansOn(goals: Goal[], tasks: Task[], date: string, excludeId?: string): PlacedSpan[]`

`spansOn` is what `resolveSlot` needs as its `placed` argument. `excludeId` matters when *moving* an already-placed block: without it the block collides with its own current position and can never move within its own gap.

`estimated` is false when the block is using the `DEFAULT_SLOT_MIN` fallback — the grid draws those with a dashed border.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/scheduled.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Goal, Task } from '../db/types';
import { scheduledOn, spansOn } from './scheduled';
import { DEFAULT_SLOT_MIN } from './slot';

const DAY = '2026-07-15';

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', title: 'Thesis', nodes: [], ...over };
}
const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', title: 'Email', done: false, goalId: null, ...over }) as Task;

describe('scheduledOn', () => {
  it('returns a scheduled leaf with its computed span', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 600, estimateMin: 90 }] });
    expect(scheduledOn([g], [], DAY)).toEqual([{
      kind: 'step', id: 'n1', goalId: 'g1', goalTitle: 'Thesis', title: 'Draft',
      done: false, date: DAY, startMin: 600, endMin: 690, estimated: true,
    }]);
  });

  it('falls back to DEFAULT_SLOT_MIN and flags the block as unestimated', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 600 }] });
    const [item] = scheduledOn([g], [], DAY);
    expect(item.endMin).toBe(600 + DEFAULT_SLOT_MIN);
    expect(item.estimated).toBe(false);
  });

  it('ignores a leaf with a day but no start minute', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY }] });
    expect(scheduledOn([g], [], DAY)).toEqual([]);
  });

  it('ignores leaves on other days and archived projects', () => {
    const other = goal({ nodes: [{ id: 'n1', title: 'x', plannedWeek: '2026-07-13', plannedDay: '2026-07-16', plannedStartMin: 600 }] });
    const archived = goal({ id: 'g2', completedAt: '2026-07-01', nodes: [{ id: 'n2', title: 'y', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 600 }] });
    expect(scheduledOn([other, archived], [], DAY)).toEqual([]);
  });

  it('includes a scheduled task and sorts everything by start minute', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 660, estimateMin: 30 }] });
    const t = task({ date: DAY, startMin: 540, estimateMin: 30 });
    expect(scheduledOn([g], [t], DAY).map((i) => i.id)).toEqual(['t1', 'n1']);
  });

  it('ignores a task with a date but no start minute', () => {
    expect(scheduledOn([], [task({ date: DAY })], DAY)).toEqual([]);
  });

  it('keeps done work — history still occupies its slot', () => {
    const t = task({ date: DAY, startMin: 540, estimateMin: 30, done: true });
    expect(scheduledOn([], [t], DAY)[0].done).toBe(true);
  });
});

describe('spansOn', () => {
  it('returns bare spans for everything scheduled that day', () => {
    const t = task({ date: DAY, startMin: 540, estimateMin: 60 });
    expect(spansOn([], [t], DAY)).toEqual([{ startMin: 540, endMin: 600 }]);
  });

  it('omits the excluded id so a block can move within its own gap', () => {
    const t = task({ date: DAY, startMin: 540, estimateMin: 60 });
    expect(spansOn([], [t], DAY, 't1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/scheduled.test.ts`
Expected: FAIL — `Failed to resolve import "./scheduled"`.

- [ ] **Step 3: Write `src/lib/scheduled.ts`**

```ts
import type { Goal, GoalNode, Task } from '../db/types';
import { normalizeEstimate } from './capacity';
import { durationOf, type PlacedSpan } from './slot';

/** One block on the grid, from either kind of commitment. */
export interface ScheduledItem {
  kind: 'step' | 'task';
  id: string;              // nodeId or taskId
  goalId: string | null;
  goalTitle: string;       // '' for a task with no project
  title: string;
  done: boolean;
  date: string;
  startMin: number;
  endMin: number;
  estimated: boolean;      // false ⇒ using the DEFAULT_SLOT_MIN fallback
}

function walkLeaves(nodes: GoalNode[], visit: (n: GoalNode) => void): void {
  for (const n of nodes) {
    if (n.children && n.children.length) walkLeaves(n.children, visit);
    else visit(n);
  }
}

/**
 * Everything drawn on `date`, in start order.
 *
 * An item counts as scheduled only when it has BOTH a day and a start minute —
 * the invariant from the spec. A half-state is skipped rather than guessed at,
 * so a bug that writes one field without the other stays visible instead of
 * silently rendering at midnight.
 */
export function scheduledOn(goals: Goal[], tasks: Task[], date: string): ScheduledItem[] {
  const out: ScheduledItem[] = [];

  for (const g of goals) {
    if (g.completedAt) continue; // archived projects never surface commitments
    walkLeaves(g.nodes, (n) => {
      if (n.plannedDay !== date || n.plannedStartMin === undefined) return;
      const duration = durationOf(n.estimateMin);
      out.push({
        kind: 'step', id: n.id, goalId: g.id, goalTitle: g.title, title: n.title,
        done: !!n.done, date, startMin: n.plannedStartMin,
        endMin: n.plannedStartMin + duration,
        estimated: normalizeEstimate(n.estimateMin) !== undefined,
      });
    });
  }

  for (const t of tasks) {
    if (t.date !== date || t.startMin === undefined) continue;
    const duration = durationOf(t.estimateMin);
    out.push({
      kind: 'task', id: t.id, goalId: t.goalId, goalTitle: '', title: t.title,
      done: t.done, date, startMin: t.startMin, endMin: t.startMin + duration,
      estimated: normalizeEstimate(t.estimateMin) !== undefined,
    });
  }

  return out.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
}

/**
 * The occupied spans on `date`, for `resolveSlot`'s `placed` argument.
 *
 * `excludeId` drops one item. Moving an already-placed block MUST exclude
 * itself, or it collides with its own current position and can never be
 * repositioned inside the gap it already occupies.
 */
export function spansOn(
  goals: Goal[],
  tasks: Task[],
  date: string,
  excludeId?: string,
): PlacedSpan[] {
  return scheduledOn(goals, tasks, date)
    .filter((i) => i.id !== excludeId)
    .map((i) => ({ startMin: i.startMin, endMin: i.endMin }));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/scheduled.test.ts`
Expected: PASS, 9 tests.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduled.ts src/lib/scheduled.test.ts
git commit -m "feat(scheduled): read scheduled blocks and occupied spans from state"
```

---

### Task 7: `migrateSlots` — the one-shot data rewrite

**Files:**
- Create: `src/lib/migrateSlots.ts`
- Create: `src/lib/migrateSlots.test.ts`

**Interfaces:**
- Consumes: `resolveSlot`, `durationOf`, `PlacedSpan` from `slot.ts`; `windowForDate` from `availability.ts`; `weekOf` from `plan.ts`; `cloneGoals` from `tree.ts`; `Now` from `capacity.ts`.
- Produces:
  - `MIGRATION_NOW: Now`
  - `interface MigrationReport { scheduledSteps: number; scheduledTasks: number; sidebarSteps: number; sidebarTasks: number }`
  - `migrateSlots(goals: Goal[], tasks: Task[], windows: AvailabilityWindow[], allDayBlocks: boolean): { goals: Goal[]; tasks: Task[]; report: MigrationReport }`
  - `describeMigration(report: MigrationReport): string | null`

Two decisions the implementer must not change:

- **`MIGRATION_NOW` is `{ date: '1970-01-01', minute: 0 }`.** The migration re-homes commitments the user already made; it must not refuse this morning merely because it is now afternoon.
- **Busy blocks are empty.** The migration runs at first hydration, before any calendar fetch, so there is never cached calendar data to respect. Passing `[]` is correct, not a shortcut.

Placement order is fixed so the result is deterministic and the idempotence test is meaningful: **steps before tasks**; steps in goal-array order (already column-major) then depth-first; tasks in array order.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/migrateSlots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, Goal, Task } from '../db/types';
import { migrateSlots, describeMigration } from './migrateSlots';

const WED = '2026-07-15';   // Wednesday, dow 2
const WEEK = '2026-07-13';
const WINDOWS: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1080 }];

const goal = (nodes: Goal['nodes'], over: Partial<Goal> = {}): Goal =>
  ({ id: 'g1', title: 'Thesis', nodes, ...over });

describe('migrateSlots', () => {
  it('places an open day-pinned step at the start of its window', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0].plannedStartMin).toBe(540);
    expect(report.scheduledSteps).toBe(1);
  });

  it('stacks a second step after the first instead of overlapping it', () => {
    const g = goal([
      { id: 'n1', title: 'A', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 },
      { id: 'n2', title: 'B', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 },
    ]);
    const { goals } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes.map((n) => n.plannedStartMin)).toEqual([540, 630]);
  });

  it('returns an old Any-day step (week but no day) to the sidebar', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0].plannedWeek).toBeUndefined();
    expect(goals[0].nodes[0].plannedDay).toBeUndefined();
    expect(report.sidebarSteps).toBe(1);
  });

  it('returns a step that will not fit its day to the sidebar', () => {
    const g = goal([{ id: 'n1', title: 'Huge', plannedWeek: WEEK, plannedDay: WED, estimateMin: 600 }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0].plannedWeek).toBeUndefined();
    expect(goals[0].nodes[0].plannedStartMin).toBeUndefined();
    expect(report.sidebarSteps).toBe(1);
  });

  it('leaves done steps untouched', () => {
    const g = goal([{ id: 'n1', title: 'Done', done: true, plannedWeek: WEEK, plannedDay: WED }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0]).toEqual({ id: 'n1', title: 'Done', done: true, plannedWeek: WEEK, plannedDay: WED });
    expect(report.scheduledSteps).toBe(0);
  });

  it('leaves unplanned steps alone', () => {
    const g = goal([{ id: 'n1', title: 'Someday' }]);
    expect(migrateSlots([g], [], WINDOWS, true).goals[0].nodes[0].plannedStartMin).toBeUndefined();
  });

  it('places an open dated task', () => {
    const t: Task = { id: 't1', title: 'Email', date: WED, done: false, goalId: null, estimateMin: 15 };
    const { tasks, report } = migrateSlots([], [t], WINDOWS, true);
    expect(tasks[0].startMin).toBe(540);
    expect(report.scheduledTasks).toBe(1);
  });

  it('drops the date of a task that will not fit, sending it to the sidebar', () => {
    const t: Task = { id: 't1', title: 'Huge', date: WED, done: false, goalId: null, estimateMin: 600 };
    const { tasks, report } = migrateSlots([], [t], WINDOWS, true);
    expect('date' in tasks[0]).toBe(false);
    expect(report.sidebarTasks).toBe(1);
  });

  it('schedules steps before tasks, so steps win the earlier slots', () => {
    const g = goal([{ id: 'n1', title: 'Step', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 }]);
    const t: Task = { id: 't1', title: 'Task', date: WED, done: false, goalId: null, estimateMin: 60 };
    const { goals, tasks } = migrateSlots([g], [t], WINDOWS, true);
    expect(goals[0].nodes[0].plannedStartMin).toBe(540);
    expect(tasks[0].startMin).toBe(600);
  });

  it('sends a step to the sidebar when the day is off entirely', () => {
    const g = goal([{ id: 'n1', title: 'Sat', plannedWeek: WEEK, plannedDay: '2026-07-18', estimateMin: 30 }]);
    expect(migrateSlots([g], [], WINDOWS, true).report.sidebarSteps).toBe(1);
  });

  it('is idempotent — a second run changes nothing', () => {
    const g = goal([
      { id: 'n1', title: 'A', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 },
      { id: 'n2', title: 'B', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 },
    ]);
    const t: Task = { id: 't1', title: 'Email', date: WED, done: false, goalId: null, estimateMin: 15 };
    const first = migrateSlots([g], [t], WINDOWS, true);
    const second = migrateSlots(first.goals, first.tasks, WINDOWS, true);
    expect(second.goals).toEqual(first.goals);
    expect(second.tasks).toEqual(first.tasks);
    expect(second.report).toEqual({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, sidebarTasks: 0 });
  });

  it('does not mutate its inputs', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 }]);
    const snapshot = structuredClone(g);
    migrateSlots([g], [], WINDOWS, true);
    expect(g).toEqual(snapshot);
  });
});

describe('describeMigration', () => {
  it('returns null when nothing moved', () => {
    expect(describeMigration({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, sidebarTasks: 0 })).toBeNull();
  });
  it('reports placements and returns together', () => {
    expect(describeMigration({ scheduledSteps: 2, scheduledTasks: 1, sidebarSteps: 1, sidebarTasks: 0 }))
      .toBe('3 items placed on the calendar · 1 returned to the sidebar');
  });
  it('uses the singular for one item', () => {
    expect(describeMigration({ scheduledSteps: 1, scheduledTasks: 0, sidebarSteps: 0, sidebarTasks: 0 }))
      .toBe('1 item placed on the calendar');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/migrateSlots.test.ts`
Expected: FAIL — `Failed to resolve import "./migrateSlots"`.

- [ ] **Step 3: Write `src/lib/migrateSlots.ts`**

```ts
import type { AvailabilityWindow, Goal, GoalNode, Task } from '../db/types';
import { windowForDate } from './availability';
import type { Now } from './capacity';
import { weekOf } from './plan';
import { durationOf, resolveSlot, type PlacedSpan } from './slot';
import { cloneGoals } from './tree';

/**
 * The migration re-homes commitments the user ALREADY made. Clamping to the
 * real clock would refuse this morning merely because it is now afternoon and
 * dump the day's work into the sidebar. A sentinel far in the past disables
 * `remainingWindow`'s past-clamping for every date the migration touches.
 */
export const MIGRATION_NOW: Now = { date: '1970-01-01', minute: 0 };

export interface MigrationReport {
  scheduledSteps: number;
  scheduledTasks: number;
  sidebarSteps: number;
  sidebarTasks: number;
}

function walkLeaves(nodes: GoalNode[], visit: (n: GoalNode) => void): void {
  for (const n of nodes) {
    if (n.children && n.children.length) walkLeaves(n.children, visit);
    else visit(n);
  }
}

/**
 * Give every open, day-committed step and task a real start minute.
 *
 * Placement order is FIXED — steps before tasks, goals in array order (already
 * column-major), leaves depth-first, tasks in array order — because items on
 * one day compete for the same gaps. A different order yields a different
 * result, which would make the idempotence guarantee meaningless.
 *
 * Busy blocks are deliberately empty: this runs at first hydration, before any
 * calendar fetch, so no cached calendar data exists to respect.
 */
export function migrateSlots(
  goals: Goal[],
  tasks: Task[],
  windows: AvailabilityWindow[],
  allDayBlocks: boolean,
): { goals: Goal[]; tasks: Task[]; report: MigrationReport } {
  const report: MigrationReport = {
    scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, sidebarTasks: 0,
  };
  const occupied = new Map<string, PlacedSpan[]>();

  function spansFor(date: string): PlacedSpan[] {
    let list = occupied.get(date);
    if (!list) { list = []; occupied.set(date, list); }
    return list;
  }

  function place(date: string, durationMin: number): number | null {
    const window = windowForDate(date, windows);
    if (!window) return null;
    return resolveSlot({
      date,
      aimMin: window.startMin, // "earliest gap that fits" falls out of the normal search
      durationMin,
      windows,
      blocks: [],
      placed: spansFor(date),
      now: MIGRATION_NOW,
      allDayBlocks,
    });
  }

  const nextGoals = cloneGoals(goals);
  for (const g of nextGoals) {
    walkLeaves(g.nodes, (n) => {
      if (n.done || !n.plannedWeek) return;

      // Already migrated: keep it, but register its span so later items avoid it.
      if (n.plannedDay && n.plannedStartMin !== undefined) {
        spansFor(n.plannedDay).push({
          startMin: n.plannedStartMin,
          endMin: n.plannedStartMin + durationOf(n.estimateMin),
        });
        return;
      }

      if (!n.plannedDay) { // the old "Any day" bucket has no equivalent now
        delete n.plannedWeek;
        report.sidebarSteps++;
        return;
      }

      const duration = durationOf(n.estimateMin);
      const startMin = place(n.plannedDay, duration);
      if (startMin === null) {
        delete n.plannedWeek;
        delete n.plannedDay;
        report.sidebarSteps++;
        return;
      }

      spansFor(n.plannedDay).push({ startMin, endMin: startMin + duration });
      n.plannedWeek = weekOf(n.plannedDay);
      n.plannedStartMin = startMin;
      report.scheduledSteps++;
    });
  }

  const nextTasks = tasks.map((t) => {
    if (t.done || !t.date) return t;

    if (t.startMin !== undefined) {
      spansFor(t.date).push({ startMin: t.startMin, endMin: t.startMin + durationOf(t.estimateMin) });
      return t;
    }

    const duration = durationOf(t.estimateMin);
    const startMin = place(t.date, duration);
    if (startMin === null) {
      const { date: _unscheduled, ...rest } = t; // omit the key rather than store undefined
      report.sidebarTasks++;
      return rest as Task;
    }

    spansFor(t.date).push({ startMin, endMin: startMin + duration });
    report.scheduledTasks++;
    return { ...t, startMin };
  });

  return { goals: nextGoals, tasks: nextTasks, report };
}

/** One-line summary for the post-migration toast, or null if nothing moved. */
export function describeMigration(report: MigrationReport): string | null {
  const placed = report.scheduledSteps + report.scheduledTasks;
  const returned = report.sidebarSteps + report.sidebarTasks;
  if (placed === 0 && returned === 0) return null;

  const parts: string[] = [];
  if (placed > 0) parts.push(`${placed} item${placed === 1 ? '' : 's'} placed on the calendar`);
  if (returned > 0) parts.push(`${returned} returned to the sidebar`);
  return parts.join(' · ');
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/lib/migrateSlots.test.ts`
Expected: PASS, 15 tests.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/migrateSlots.ts src/lib/migrateSlots.test.ts
git commit -m "feat(migrate): one-shot rewrite giving committed work real start times"
```

---

### Task 8: Run the migration once, behind a snapshot

**Files:**
- Modify: `src/db/db.ts` (append after `saveAllDayBlocks`, line ~111)
- Modify: `src/state/store.ts:140-168` (`initStore`)

**Interfaces:**
- Consumes: `migrateSlots`, `describeMigration` from Task 7.
- Produces, from `db.ts`:
  - `isSlotMigrationDone(): Promise<boolean>`
  - `saveSlotMigrationSnapshot(goals: Goal[], tasks: Task[]): Promise<void>`
  - `markSlotMigrationDone(): Promise<void>`

**No Dexie version bump.** `plannedStartMin`, `Task.startMin` and optional `Task.date` add no store and no index — Dexie only versions schema changes. A ceremonial `.version(5)` would imply a schema change that is not happening. The one-shot is gated by a `settings` row instead.

**The snapshot is a settings row, not a file download.** `exportState` opens a save dialog; firing one unprompted on the first launch after an update is startling, and the risk being guarded against is this migration mangling scheduling — which a same-database snapshot fully covers.

**Ordering is load-bearing:** snapshot → migrate → `persist` → mark done. If `persist` throws, the flag was never set, so the migration retries on the next launch instead of leaving data half-rewritten and marked complete.

- [ ] **Step 1: Add the three helpers to `src/db/db.ts`**

Append after `saveAllDayBlocks`:

```ts
// One-shot flag for the calendar-slot migration (see lib/migrateSlots.ts).
// Not a Dexie version: the migration adds optional fields to existing objects,
// which changes no store and no index.
const SLOT_MIGRATION_KEY = 'slotMigrationDone';
const SLOT_SNAPSHOT_KEY = 'preSlotMigrationSnapshot';

export async function isSlotMigrationDone(): Promise<boolean> {
  const row = await db.settings.get(SLOT_MIGRATION_KEY);
  return row?.value === 'true';
}

/**
 * Pre-migration copy of the two tables the migration rewrites. Kept in the
 * settings table rather than downloaded, so the safety net costs the user no
 * interaction on first launch.
 */
export async function saveSlotMigrationSnapshot(goals: Goal[], tasks: Task[]): Promise<void> {
  await db.settings.put({ key: SLOT_SNAPSHOT_KEY, value: JSON.stringify({ goals, tasks }) });
}

export async function markSlotMigrationDone(): Promise<void> {
  await db.settings.put({ key: SLOT_MIGRATION_KEY, value: 'true' });
}
```

- [ ] **Step 2: Wire it into `initStore`**

In `src/state/store.ts`, add to the `../db/db` import list: `isSlotMigrationDone, saveSlotMigrationSnapshot, markSlotMigrationDone`. Add a new import:

```ts
import { migrateSlots, describeMigration } from '../lib/migrateSlots';
```

Replace the body of the `try` block in `initStore` (lines 146-161) with:

```ts
  try {
    const [appState, pxPerDay, planReview, availability, allDayBlocks] = await Promise.all([
      loadState(), loadScale(), loadPlanReview(), loadAvailability(), loadAllDayBlocks(),
    ]);

    // One-shot: give every day-committed step and task a real start minute.
    // Snapshot BEFORE, mark done only AFTER a successful persist — a failure
    // here leaves the flag unset so the next launch retries cleanly rather
    // than stranding half-rewritten data behind a "done" marker.
    let migrated = appState;
    let migrationToast: string | null = null;
    if (!(await isSlotMigrationDone())) {
      await saveSlotMigrationSnapshot(appState.goals, appState.tasks);
      const result = migrateSlots(appState.goals, appState.tasks, availability, allDayBlocks);
      migrated = { ...appState, goals: result.goals, tasks: result.tasks };
      await persist(migrated);
      await markSlotMigrationDone();
      migrationToast = describeMigration(result.report);
    }

    state = {
      ...state,
      ...migrated,
      pxPerDay,
      planReview,
      availability,
      allDayBlocks,
      hydration: 'ready',
      expanded: collectContainers(migrated.goals),
    };
    notify();
    ensureWeekRollover();
    if (migrationToast) actions.showToast(migrationToast);
  } catch {
```

Leave the `catch` block exactly as it is.

- [ ] **Step 3: Typecheck and run the whole suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS, no regressions.

- [ ] **Step 4: Smoke-test the migration against real data**

Run: `./node_modules/.bin/vite` and open the printed URL.

Verify, in order:
1. The app loads without the "can't reach its local database" screen.
2. A toast appears naming how many items were placed and how many returned to the sidebar (or no toast, if you had nothing planned).
3. Reload. **No second toast** — the flag stuck.
4. In DevTools → Application → IndexedDB → `phase` → `settings`, confirm rows `slotMigrationDone` = `true` and `preSlotMigrationSnapshot` holding JSON.

- [ ] **Step 5: Commit**

```bash
git add src/db/db.ts src/state/store.ts
git commit -m "feat(migrate): run the slot migration once at hydration behind a snapshot"
```

---

### Task 9: Store actions for scheduling

**Files:**
- Modify: `src/state/store.ts`
- Create: `src/state/scheduleActions.test.ts`

**Interfaces:**
- Consumes: `resolveSlot`, `durationOf` from `slot.ts`; `spansOn`, `scheduledOn` from `scheduled.ts`; `freeIntervals` from `slot.ts`.
- Produces, on `actions`:
  - `scheduleNode(goalId: string, nodeId: string, day: string, aimMin: number): void`
  - `scheduleTask(taskId: string, date: string, aimMin: number): void`
  - `unscheduleNode(goalId: string, nodeId: string): void`
  - `unscheduleTask(taskId: string): void`
  - `resizeNode(nodeId: string, minutes: number): void`
  - `resizeTask(taskId: string, minutes: number): void`

Views stay thin: they hand over *where the user pointed*, and the store resolves the slot, refuses with a toast when nothing fits, and persists. Views never call `resolveSlot` themselves.

`resizeNode`/`resizeTask` clamp the new duration to the gap the block sits in, so a resize can never create the overlap that a drop is forbidden from creating.

- [ ] **Step 1: Write the failing tests**

Create `src/state/scheduleActions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, GoalNode } from '../db/types';
import { weekOf } from '../lib/plan';
import { clampResize, setPlannedSlot, clearPlannedSlot } from './scheduleActions';

const WED = '2026-07-15';
const WINDOWS: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1080 }];

describe('the plannedWeek invariant', () => {
  // plannedWeek is redundant with plannedDay and kept only to avoid a 31-site
  // refactor (see the spec). This is the test that keeps the two from drifting.
  it('setPlannedSlot always writes plannedWeek as the Monday of plannedDay', () => {
    const cases = [
      { day: '2026-07-13', week: '2026-07-13' }, // a Monday
      { day: '2026-07-15', week: '2026-07-13' }, // midweek
      { day: '2026-07-19', week: '2026-07-13' }, // a Sunday
      { day: '2026-07-20', week: '2026-07-20' }, // the next Monday
    ];
    for (const { day, week } of cases) {
      const node: GoalNode = { id: 'n1', title: 'x' };
      setPlannedSlot(node, day, 600);
      expect(node.plannedWeek).toBe(week);
      expect(node.plannedDay).toBe(day);
      expect(node.plannedStartMin).toBe(600);
      expect(node.plannedWeek).toBe(weekOf(node.plannedDay!));
    }
  });

  it('clearPlannedSlot removes all three fields together', () => {
    const node: GoalNode = { id: 'n1', title: 'x' };
    setPlannedSlot(node, '2026-07-15', 600);
    clearPlannedSlot(node);
    expect('plannedWeek' in node).toBe(false);
    expect('plannedDay' in node).toBe(false);
    expect('plannedStartMin' in node).toBe(false);
  });
});

describe('clampResize', () => {
  it('allows a resize that stays inside the free gap', () => {
    expect(clampResize({
      date: WED, startMin: 540, requestedMin: 120,
      windows: WINDOWS, blocks: [], placed: [], allDayBlocks: true,
    })).toBe(120);
  });

  it('clamps a resize that would run into the next block', () => {
    expect(clampResize({
      date: WED, startMin: 540, requestedMin: 300,
      windows: WINDOWS, blocks: [], placed: [{ startMin: 660, endMin: 720 }], allDayBlocks: true,
    })).toBe(120); // 09:00 → 11:00
  });

  it('clamps a resize that would run past the end of the window', () => {
    expect(clampResize({
      date: WED, startMin: 1020, requestedMin: 300,
      windows: WINDOWS, blocks: [], placed: [], allDayBlocks: true,
    })).toBe(60); // 17:00 → 18:00
  });

  it('refuses a non-positive request', () => {
    expect(clampResize({
      date: WED, startMin: 540, requestedMin: 0,
      windows: WINDOWS, blocks: [], placed: [], allDayBlocks: true,
    })).toBeNull();
  });

  it('refuses when the block no longer sits in any free gap', () => {
    expect(clampResize({
      date: WED, startMin: 300, requestedMin: 60,
      windows: WINDOWS, blocks: [], placed: [], allDayBlocks: true,
    })).toBeNull(); // 05:00 is outside the 09:00–18:00 window
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/state/scheduleActions.test.ts`
Expected: FAIL — `Failed to resolve import "./scheduleActions"`.

- [ ] **Step 3: Create `src/state/scheduleActions.ts`**

The pure part of resizing lives outside the store so it can be tested without Dexie:

```ts
import type { AvailabilityWindow, BusyBlock, GoalNode } from '../db/types';
import { freeIntervals, SLOT_GRANULARITY_MIN, type PlacedSpan } from '../lib/slot';
import { MIGRATION_NOW } from '../lib/migrateSlots';
import { weekOf } from '../lib/plan';

/**
 * The single writer for a scheduled slot.
 *
 * `plannedWeek` is fully derivable from `plannedDay` and is kept only to avoid
 * a 31-site refactor (see the spec). Routing every write through here — and
 * never assigning the three fields separately — is what stops the two from
 * ever disagreeing. Its sibling test is the guard.
 */
export function setPlannedSlot(node: GoalNode, day: string, startMin: number): void {
  node.plannedWeek = weekOf(day);
  node.plannedDay = day;
  node.plannedStartMin = startMin;
}

/** Remove all three together — a partial clear would leave an illegal half-state. */
export function clearPlannedSlot(node: GoalNode): void {
  delete node.plannedWeek;
  delete node.plannedDay;
  delete node.plannedStartMin;
}

export interface ClampResizeInput {
  date: string;
  startMin: number;      // where the block currently starts — unchanged by a resize
  requestedMin: number;  // the duration the drag is asking for
  windows: AvailabilityWindow[];
  blocks: BusyBlock[];
  placed: PlacedSpan[];  // MUST exclude the block being resized
  allDayBlocks: boolean;
}

/**
 * The largest duration a block at `startMin` may take without colliding, or
 * null if the request is nonsense or the block sits outside any free gap.
 *
 * A resize must not be able to create the overlap a drop is forbidden from
 * creating, so the requested duration is clamped to the gap the block occupies.
 *
 * `MIGRATION_NOW` is used deliberately: resizing something already scheduled at
 * 09:00 must stay possible at 14:00, and the past-clamp would otherwise report
 * no gap at all.
 */
export function clampResize(input: ClampResizeInput): number | null {
  const { date, startMin, requestedMin, windows, blocks, placed, allDayBlocks } = input;
  if (!Number.isFinite(requestedMin) || requestedMin <= 0) return null;

  const gap = freeIntervals(date, windows, blocks, placed, MIGRATION_NOW, allDayBlocks)
    .find((g) => startMin >= g.startMin && startMin < g.endMin);
  if (!gap) return null;

  const rounded = Math.round(requestedMin / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
  return Math.max(SLOT_GRANULARITY_MIN, Math.min(rounded, gap.endMin - startMin));
}
```

- [ ] **Step 4: Add the actions to `src/state/store.ts`**

Add imports:

```ts
import { resolveSlot, durationOf } from '../lib/slot';
import { spansOn } from '../lib/scheduled';
import { clampResize, setPlannedSlot, clearPlannedSlot } from './scheduleActions';
```

Add this private helper next to `isActiveNode` (around line 211):

```ts
// Minutes-since-midnight for the live clock — the one place the store reads it.
function nowMoment(): Now {
  const d = new Date();
  return { date: todayStr(), minute: d.getHours() * 60 + d.getMinutes() };
}
```

Add `import type { Now } from '../lib/capacity';`.

Replace `planNode` and `unplanNode` (lines 697-720) with:

```ts
  // Scheduling. A view hands over WHERE THE USER POINTED; the store resolves
  // the actual slot, refuses with an explanation when nothing fits, and
  // persists. Views never call resolveSlot.
  scheduleNode(goalId: string, nodeId: string, day: string, aimMin: number): void {
    if (!isActiveGoal(goalId)) return; // frozen on a completed project
    const source = state.goals.find((g) => g.id === goalId);
    const sourceNode = source ? findNode(source.nodes, nodeId) : null;
    if (!sourceNode || sourceNode.children) return;

    const durationMin = durationOf(sourceNode.estimateMin);
    const startMin = resolveSlot({
      date: day,
      aimMin,
      durationMin,
      windows: state.availability,
      blocks: [], // slice 2 supplies real busy blocks
      placed: spansOn(state.goals, state.tasks, day, nodeId),
      now: nowMoment(),
      allDayBlocks: state.allDayBlocks,
    });
    if (startMin === null) {
      actions.showToast(`No ${formatDuration(durationMin)} gap left that day`);
      return;
    }

    const goals = cloneGoals(state.goals);
    const node = findNode(goals.find((g) => g.id === goalId)!.nodes, nodeId)!;
    setPlannedSlot(node, day, startMin);
    setAndPersist({ goals });
  },

  scheduleTask(taskId: string, date: string, aimMin: number): void {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || !isValidLocalDate(date)) return;

    const durationMin = durationOf(task.estimateMin);
    const startMin = resolveSlot({
      date,
      aimMin,
      durationMin,
      windows: state.availability,
      blocks: [],
      placed: spansOn(state.goals, state.tasks, date, taskId),
      now: nowMoment(),
      allDayBlocks: state.allDayBlocks,
    });
    if (startMin === null) {
      actions.showToast(`No ${formatDuration(durationMin)} gap left that day`);
      return;
    }

    setAndPersist({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, date, startMin } : t)),
    });
  },

  unscheduleNode(goalId: string, nodeId: string): void {
    if (!isActiveGoal(goalId)) return;
    const goal = state.goals.find((g) => g.id === goalId);
    const node = goal ? findNode(goal.nodes, nodeId) : null;
    if (!goal || !node || !node.plannedWeek) return;
    const goals = cloneGoals(state.goals);
    clearPlannedSlot(findNode(goals.find((g) => g.id === goalId)!.nodes, nodeId)!);
    withUndo(`Removed "${node.title}" from plan · Undo`, 'goals', goals);
  },

  unscheduleTask(taskId: string): void {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || !task.date) return;
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const { date: _unscheduled, startMin: _cleared, ...rest } = t;
      return rest as Task;
    });
    withUndo(`Unscheduled "${task.title}" · Undo`, 'tasks', tasks);
  },

  resizeNode(nodeId: string, minutes: number): void {
    if (!isActiveNode(nodeId)) return;
    const goal = goalOfNode(nodeId);
    const node = goal ? findNode(goal.nodes, nodeId) : null;
    if (!goal || !node || node.plannedDay === undefined || node.plannedStartMin === undefined) return;

    const clamped = clampResize({
      date: node.plannedDay,
      startMin: node.plannedStartMin,
      requestedMin: minutes,
      windows: state.availability,
      blocks: [],
      placed: spansOn(state.goals, state.tasks, node.plannedDay, nodeId),
      allDayBlocks: state.allDayBlocks,
    });
    if (clamped === null) return;

    const goals = cloneGoals(state.goals);
    findNode(goals.find((g) => g.id === goal.id)!.nodes, nodeId)!.estimateMin = clamped;
    setAndPersist({ goals });
  },

  resizeTask(taskId: string, minutes: number): void {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || task.date === undefined || task.startMin === undefined) return;

    const clamped = clampResize({
      date: task.date,
      startMin: task.startMin,
      requestedMin: minutes,
      windows: state.availability,
      blocks: [],
      placed: spansOn(state.goals, state.tasks, task.date, taskId),
      allDayBlocks: state.allDayBlocks,
    });
    if (clamped === null) return;

    setAndPersist({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, estimateMin: clamped } : t)),
    });
  },
```

Add this helper beside `nowMoment`:

```ts
// "1h 30m" / "45m" — used only in refusal toasts.
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
```

- [ ] **Step 5: Keep `PlanWeekOverlay` compiling**

`PlanWeekOverlay.tsx` still calls `actions.planNode` and `actions.unplanNode`, which no longer exist. It is deleted in plan 2, so keep it alive with the smallest possible change — in `handleDragEnd` (lines 296-310) replace the two call sites:

```ts
    if (command.kind === 'unplan-step') {
      actions.unscheduleNode(command.goalId, command.nodeId);
      return;
    }
    // The old overlay has no notion of a time; aim at the start of the day and
    // let resolveSlot pick. This file is deleted in plan 2.
    if (command.day) actions.scheduleNode(command.goalId, command.nodeId, command.day, 0);
```

Also replace `actions.unplanNode(l.goalId, l.nodeId)` with `actions.unscheduleNode(l.goalId, l.nodeId)` at lines 432 and 451.

Then search for any remaining callers and fix them the same way:

```bash
grep -rn "planNode\|unplanNode" src --include="*.ts" --include="*.tsx"
```

- [ ] **Step 6: Run the suite and typecheck**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS, including 7 new cases (5 `clampResize`, 2 invariant). Existing `store.test.ts` cases referencing `planNode` must be updated to `scheduleNode` with an `aimMin` argument.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts src/state/scheduleActions.ts src/state/scheduleActions.test.ts src/state/store.test.ts src/views/plan/PlanWeekOverlay.tsx
git commit -m "feat(store): scheduling actions that resolve slots and refuse overflow"
```

---

## View tasks

The remaining tasks build React components. **Vitest runs with `environment: 'node'` — there is no DOM, so these cannot be unit-tested.** Their gate is `./node_modules/.bin/tsc -b` plus the explicit smoke checks each task lists. Do not add `*.test.ts` files for components; do not add a DOM test environment as part of this plan.

Throughout, `Today` and the old `PlanWeekOverlay` keep working. Nothing in these tasks touches them except where Task 9 already did.

### Task 10: The `Plan` view and its nav entry

**Files:**
- Create: `src/views/Plan.tsx`
- Modify: `src/state/store.ts:37` (`ViewName`)
- Modify: `src/App.tsx:140-171` (nav), `src/App.tsx:246-258` (routing)
- Modify: `src/lib/appKeyboard.ts`

**Interfaces:**
- Consumes: `weekOf` from `plan.ts`; `weekDates`, `todayStr`, `addDays` from `dates.ts`.
- Produces: `Plan` component; `ViewName` gains `'plan'`; `Plan` owns `weekStart` state and passes `weekStart`/`days` to its children in later tasks.

The provisional backlog list in step 2 is scaffolding — plan 2 replaces it with the sidebar accordion. It exists so Task 13 has something to drag from.

- [ ] **Step 1: Widen `ViewName` and route to it**

In `src/state/store.ts` line 37:

```ts
export type ViewName = 'today' | 'goals' | 'timeline' | 'plan';
```

In `src/App.tsx`, add `import { Plan } from './views/Plan';` and add a nav entry by replacing the nav array (lines 141-147):

```tsx
            [
              ['today', 'Today'],
              ['plan', 'Plan'],
              ['goals', 'Goals'],
              ['timeline', 'Timeline'],
            ] as const
```

Replace the `Plan week` button (lines 161-170) — the old modal keeps its `4` shortcut but loses its nav button, so the header does not carry two competing entry points:

```tsx
          <button
            type="button"
            onClick={() => actions.openPlan()}
            aria-haspopup="dialog"
            title="Old planner (4)"
            className="px-[14px] py-[6px] rounded-full text-[.86rem] font-medium text-muted border border-line-2 hover:bg-hover hover:text-ink"
          >
            Old planner
            {reviewWaiting && <span className="text-accent"> · review</span>}
          </button>
```

Add a routing branch in `App.tsx`, immediately before the `view === 'timeline'` branch (line 250):

```tsx
        ) : view === 'plan' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[24px]">
            <Plan />
          </div>
```

- [ ] **Step 2: Create `src/views/Plan.tsx`**

```tsx
import { useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr, addDays, weekDates } from '../lib/dates';
import { weekOf, attentionRank, unplannedOpenLeaves } from '../lib/plan';

/**
 * The week calendar. Owns which week is shown; everything else is derived.
 *
 * The backlog list below is SCAFFOLDING — plan 2 replaces it with the sidebar
 * accordion. It exists so there is something to drag from.
 */
export function Plan() {
  const { goals, hydration } = useAppStore();
  const today = todayStr();
  const [weekStart, setWeekStart] = useState(() => weekOf(today));
  const days = weekDates(weekStart);

  if (hydration !== 'ready') {
    return <div className="text-muted text-[.85rem] py-[40px]">Loading…</div>;
  }

  const backlog = attentionRank(goals, today)
    .map((goal) => ({ goal, leaves: unplannedOpenLeaves(goal, weekStart) }))
    .filter((g) => g.leaves.length > 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[232px_1fr] gap-[18px] items-start">
      <div className="min-w-0">
        <h3 className="font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold mb-[8px]">
          To plan
        </h3>
        {backlog.length === 0 ? (
          <div className="text-faint text-[.82rem] italic">Nothing left to plan.</div>
        ) : (
          backlog.map(({ goal, leaves }) => (
            <div key={goal.id} className="mb-[10px]">
              <div className="font-disp text-[.86rem] font-semibold truncate">{goal.title}</div>
              {leaves.map((leaf) => (
                <div
                  key={leaf.id}
                  className="text-[.78rem] text-ink-soft truncate px-[6px] py-[4px] rounded-[6px] border border-line-2 bg-panel mt-[3px]"
                >
                  {leaf.title}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-[10px] mb-[10px]">
          <h3 className="font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold">
            Your week
          </h3>
          <span className="flex-1" />
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className="text-muted hover:text-ink px-[6px]">‹</button>
          <button type="button" onClick={() => setWeekStart(weekOf(today))} className="text-[.72rem] text-muted hover:text-ink">today</button>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} className="text-muted hover:text-ink px-[6px]">›</button>
        </div>
        <div className="text-faint text-[.8rem]">{days[0]} – {days[6]}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Map the keyboard**

In `src/lib/appKeyboard.ts`, add `| 'view-plan'` to the `AppKeyCommand` union (after `'view-timeline'`, line 7), and add the key mapping immediately after line 45:

```ts
  if (event.key === '5') return 'view-plan';
```

`5` rather than `4`, because `4` still opens the old planner modal until plan 2 deletes it.

Then in `src/App.tsx`'s `onKey` handler, after the `view-timeline` line (line 116):

```tsx
      if (command === 'view-plan') actions.setView('plan');
```

Update the nav `title` string on line 140 to read `Keyboard: 1–3 switch views · 5 plan · 4 old planner · T today · ⌘N add task · ? shortcuts · Esc closes`, and add the matching row to `src/components/ShortcutsOverlay.tsx`.

- [ ] **Step 4: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output. If `appKeyboard.test.ts` enumerates commands exhaustively, add the `view-plan` case there.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Smoke test**

Run `./node_modules/.bin/vite`, open the URL, then verify:
1. The header shows `Today · Plan · Goals · Timeline` plus an `Old planner` button.
2. Clicking **Plan** shows the "To plan" list on the left and the week range on the right.
3. Pressing `5` switches to Plan; `1` returns to Today.
4. `‹` and `›` move the shown date range by seven days; **today** returns to this week.
5. `4` still opens the old planner modal, and it still works.

- [ ] **Step 6: Commit**

```bash
git add src/views/Plan.tsx src/App.tsx src/state/store.ts src/lib/appKeyboard.ts src/components/ShortcutsOverlay.tsx
git commit -m "feat(plan): add the Plan view behind a fourth nav item"
```

---

### Task 11: The grid chrome — axis, day headers, shading, now-line

**Files:**
- Create: `src/views/plan/WeekGrid.tsx`
- Create: `src/views/plan/DayColumn.tsx`
- Modify: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `visibleRange`, `minuteToPct`, `hourMarks` from `grid.ts`; `windowForDate` from `availability.ts`; `Now` from `capacity.ts`.
- Produces:
  - `WeekGrid({ days, today, nowMinute, children })` where `children` is `(date: string) => ReactNode`, rendering the per-day content that Task 12 supplies.
  - `DayColumn({ date, isToday, window, nowMinute, range, children })`

`GRID_HEIGHT_PX = 720` is a named constant — the pixel height the percentage geometry maps onto, and the number Task 13 divides by to turn a drop offset back into a minute.

- [ ] **Step 1: Create `src/views/plan/DayColumn.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { AvailabilityWindow } from '../../db/types';
import type { Interval } from '../../lib/capacity';
import { minuteToPct } from '../../lib/grid';

/**
 * One day. Draws the availability shading, the now-line, and nothing else —
 * the blocks themselves arrive as `children` so this file stays about geometry.
 *
 * A day with no window is hatched and, from Task 13 onward, refuses drops.
 */
export function DayColumn({
  date, isToday, window, nowMinute, range, children,
}: {
  date: string;
  isToday: boolean;
  window: AvailabilityWindow | null;
  nowMinute: number | null;
  range: Interval;
  children: ReactNode;
}) {
  return (
    <div
      data-date={date}
      className={`relative min-w-0 border-l border-line-soft ${
        window ? '' : 'bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgb(var(--c-hover))_4px,rgb(var(--c-hover))_8px)]'
      } ${isToday ? 'bg-hover/40' : ''}`}
    >
      {/* hours outside the working window, dimmed */}
      {window && (
        <>
          <div
            className="absolute left-0 right-0 top-0 bg-hover/60 pointer-events-none"
            style={{ height: `${Math.max(0, minuteToPct(window.startMin, range))}%` }}
          />
          <div
            className="absolute left-0 right-0 bottom-0 bg-hover/60 pointer-events-none"
            style={{ height: `${Math.max(0, 100 - minuteToPct(window.endMin, range))}%` }}
          />
        </>
      )}

      {children}

      {isToday && nowMinute !== null && nowMinute >= range.startMin && nowMinute <= range.endMin && (
        <div
          className="absolute left-0 right-0 h-0 border-t border-accent pointer-events-none z-[2]"
          style={{ top: `${minuteToPct(nowMinute, range)}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/views/plan/WeekGrid.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { AvailabilityWindow, BusyBlock } from '../../db/types';
import { windowForDate } from '../../lib/availability';
import { visibleRange, minuteToPct, hourMarks } from '../../lib/grid';
import { parseD } from '../../lib/dates';
import { DayColumn } from './DayColumn';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Pixel height of the hour grid. The pure geometry in lib/grid.ts works in
 * percentages; this is the one place a percentage becomes a pixel, and the
 * divisor Task 13 uses to turn a drop offset back into a minute.
 */
export const GRID_HEIGHT_PX = 720;

const AXIS_WIDTH_PX = 46;

function hourLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

export function WeekGrid({
  days, today, nowMinute, windows, blocks, allDayBlocks, children,
}: {
  days: string[];
  today: string;
  nowMinute: number | null;
  windows: AvailabilityWindow[];
  blocks: BusyBlock[];
  allDayBlocks: boolean;
  children: (date: string) => ReactNode;
}) {
  const range = visibleRange(days, windows, blocks, allDayBlocks);
  const marks = hourMarks(range);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* day headings */}
        <div
          className="grid gap-0 mb-[4px]"
          style={{ gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))` }}
        >
          <span />
          {days.map((iso, i) => (
            <div key={iso} className="text-center">
              <div className={`font-mono text-[.58rem] tracking-[.12em] uppercase ${iso === today ? 'text-accent' : 'text-muted'}`}>
                {DOW[i]}
              </div>
              <div className={`text-[.82rem] tabular-nums ${iso === today ? 'text-ink font-semibold' : 'text-ink-soft'}`}>
                {parseD(iso).getDate()}
              </div>
            </div>
          ))}
        </div>

        {/* the hour grid */}
        <div
          className="grid relative border-t border-line"
          style={{
            gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))`,
            height: `${GRID_HEIGHT_PX}px`,
          }}
        >
          {/* hour rules, drawn once across the full width behind everything */}
          {marks.map((m) => (
            <div
              key={m}
              className="absolute left-0 right-0 border-t border-line-soft pointer-events-none"
              style={{ top: `${minuteToPct(m, range)}%` }}
              aria-hidden="true"
            />
          ))}

          {/* time axis */}
          <div className="relative">
            {marks.map((m) => (
              <span
                key={m}
                className="absolute right-[6px] -translate-y-1/2 font-mono text-[.58rem] text-faint tabular-nums"
                style={{ top: `${minuteToPct(m, range)}%` }}
              >
                {hourLabel(m)}
              </span>
            ))}
          </div>

          {days.map((iso) => (
            <DayColumn
              key={iso}
              date={iso}
              isToday={iso === today}
              window={windowForDate(iso, windows)}
              nowMinute={iso === today ? nowMinute : null}
              range={range}
            >
              {children(iso)}
            </DayColumn>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render it from `Plan.tsx`**

Replace the `<div className="text-faint text-[.8rem]">{days[0]} – {days[6]}</div>` placeholder with:

```tsx
        <WeekGrid
          days={days}
          today={today}
          nowMinute={nowMinute}
          windows={availability}
          blocks={[]}
          allDayBlocks={allDayBlocks}
        >
          {() => null}
        </WeekGrid>
```

Pull `availability` and `allDayBlocks` from `useAppStore()`, add `import { WeekGrid } from './plan/WeekGrid';`, and compute the live minute:

```tsx
  // Re-render each minute so the now-line moves.
  const [nowMinute, setNowMinute] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinute(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);
```

Add `useEffect` to the React import.

- [ ] **Step 4: Handle the "no working hours at all" case**

If every weekday is off, the grid is seven hatched columns and no explanation. Add this above the `WeekGrid` call in `Plan.tsx`:

```tsx
        {availability.length === 0 && (
          <div className="mb-[10px] px-[10px] py-[8px] rounded-[9px] border border-line-2 bg-panel text-[.82rem] text-ink-soft">
            No working hours set — every day is off, so nothing can be scheduled.{' '}
            <button
              type="button"
              onClick={() => actions.openPlan()}
              className="font-semibold text-accent hover:text-accent-deep"
            >
              Set your availability
            </button>
          </div>
        )}
```

The button opens the old planner, which owns `AvailabilitySettings` until plan 2 moves it into the sidebar.

- [ ] **Step 5: Typecheck**

Run: `./node_modules/.bin/tsc -b`
Expected: no output.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS.

- [ ] **Step 6: Smoke test**

Run `./node_modules/.bin/vite` and on the Plan view verify:
1. Seven day columns with weekday names and dates; today's heading is accent-coloured.
2. A left time axis labelled from at least `8am` to `8pm`, with a horizontal rule at each hour.
3. Mon–Fri 09:00–18:00 read as normal; the hours above 9am and below 6pm are dimmed.
4. Saturday and Sunday are hatched.
5. A thin accent line crosses today's column at the current time. If the current time is outside 08:00–20:00 it is correctly absent.
6. In Availability (via the old planner, `4`), set Saturday on 10:00–14:00 → Saturday stops being hatched and shows a 10–14 clear band.
7. Set a window to 06:00–22:00 → the axis grows to cover it.
8. Turn **every** weekday off → the "No working hours set" notice appears above an all-hatched grid.

- [ ] **Step 7: Commit**

```bash
git add src/views/plan/WeekGrid.tsx src/views/plan/DayColumn.tsx src/views/Plan.tsx
git commit -m "feat(plan): hour-grid chrome with axis, shading and now-line"
```

---

### Task 12: Render the blocks

**Files:**
- Create: `src/views/plan/EventBlock.tsx`
- Create: `src/views/plan/DayBlocks.tsx`
- Modify: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `scheduledOn`, `ScheduledItem` from `scheduled.ts`; `assignLanes`, `minuteToPct` from `grid.ts`.
- Produces:
  - `interface GridBlock { key: string; kind: 'step' | 'task' | 'busy'; title: string; startMin: number; endMin: number; done: boolean; estimated: boolean }`
  - `EventBlock({ block, lane, laneCount, range, onRemove })`
  - `DayBlocks({ date, goals, tasks, blocks, range, allDayBlocks, onRemove })`

The spec lists `BusyBlock.tsx` as a separate component. It is folded into `EventBlock` as `kind: 'busy'` instead: the two differ only in colour and the absence of a remove button, and they must share one lane-layout pass, so splitting them would mean duplicating the positioning maths in two files.

Calendar events and scheduled work are laid out in **one** `assignLanes` pass over the combined set, so a step and a meeting that overlap sit side by side rather than on top of one another. (Placed work cannot overlap other placed work — but it can overlap a calendar event that appeared after it was scheduled.)

- [ ] **Step 1: Create `src/views/plan/EventBlock.tsx`**

```tsx
import type { Interval } from '../../lib/capacity';
import { minuteToPct } from '../../lib/grid';

/** A block on the grid — either committed work or a calendar event. */
export interface GridBlock {
  key: string;
  kind: 'step' | 'task' | 'busy';
  title: string;
  startMin: number;
  endMin: number;
  done: boolean;
  estimated: boolean; // false ⇒ using the DEFAULT_SLOT_MIN fallback
}

function timeLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const display = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${display}${suffix}` : `${display}:${String(m).padStart(2, '0')}${suffix}`;
}

export function EventBlock({
  block, lane, laneCount, range, onRemove,
}: {
  block: GridBlock;
  lane: number;
  laneCount: number;
  range: Interval;
  onRemove?: () => void;
}) {
  const top = minuteToPct(block.startMin, range);
  const height = minuteToPct(block.endMin, range) - top;
  const width = 100 / laneCount;
  const isBusy = block.kind === 'busy';

  return (
    <div
      className={`absolute rounded-[6px] px-[5px] py-[2px] overflow-hidden text-[.66rem] leading-[1.2] border ${
        isBusy
          ? 'bg-hover border-line-2 text-muted italic'
          : `bg-panel border-line-2 border-l-[3px] border-l-accent text-ink ${block.done ? 'opacity-55 line-through' : ''} ${block.estimated ? '' : 'border-dashed'}`
      }`}
      style={{
        top: `${top}%`,
        height: `${Math.max(height, 1.6)}%`,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      title={`${block.title} · ${timeLabel(block.startMin)}–${timeLabel(block.endMin)}${block.estimated ? '' : ' · no estimate'}`}
    >
      <div className="truncate font-medium">{block.title}</div>
      <div className="truncate text-faint text-[.6rem] tabular-nums">{timeLabel(block.startMin)}</div>
      {onRemove && !isBusy && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Unschedule ${block.title}`}
          className="absolute top-0 right-[2px] text-faint hover:text-warn text-[.7rem] leading-none px-[2px]"
        >
          ×
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/views/plan/DayBlocks.tsx`**

```tsx
import type { BusyBlock, Goal, Task } from '../../db/types';
import type { Interval } from '../../lib/capacity';
import { assignLanes } from '../../lib/grid';
import { scheduledOn } from '../../lib/scheduled';
import { EventBlock, type GridBlock } from './EventBlock';

/**
 * Everything drawn inside one day column.
 *
 * Work and calendar events go through ONE assignLanes pass. Placed work never
 * overlaps other placed work, but it can overlap an event that landed in the
 * calendar after it was scheduled — laying them out together is what keeps
 * that case legible instead of stacking one on top of the other.
 */
export function DayBlocks({
  date, goals, tasks, blocks, range, allDayBlocks, onRemove,
}: {
  date: string;
  goals: Goal[];
  tasks: Task[];
  blocks: BusyBlock[];
  range: Interval;
  allDayBlocks: boolean;
  onRemove: (kind: 'step' | 'task', id: string, goalId: string | null) => void;
}) {
  const work: GridBlock[] = scheduledOn(goals, tasks, date).map((item) => ({
    key: `${item.kind}:${item.id}`,
    kind: item.kind,
    title: item.title,
    startMin: item.startMin,
    endMin: item.endMin,
    done: item.done,
    estimated: item.estimated,
  }));

  const busy: GridBlock[] = blocks
    .filter((b) => b.date === date && !b.allDay && (allDayBlocks || !b.allDay))
    .map((b, i) => ({
      key: `busy:${date}:${i}`,
      kind: 'busy' as const,
      title: b.title,
      startMin: b.startMin,
      endMin: b.endMin,
      done: false,
      estimated: true,
    }));

  const byKey = new Map<string, GridBlock>([...work, ...busy].map((b) => [b.key, b]));
  const laid = assignLanes([...work, ...busy]);
  const idOf = (key: string) => key.slice(key.indexOf(':') + 1);

  return (
    <>
      {laid.map(({ item, lane, laneCount }) => {
        const block = byKey.get(item.key)!;
        const source = scheduledOn(goals, tasks, date).find(
          (s) => `${s.kind}:${s.id}` === block.key,
        );
        return (
          <EventBlock
            key={block.key}
            block={block}
            lane={lane}
            laneCount={laneCount}
            range={range}
            onRemove={
              block.kind === 'busy'
                ? undefined
                : () => onRemove(block.kind as 'step' | 'task', idOf(block.key), source?.goalId ?? null)
            }
          />
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: Render from `Plan.tsx`**

Replace `{() => null}` in the `WeekGrid` call with:

```tsx
          {(date) => (
            <DayBlocks
              date={date}
              goals={goals}
              tasks={tasks}
              blocks={[]}
              range={range}
              allDayBlocks={allDayBlocks}
              onRemove={(kind, id, goalId) => {
                if (kind === 'task') actions.unscheduleTask(id);
                else if (goalId) actions.unscheduleNode(goalId, id);
              }}
            />
          )}
```

`range` must be computed in `Plan.tsx` as well as inside `WeekGrid`, so lift it: add `import { visibleRange } from '../lib/grid';` and `const range = visibleRange(days, availability, [], allDayBlocks);`, then pass `range` into `WeekGrid` as a prop instead of computing it there. Change `WeekGrid`'s signature to accept `range: Interval` and delete its internal `visibleRange` call — one source of truth for the geometry both components share.

Pull `tasks` and `actions` from `useAppStore()` and import `DayBlocks`.

- [ ] **Step 4: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Smoke test**

Run `./node_modules/.bin/vite`. On Plan:
1. Steps and tasks that the Task 8 migration placed appear as blocks at their times.
2. A block's height matches its estimate — a 90-minute step is 1.5× the height of a 60-minute one.
3. A step with **no** estimate renders one hour tall with a **dashed** border.
4. A completed step renders struck through and dimmed.
5. Hovering shows a tooltip with the title and time range.
6. Clicking `×` removes the block, an undo toast appears, and **Undo** puts it back.
7. Switching to the previous/next week shows that week's blocks.

- [ ] **Step 6: Commit**

```bash
git add src/views/plan/EventBlock.tsx src/views/plan/DayBlocks.tsx src/views/plan/WeekGrid.tsx src/views/Plan.tsx
git commit -m "feat(plan): render scheduled work and calendar events on the grid"
```

---

### Task 13: Drag to schedule, drag to move, drag to resize

**Files:**
- Modify: `src/views/Plan.tsx`
- Modify: `src/views/plan/DayColumn.tsx`
- Modify: `src/views/plan/EventBlock.tsx`
- Create: `src/views/plan/dropTarget.ts`
- Create: `src/views/plan/dropTarget.test.ts`

**Interfaces:**
- Consumes: `pctToMinute` from `grid.ts`; `scheduleNode`, `scheduleTask`, `resizeNode`, `resizeTask` from Task 9.
- Produces:
  - `interface PlanDragData { kind: 'step' | 'task'; id: string; goalId: string | null; title: string }`
  - `aimMinuteFor(clientY: number, rectTop: number, rectHeight: number, range: Interval): number`

The drop's vertical position *is* the aimed-at time. `aimMinuteFor` is pure and tested; the dnd-kit wiring around it is not.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/dropTarget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aimMinuteFor } from './dropTarget';

const RANGE = { startMin: 480, endMin: 1200 }; // 08:00–20:00

describe('aimMinuteFor', () => {
  it('maps the top of the column to the range start', () => {
    expect(aimMinuteFor(100, 100, 720, RANGE)).toBe(480);
  });
  it('maps the bottom of the column to the range end', () => {
    expect(aimMinuteFor(820, 100, 720, RANGE)).toBe(1200);
  });
  it('maps the midpoint to the middle of the range', () => {
    expect(aimMinuteFor(460, 100, 720, RANGE)).toBe(840);
  });
  it('clamps a drop above the column to the range start', () => {
    expect(aimMinuteFor(0, 100, 720, RANGE)).toBe(480);
  });
  it('clamps a drop below the column to the range end', () => {
    expect(aimMinuteFor(9999, 100, 720, RANGE)).toBe(1200);
  });
  it('returns the range start for a zero-height rect rather than dividing by zero', () => {
    expect(aimMinuteFor(100, 100, 0, RANGE)).toBe(480);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts src/views/plan/dropTarget.test.ts`
Expected: FAIL — `Failed to resolve import "./dropTarget"`.

- [ ] **Step 3: Create `src/views/plan/dropTarget.ts`**

```ts
import type { Interval } from '../../lib/capacity';
import { pctToMinute } from '../../lib/grid';

/** What a draggable carries. `goalId` is null for tasks. */
export interface PlanDragData {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
}

/**
 * The minute a drop at `clientY` is aiming at.
 *
 * Clamped to the range: a drop released above or below the column still means
 * "the earliest/latest time shown" rather than an out-of-range minute that
 * resolveSlot would silently push somewhere surprising.
 */
export function aimMinuteFor(
  clientY: number,
  rectTop: number,
  rectHeight: number,
  range: Interval,
): number {
  if (rectHeight <= 0) return range.startMin;
  const pct = ((clientY - rectTop) / rectHeight) * 100;
  const minute = pctToMinute(pct, range);
  return Math.round(Math.min(Math.max(minute, range.startMin), range.endMin));
}
```

- [ ] **Step 4: Make day columns droppable**

In `DayColumn.tsx`, add `import { useDroppable } from '@dnd-kit/core';` and inside the component:

```tsx
  // A day with no availability window refuses drops outright — the disabled
  // droppable is what makes `over` null there, so nothing is ever scheduled
  // onto a day off.
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: !window });
```

Put `ref={setNodeRef}` on the outer `<div>` and append `${isOver && window ? 'bg-accent/5' : ''}` to its className.

- [ ] **Step 5: Make backlog items and placed blocks draggable**

In `EventBlock.tsx`, accept an optional `drag?: PlanDragData`, and when present wrap with `useDraggable({ id: `${drag.kind}:${drag.id}`, data: drag })`, spreading `listeners`/`attributes` and setting `ref`. Add `cursor-grab` to the className.

Add a resize handle to non-busy blocks:

```tsx
      {onResize && !isBusy && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const startY = e.clientY;
            const startDuration = block.endMin - block.startMin;
            const pxPerMinute = gridHeightPx / (range.endMin - range.startMin);
            const move = (ev: PointerEvent) => {
              onPreview?.(Math.round(startDuration + (ev.clientY - startY) / pxPerMinute));
            };
            const up = (ev: PointerEvent) => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              onResize(Math.round(startDuration + (ev.clientY - startY) / pxPerMinute));
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          className="absolute left-0 right-0 bottom-0 h-[6px] cursor-ns-resize"
          aria-hidden="true"
        />
      )}
```

Add `onResize?: (minutes: number) => void`, `onPreview?: (minutes: number) => void` and `gridHeightPx: number` to the props. `onPreview` may be omitted in this task — the store clamps on commit either way.

Native pointer events are used here rather than a second dnd-kit sensor: nesting a draggable inside a draggable fights for the same gesture, and resize needs only a vertical delta.

- [ ] **Step 6: Wire `DndContext` in `Plan.tsx`**

```tsx
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(e: DragEndEvent) {
    setDragTitle(null);
    const data = e.active.data.current as PlanDragData | undefined;
    const overId = typeof e.over?.id === 'string' ? e.over.id : null;
    if (!data || !overId?.startsWith('day:') || !e.over) return;
    const date = overId.slice('day:'.length);

    // The pointer's final Y: where the gesture started, plus how far it moved.
    const activator = e.activatorEvent as PointerEvent;
    const clientY = activator.clientY + e.delta.y;
    const aim = aimMinuteFor(clientY, e.over.rect.top, e.over.rect.height, range);

    if (data.kind === 'task') actions.scheduleTask(data.id, date, aim);
    else if (data.goalId) actions.scheduleNode(data.goalId, data.id, date, aim);
  }
```

Wrap the whole return in `<DndContext sensors={sensors} onDragStart={...} onDragEnd={handleDragEnd}>` with a `<DragOverlay>` showing `dragTitle`, mirroring `PlanWeekOverlay.tsx:478-484`. Give each provisional backlog row a `useDraggable` with `PlanDragData`.

- [ ] **Step 7: Typecheck and run the suite**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS, 6 new `aimMinuteFor` cases.
Run: `./node_modules/.bin/tsc -b`
Expected: no output.

- [ ] **Step 8: Smoke test**

Run `./node_modules/.bin/vite`. On Plan:
1. Drag a backlog step onto Wednesday around 2pm → it lands at 2pm and leaves the backlog.
2. Drag one onto a time already occupied → it snaps below the existing block, not on top of it.
3. Drag onto Saturday (hatched, no window) → refused; the step stays in the backlog.
4. Fill a day, then drag one more large step onto it → a toast reads `No 1h 30m gap left that day` and nothing moves.
5. Drag a placed block to a different day and time → it moves.
6. Drag a block's bottom edge down → it grows, and the estimate updates. Reload — the new duration persists.
7. Resize a block down into the next block → it stops at the boundary instead of overlapping.
8. Resize past 6pm → it stops at the end of the availability window.

- [ ] **Step 9: Commit**

```bash
git add src/views/Plan.tsx src/views/plan/DayColumn.tsx src/views/plan/EventBlock.tsx src/views/plan/dropTarget.ts src/views/plan/dropTarget.test.ts
git commit -m "feat(plan): drag to schedule, move and resize on the grid"
```

---

### Task 14: Week header — capacity, navigation, past weeks

**Files:**
- Create: `src/views/plan/WeekHeader.tsx`
- Modify: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `weekCapacity`, `Now` from `capacity.ts`; `capacityParts`, `capacityNote`, `isOverCommitted` from `./capacityLabel`; `plannedLeaves` from `plan.ts`; `tasksForWeek` from `dailyWork.ts`.
- Produces: `WeekHeader({ weekStart, today, isPast, capacity, onPrev, onNext, onToday })`

`weekCapacity` needs no change: `plannedWeek` is still written by `setPlannedSlot`, so `plannedLeaves` keeps working exactly as it does now.

A past week is read-only. Rather than a second permission system, `Plan` simply does not render the `DndContext`'s drop targets as enabled — the existing `disabled` flag on `useDroppable` already covers it once `isPast` is threaded through.

- [ ] **Step 1: Create `src/views/plan/WeekHeader.tsx`**

```tsx
import type { WeekCapacity } from '../../lib/capacity';
import { fmtD, addDays } from '../../lib/dates';
import { capacityParts, capacityNote, isOverCommitted } from './capacityLabel';

export function WeekHeader({
  weekStart, isPast, capacity, onPrev, onNext, onToday,
}: {
  weekStart: string;
  isPast: boolean;
  capacity: WeekCapacity;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const note = capacityNote(capacity);
  return (
    <div className="flex items-baseline gap-[10px] mb-[10px] flex-wrap">
      <h3 className="font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold">
        {fmtD(weekStart)} – {fmtD(addDays(weekStart, 6))}
      </h3>
      <span className={`text-[.78rem] tabular-nums ${isOverCommitted(capacity) ? 'text-warn' : 'text-muted'}`}>
        {capacityParts(capacity).join(' · ')}
      </span>
      {note && (
        <span className="text-[.56rem] text-faint truncate max-w-[240px]" title={note}>{note}</span>
      )}
      {isPast && (
        <span className="text-[.7rem] text-faint italic">past week — read only</span>
      )}
      <span className="flex-1" />
      <button type="button" onClick={onPrev} aria-label="Previous week" className="text-muted hover:text-ink px-[6px]">‹</button>
      <button type="button" onClick={onToday} className="text-[.72rem] text-muted hover:text-ink">today</button>
      <button type="button" onClick={onNext} aria-label="Next week" className="text-muted hover:text-ink px-[6px]">›</button>
    </div>
  );
}
```

- [ ] **Step 2: Compute capacity and wire the header in `Plan.tsx`**

Replace the ad-hoc header block from Task 10 with:

```tsx
  const now: Now = { date: today, minute: nowMinute };
  const capacity = weekCapacity({
    week: weekStart,
    windows: availability,
    blocks: [],
    leaves: plannedLeaves(goals, weekStart),
    tasks: tasksForWeek(tasks, weekStart),
    now,
    allDayBlocks,
    hasData: false, // slice 2 flips this when a calendar is connected
  });
  const isPast = weekStart < weekOf(today);
```

```tsx
        <WeekHeader
          weekStart={weekStart}
          isPast={isPast}
          capacity={capacity}
          onPrev={() => setWeekStart(addDays(weekStart, -7))}
          onNext={() => setWeekStart(addDays(weekStart, 7))}
          onToday={() => setWeekStart(weekOf(today))}
        />
```

Thread `isPast` down to `WeekGrid` → `DayColumn` and widen the droppable guard:

```tsx
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: !window || readOnly });
```

Also pass `onRemove={undefined}` from `DayBlocks` when `isPast`, so a past week shows no `×`.

- [ ] **Step 3: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc -b`
Expected: no output.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts`
Expected: PASS.

- [ ] **Step 4: Smoke test**

1. The header reads the week's date range and a capacity figure matching what the old planner (`4`) shows for the same week.
2. Over-commit a week → the figure turns warn-coloured.
3. Navigate to last week → `past week — read only` appears, dragging onto it does nothing, and no `×` buttons render.
4. Navigate forward to a future week → fully editable again.
5. **today** returns to the current week.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/WeekHeader.tsx src/views/Plan.tsx src/views/plan/WeekGrid.tsx src/views/plan/DayColumn.tsx src/views/plan/DayBlocks.tsx
git commit -m "feat(plan): week header with capacity, navigation and read-only past weeks"
```

---

## Done criteria

- `./node_modules/.bin/tsc -b` clean and the full suite green.
- Plan is reachable from the nav and by pressing `5`; Today, Goals, Timeline and the old planner (`4`) all still work.
- Migrated commitments render at real times; drag, move, resize and unschedule all persist across a reload.
- `src/components/GoalTree.tsx` is still unstaged, uncommitted, and byte-identical.

## What plan 2 covers

The sidebar accordion with the backlog pinned open and Habits / Suggestions / Stats / Month folded beneath it; `QuickAdd` and the goal-percentage move onto project headers; unscheduled tasks in the backlog (the `Task.date`-optional half that this plan only prepared); the inline recap panel; keyboard placement with `1`–`7`, `[`, `]`, `T`; then the flip — Plan becomes the default view, `Today.tsx`, `src/views/today/*` and `PlanWeekOverlay.tsx` are deleted, and the nav returns to three entries.
