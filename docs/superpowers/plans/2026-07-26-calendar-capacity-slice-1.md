# Calendar Capacity — Slice 1: Estimates, Windows, and Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the week planner a real, honest capacity readout — free / planned / unestimated per day and per week — computed entirely from local data, with no Google involvement.

**Architecture:** Three new pure modules in `src/lib` (`availability.ts`, `capacity.ts`, and a planner-local formatter), plus an optional `estimateMin` field on `GoalNode` and `Task`. Capacity consumes a `BusyBlock[]` that is defined now but always empty in this slice — slice 2 fills it from Google without capacity changing. The `now` used for "remaining capacity" is injected, never read from a clock, so every calculation is deterministic and fixture-testable.

**Tech Stack:** TypeScript, React 18, Vitest (`environment: 'node'`, no DOM), Dexie.

Spec: `docs/superpowers/specs/2026-07-26-google-calendar-capacity-design.md`

## Global Constraints

- `estimateMin` is **scheduling metadata**. It must never affect the pct roll-up in `src/lib/pct.ts`. Do not touch that file.
- All new logic in `src/lib/*` is **pure**: no `Date.now()`, no `new Date()` without an argument, no `db` access, no network. Current time enters as a parameter.
- Views never call `db` directly. All mutations go through `actions` in `src/state/store.ts`, which call `setAndPersist` or `set`.
- Tests run under `environment: 'node'` — **there is no DOM and no jsdom**. Test pure functions, not React rendering. Extract display logic into a pure module and test that, mirroring `src/views/today/workActions.ts` + `workActions.test.ts`.
- Visual identity is locked. Add information, not styling. No new colors, no new components beyond what is specified.
- Every new `src/lib` module ships a sibling `*.test.ts`.
- Run `npm test` and `npx tsc -b` before every commit.
- **Do not stage `src/components/GoalTree.tsx`** — it holds unrelated uncommitted work. Stage files explicitly by path; never `git add -A` or `git add .`.
- Minutes are integers, minutes-from-local-midnight, range `0..1440`, end exclusive.
- `dow` is `0 = Monday … 6 = Sunday`, matching `weekDates()` in `src/lib/dates.ts`.

## File Structure

| File | Responsibility | Status |
| --- | --- | --- |
| `src/db/types.ts` | `estimateMin` on `GoalNode`/`Task`; `AvailabilityWindow`; `BusyBlock` | Modify |
| `src/lib/tree.ts` | Drop `estimateMin` when a leaf becomes a container | Modify |
| `src/lib/plan.ts` | Carry `estimateMin` on `PlannedLeaf` | Modify |
| `src/lib/availability.ts` | Window model, validation, defaults, per-date lookup | **Create** |
| `src/lib/capacity.ts` | Free minutes, workload, day/week assembly | **Create** |
| `src/db/db.ts` | Load/save availability in the `settings` table | Modify |
| `src/state/store.ts` | Availability state + estimate actions | Modify |
| `src/views/plan/capacityLabel.ts` | Pure formatting for the planner readout | **Create** |
| `src/views/plan/PlanWeekOverlay.tsx` | Render the readout; delete `SOFT_CAPACITY` | Modify |
| `src/views/plan/EstimateField.tsx` | Inline estimate entry | **Create** |
| `src/components/AvailabilitySettings.tsx` | Weekday window editor | **Create** |

---

### Task 1: `estimateMin` on the domain types

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/lib/tree.ts:121-141` (`indentNode`)
- Modify: `src/state/store.ts:242-258` (`addChild`), `src/state/store.ts:261-280` (`addChildren`)
- Test: `src/lib/tree.test.ts` (extend), `src/state/store.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `GoalNode.estimateMin?: number`, `Task.estimateMin?: number`, `AvailabilityWindow`, `BusyBlock`. All later tasks depend on these exact names.

There are exactly **three** places where a leaf becomes a container and leaf-only fields are deleted. `estimateMin` must be dropped at all three, or a container will carry a stale estimate that `capacity.ts` would have to defend against.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tree.test.ts`:

```ts
it('drops estimateMin when a leaf becomes a container via indent', () => {
  const goals: Goal[] = [{
    id: 'g1', title: 'G', nodes: [
      { id: 'a', title: 'A', done: false, estimateMin: 90 },
      { id: 'b', title: 'B', done: false },
    ],
  }];
  const next = indentNode(goals, 'b');
  const a = next[0].nodes[0];
  expect(a.children?.map((c) => c.id)).toEqual(['b']);
  expect(a.estimateMin).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/lib/tree.test.ts -t 'drops estimateMin'`
Expected: FAIL — `expected 90 to be undefined`.

- [ ] **Step 3: Add the fields and the three deletions**

In `src/db/types.ts`, add to `GoalNode` after `plannedDay`:

```ts
  estimateMin?: number;  // LEAVES only — expected effort in minutes.
                         // Scheduling metadata: never affects pct roll-up.
```

Add to `Task` after `goalId`:

```ts
  estimateMin?: number; // expected effort in minutes; same meaning as GoalNode
```

Add two new exported interfaces at the end of the file:

```ts
// A weekday's availability window. Absent dow means that day is off.
export interface AvailabilityWindow {
  dow: number;      // 0 = Mon … 6 = Sun, matching weekDates() order
  startMin: number; // minutes from local midnight; 540 = 09:00
  endMin: number;   // exclusive
}

// A busy slice, already flattened onto one local day by the main process.
// Always empty in slice 1; populated from Google in slice 2.
export interface BusyBlock {
  date: string;     // 'YYYY-MM-DD' local
  startMin: number; // clipped to that local day, 0..1440
  endMin: number;   // exclusive, > startMin
  title: string;
  allDay: boolean;
}
```

In `src/lib/tree.ts`, inside `indentNode`, extend the existing deletion block:

```ts
    if (!prev.children?.length) {
      delete prev.done;
      delete prev.doneAt;
      delete prev.plannedWeek;
      delete prev.plannedDay;
      delete prev.estimateMin;
    }
```

In `src/state/store.ts`, in **both** `addChild` and `addChildren`, extend the matching block:

```ts
    delete node.done;
    delete node.doneAt;
    delete node.estimateMin;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npx tsc -b`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/types.ts src/lib/tree.ts src/lib/tree.test.ts src/state/store.ts src/state/store.test.ts
git commit -m "feat(capacity): estimateMin on leaves and tasks"
```

---

### Task 2: Carry `estimateMin` on `PlannedLeaf`

**Files:**
- Modify: `src/lib/plan.ts:22-31` (`PlannedLeaf`), `src/lib/plan.ts:48-54` (`asPlanned`)
- Test: `src/lib/plan.test.ts` (extend)

**Interfaces:**
- Consumes: `GoalNode.estimateMin` from Task 1.
- Produces: `PlannedLeaf.estimateMin?: number` — Task 6 sums this.

`capacity.ts` reads planned work through `plannedLeaves()`, which returns `PlannedLeaf`, not `GoalNode`. Without this the estimate is invisible to the capacity math.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/plan.test.ts`:

```ts
it('carries estimateMin onto planned leaves', () => {
  const goals: Goal[] = [{
    id: 'g1', title: 'G', nodes: [
      { id: 'a', title: 'A', done: false, plannedWeek: '2026-07-27', estimateMin: 45 },
      { id: 'b', title: 'B', done: false, plannedWeek: '2026-07-27' },
    ],
  }];
  const out = plannedLeaves(goals, '2026-07-27');
  expect(out.find((l) => l.nodeId === 'a')?.estimateMin).toBe(45);
  expect(out.find((l) => l.nodeId === 'b')?.estimateMin).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/lib/plan.test.ts -t 'carries estimateMin'`
Expected: FAIL — TypeScript error, `estimateMin` does not exist on `PlannedLeaf`.

- [ ] **Step 3: Add the field**

In `src/lib/plan.ts`, add to the `PlannedLeaf` interface after `plannedDay`:

```ts
  estimateMin?: number;
```

And in `asPlanned`, add to the returned object:

```ts
function asPlanned(g: Goal, n: GoalNode): PlannedLeaf {
  return {
    goalId: g.id, goalTitle: g.title, nodeId: n.id, title: n.title,
    done: !!n.done, plannedWeek: n.plannedWeek!, plannedDay: n.plannedDay,
    estimateMin: n.estimateMin,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan.ts src/lib/plan.test.ts
git commit -m "feat(capacity): carry estimateMin on PlannedLeaf"
```

---

### Task 3: `src/lib/availability.ts`

**Files:**
- Create: `src/lib/availability.ts`
- Test: `src/lib/availability.test.ts`

**Interfaces:**
- Consumes: `AvailabilityWindow` (Task 1), `parseD` from `src/lib/dates.ts`.
- Produces:
  - `DEFAULT_AVAILABILITY: AvailabilityWindow[]`
  - `parseAvailability(raw: unknown): AvailabilityWindow[]`
  - `windowForDate(date: string, windows: AvailabilityWindow[]): AvailabilityWindow | null`
  - `serializeAvailability(w: AvailabilityWindow[]): string`

Validation is strict and total: any violation returns the default rather than throwing or returning a partial list. A half-valid window set would silently produce wrong capacity.

- [ ] **Step 1: Write the failing test**

Create `src/lib/availability.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AVAILABILITY, parseAvailability, windowForDate, serializeAvailability,
} from './availability';

describe('parseAvailability', () => {
  const good = [{ dow: 0, startMin: 540, endMin: 1080 }];

  it('accepts a valid list', () => {
    expect(parseAvailability(good)).toEqual(good);
  });

  it('accepts a JSON string', () => {
    expect(parseAvailability(JSON.stringify(good))).toEqual(good);
  });

  it.each([
    ['not an array', { dow: 0, startMin: 0, endMin: 60 }],
    ['malformed JSON', '{nope'],
    ['duplicate dow', [{ dow: 0, startMin: 0, endMin: 60 }, { dow: 0, startMin: 120, endMin: 180 }]],
    ['non-integer dow', [{ dow: 1.5, startMin: 0, endMin: 60 }]],
    ['dow below range', [{ dow: -1, startMin: 0, endMin: 60 }]],
    ['dow above range', [{ dow: 7, startMin: 0, endMin: 60 }]],
    ['startMin equals endMin', [{ dow: 0, startMin: 60, endMin: 60 }]],
    ['startMin after endMin', [{ dow: 0, startMin: 120, endMin: 60 }]],
    ['negative startMin', [{ dow: 0, startMin: -1, endMin: 60 }]],
    ['endMin over 1440', [{ dow: 0, startMin: 0, endMin: 1441 }]],
    ['non-integer minutes', [{ dow: 0, startMin: 0.5, endMin: 60 }]],
    ['missing field', [{ dow: 0, startMin: 0 }]],
    ['null', null],
  ])('falls back to the default on %s', (_label, input) => {
    expect(parseAvailability(input)).toEqual(DEFAULT_AVAILABILITY);
  });

  it('round-trips through serializeAvailability', () => {
    expect(parseAvailability(serializeAvailability(good))).toEqual(good);
  });
});

describe('windowForDate', () => {
  // 2026-07-27 is a Monday.
  it('finds Monday as dow 0', () => {
    expect(windowForDate('2026-07-27', DEFAULT_AVAILABILITY))
      .toEqual({ dow: 0, startMin: 540, endMin: 1080 });
  });

  it('finds Friday as dow 4', () => {
    expect(windowForDate('2026-07-31', DEFAULT_AVAILABILITY)?.dow).toBe(4);
  });

  it('returns null for a day off (Saturday)', () => {
    expect(windowForDate('2026-08-01', DEFAULT_AVAILABILITY)).toBeNull();
  });

  it('returns null for Sunday', () => {
    expect(windowForDate('2026-08-02', DEFAULT_AVAILABILITY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/lib/availability.test.ts`
Expected: FAIL — cannot resolve `./availability`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/availability.ts`:

```ts
import type { AvailabilityWindow } from '../db/types';
import { parseD } from './dates';

export const MINUTES_PER_DAY = 1440;

// Mon–Fri 09:00–18:00; Sat and Sun off (absent = off).
export const DEFAULT_AVAILABILITY: AvailabilityWindow[] = [
  { dow: 0, startMin: 540, endMin: 1080 },
  { dow: 1, startMin: 540, endMin: 1080 },
  { dow: 2, startMin: 540, endMin: 1080 },
  { dow: 3, startMin: 540, endMin: 1080 },
  { dow: 4, startMin: 540, endMin: 1080 },
];

function isWindow(v: unknown): v is AvailabilityWindow {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Partial<AvailabilityWindow>;
  return Number.isInteger(w.dow) && (w.dow as number) >= 0 && (w.dow as number) <= 6
    && Number.isInteger(w.startMin) && Number.isInteger(w.endMin)
    && (w.startMin as number) >= 0
    && (w.startMin as number) < (w.endMin as number)
    && (w.endMin as number) <= MINUTES_PER_DAY;
}

/**
 * Total validation: a list is accepted only if EVERY entry is well-formed and
 * `dow` values are unique. Anything else returns the default — a partially
 * valid window set would silently produce wrong capacity, which is worse than
 * visibly falling back.
 */
export function parseAvailability(raw: unknown): AvailabilityWindow[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return DEFAULT_AVAILABILITY;
    }
  }
  if (!Array.isArray(value) || !value.every(isWindow)) return DEFAULT_AVAILABILITY;
  const dows = new Set(value.map((w) => w.dow));
  if (dows.size !== value.length) return DEFAULT_AVAILABILITY;
  return value.map((w) => ({ dow: w.dow, startMin: w.startMin, endMin: w.endMin }));
}

export function serializeAvailability(windows: AvailabilityWindow[]): string {
  return JSON.stringify(windows);
}

/** 0 = Monday … 6 = Sunday, matching weekDates(). */
export function dowOf(date: string): number {
  return (parseD(date).getDay() + 6) % 7;
}

export function windowForDate(
  date: string,
  windows: AvailabilityWindow[],
): AvailabilityWindow | null {
  const dow = dowOf(date);
  return windows.find((w) => w.dow === dow) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts src/lib/availability.test.ts && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/availability.ts src/lib/availability.test.ts
git commit -m "feat(capacity): availability window model and validation"
```

---

### Task 4: Free minutes, clipped to now

**Files:**
- Create: `src/lib/capacity.ts`
- Test: `src/lib/capacity.test.ts`

**Interfaces:**
- Consumes: `AvailabilityWindow`, `BusyBlock` (Task 1); `windowForDate` (Task 3).
- Produces:
  - `interface Now { date: string; minute: number }`
  - `freeMinutes(date, windows, blocks, now, allDayBlocks): number`
  - `mergeIntervals(intervals): Array<{ startMin: number; endMin: number }>` (exported for testing)

This is the spec's §4.1 and §4.2. Two rules carry the design: **past time is gone** (a day before `now.date` has zero remaining capacity; today's window starts no earlier than `now.minute`), and **overlapping meetings contribute their union**, never the sum of their durations.

- [ ] **Step 1: Write the failing test**

Create `src/lib/capacity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { BusyBlock, AvailabilityWindow } from '../db/types';
import { freeMinutes, mergeIntervals, type Now } from './capacity';

// Mon–Fri 09:00–18:00 (540 min window), weekend off.
const WINDOWS: AvailabilityWindow[] = [0, 1, 2, 3, 4].map((dow) => ({
  dow, startMin: 540, endMin: 1080,
}));

// 2026-07-27 Mon, 07-28 Tue, 07-29 Wed, 08-01 Sat
const MON = '2026-07-27';
const TUE = '2026-07-28';
const SAT = '2026-08-01';

// "Now" is Monday at 00:00 unless a test says otherwise, so the whole week is ahead.
const EARLY: Now = { date: MON, minute: 0 };

function block(date: string, startMin: number, endMin: number, title = 'x'): BusyBlock {
  return { date, startMin, endMin, title, allDay: false };
}

describe('mergeIntervals', () => {
  it('merges overlapping intervals into their union', () => {
    expect(mergeIntervals([
      { startMin: 600, endMin: 700 },
      { startMin: 650, endMin: 800 },
    ])).toEqual([{ startMin: 600, endMin: 800 }]);
  });

  it('merges touching intervals', () => {
    expect(mergeIntervals([
      { startMin: 600, endMin: 700 },
      { startMin: 700, endMin: 800 },
    ])).toEqual([{ startMin: 600, endMin: 800 }]);
  });

  it('keeps disjoint intervals separate', () => {
    expect(mergeIntervals([
      { startMin: 600, endMin: 700 },
      { startMin: 800, endMin: 900 },
    ])).toEqual([
      { startMin: 600, endMin: 700 },
      { startMin: 800, endMin: 900 },
    ]);
  });

  it('absorbs a fully contained interval', () => {
    expect(mergeIntervals([
      { startMin: 600, endMin: 900 },
      { startMin: 700, endMin: 800 },
    ])).toEqual([{ startMin: 600, endMin: 900 }]);
  });

  it('handles unsorted input', () => {
    expect(mergeIntervals([
      { startMin: 800, endMin: 900 },
      { startMin: 600, endMin: 700 },
    ])).toEqual([
      { startMin: 600, endMin: 700 },
      { startMin: 800, endMin: 900 },
    ]);
  });
});

describe('freeMinutes', () => {
  it('returns the full window when nothing is booked', () => {
    expect(freeMinutes(TUE, WINDOWS, [], EARLY, true)).toBe(540);
  });

  it('returns zero on a day with no window', () => {
    expect(freeMinutes(SAT, WINDOWS, [], EARLY, true)).toBe(0);
  });

  it('subtracts a meeting inside the window', () => {
    expect(freeMinutes(TUE, WINDOWS, [block(TUE, 600, 660)], EARLY, true)).toBe(480);
  });

  it('does NOT double-count overlapping meetings', () => {
    // 10:00-11:00 and 10:30-12:00 overlap; union is 10:00-12:00 = 120 min.
    const blocks = [block(TUE, 600, 660), block(TUE, 630, 720)];
    expect(freeMinutes(TUE, WINDOWS, blocks, EARLY, true)).toBe(540 - 120);
  });

  it('ignores a meeting entirely outside the window', () => {
    // 22:00-23:00 is past an 18:00 window end.
    expect(freeMinutes(TUE, WINDOWS, [block(TUE, 1320, 1380)], EARLY, true)).toBe(540);
  });

  it('clips a meeting that straddles the window start', () => {
    // 08:00-10:00 overlaps the window only from 09:00 → 60 min consumed.
    expect(freeMinutes(TUE, WINDOWS, [block(TUE, 480, 600)], EARLY, true)).toBe(480);
  });

  it('ignores blocks belonging to another day', () => {
    expect(freeMinutes(TUE, WINDOWS, [block(MON, 600, 660)], EARLY, true)).toBe(540);
  });

  it('clamps at zero when the day is over-booked', () => {
    expect(freeMinutes(TUE, WINDOWS, [block(TUE, 0, 1440)], EARLY, true)).toBe(0);
  });

  describe('remaining capacity, not nominal', () => {
    it('gives a past day zero', () => {
      const now: Now = { date: TUE, minute: 0 };
      expect(freeMinutes(MON, WINDOWS, [], now, true)).toBe(0);
    });

    it('clips today to the current minute', () => {
      // Now is Tuesday 15:00 (900). Window 09:00-18:00 → 180 min left.
      const now: Now = { date: TUE, minute: 900 };
      expect(freeMinutes(TUE, WINDOWS, [], now, true)).toBe(180);
    });

    it('gives zero once today\'s window has closed', () => {
      const now: Now = { date: TUE, minute: 1200 }; // 20:00, past an 18:00 end
      expect(freeMinutes(TUE, WINDOWS, [], now, true)).toBe(0);
    });

    it('ignores a meeting that already finished today', () => {
      // Now 15:00; a 10:00-11:00 meeting is already spent, not deducted again.
      const now: Now = { date: TUE, minute: 900 };
      expect(freeMinutes(TUE, WINDOWS, [block(TUE, 600, 660)], now, true)).toBe(180);
    });

    it('deducts only the remaining part of an in-progress meeting', () => {
      // Now 15:00; meeting 14:00-16:00 → only 15:00-16:00 (60 min) still costs.
      const now: Now = { date: TUE, minute: 900 };
      expect(freeMinutes(TUE, WINDOWS, [block(TUE, 840, 960)], now, true)).toBe(120);
    });

    it('leaves future days at their full window', () => {
      const now: Now = { date: MON, minute: 900 };
      expect(freeMinutes(TUE, WINDOWS, [], now, true)).toBe(540);
    });
  });

  describe('all-day blocks', () => {
    const allDay: BusyBlock = {
      date: TUE, startMin: 0, endMin: 1440, title: 'Conference', allDay: true,
    };

    it('zeroes the day when allDayBlocks is on', () => {
      expect(freeMinutes(TUE, WINDOWS, [allDay], EARLY, true)).toBe(0);
    });

    it('is ignored when allDayBlocks is off', () => {
      expect(freeMinutes(TUE, WINDOWS, [allDay], EARLY, false)).toBe(540);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/lib/capacity.test.ts`
Expected: FAIL — cannot resolve `./capacity`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/capacity.ts`:

```ts
import type { AvailabilityWindow, BusyBlock } from '../db/types';
import { windowForDate } from './availability';

/**
 * The current moment, injected. Capacity is measured from here forward, so this
 * module stays pure and every result is deterministic in tests.
 */
export interface Now {
  date: string;   // 'YYYY-MM-DD' local
  minute: number; // minutes from local midnight
}

export interface Interval {
  startMin: number;
  endMin: number;
}

/**
 * Collapse intervals into a disjoint, ascending set. Two overlapping meetings
 * must contribute their UNION — summing their durations would deduct the
 * overlap twice and understate free time.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, cur.endMin);
    } else {
      out.push({ startMin: cur.startMin, endMin: cur.endMin });
    }
  }
  return out;
}

/**
 * The part of `date`'s availability window that is still ahead of `now`.
 * Returns null when the day is off, already past, or its window has closed.
 */
function remainingWindow(
  date: string,
  windows: AvailabilityWindow[],
  now: Now,
): Interval | null {
  if (date < now.date) return null; // the past is not capacity
  const w = windowForDate(date, windows);
  if (!w) return null;
  const startMin = date === now.date ? Math.max(w.startMin, now.minute) : w.startMin;
  return startMin < w.endMin ? { startMin, endMin: w.endMin } : null;
}

/**
 * Minutes still available on `date`: the remaining availability window minus
 * the merged busy time intersecting it.
 *
 * `allDayBlocks` is applied HERE, at read time, rather than at fetch time — so
 * toggling the preference never requires a refetch (spec §3.2).
 */
export function freeMinutes(
  date: string,
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  now: Now,
  allDayBlocks: boolean,
): number {
  const win = remainingWindow(date, windows, now);
  if (!win) return 0;

  const today = blocks.filter((b) => b.date === date && (allDayBlocks || !b.allDay));
  if (today.some((b) => b.allDay)) return 0; // an all-day event consumes the day

  const busy = mergeIntervals(today).reduce((sum, b) => {
    const start = Math.max(b.startMin, win.startMin);
    const end = Math.min(b.endMin, win.endMin);
    return sum + Math.max(0, end - start);
  }, 0);

  return Math.max(0, (win.endMin - win.startMin) - busy);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts src/lib/capacity.test.ts && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capacity.ts src/lib/capacity.test.ts
git commit -m "feat(capacity): free minutes clipped to now, with overlap merging"
```

---

### Task 5: Workload — unfinished commitments of both kinds

**Files:**
- Modify: `src/lib/capacity.ts`
- Test: `src/lib/capacity.test.ts` (extend)

**Interfaces:**
- Consumes: `PlannedLeaf` (Task 2), `Task`.
- Produces:
  - `interface Workload { plannedMin: number; unestimated: number }`
  - `workloadOf(leaves: PlannedLeaf[], tasks: Task[]): Workload`

Spec §4.3–4.4. Two rules that the review caught and that must not drift:

1. **Done work is excluded.** `plannedLeaves()` returns done leaves too (`plan.ts:65`), so filtering is mandatory.
2. **Tasks count.** The planner grid shows dated tasks beside planned steps (`PlanWeekOverlay.tsx:213-220`). This mirrors the existing `plannerOpenCount(placed, weekTasks)` in `planner.ts:72` — capacity must not use a narrower definition of "open work" than the count rendered next to it.

Unestimated work is **never** given a phantom duration; it is counted separately.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/capacity.test.ts`. Place the `leaf` and `task` factories at
**module scope**, beside the existing `block` factory from Task 4 — Task 6's
tests reuse all three, along with the `MON` / `TUE` / `WINDOWS` / `EARLY`
constants already defined there.

```ts
import type { Task } from '../db/types';
import type { PlannedLeaf } from './plan';
import { workloadOf } from './capacity';

function leaf(over: Partial<PlannedLeaf> = {}): PlannedLeaf {
  return {
    goalId: 'g1', goalTitle: 'G', nodeId: 'n1', title: 'N',
    done: false, plannedWeek: MON, ...over,
  };
}

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: 'T', date: TUE, done: false, goalId: null, ...over };
}

describe('workloadOf', () => {
  it('is empty for no commitments', () => {
    expect(workloadOf([], [])).toEqual({ plannedMin: 0, unestimated: 0 });
  });

  it('sums estimates across leaves', () => {
    const out = workloadOf([leaf({ estimateMin: 30 }), leaf({ estimateMin: 45 })], []);
    expect(out).toEqual({ plannedMin: 75, unestimated: 0 });
  });

  it('counts unestimated leaves separately, never as a default duration', () => {
    const out = workloadOf([leaf({ estimateMin: 30 }), leaf()], []);
    expect(out).toEqual({ plannedMin: 30, unestimated: 1 });
  });

  it('excludes done leaves from both figures', () => {
    const out = workloadOf([leaf({ done: true, estimateMin: 30 }), leaf({ done: true })], []);
    expect(out).toEqual({ plannedMin: 0, unestimated: 0 });
  });

  it('includes unfinished tasks', () => {
    const out = workloadOf([], [task({ estimateMin: 20 })]);
    expect(out).toEqual({ plannedMin: 20, unestimated: 0 });
  });

  it('counts unfinished tasks with no estimate as unestimated', () => {
    const out = workloadOf([], [task()]);
    expect(out).toEqual({ plannedMin: 0, unestimated: 1 });
  });

  it('excludes done tasks', () => {
    const out = workloadOf([], [task({ done: true, estimateMin: 20 }), task({ done: true })]);
    expect(out).toEqual({ plannedMin: 0, unestimated: 0 });
  });

  it('combines leaves and tasks', () => {
    const out = workloadOf(
      [leaf({ estimateMin: 30 }), leaf()],
      [task({ estimateMin: 20 }), task(), task({ done: true })],
    );
    expect(out).toEqual({ plannedMin: 50, unestimated: 2 });
  });

  it('ignores a non-positive or non-finite estimate as unestimated', () => {
    const out = workloadOf([leaf({ estimateMin: 0 }), leaf({ estimateMin: -5 })], []);
    expect(out).toEqual({ plannedMin: 0, unestimated: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/lib/capacity.test.ts -t 'workloadOf'`
Expected: FAIL — `workloadOf` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/capacity.ts`:

```ts
import type { Task } from '../db/types';
import type { PlannedLeaf } from './plan';

export interface Workload {
  plannedMin: number;  // Σ estimateMin over unfinished commitments
  unestimated: number; // unfinished commitments carrying no usable estimate
}

function usableEstimate(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The week's (or day's) unfinished workload, across BOTH kinds of commitment
 * the planner displays: planned goal leaves and dated tasks. Mirrors
 * `plannerOpenCount` in views/plan/planner.ts — capacity must not use a
 * narrower definition of "open work" than the count rendered beside it.
 *
 * Unestimated work is counted, never assigned a phantom duration: a blended
 * number would look authoritative while being partly invented.
 */
export function workloadOf(leaves: PlannedLeaf[], tasks: Task[]): Workload {
  let plannedMin = 0;
  let unestimated = 0;

  for (const l of leaves) {
    if (l.done) continue;
    const est = usableEstimate(l.estimateMin);
    if (est === null) unestimated++;
    else plannedMin += est;
  }
  for (const t of tasks) {
    if (t.done) continue;
    const est = usableEstimate(t.estimateMin);
    if (est === null) unestimated++;
    else plannedMin += est;
  }

  return { plannedMin, unestimated };
}
```

Move the two new `import type` lines up to join the existing imports at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts src/lib/capacity.test.ts && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capacity.ts src/lib/capacity.test.ts
git commit -m "feat(capacity): workload over unfinished leaves and tasks"
```

---

### Task 6: Day and week assembly

**Files:**
- Modify: `src/lib/capacity.ts`
- Test: `src/lib/capacity.test.ts` (extend)

**Interfaces:**
- Consumes: everything from Tasks 4–5; `weekDates` from `src/lib/dates.ts`.
- Produces:
  - `interface DayCapacity { date: string; freeMin: number; plannedMin: number; unestimated: number; blockedBy: string[]; hasData: boolean }`
  - `interface WeekCapacity { days: DayCapacity[]; freeMin: number; plannedMin: number; unestimated: number; hasData: boolean }`
  - `weekCapacity(input: CapacityInput): WeekCapacity`
  - `interface CapacityInput { week: string; windows: AvailabilityWindow[]; blocks: BusyBlock[]; leaves: PlannedLeaf[]; tasks: Task[]; now: Now; allDayBlocks: boolean; hasData: boolean }`

Two rules here:

- **"Anyday" leaves** (`plannedWeek` set, no `plannedDay`) count toward the **week** totals only. They are not charged to any day, because they are not on one.
- `hasData` propagates the caller's knowledge of whether the calendar cache covers this range. A day with no coverage must render as "no data", never as "free" (spec §5.5). In slice 1 the caller always passes `false`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/capacity.test.ts`:

```ts
import { weekCapacity } from './capacity';

describe('weekCapacity', () => {
  const base = {
    week: MON,
    windows: WINDOWS,
    blocks: [] as BusyBlock[],
    leaves: [] as PlannedLeaf[],
    tasks: [] as Task[],
    now: EARLY,
    allDayBlocks: true,
    hasData: true,
  };

  it('returns seven days starting Monday', () => {
    const out = weekCapacity(base);
    expect(out.days).toHaveLength(7);
    expect(out.days[0].date).toBe(MON);
    expect(out.days[6].date).toBe('2026-08-02');
  });

  it('totals free minutes over five working days', () => {
    expect(weekCapacity(base).freeMin).toBe(540 * 5);
  });

  it('charges a day-pinned leaf to its day and to the week', () => {
    const leaves = [leaf({ plannedDay: TUE, estimateMin: 60 })];
    const out = weekCapacity({ ...base, leaves });
    expect(out.days.find((d) => d.date === TUE)?.plannedMin).toBe(60);
    expect(out.plannedMin).toBe(60);
  });

  it('charges an anyday leaf to the week but to no day', () => {
    const leaves = [leaf({ estimateMin: 60 })]; // no plannedDay
    const out = weekCapacity({ ...base, leaves });
    expect(out.plannedMin).toBe(60);
    expect(out.days.every((d) => d.plannedMin === 0)).toBe(true);
  });

  it('charges an unestimated anyday leaf to the week count only', () => {
    const out = weekCapacity({ ...base, leaves: [leaf()] });
    expect(out.unestimated).toBe(1);
    expect(out.days.every((d) => d.unestimated === 0)).toBe(true);
  });

  it('charges a task to its date', () => {
    const out = weekCapacity({ ...base, tasks: [task({ date: TUE, estimateMin: 25 })] });
    expect(out.days.find((d) => d.date === TUE)?.plannedMin).toBe(25);
    expect(out.plannedMin).toBe(25);
  });

  it('lists what is blocking a day, deduplicated', () => {
    const blocks = [
      block(TUE, 600, 660, 'standup'),
      block(TUE, 700, 760, '1:1'),
      block(TUE, 700, 760, '1:1'),
    ];
    expect(weekCapacity({ ...base, blocks }).days.find((d) => d.date === TUE)?.blockedBy)
      .toEqual(['standup', '1:1']);
  });

  it('marks days as lacking data when hasData is false', () => {
    const out = weekCapacity({ ...base, hasData: false });
    expect(out.hasData).toBe(false);
    expect(out.days.every((d) => d.hasData === false)).toBe(true);
  });

  it('excludes a leaf pinned outside the week from day totals', () => {
    const leaves = [leaf({ plannedDay: '2026-08-10', estimateMin: 60 })];
    const out = weekCapacity({ ...base, leaves });
    expect(out.days.every((d) => d.plannedMin === 0)).toBe(true);
    expect(out.plannedMin).toBe(60); // still a commitment for this week
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/lib/capacity.test.ts -t 'weekCapacity'`
Expected: FAIL — `weekCapacity` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/capacity.ts`. This is a **new** import — `capacity.ts` does not
yet import from `./dates`; add it at the top of the file with the others:

```ts
import { weekDates } from './dates';

export interface DayCapacity {
  date: string;
  freeMin: number;
  plannedMin: number;
  unestimated: number;
  blockedBy: string[]; // event titles, in start order, deduplicated
  hasData: boolean;    // false ⇒ render "no data", never "free"
}

export interface WeekCapacity {
  days: DayCapacity[];
  freeMin: number;
  plannedMin: number;
  unestimated: number;
  hasData: boolean;
}

export interface CapacityInput {
  week: string;                   // Monday
  windows: AvailabilityWindow[];
  blocks: BusyBlock[];
  leaves: PlannedLeaf[];          // already filtered to this week
  tasks: Task[];                  // already filtered to this week
  now: Now;
  allDayBlocks: boolean;
  hasData: boolean;               // does the cache cover this range?
}

function blockedBy(date: string, blocks: BusyBlock[], allDayBlocks: boolean): string[] {
  const titles = blocks
    .filter((b) => b.date === date && (allDayBlocks || !b.allDay))
    .sort((a, b) => a.startMin - b.startMin)
    .map((b) => b.title);
  return [...new Set(titles)];
}

/**
 * Per-day and whole-week capacity for `week`.
 *
 * Day-pinned leaves and dated tasks are charged to their day AND the week.
 * "Anyday" leaves — plannedWeek set, no plannedDay — are charged to the week
 * ONLY: they are not on a day, so they cannot be billed to one.
 */
export function weekCapacity(input: CapacityInput): WeekCapacity {
  const { week, windows, blocks, leaves, tasks, now, allDayBlocks, hasData } = input;
  const dates = weekDates(week);

  const days: DayCapacity[] = dates.map((date) => {
    const dayLeaves = leaves.filter((l) => l.plannedDay === date);
    const dayTasks = tasks.filter((t) => t.date === date);
    const load = workloadOf(dayLeaves, dayTasks);
    return {
      date,
      freeMin: freeMinutes(date, windows, blocks, now, allDayBlocks),
      plannedMin: load.plannedMin,
      unestimated: load.unestimated,
      blockedBy: blockedBy(date, blocks, allDayBlocks),
      hasData,
    };
  });

  // Week totals come from the FULL commitment set, not the sum of day figures,
  // so anyday leaves and leaves pinned outside the week are still counted.
  const weekLoad = workloadOf(leaves, tasks);

  return {
    days,
    freeMin: days.reduce((sum, d) => sum + d.freeMin, 0),
    plannedMin: weekLoad.plannedMin,
    unestimated: weekLoad.unestimated,
    hasData,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capacity.ts src/lib/capacity.test.ts
git commit -m "feat(capacity): day and week capacity assembly"
```

---

### Task 7: Persist availability and the all-day preference

**Files:**
- Modify: `src/db/db.ts`
- Modify: `src/state/store.ts`
- Test: `src/db/db.test.ts` (extend), `src/state/store.test.ts` (extend)

**Interfaces:**
- Consumes: `parseAvailability`, `serializeAvailability`, `DEFAULT_AVAILABILITY` (Task 3).
- Produces:
  - `loadAvailability(): Promise<AvailabilityWindow[]>`, `saveAvailability(w): Promise<void>` in `db.ts`
  - `loadAllDayBlocks(): Promise<boolean>`, `saveAllDayBlocks(v): Promise<void>` in `db.ts`
  - Store state `availability: AvailabilityWindow[]`, `allDayBlocks: boolean`
  - Actions `setAvailability(w)`, `setAllDayBlocks(v)`

These are device preferences, so they use the existing `settings` key/value table — no Dexie version bump in this slice. (`version(5)` and the `calendarCache` table arrive in slice 2.)

- [ ] **Step 1: Write the failing test**

Add to `src/db/db.test.ts`:

```ts
it('returns the default availability when nothing is stored', async () => {
  await db.settings.clear();
  expect(await loadAvailability()).toEqual(DEFAULT_AVAILABILITY);
});

it('round-trips saved availability', async () => {
  const windows = [{ dow: 2, startMin: 600, endMin: 720 }];
  await saveAvailability(windows);
  expect(await loadAvailability()).toEqual(windows);
});

it('falls back to the default when the stored value is corrupt', async () => {
  await db.settings.put({ key: 'availability', value: '{not json' });
  expect(await loadAvailability()).toEqual(DEFAULT_AVAILABILITY);
});

it('defaults allDayBlocks to true and round-trips false', async () => {
  await db.settings.clear();
  expect(await loadAllDayBlocks()).toBe(true);
  await saveAllDayBlocks(false);
  expect(await loadAllDayBlocks()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/db/db.test.ts -t 'availability'`
Expected: FAIL — `loadAvailability` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/db/db.ts`, add the import and four functions (place them beside `loadScale`/`saveScale`):

```ts
import type { AvailabilityWindow } from './types';
import { parseAvailability, serializeAvailability, DEFAULT_AVAILABILITY } from '../lib/availability';

export async function loadAvailability(): Promise<AvailabilityWindow[]> {
  const row = await db.settings.get('availability');
  return parseAvailability(row?.value);
}

export async function saveAvailability(windows: AvailabilityWindow[]): Promise<void> {
  await db.settings.put({ key: 'availability', value: serializeAvailability(windows) });
}

// Defaults ON: an all-day event usually does consume the day.
export async function loadAllDayBlocks(): Promise<boolean> {
  const row = await db.settings.get('allDayBlocks');
  return row?.value !== 'false';
}

export async function saveAllDayBlocks(value: boolean): Promise<void> {
  await db.settings.put({ key: 'allDayBlocks', value: String(value) });
}
```

Re-export `DEFAULT_AVAILABILITY` from `db.ts` is **not** needed — tests import it from `../lib/availability`.

**Critical — update the store test's db mock first.** `src/state/store.test.ts:5-16`
mocks `../db/db` with an explicit `vi.hoisted` object. Adding exports to `db.ts`
without adding them here makes `initStore` throw on **every** store test, because
the mocked module simply will not have them. Extend `dbMocks`:

```ts
const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async () => [
    { dow: 0, startMin: 540, endMin: 1080 },
    { dow: 1, startMin: 540, endMin: 1080 },
    { dow: 2, startMin: 540, endMin: 1080 },
    { dow: 3, startMin: 540, endMin: 1080 },
    { dow: 4, startMin: 540, endMin: 1080 },
  ]),
  loadAllDayBlocks: vi.fn(async () => true),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
}));
```

In `src/state/store.ts`:

Add to the `UIState` interface:

```ts
  availability: AvailabilityWindow[]; // per-weekday planning window (device preference)
  allDayBlocks: boolean;              // do all-day calendar events consume the day?
```

Add to the initial `state` literal:

```ts
  availability: DEFAULT_AVAILABILITY,
  allDayBlocks: true,
```

Extend the imports:

```ts
import type { AvailabilityWindow } from '../db/types';
import { DEFAULT_AVAILABILITY } from '../lib/availability';
import {
  loadAvailability, saveAvailability, loadAllDayBlocks, saveAllDayBlocks,
} from '../db/db';
```

In `initStore`, extend the `Promise.all` and the state merge:

```ts
    const [appState, pxPerDay, planReview, availability, allDayBlocks] = await Promise.all([
      loadState(), loadScale(), loadPlanReview(), loadAvailability(), loadAllDayBlocks(),
    ]);
    state = {
      ...state,
      ...appState,
      pxPerDay,
      planReview,
      availability,
      allDayBlocks,
      hydration: 'ready',
      expanded: collectContainers(appState.goals),
    };
```

Add two actions beside `setScale`:

```ts
  setAvailability(windows: AvailabilityWindow[]): void {
    const next = parseAvailability(windows); // reject a malformed set at the door
    set({ availability: next });
    void saveAvailability(next);
  },

  setAllDayBlocks(value: boolean): void {
    if (value === state.allDayBlocks) return;
    set({ allDayBlocks: value });
    void saveAllDayBlocks(value);
  },
```

Add `parseAvailability` to the `../lib/availability` import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/db.ts src/db/db.test.ts src/state/store.ts src/state/store.test.ts
git commit -m "feat(capacity): persist availability windows and all-day preference"
```

---

### Task 8: Estimate actions in the store

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/store.test.ts` (extend)

**Interfaces:**
- Consumes: `estimateMin` (Task 1).
- Produces: `actions.setNodeEstimate(nodeId: string, minutes: number | null)`, `actions.setTaskEstimate(taskId: string, minutes: number | null)`.

Passing `null` clears the estimate, returning the item to "unestimated". A non-positive or non-finite value also clears rather than storing nonsense — the same predicate `capacity.ts` uses, so store and math can never disagree about what counts as an estimate.

- [ ] **Step 1: Write the failing test**

Add to `src/state/store.test.ts`:

This file has no `resetStore` helper — the established pattern is `freshStore()`
(`vi.resetModules()` + re-import), already defined at the top of the file. Use it.

```ts
describe('estimates', () => {
  const goalWithLeaf: Goal = {
    id: 'g1', title: 'G', nodes: [{ id: 'n1', title: 'N', done: false }],
  };

  it('sets and clears a node estimate', async () => {
    const { findInAll } = await import('../lib/tree');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithLeaf)]);

    store.actions.setNodeEstimate('n1', 90);
    expect(findInAll(store.getState().goals, 'n1')?.estimateMin).toBe(90);

    store.actions.setNodeEstimate('n1', null);
    expect(findInAll(store.getState().goals, 'n1')?.estimateMin).toBeUndefined();
  });

  it('clears a node estimate given a non-positive value', async () => {
    const { findInAll } = await import('../lib/tree');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithLeaf)]);

    store.actions.setNodeEstimate('n1', 60);
    store.actions.setNodeEstimate('n1', 0);
    expect(findInAll(store.getState().goals, 'n1')?.estimateMin).toBeUndefined();
  });

  it('refuses to estimate a container', async () => {
    const { findInAll } = await import('../lib/tree');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'g1', title: 'G',
      nodes: [{ id: 'c1', title: 'C', children: [{ id: 'n1', title: 'N', done: false }] }],
    }]);

    store.actions.setNodeEstimate('c1', 90);
    expect(findInAll(store.getState().goals, 'c1')?.estimateMin).toBeUndefined();
  });

  it('sets and clears a task estimate', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addTask('T', '2026-07-28', null);
    const id = store.getState().tasks[0].id;

    store.actions.setTaskEstimate(id, 25);
    expect(store.getState().tasks[0].estimateMin).toBe(25);

    store.actions.setTaskEstimate(id, null);
    expect(store.getState().tasks[0].estimateMin).toBeUndefined();
  });

  it('loads persisted availability into state', async () => {
    const store = await freshStore();
    await store.initStore();
    expect(store.getState().availability).toHaveLength(5);
    expect(store.getState().allDayBlocks).toBe(true);
  });
});
```

`addTask(title, date = todayStr(), goalId = null)` and `addGoals(newGoals: Goal[])`
match the signatures at `store.ts:456` and `store.ts:312`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/state/store.test.ts -t 'estimate'`
Expected: FAIL — `setNodeEstimate` is not a function.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/capacity.ts`, exported so the store shares one predicate:

```ts
/** The one definition of a usable estimate, shared by the store and the math. */
export function normalizeEstimate(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.round(v)
    : undefined;
}
```

Refactor `usableEstimate` to use it:

```ts
function usableEstimate(v: number | undefined): number | null {
  return normalizeEstimate(v) ?? null;
}
```

Add the actions to `src/state/store.ts`, beside `renameNode`:

```ts
  setNodeEstimate(nodeId: string, minutes: number | null): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = state.goals.map((g) => ({ ...g, nodes: structuredClone(g.nodes) }));
    const node = findInAll(goals, nodeId);
    if (!node || node.children) return; // leaves only
    const next = minutes === null ? undefined : normalizeEstimate(minutes);
    if (next === undefined) delete node.estimateMin;
    else node.estimateMin = next;
    setAndPersist({ goals });
  },

  setTaskEstimate(taskId: string, minutes: number | null): void {
    const next = minutes === null ? undefined : normalizeEstimate(minutes);
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const copy = { ...t };
      if (next === undefined) delete copy.estimateMin;
      else copy.estimateMin = next;
      return copy;
    });
    setAndPersist({ tasks });
  },
```

Import `normalizeEstimate` from `../lib/capacity`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capacity.ts src/state/store.ts src/state/store.test.ts
git commit -m "feat(capacity): store actions for node and task estimates"
```

---

### Task 9: The planner readout formatter

**Files:**
- Create: `src/views/plan/capacityLabel.ts`
- Test: `src/views/plan/capacityLabel.test.ts`

**Interfaces:**
- Consumes: `DayCapacity`, `WeekCapacity` (Task 6).
- Produces:
  - `formatMinutes(min: number): string`
  - `interface CapacityFigures { freeMin: number; plannedMin: number; unestimated: number; hasData: boolean }`
  - `capacityParts(c: CapacityFigures): string[]` — **one** function, used for both
    day and week. `DayCapacity` and `WeekCapacity` both structurally satisfy
    `CapacityFigures`, so a second near-identical formatter would be duplication.
  - `isOverCommitted(c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'hasData'>): boolean`

Tests run with no DOM, so all display logic lives here as pure functions and the component just renders the strings — the same split as `src/views/today/workActions.ts`.

Over-commitment is **only** claimable when `hasData` is true. With no calendar data, `freeMin` is nominal-window-only and asserting "over-committed" against it would be a guess presented as a fact.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/capacityLabel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { DayCapacity, WeekCapacity } from '../../lib/capacity';
import { formatMinutes, capacityParts, isOverCommitted } from './capacityLabel';

function day(over: Partial<DayCapacity> = {}): DayCapacity {
  return {
    date: '2026-07-28', freeMin: 195, plannedMin: 120, unestimated: 0,
    blockedBy: [], hasData: true, ...over,
  };
}

describe('formatMinutes', () => {
  it.each([
    [0, '0m'],
    [45, '45m'],
    [60, '1h'],
    [120, '2h'],
    [195, '3h 15m'],
    [1440, '24h'],
  ])('formats %i as %s', (min, expected) => {
    expect(formatMinutes(min)).toBe(expected);
  });
});

describe('capacityParts', () => {
  it('shows free and planned', () => {
    expect(capacityParts(day({ freeMin: 195, plannedMin: 120 })))
      .toEqual(['3h 15m free', '2h planned']);
  });

  it('appends an unestimated count, pluralised', () => {
    expect(capacityParts(day({ unestimated: 1 }))).toContain('1 unestimated');
    expect(capacityParts(day({ unestimated: 2 }))).toContain('2 unestimated');
  });

  it('omits planned when nothing is committed', () => {
    expect(capacityParts(day({ plannedMin: 0, unestimated: 0 })))
      .toEqual(['3h 15m free']);
  });

  it('says "no calendar data" instead of free hours when hasData is false', () => {
    expect(capacityParts(day({ hasData: false, plannedMin: 120 })))
      .toEqual(['no calendar data', '2h planned']);
  });
});

describe('isOverCommitted', () => {
  it('is true when planned exceeds free', () => {
    expect(isOverCommitted({ freeMin: 60, plannedMin: 120, hasData: true })).toBe(true);
  });

  it('is false when planned fits', () => {
    expect(isOverCommitted({ freeMin: 120, plannedMin: 60, hasData: true })).toBe(false);
  });

  it('is false when planned exactly fills the day', () => {
    expect(isOverCommitted({ freeMin: 120, plannedMin: 120, hasData: true })).toBe(false);
  });

  it('never claims over-commitment without calendar data', () => {
    expect(isOverCommitted({ freeMin: 0, plannedMin: 999, hasData: false })).toBe(false);
  });
});

describe('capacityParts over a WeekCapacity', () => {
  // The same formatter serves the week — WeekCapacity structurally satisfies
  // CapacityFigures, so no second function is needed.
  const week: WeekCapacity = {
    days: [], freeMin: 2700, plannedMin: 300, unestimated: 3, hasData: true,
  };

  it('summarises the week', () => {
    expect(capacityParts(week)).toEqual(['45h free', '5h planned', '3 unestimated']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/views/plan/capacityLabel.test.ts`
Expected: FAIL — cannot resolve `./capacityLabel`.

- [ ] **Step 3: Write the implementation**

Create `src/views/plan/capacityLabel.ts`:

```ts
export function formatMinutes(min: number): string {
  const safe = Math.max(0, Math.round(min));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * The shape both DayCapacity and WeekCapacity satisfy. One formatter serves
 * both — day and week differ in what they aggregate, not in how they read.
 */
export interface CapacityFigures {
  freeMin: number;
  plannedMin: number;
  unestimated: number;
  hasData: boolean;
}

/**
 * Free / planned / unestimated as separate strings — never fused into one
 * number. A blended figure would read as authoritative while being partly
 * invented from work that carries no estimate (spec §4.4).
 */
export function capacityParts(c: CapacityFigures): string[] {
  const parts = [c.hasData ? `${formatMinutes(c.freeMin)} free` : 'no calendar data'];
  if (c.plannedMin > 0) parts.push(`${formatMinutes(c.plannedMin)} planned`);
  if (c.unestimated > 0) parts.push(`${c.unestimated} unestimated`);
  return parts;
}

/**
 * Only claimable with real calendar data. Without it, `freeMin` is a nominal
 * window figure, and calling that over-commitment would present a guess as a
 * fact.
 */
export function isOverCommitted(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'hasData'>,
): boolean {
  return c.hasData && c.plannedMin > c.freeMin;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts src/views/plan/capacityLabel.test.ts && npx tsc -b`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/capacityLabel.ts src/views/plan/capacityLabel.test.ts
git commit -m "feat(capacity): planner capacity formatting"
```

---

### Task 10: Wire the readout into the planner, delete `SOFT_CAPACITY`

**Files:**
- Modify: `src/views/plan/PlanWeekOverlay.tsx` (remove `SOFT_CAPACITY` at line 36; day column headers; week header)
- Test: covered by `capacityLabel.test.ts` and `capacity.test.ts` (no DOM available)

**Interfaces:**
- Consumes: `weekCapacity`, `Now` (Task 6); `capacityParts`, `isOverCommitted` (Task 9); store `availability`, `allDayBlocks` (Task 7).
- Produces: no new exports.

`SOFT_CAPACITY = 7` is deleted, not repurposed. It was a guess at how many steps fit in a week; the week now has a real figure and keeping both would give the planner two disagreeing opinions.

`hasData` is hardcoded `false` in this slice — no calendar is connected yet, so the UI honestly reports "no calendar data" beside real planned/unestimated figures. Slice 2 flips it.

- [ ] **Step 1: Compute capacity in the component**

In `PlanWeekOverlay.tsx`, delete the line:

```ts
const SOFT_CAPACITY = 7;
```

and every reference to it. Add the imports:

```ts
import { weekCapacity, type Now } from '../../lib/capacity';
import { capacityParts, isOverCommitted } from './capacityLabel';
```

Pull the new preferences from the store, alongside the existing destructure:

```ts
const { planReview, availability, allDayBlocks, actions } = useAppStore();
```

After `weekTasks` is computed (around line 220), add:

```ts
// Injected rather than read inside capacity.ts, which stays pure. Minutes since
// local midnight, so "free" means free FROM NOW — a planner opened Tuesday
// afternoon must not offer Monday's hours.
const nowDate = new Date();
const now: Now = {
  date: today,
  minute: nowDate.getHours() * 60 + nowDate.getMinutes(),
};

const capacity = weekCapacity({
  week,
  windows: availability,
  blocks: [],          // slice 2 supplies real busy blocks
  leaves: placed,
  tasks: weekTasks,
  now,
  allDayBlocks,
  hasData: false,      // slice 2 flips this when a calendar is connected
});
const capacityByDay = new Map(capacity.days.map((d) => [d.date, d]));
```

- [ ] **Step 2: Render the per-day line**

In the day column header, below the existing weekday label and date, add:

```tsx
{(() => {
  const cap = capacityByDay.get(day);
  if (!cap) return null;
  return (
    <div className="mt-0.5 text-[11px] leading-tight text-neutral-500 dark:text-neutral-400">
      <div className={isOverCommitted(cap) ? 'text-amber-600 dark:text-amber-400' : undefined}>
        {capacityParts(cap).join(' · ')}
      </div>
      {cap.blockedBy.length > 0 && (
        <div className="truncate" title={cap.blockedBy.join(', ')}>
          blocked by: {cap.blockedBy.join(', ')}
        </div>
      )}
    </div>
  );
})()}
```

Match the surrounding Tailwind classes for muted text rather than copying these verbatim if the file's existing muted-text class differs — visual identity is locked, so reuse what is already there.

- [ ] **Step 3: Render the week line**

Where `SOFT_CAPACITY` was previously used in the week header, render:

```tsx
<span className="text-[11px] text-neutral-500 dark:text-neutral-400">
  {capacityParts(capacity).join(' · ')}
</span>
```

`capacity` is a `WeekCapacity`, which structurally satisfies `CapacityFigures` —
the same formatter handles both day and week.

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc -b`
Expected: all PASS, no type errors, and no remaining reference to `SOFT_CAPACITY`.

Run: `grep -rn "SOFT_CAPACITY" src/`
Expected: no output.

Then run `npm run app:dev`, press `4` to open the planner, and confirm: each day column shows "no calendar data", days with planned estimates show a planned figure, and unestimated commitments show a count.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/PlanWeekOverlay.tsx
git commit -m "feat(capacity): planner capacity readout replaces SOFT_CAPACITY"
```

---

### Task 11: Inline estimate entry

**Files:**
- Create: `src/views/plan/estimateInput.ts`
- Create: `src/views/plan/EstimateField.tsx`
- Modify: `src/views/plan/PlanWeekOverlay.tsx`
- Test: `src/views/plan/estimateInput.test.ts`

**Interfaces:**
- Consumes: `actions.setNodeEstimate`, `actions.setTaskEstimate` (Task 8).
- Produces: `parseEstimateInput(raw: string): number | null | undefined` and the `EstimateField` component.

Return contract: a number for a valid estimate, `null` for a deliberate clear (empty input), `undefined` for unparseable input (reject the edit, keep the old value). Three outcomes, because "clear it" and "that isn't a number" must not collapse into one.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/estimateInput.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseEstimateInput } from './estimateInput';

describe('parseEstimateInput', () => {
  it.each([
    ['45', 45],
    ['45m', 45],
    ['90 min', 90],
    ['1h', 60],
    ['2h', 120],
    ['1h30', 90],
    ['1h30m', 90],
    ['1.5h', 90],
    ['0.5h', 30],
  ])('parses %s as %i minutes', (input, expected) => {
    expect(parseEstimateInput(input)).toBe(expected);
  });

  it.each(['', '   '])('treats %s as a deliberate clear', (input) => {
    expect(parseEstimateInput(input)).toBeNull();
  });

  it.each(['abc', '-30', '0', 'h', '--'])('rejects %s', (input) => {
    expect(parseEstimateInput(input)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/views/plan/estimateInput.test.ts`
Expected: FAIL — cannot resolve `./estimateInput`.

- [ ] **Step 3: Write the implementation**

Create `src/views/plan/estimateInput.ts`:

```ts
/**
 * Parse a human estimate.
 *   number  → minutes
 *   null    → deliberate clear (empty input)
 *   undefined → unparseable; the caller keeps the previous value
 * Three outcomes, because "clear it" and "that isn't a number" are different
 * intentions and must not collapse into one.
 */
export function parseEstimateInput(raw: string): number | null | undefined {
  const s = raw.trim().toLowerCase();
  if (s === '') return null;

  // 1h30, 1h30m, 1h
  const hm = s.match(/^(\d+)\s*h\s*(\d+)?\s*m?$/);
  if (hm) {
    const minutes = Number(hm[1]) * 60 + Number(hm[2] ?? 0);
    return minutes > 0 ? minutes : undefined;
  }

  // 1.5h, 0.5h
  const fractional = s.match(/^(\d*\.?\d+)\s*h$/);
  if (fractional) {
    const minutes = Math.round(Number(fractional[1]) * 60);
    return minutes > 0 ? minutes : undefined;
  }

  // 45, 45m, 90 min
  const mins = s.match(/^(\d*\.?\d+)\s*(m|min|mins|minutes)?$/);
  if (mins) {
    const minutes = Math.round(Number(mins[1]));
    return minutes > 0 ? minutes : undefined;
  }

  return undefined;
}

export function formatEstimateValue(minutes: number | undefined): string {
  if (!minutes) return '';
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}`;
}
```

Create `src/views/plan/EstimateField.tsx`:

```tsx
import { useState, type KeyboardEvent } from 'react';
import { parseEstimateInput, formatEstimateValue } from './estimateInput';

/**
 * A one-keystroke estimate entry. Blur or Enter commits; Escape reverts.
 * Unparseable input is rejected and the field reverts, so a typo can never
 * silently wipe an existing estimate.
 */
export function EstimateField({
  minutes,
  onChange,
  label,
}: {
  minutes: number | undefined;
  onChange: (minutes: number | null) => void;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatEstimateValue(minutes);

  function commit() {
    if (draft === null) return;
    const parsed = parseEstimateInput(draft);
    if (parsed !== undefined) onChange(parsed);
    setDraft(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(null);
      (e.target as HTMLInputElement).blur();
    }
    e.stopPropagation(); // the planner owns global keys; don't let 4/Esc escape
  }

  return (
    <input
      aria-label={`Estimate for ${label}`}
      value={shown}
      placeholder="est"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className="w-12 shrink-0 rounded border border-transparent bg-transparent px-1 text-[11px] text-neutral-500 hover:border-neutral-300 focus:border-neutral-400 focus:outline-none dark:text-neutral-400 dark:hover:border-neutral-600"
    />
  );
}
```

In `PlanWeekOverlay.tsx`, render `EstimateField` beside each planned leaf and each task in the day grid:

```tsx
<EstimateField
  minutes={leaf.estimateMin}
  label={leaf.title}
  onChange={(m) => actions.setNodeEstimate(leaf.nodeId, m)}
/>
```

```tsx
<EstimateField
  minutes={task.estimateMin}
  label={task.title}
  onChange={(m) => actions.setTaskEstimate(task.id, m)}
/>
```

Place them so they do not interfere with the existing drag handles — the field must not be inside the draggable region, or dragging will start on focus.

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc -b`
Expected: all PASS.

Run `npm run app:dev`, press `4`, and confirm: typing `1h30` into a step's estimate field and pressing Enter updates that day's "planned" figure and decrements the "unestimated" count; typing `abc` reverts; clearing the field returns the item to unestimated; dragging a step still works.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/estimateInput.ts src/views/plan/estimateInput.test.ts src/views/plan/EstimateField.tsx src/views/plan/PlanWeekOverlay.tsx
git commit -m "feat(capacity): inline estimate entry in the planner"
```

---

### Task 12: Availability settings UI

**Files:**
- Create: `src/components/AvailabilitySettings.tsx`
- Modify: `src/views/plan/PlanWeekOverlay.tsx` (entry point to the editor)
- Test: covered by `availability.test.ts`

**Interfaces:**
- Consumes: `actions.setAvailability`, `actions.setAllDayBlocks` (Task 7); `DEFAULT_AVAILABILITY` (Task 3).
- Produces: no new exports beyond the component.

- [ ] **Step 1: Write the component**

Create `src/components/AvailabilitySettings.tsx`:

```tsx
import type { AvailabilityWindow } from '../db/types';
import { useAppStore } from '../state/store';

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toTimeValue(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function fromTimeValue(value: string): number | null {
  const m = value.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min >= 0 && min <= 1440 ? min : null;
}

/**
 * Per-weekday planning window. A day with no window is a day off and
 * contributes zero capacity.
 */
export function AvailabilitySettings() {
  const { availability, allDayBlocks, actions } = useAppStore();
  const byDow = new Map(availability.map((w) => [w.dow, w]));

  function update(dow: number, patch: Partial<AvailabilityWindow>) {
    const cur = byDow.get(dow) ?? { dow, startMin: 540, endMin: 1080 };
    const next = { ...cur, ...patch };
    if (next.startMin >= next.endMin) return; // reject rather than store nonsense
    actions.setAvailability([...availability.filter((w) => w.dow !== dow), next]
      .sort((a, b) => a.dow - b.dow));
  }

  function toggle(dow: number, on: boolean) {
    actions.setAvailability(
      on
        ? [...availability, { dow, startMin: 540, endMin: 1080 }].sort((a, b) => a.dow - b.dow)
        : availability.filter((w) => w.dow !== dow),
    );
  }

  return (
    <div className="space-y-2">
      {DOW_LABELS.map((label, dow) => {
        const w = byDow.get(dow);
        return (
          <div key={dow} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!w}
              aria-label={`${label} available`}
              onChange={(e) => toggle(dow, e.target.checked)}
            />
            <span className="w-10">{label}</span>
            {w ? (
              <>
                <input
                  type="time"
                  value={toTimeValue(w.startMin)}
                  aria-label={`${label} start`}
                  onChange={(e) => {
                    const v = fromTimeValue(e.target.value);
                    if (v !== null) update(dow, { startMin: v });
                  }}
                />
                <span>–</span>
                <input
                  type="time"
                  value={toTimeValue(w.endMin)}
                  aria-label={`${label} end`}
                  onChange={(e) => {
                    const v = fromTimeValue(e.target.value);
                    if (v !== null) update(dow, { endMin: v });
                  }}
                />
              </>
            ) : (
              <span className="text-neutral-500">off</span>
            )}
          </div>
        );
      })}

      <label className="flex items-center gap-2 pt-2 text-sm">
        <input
          type="checkbox"
          checked={allDayBlocks}
          onChange={(e) => actions.setAllDayBlocks(e.target.checked)}
        />
        All-day events consume the whole day
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Add the entry point**

In `PlanWeekOverlay.tsx`, add a small "Availability" toggle in the planner header that reveals `<AvailabilitySettings />` inline. Reuse the existing header button styling in that file; do not introduce new visual treatments.

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc -b`
Expected: all PASS.

Run `npm run app:dev`, press `4`, open Availability, and confirm: unchecking Saturday leaves it off; changing Monday to 10:00–14:00 changes Monday's free figure to `4h`; the setting survives an app restart; toggling "All-day events consume the whole day" persists.

- [ ] **Step 4: Commit**

```bash
git add src/components/AvailabilitySettings.tsx src/views/plan/PlanWeekOverlay.tsx
git commit -m "feat(capacity): availability settings editor"
```

---

## Slice 1 Definition of Done

- [ ] `npm test` passes; `npx tsc -b` clean.
- [ ] `grep -rn "SOFT_CAPACITY" src/` returns nothing.
- [ ] The planner shows free / planned / unestimated per day and for the week.
- [ ] Estimates can be set and cleared inline for both steps and tasks.
- [ ] Availability windows and the all-day preference persist across restart.
- [ ] `src/components/GoalTree.tsx` remains unstaged and unmodified.
- [ ] No file in `src/lib/` imports `db`, reads a clock, or makes a network call.

## What slice 1 deliberately does not do

- No Google, no OAuth, no network. `blocks` is always `[]` and `hasData` is always `false`, so every day honestly reports "no calendar data" beside real planned/unestimated figures.
- No Dexie version bump. `calendarCache` and `version(5)` belong to slice 2.
- No Timeline changes. That is slice 3.

Slices 2 and 3 get their own plans, written once slice 1 is merged and the arithmetic has been used against real weeks.
