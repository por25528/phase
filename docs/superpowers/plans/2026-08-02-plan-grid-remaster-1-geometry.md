# Plan Grid Remaster — Geometry (1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 720px week grid that stretches its hour range with a constant-scale 24h grid that scrolls, and re-derive the drag aim arithmetic so it survives scrolling.

**Architecture:** `src/lib/grid.ts` stops working in percentages of a fixed height and works in pixels at a constant `PX_PER_MINUTE`. `visibleRange` is demoted from a geometry function to `initialScrollWindow`, which only says where to scroll on mount. The week grid becomes a two-axis scroller with sticky day headings and a sticky hour axis. `aimMinuteFor` moves from viewport coordinates to scroller content coordinates, which is what makes `autoScroll` safe to turn back on.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 3, dnd-kit, Vitest + Testing Library, jsdom.

## Global Constraints

- `PX_PER_MINUTE = 1`. Chosen so rendered density is byte-identical to today's default (720px for a 480–1200 range is already 1px/minute). Do not "improve" the density — visual identity is locked.
- Reuse `MINUTES_PER_DAY` from `src/lib/availability.ts`. Do not declare a second `1440`.
- Snap grain stays `SLOT_GRANULARITY_MIN = 5` (`src/lib/slot.ts:14`). Unchanged by this plan.
- No literal hex colours and no arbitrary `text-[Nrem]` in `src/**/*.tsx?` — `src/lib/designScale.test.ts` fails the build on both.
- Corner radii are restricted to `4`, `6`, `11`, `rounded-field` (9), `rounded-card` (14).
- Run `npm test` and `npx tsc -b` before every commit, and both must be **green**. The pixel API is therefore added alongside the percentage API in Task 1 and the old one is deleted in Task 7 with its last caller — no commit in this branch may be unbuildable.
- Baseline is 1417 tests / 72 files, `tsc` clean. `src/views/goals/BoardCard.keyboard.test.tsx` is a known low-rate flake (one failure in eight baseline runs) in code this plan does not touch: re-run once if it fails. Any other failure is real.
- This plan covers spec Parts 1 and 2.1 only. Colour, capacity temperature, the gutter, the all-day lane and motion tokens are plans 2 and 3.

---

### Task 1: Pixel geometry in `grid.ts`

**Files:**
- Modify: `src/lib/grid.ts`
- Test: `src/lib/grid.test.ts`

**Interfaces:**
- Consumes: `MINUTES_PER_DAY`, `windowForDate` from `src/lib/availability.ts`; `Interval` from `src/lib/capacity.ts`.
- Produces: `PX_PER_MINUTE`, `DAY_START_MIN`, `DAY_END_MIN`, `DAY_HEIGHT_PX`, `minuteToPx(minute: number): number`, `pxToMinute(px: number): number`, `initialScrollWindow(dates: string[], windows: AvailabilityWindow[]): Interval`, and the `Z_*` scale.
- **Not changed here:** `hourMarks` keeps its `Interval` parameter. `WeekGrid` is its only consumer, so its signature changes in Task 6 where that consumer is already being rewritten — changing it here would break the build for five tasks. `assignLanes`, `LaneSpan`, `Laid`, `MIN_VISIBLE_START`, `MIN_VISIBLE_END` are unchanged.
- **Retains:** `visibleRange`, `minuteToPct`, `pctToMinute` and their existing tests, untouched. They still have call sites in Tasks 4–7 and are deleted in Task 7 Step 8, once the last one is migrated. This is what keeps every commit in the branch typechecking and bisectable — do not delete them here.

- [ ] **Step 1: Append the new geometry tests to `grid.test.ts`**

Leave the existing file entirely intact — the `visibleRange`, `minute ↔ percentage`, `hourMarks` and `assignLanes` describes all stay, because the code they cover is still live until Task 7.

Extend the existing import at the top of the file to add the new names:

```ts
import {
  visibleRange, minuteToPct, pctToMinute, hourMarks, assignLanes,
  MIN_VISIBLE_START, MIN_VISIBLE_END, type LaneSpan,
  initialScrollWindow, minuteToPx, pxToMinute,
  PX_PER_MINUTE, DAY_START_MIN, DAY_END_MIN, DAY_HEIGHT_PX,
  Z_RULES, Z_BLOCK, Z_BLOCK_REVEALED, Z_NOW_LINE, Z_AXIS, Z_HEADINGS, Z_CORNER,
} from './grid';
```

Then append the following describes to the end of the file. Note the existing file already declares `WEEK` and `NINE_TO_SIX` at module scope — reuse them, do not redeclare.

```ts
describe('the scale', () => {
  it('spans the whole day', () => {
    expect(DAY_START_MIN).toBe(0);
    expect(DAY_END_MIN).toBe(1440);
  });

  // The density guard. 720px for a 480-1200 range — the old default — is
  // exactly 1px per minute, so holding PX_PER_MINUTE at 1 is what keeps the
  // remaster from silently restyling a locked visual identity.
  it('renders at the same density the stretching grid used by default', () => {
    expect(PX_PER_MINUTE).toBe(1);
    expect(minuteToPx(1200) - minuteToPx(480)).toBe(720);
  });

  it('is as tall as the day is long', () => {
    expect(DAY_HEIGHT_PX).toBe(1440 * PX_PER_MINUTE);
  });
});

describe('minute <-> pixel', () => {
  it('puts midnight at the top', () => {
    expect(minuteToPx(DAY_START_MIN)).toBe(0);
  });

  it('puts the end of the day at the full height', () => {
    expect(minuteToPx(DAY_END_MIN)).toBe(DAY_HEIGHT_PX);
  });

  it('is linear rather than range-relative', () => {
    // The old minuteToPct answered differently for the same minute depending
    // on which blocks happened to be on the week. This must not.
    expect(minuteToPx(600)).toBe(600 * PX_PER_MINUTE);
    expect(minuteToPx(1300)).toBe(1300 * PX_PER_MINUTE);
  });

  it('round-trips every minute of the day', () => {
    const failures: string[] = [];
    for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 1) {
      const back = pxToMinute(minuteToPx(m));
      if (Math.abs(back - m) > 1e-6) failures.push(`${m} -> ${back}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('the stacking order', () => {
  // A guard, not a tautology: the layers have a required ORDER, and the one
  // that actually regressed before was a revealed block sitting above the
  // sticky headings. Asserting the relation catches a reorder that asserting
  // the numbers individually would not.
  it('puts every layer above the one it must cover', () => {
    expect(Z_RULES).toBeLessThan(Z_BLOCK);
    expect(Z_BLOCK).toBeLessThan(Z_BLOCK_REVEALED);
    expect(Z_BLOCK_REVEALED).toBeLessThan(Z_NOW_LINE);
    expect(Z_NOW_LINE).toBeLessThan(Z_AXIS);
    expect(Z_AXIS).toBeLessThan(Z_HEADINGS);
    expect(Z_HEADINGS).toBeLessThan(Z_CORNER);
  });
});

describe('initialScrollWindow', () => {
  it('never returns less than the 08:00-20:00 floor', () => {
    expect(initialScrollWindow(WEEK, NINE_TO_SIX))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('grows to cover an early availability window, floored to the hour', () => {
    const early: AvailabilityWindow[] = [{ dow: 2, startMin: 415, endMin: 1080 }]; // 06:55
    expect(initialScrollWindow(WEEK, early).startMin).toBe(360); // 06:00
  });

  it('grows to cover a late availability window, ceiled to the hour', () => {
    const late: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1330 }]; // 22:10
    expect(initialScrollWindow(WEEK, late).endMin).toBe(1380); // 23:00
  });

  it('ignores windows for days not in the week', () => {
    const SIX = WEEK.slice(0, 6);
    expect(initialScrollWindow(SIX, [{ dow: 6, startMin: 60, endMin: 120 }]))
      .toEqual({ startMin: MIN_VISIBLE_START, endMin: MIN_VISIBLE_END });
  });

  it('stays inside the day even for an absurd window', () => {
    const w = initialScrollWindow(WEEK, [{ dow: 2, startMin: 0, endMin: 1440 }]);
    expect(w.startMin).toBeGreaterThanOrEqual(DAY_START_MIN);
    expect(w.endMin).toBeLessThanOrEqual(DAY_END_MIN);
  });

  it('always returns a positive-width window', () => {
    const cases: Array<[string, string[], AvailabilityWindow[]]> = [
      ['empty week', WEEK, []],
      ['a narrow midday window', WEEK, [{ dow: 2, startMin: 700, endMin: 720 }]],
      ['a genuinely empty dates array', [], []],
    ];
    for (const [label, dates, windows] of cases) {
      const w = initialScrollWindow(dates, windows);
      expect(w.endMin, label).toBeGreaterThan(w.startMin);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/grid.test.ts`
Expected: FAIL — `No "initialScrollWindow" export is defined on the module`.

- [ ] **Step 3: Add the pixel API to `grid.ts`**

**Delete nothing in this step.** `visibleRange`, `minuteToPct`, `pctToMinute`, `hourMarks` and the `BusyBlock` import all stay exactly as they are — they still have call sites, and Task 7 Step 8 removes them once the last one is gone. Keeping both APIs alive for five tasks is what keeps every commit buildable.

Extend the existing `./availability` import to `import { MINUTES_PER_DAY, windowForDate } from './availability';` and add:

```ts

/**
 * The scale. One pixel per minute.
 *
 * Not an arbitrary choice: the grid this replaces was 720px tall for a default
 * 08:00-20:00 range, which is already exactly 1px per minute. Holding the
 * constant at 1 means the remaster changes WHICH minutes are reachable — all
 * of them, by scrolling — without changing how dense any of them look. The
 * visual identity is locked; this is what keeps it locked.
 *
 * `minuteToPx` is therefore the identity function today. Do not inline it away.
 * It is the single place the scale is applied, and this constant is the only
 * thing that would change if a zoom control is ever added.
 */
export const PX_PER_MINUTE = 1;
export const DAY_START_MIN = 0;
export const DAY_END_MIN = MINUTES_PER_DAY;
export const DAY_HEIGHT_PX = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MINUTE;

/** Vertical offset of `minute` within the day's content box, in pixels. */
export function minuteToPx(minute: number): number {
  return (minute - DAY_START_MIN) * PX_PER_MINUTE;
}

/**
 * Inverse of `minuteToPx`. Unlike the `pctToMinute` it replaces, this has no
 * precondition and cannot divide by zero — the scale is a constant, not a
 * range whose width depends on the week's contents.
 */
export function pxToMinute(px: number): number {
  return DAY_START_MIN + px / PX_PER_MINUTE;
}

/**
 * The grid's stacking order, in one place because it now has real layers.
 *
 * Under the fixed grid only the axis and the now-line were stacked and a
 * revealed block could sit at z-10 harmlessly. With sticky headings that block
 * would float over them mid-scroll, so the whole order is declared together
 * rather than rediscovered per component.
 */
export const Z_RULES = 0;
export const Z_BLOCK = 1;
export const Z_BLOCK_REVEALED = 2;
export const Z_NOW_LINE = 3;
export const Z_AXIS = 4;
export const Z_HEADINGS = 5;
export const Z_CORNER = 6;

/**
 * Where to scroll the grid on mount: the union of the week's availability
 * windows, expanded to whole hours and then to at least 08:00-20:00.
 *
 * This is NOT geometry. Nothing positions against it. It was `visibleRange`,
 * which had to widen itself to cover every scheduled block or that block would
 * render off-grid — the `spans` parameter existed for exactly that, and its
 * whole justification disappears once every minute of the day is reachable by
 * scrolling. `blocks` went the same way: a calendar event is a reason to look
 * somewhere, not a reason to reshape the grid.
 */
export function initialScrollWindow(
  dates: string[],
  windows: AvailabilityWindow[],
): Interval {
  let startMin = MIN_VISIBLE_START;
  let endMin = MIN_VISIBLE_END;

  for (const date of dates) {
    const w = windowForDate(date, windows);
    if (!w) continue;
    startMin = Math.min(startMin, w.startMin);
    endMin = Math.max(endMin, w.endMin);
  }

  return {
    startMin: Math.max(DAY_START_MIN, floorToHour(startMin)),
    endMin: Math.min(DAY_END_MIN, ceilToHour(endMin)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/grid.test.ts`
Expected: PASS — the new describes plus every pre-existing one, all green together.

- [ ] **Step 5: Verify the build stayed green**

Run: `npx tsc -b && npm test`
Expected: `tsc` clean, 1417 + new tests passing.

If `src/views/goals/BoardCard.keyboard.test.tsx` fails, re-run once — it is a known low-rate flake (observed once in eight baseline runs) in code this plan does not touch. Any *other* failure is real.

- [ ] **Step 6: Commit**

```bash
git add src/lib/grid.ts src/lib/grid.test.ts
git commit -m "feat(plan): add pixel geometry at a constant scale

minuteToPx/pxToMinute map a minute to an absolute offset at a constant
1px/minute, rather than to a percentage of a fixed 720px whose meaning
changed with the week's contents. initialScrollWindow replaces what
visibleRange was for: it says where to scroll, so it does not have to
widen itself to keep off-range blocks on screen.

Added alongside the percentage API rather than replacing it. Five tasks
still call the old functions, and deleting them here would leave four
commits that do not typecheck. Task 7 removes them with the last caller.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Scroller-relative drag aim

**Files:**
- Modify: `src/views/plan/dropTarget.ts`
- Test: `src/views/plan/dropTarget.test.ts`

**Interfaces:**
- Consumes: `pxToMinute`, `DAY_START_MIN`, `DAY_END_MIN` from Task 1.
- Produces: `aimMinuteFor(input: AimInput): number` where `AimInput` is `{ draggedTopViewport: number; scrollerTopViewport: number; scrollTop: number; gridOffsetPx: number }`. `PlanDragData` is unchanged.

This is the highest-risk change in the whole remaster: a mistake here does not crash, it lands blocks a few minutes away from where their ghost was, which is easy to ship and hard to notice. It gets its tests before it gets a call site.

- [ ] **Step 1: Replace `dropTarget.test.ts` entirely**

```ts
import { describe, it, expect } from 'vitest';
import { aimMinuteFor } from './dropTarget';

/**
 * The grid is a scroller. Its content box starts `gridOffsetPx` below the
 * scroller's own top edge — that is the sticky day headings and the all-day
 * lane, which live inside the scroller but above the hour grid.
 *
 * Every case below fixes the scroller at viewport y=100 with a 60px header
 * band, and varies only `scrollTop`. The point of the coordinate change is
 * that the SAME viewport position means a LATER minute once the grid has been
 * scrolled — which is precisely what the old viewport-only arithmetic got
 * wrong, and what made autoScroll unsafe to enable.
 */
const SCROLLER_TOP = 100;
const HEADER = 60;
const DAY_START = 0;
const DAY_END = 1440;

function aim(draggedTopViewport: number, scrollTop = 0): number {
  return aimMinuteFor({
    draggedTopViewport,
    scrollerTopViewport: SCROLLER_TOP,
    scrollTop,
    gridOffsetPx: HEADER,
  });
}

describe('aimMinuteFor', () => {
  it('maps the top of an unscrolled grid to midnight', () => {
    expect(aim(SCROLLER_TOP + HEADER)).toBe(0);
  });

  it('maps a position down the unscrolled grid to that many minutes', () => {
    // 540px below the grid top, at 1px/minute, is 09:00.
    expect(aim(SCROLLER_TOP + HEADER + 540)).toBe(540);
  });

  it('adds the scroll offset — the whole point of the coordinate change', () => {
    // Same pixel on screen, but the grid has been scrolled down 480px, so the
    // minute under it is 480 later. Viewport-only arithmetic returns 540 here
    // and is wrong by eight hours.
    expect(aim(SCROLLER_TOP + HEADER + 540, 480)).toBe(1020);
  });

  it('is stable under scroll for a fixed content position', () => {
    // Scrolling and moving the pointer by the same amount must not change the
    // answer: the block stays under the same minute.
    const unscrolled = aim(SCROLLER_TOP + HEADER + 600, 0);
    const scrolled = aim(SCROLLER_TOP + HEADER + 300, 300);
    expect(scrolled).toBe(unscrolled);
  });

  it('clamps above the grid to midnight rather than a negative minute', () => {
    expect(aim(SCROLLER_TOP - 500)).toBe(DAY_START);
  });

  it('clamps below the grid to the end of the day', () => {
    expect(aim(SCROLLER_TOP + HEADER + 99999)).toBe(DAY_END);
  });

  it('clamps once the scroll offset alone pushes past the end of the day', () => {
    expect(aim(SCROLLER_TOP + HEADER + 100, 1_000_000)).toBe(DAY_END);
  });

  it('rounds to a whole minute', () => {
    expect(Number.isInteger(aim(SCROLLER_TOP + HEADER + 540.7))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/plan/dropTarget.test.ts`
Expected: FAIL — `aimMinuteFor` still takes four positional numbers and a `range`, so every case gets `NaN` or a type error.

- [ ] **Step 3: Rewrite `aimMinuteFor`**

Replace the whole of `aimMinuteFor` and its doc comment in `src/views/plan/dropTarget.ts` (lines 12–35), keeping the `PlanDragData` interface above it. Update the imports at the top of the file to `import { pxToMinute, DAY_START_MIN, DAY_END_MIN } from '../../lib/grid';` and drop the `Interval` import.

```ts
export interface AimInput {
  /**
   * Viewport Y of the TOP EDGE of the thing being dragged — not the pointer.
   * A block is grabbed anywhere along its body, but its top edge is what the
   * user sees lined up against the hour grid, so that edge is the aim basis.
   * Callers derive it from `active.rect.current.initial.top + delta.y`.
   */
  draggedTopViewport: number;
  /** Live `getBoundingClientRect().top` of the grid's scroller. */
  scrollerTopViewport: number;
  /** Live `scrollTop` of that same scroller. */
  scrollTop: number;
  /** Offset of the hour grid inside the scroller's content — the sticky day headings and all-day lane. */
  gridOffsetPx: number;
}

/**
 * The minute a drag is aiming at, in the grid's own content coordinates.
 *
 * The previous version worked in viewport coordinates against a droppable rect
 * measured at drag start, and carried a comment forbidding a live rect because
 * pairing a live rect with a start-of-drag delta double-counts scroll. That
 * whole problem was a symptom of a fixed-height grid: there was no vertical
 * scroll, so viewport space and content space were the same space.
 *
 * They are not the same space any more. `scrollTop` is what reconciles them,
 * and taking it live alongside a live scroller rect is consistent precisely
 * because BOTH are live — the double-counting the old comment warned about
 * came from mixing one live measurement with one stale one.
 *
 * This is what makes `autoScroll` safe to re-enable on the DndContext.
 */
export function aimMinuteFor(input: AimInput): number {
  const { draggedTopViewport, scrollerTopViewport, scrollTop, gridOffsetPx } = input;
  const contentY = draggedTopViewport - scrollerTopViewport + scrollTop - gridOffsetPx;
  const minute = pxToMinute(contentY);
  return Math.round(Math.min(Math.max(minute, DAY_START_MIN), DAY_END_MIN));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/views/plan/dropTarget.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/dropTarget.ts src/views/plan/dropTarget.test.ts
git commit -m "feat(plan): aim in scroller content coordinates

The old arithmetic worked in viewport space against a rect measured at
drag start, which was correct only because a fixed-height grid never
scrolled — viewport space and content space were the same space. They
are not, once the grid scrolls, and the drift is about a minute per
pixel scrolled.

Takes live scrollerTop and live scrollTop together, which is consistent
because both are live; the double-counting the old comment warned
against came from mixing one live measurement with one stale one. This
is the prerequisite for turning autoScroll back on.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Canvas span arithmetic

**Files:**
- Create: `src/lib/canvasCreate.ts`
- Test: `src/lib/canvasCreate.test.ts`

**Interfaces:**
- Consumes: `SLOT_GRANULARITY_MIN`, `DEFAULT_SLOT_MIN` from `src/lib/slot.ts`; `pxToMinute`, `DAY_START_MIN`, `DAY_END_MIN` from Task 1.
- Produces: `snapMinute(minute: number): number`, `CanvasSpan` (`{ startMin: number; durationMin: number }`), `canvasSpan(anchorContentY: number, currentContentY: number): CanvasSpan`, `CLICK_THRESHOLD_PX`.

Pulling this out of the component is what lets the click-versus-drag rule and the day-boundary clamping be tested without a DOM.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { canvasSpan, snapMinute, CLICK_THRESHOLD_PX } from './canvasCreate';
import { DEFAULT_SLOT_MIN, SLOT_GRANULARITY_MIN } from './slot';

describe('snapMinute', () => {
  it('snaps to the grain the rest of the scheduler already uses', () => {
    expect(snapMinute(542)).toBe(540);
    expect(snapMinute(543)).toBe(545);
    expect(snapMinute(540)).toBe(540);
  });
});

describe('canvasSpan', () => {
  it('treats a click as a default-length block', () => {
    expect(canvasSpan(540, 540)).toEqual({ startMin: 540, durationMin: DEFAULT_SLOT_MIN });
  });

  it('treats a tiny drag as a click, not a one-minute block', () => {
    const span = canvasSpan(540, 540 + CLICK_THRESHOLD_PX - 1);
    expect(span.durationMin).toBe(DEFAULT_SLOT_MIN);
  });

  it('uses the dragged extent once the drag is real', () => {
    expect(canvasSpan(540, 615)).toEqual({ startMin: 540, durationMin: 75 });
  });

  it('snaps both edges', () => {
    expect(canvasSpan(542, 613)).toEqual({ startMin: 540, durationMin: 75 });
  });

  it('handles an upward drag by ordering the edges', () => {
    expect(canvasSpan(615, 540)).toEqual({ startMin: 540, durationMin: 75 });
  });

  it('never produces a block shorter than the snap grain', () => {
    // Both edges clamp to DAY_START_MIN, so the raw extent is zero and only the
    // floor saves it. Without `Math.max(SLOT_GRANULARITY_MIN, …)` this is a
    // zero-length block. A drag of CLICK_THRESHOLD_PX + 1 does NOT reach this
    // branch — at 1px/minute two points 6px apart always snap apart — so that
    // input would leave the floor uncovered.
    expect(canvasSpan(-200, -100)).toEqual({ startMin: 0, durationMin: SLOT_GRANULARITY_MIN });
  });

  it('gives a click near midnight a full-length block pulled back inside the day', () => {
    // The whole block moves, it is not truncated. A truncating implementation
    // returns { startMin: 1430, durationMin: 10 }, which also satisfies a bare
    // "ends by midnight" assertion — so assert the duration, not just the end.
    expect(canvasSpan(1430, 1430)).toEqual({ startMin: 1380, durationMin: DEFAULT_SLOT_MIN });
  });

  it('keeps a drag entirely past midnight inside the day', () => {
    // Both edges clamp to DAY_END_MIN. If the grain floor is applied after the
    // clamp without pulling the start back, this ends at 00:05 tomorrow.
    const span = canvasSpan(1450, 1460);
    expect(span.startMin + span.durationMin).toBe(1440);
    expect(span.durationMin).toBeGreaterThanOrEqual(SLOT_GRANULARITY_MIN);
  });

  it('clamps a drag that runs off the bottom of the day', () => {
    const span = canvasSpan(1380, 2000);
    expect(span.startMin).toBe(1380);
    expect(span.startMin + span.durationMin).toBe(1440);
  });

  it('clamps a drag that starts above midnight', () => {
    const span = canvasSpan(-200, 120);
    expect(span.startMin).toBe(0);
    expect(span.durationMin).toBe(120);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/canvasCreate.test.ts`
Expected: FAIL — `Failed to load url ./canvasCreate`.

- [ ] **Step 3: Write the implementation**

```ts
import { DEFAULT_SLOT_MIN, SLOT_GRANULARITY_MIN } from './slot';
import { pxToMinute, DAY_START_MIN, DAY_END_MIN } from './grid';

/**
 * Below this much pointer travel the gesture is a click, not a drag.
 *
 * Expressed in pixels rather than minutes because it is a property of the
 * hand, not of the schedule. dnd-kit's own PointerSensor uses a 5px activation
 * distance for the same reason, and matching it means the canvas and the
 * blocks agree on what counts as a drag.
 */
export const CLICK_THRESHOLD_PX = 5;

export interface CanvasSpan {
  startMin: number;
  durationMin: number;
}

/** Round to the grain that `resolveSlot` already snaps its aim to. */
export function snapMinute(minute: number): number {
  return Math.round(minute / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
}

function clampMinute(minute: number): number {
  return Math.min(Math.max(minute, DAY_START_MIN), DAY_END_MIN);
}

/**
 * The block a canvas gesture is describing, from the pointer's anchor and
 * current position in the grid's content coordinates.
 *
 * A click — travel under `CLICK_THRESHOLD_PX` — means a default-length block
 * at that minute, the same thing every calendar does with a click on empty
 * space. Anything longer uses the dragged extent.
 *
 * Both edges are snapped and the result is clamped inside the day, so a drag
 * released past midnight produces a block that ends at midnight rather than
 * one the store will have to refuse.
 */
export function canvasSpan(anchorContentY: number, currentContentY: number): CanvasSpan {
  const isClick = Math.abs(currentContentY - anchorContentY) < CLICK_THRESHOLD_PX;

  if (isClick) {
    const start = clampMinute(snapMinute(pxToMinute(anchorContentY)));
    // Pull the whole block back inside the day rather than truncating it: a
    // click at 23:50 means "an hour of work here", and a 10-minute block is a
    // worse answer than an hour ending at midnight.
    const startMin = Math.min(start, DAY_END_MIN - DEFAULT_SLOT_MIN);
    return { startMin: Math.max(DAY_START_MIN, startMin), durationMin: DEFAULT_SLOT_MIN };
  }

  const a = clampMinute(snapMinute(pxToMinute(anchorContentY)));
  const b = clampMinute(snapMinute(pxToMinute(currentContentY)));
  /*
   * Pull the start back far enough that the grain floor below cannot push the
   * block past midnight — the same pull-back the click branch uses, for the
   * same reason.
   *
   * Without it, a drag entirely beyond the day clamps BOTH edges to
   * DAY_END_MIN, the floor then widens a zero-length block to 5 minutes, and
   * the result ends at 00:05 the next day. Clamping the edges is not enough on
   * its own: the floor runs after the clamp and only ever extends the end
   * forward, so it can reintroduce the overflow the clamp just removed.
   */
  const startMin = Math.min(Math.min(a, b), DAY_END_MIN - SLOT_GRANULARITY_MIN);
  return {
    startMin,
    durationMin: Math.max(SLOT_GRANULARITY_MIN, Math.max(a, b) - startMin),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/canvasCreate.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvasCreate.ts src/lib/canvasCreate.test.ts
git commit -m "feat(plan): canvas gesture arithmetic

The click-versus-drag rule and the day-boundary clamping are the parts
of drag-to-create most likely to be got subtly wrong, so they live in a
pure module with tests rather than inside a pointer handler.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: `EventBlock` positions in pixels

**Files:**
- Modify: `src/views/plan/EventBlock.tsx`

**Interfaces:**
- Consumes: `minuteToPx`, `PX_PER_MINUTE`, `Z_BLOCK`, `Z_BLOCK_REVEALED` from Task 1.
- Produces: `EventBlock` loses its `range` and `gridHeightPx` props. `GridBlock` is unchanged.

The `range` prop existed only so a block could work out what fraction of a variable window it occupied. A block's height is now a property of its own duration, which is what it always should have been.

- [ ] **Step 1: Swap the imports**

At the top of `src/views/plan/EventBlock.tsx`, replace the `Interval`/`minuteToPct` imports with:

```ts
import { minuteToPx, PX_PER_MINUTE, Z_BLOCK, Z_BLOCK_REVEALED } from '../../lib/grid';
```

- [ ] **Step 2: Change the prop signature**

Remove `range` and `gridHeightPx` from the destructured props and from the props type. The remaining props are unchanged:

```ts
export function EventBlock({
  block, lane, laneCount, onRemove, onComplete, drag, onResize,
  domId, revealed = false,
}: {
  block: GridBlock;
  lane: number;
  laneCount: number;
  onRemove?: () => void;
  onComplete?: () => void;
  drag?: PlanDragData;
  onResize?: (minutes: number) => void;
  domId?: string;
  revealed?: boolean;
}) {
```

Keep every existing doc comment on `onComplete` and `drag` verbatim — they record decisions this plan does not revisit.

- [ ] **Step 3: Replace the geometry block**

Replace the `top`/`committedHeight`/`height`/`width`/`heightPx`/`compact` calculation (currently lines 86–95) with:

```ts
  const top = minuteToPx(block.startMin);
  const committedMinutes = block.endMin - block.startMin;
  const minutes = previewMinutes ?? committedMinutes;
  const heightPx = Math.max(minutes * PX_PER_MINUTE, MIN_BLOCK_PX);
  const width = 100 / laneCount;
  // A property of the block's own duration now, not of the week it sits on.
  // The old form compared a percentage of a variable grid height, so the same
  // 30-minute block was compact on a busy week and not on a quiet one.
  const compact = heightPx < COMPACT_BLOCK_PX;
```

- [ ] **Step 4: Replace the inline style and the z-index**

In the same element, change the `style` prop to pixels and the `revealed` class to use the constant:

```tsx
      className={`group/blk absolute rounded-[6px] px-[5px] py-[2px] overflow-hidden text-badge leading-[1.2] border ${
        isBusy
          ? 'bg-hover border-line-2 text-muted italic'
          : `bg-panel border-line-2 border-l-[3px] border-l-accent text-ink touch-none ${block.done ? 'opacity-55 line-through' : ''} ${block.estimated ? '' : 'border-dashed'} cursor-grab`
      } ${isDragging ? 'opacity-40' : ''} ${revealed ? 'ring-2 ring-inset ring-accent' : ''}`}
      style={{
        top: `${top}px`,
        height: `${heightPx}px`,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        zIndex: revealed ? Z_BLOCK_REVEALED : Z_BLOCK,
      }}
```

Note `minHeight` is gone: the `Math.max` against `MIN_BLOCK_PX` in Step 3 already enforces the floor, and keeping both would apply it twice. The comment explaining why very short blocks are allowed to overlap slightly should move onto the `Math.max` line.

- [ ] **Step 5: Fix the resize handle's scale**

`ResizeHandle`'s `pxPerMinute` prop was computed by the caller from the grid height. It is now the constant. In the `onResize && !isBusy` branch:

```tsx
        <ResizeHandle
          startDuration={committedMinutes}
          pxPerMinute={PX_PER_MINUTE}
          onPreview={setPreviewMinutes}
          onResize={onResize}
        />
```

- [ ] **Step 6: Update `DayBlocks` to match**

In `src/views/plan/DayBlocks.tsx`, remove `range` and `gridHeightPx` from the props type and the destructuring, and remove `range={range}` and `gridHeightPx={gridHeightPx}` from the `<EventBlock>` call.

`range` is still used at lines 96–97 for the all-day path, which spans "the entire visible range". Replace those two lines with the day bounds:

```ts
        startMin: DAY_START_MIN,
        endMin: DAY_END_MIN,
```

adding `import { DAY_START_MIN, DAY_END_MIN } from '../../lib/grid';`. This path is unexercised today (`blocks` is always `[]`) and plan 3 replaces it with the all-day lane; this keeps it compiling and honest in the meantime.

- [ ] **Step 7: Typecheck and test**

Run: `npx tsc -b && npm test`
Expected: both clean. `WeekGrid` still passes `range`/`gridHeightPx` in its JSX, which is now surplus — TypeScript accepts extra props on a call only if they are declared, so **if `tsc` reports an error in `WeekGrid.tsx`, remove those two attributes from its `<DayBlocks>` call as part of this task.** That is a one-line change and it keeps the build green; do not defer it to Task 6.

A `BoardCard.keyboard.test.tsx` failure is a known flake — re-run once.

- [ ] **Step 8: Commit**

```bash
git add src/views/plan/EventBlock.tsx src/views/plan/DayBlocks.tsx
git commit -m "feat(plan): blocks size themselves from their own duration

Drops the range and gridHeightPx props. A block's height was a fraction
of a variable window, so the same 30-minute block rendered compact on a
busy week and comfortable on a quiet one. Adds the grid's z-index scale
and brings a revealed block down from z-10, which would otherwise float
over the sticky day headings that arrive with the scroller.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: `DayColumn` shading in pixels

**Files:**
- Modify: `src/views/plan/DayColumn.tsx`

**Interfaces:**
- Consumes: `minuteToPx`, `DAY_HEIGHT_PX`, `Z_NOW_LINE` from Task 1.
- Produces: `DayColumn` loses its `range` prop.

- [ ] **Step 1: Swap the imports and drop the prop**

Replace `import { minuteToPct } from '../../lib/grid';` and the `Interval` import with:

```ts
import { minuteToPx, DAY_HEIGHT_PX, Z_NOW_LINE } from '../../lib/grid';
```

Remove `range` from the destructured props and the props type.

- [ ] **Step 2: Convert the availability shading**

The two dimming panels currently use percentage heights derived from the range. In pixels they become:

```tsx
      {availabilityWindow && (
        <>
          <div
            className="absolute left-0 right-0 top-0 bg-hover/60 pointer-events-none"
            style={{ height: `${minuteToPx(availabilityWindow.startMin)}px` }}
          />
          <div
            className="absolute left-0 right-0 bottom-0 bg-hover/60 pointer-events-none"
            style={{ height: `${DAY_HEIGHT_PX - minuteToPx(availabilityWindow.endMin)}px` }}
          />
        </>
      )}
```

The `Math.max(0, …)` guards are no longer needed: a window's minutes are inside the day by construction, so neither expression can go negative — where under the old range they could, because the range was narrower than the day.

- [ ] **Step 3: Convert the now-line**

```tsx
      {isToday && nowMinute !== null && (
        <div
          className="absolute left-0 right-0 h-0 border-t border-accent pointer-events-none"
          style={{ top: `${minuteToPx(nowMinute)}px`, zIndex: Z_NOW_LINE }}
          aria-hidden="true"
        />
      )}
```

The `nowMinute >= range.startMin && nowMinute <= range.endMin` guard is deleted. It existed because a clock reading outside the visible range would have rendered off-grid; every minute of the day is now on the grid, so the guard can only ever be true.

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc -b && npm test`
Expected: both clean. As in Task 4, if `tsc` flags the now-surplus `range` attribute on `WeekGrid`'s `<DayColumn>` call, remove it here rather than deferring it.

A `BoardCard.keyboard.test.tsx` failure is a known flake — re-run once.

- [ ] **Step 5: Commit**

```bash
git add src/views/plan/DayColumn.tsx src/views/plan/WeekGrid.tsx
git commit -m "feat(plan): day shading and now-line in pixels

Drops the range prop and two guards that only existed because the grid
showed a window rather than a day: shading heights could go negative,
and the clock could fall outside the range. Neither is reachable now.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: `WeekGrid` becomes a two-axis scroller

**Files:**
- Modify: `src/views/plan/WeekGrid.tsx`
- Test: `src/views/plan/WeekGrid.centring.test.tsx`

**Interfaces:**
- Consumes: `minuteToPx`, `hourMarks`, `DAY_HEIGHT_PX`, `Z_AXIS`, `Z_HEADINGS`, `Z_CORNER` from Task 1.
- Produces: `WeekGrid` gains `scrollWindow: Interval`, `scrollerRef: RefObject<HTMLDivElement | null>` and `gridRef: RefObject<HTMLDivElement | null>` props, and loses `range`. `GRID_HEIGHT_PX` is **deleted**; `GRID_VIEWPORT_PX` replaces it as the scroller's own height.

- [ ] **Step 0: Give `hourMarks` its day-wide signature**

`WeekGrid` is its only consumer, which is why this lands here rather than in Task 1. In `src/lib/grid.ts`:

```ts
/** Every whole hour of the day, both ends inclusive. 25 marks. */
export function hourMarks(): number[] {
  const out: number[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) out.push(m);
  return out;
}
```

Replace the existing range-based `hourMarks` outright — after this step nothing calls the old form. Then replace its test in `src/lib/grid.test.ts`:

```ts
describe('hourMarks', () => {
  it('labels every whole hour of the day, both ends inclusive', () => {
    const marks = hourMarks();
    expect(marks).toHaveLength(25);
    expect(marks[0]).toBe(0);
    expect(marks[24]).toBe(1440);
    expect(marks[9]).toBe(540);
  });
});
```

- [ ] **Step 1: Replace the module header**

Replace the `GRID_HEIGHT_PX` export and the `minuteToPct, hourMarks` import with:

```ts
import { minuteToPx, hourMarks, DAY_HEIGHT_PX, Z_AXIS, Z_HEADINGS, Z_CORNER } from '../../lib/grid';

/**
 * How tall the scroller itself is — the window onto the day, not the day.
 *
 * 720px is the height the old fixed grid occupied, kept so the page layout and
 * the sidebar bounded against it are unchanged. The sticky day headings live
 * inside this box and eat into it, exactly as they do in every calendar; the
 * content behind them is `DAY_HEIGHT_PX` and reachable by scrolling.
 */
export const GRID_VIEWPORT_PX = 720;

const AXIS_WIDTH_PX = 46;
```

- [ ] **Step 2: Change the props**

```ts
export function WeekGrid({
  days, today, nowMinute, windows, scrollWindow, readOnly, dayCapacity,
  scrollerRef, gridRef, children,
}: {
  days: string[];
  today: string;
  nowMinute: number | null;
  windows: AvailabilityWindow[];
  /** Where to scroll on mount. Nothing positions against it — see initialScrollWindow. */
  scrollWindow: Interval;
  readOnly?: boolean;
  dayCapacity?: DayCapacity[];
  /** Owned by Plan, which needs it live to resolve a drop. */
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The hour grid inside the scroller. Plan reads its offsetTop as gridOffsetPx. */
  gridRef: RefObject<HTMLDivElement | null>;
  children: (date: string) => ReactNode;
}) {
```

Add `type RefObject` to the React import and keep the `Interval` import.

- [ ] **Step 3: Replace the scroll-restoration effect**

Delete the local `scrollerRef` (`WeekGrid.tsx:52`) — it is a prop now — and replace the whole `centredFor`/`userScrolled`/`programmatic` block and its effect (lines 74–148) with:

```tsx
  /*
   * Two axes, restored independently.
   *
   * Horizontal: bring today into view once per week. Vertical: put the working
   * day at the top once per week. Each stops the moment the user moves THAT
   * axis themselves — separate flags, because scrolling sideways to reach
   * Friday should not forfeit the scroll-to-working-hours, and vice versa.
   *
   * `weekKey` rather than `days`: `weekDates` returns a fresh array every
   * render, so keying on it re-ran this on the 60-second now-line tick and
   * threw away the user's scroll. See the note Plan.tsx carries for the same
   * hazard on its keydown listener.
   */
  const weekKey = days[0];
  const doneFor = useRef<string | null>(null);
  const userScrolledX = useRef(false);
  const userScrolledY = useRef(false);
  const programmaticX = useRef(false);
  const programmaticY = useRef(false);
  const lastLeft = useRef(0);
  const lastTop = useRef(0);

  useEffect(() => {
    doneFor.current = null;
    userScrolledX.current = false;
    userScrolledY.current = false;
  }, [weekKey]);

  /*
   * Layout effect, not effect: the scroller's content starts at 00:00, so a
   * post-paint scroll shows the user midnight for one frame before jumping to
   * their working day. This runs before the browser paints.
   */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    function restore(): void {
      const node = scrollerRef.current;
      if (!node || doneFor.current === weekKey) return;

      if (!userScrolledY.current) {
        const targetTop = minuteToPx(scrollWindow.startMin);
        if (Math.abs(node.scrollTop - targetTop) >= 1) {
          programmaticY.current = true;
          node.scrollTop = targetTop;
          lastTop.current = targetTop;
        }
      }

      // Horizontal centring only applies once the grid actually overflows.
      // Returning WITHOUT marking the week done is the point of watching for
      // resizes: the grid is min-w-[780px], so a window dragged narrower makes
      // it scrollable long after mount.
      if (node.scrollWidth <= node.clientWidth) return;
      if (!userScrolledX.current) {
        const index = days.indexOf(today);
        if (index >= 0) {
          const colWidth = (node.scrollWidth - AXIS_WIDTH_PX) / days.length;
          const targetLeft = Math.max(
            0,
            AXIS_WIDTH_PX + index * colWidth - (node.clientWidth - AXIS_WIDTH_PX - colWidth) / 2,
          );
          if (Math.abs(node.scrollLeft - targetLeft) >= 1) {
            programmaticX.current = true;
            node.scrollLeft = targetLeft;
            lastLeft.current = targetLeft;
          }
        }
      }
      doneFor.current = weekKey;
    }

    /*
     * One scroll event serves both axes, so which flag to set is decided by
     * which offset actually moved. Without the comparison, a programmatic
     * vertical scroll would consume the flag guarding the horizontal one.
     */
    function onScroll(): void {
      const node = scrollerRef.current;
      if (!node) return;
      if (node.scrollLeft !== lastLeft.current) {
        if (programmaticX.current) programmaticX.current = false;
        else userScrolledX.current = true;
        lastLeft.current = node.scrollLeft;
      }
      if (node.scrollTop !== lastTop.current) {
        if (programmaticY.current) programmaticY.current = false;
        else userScrolledY.current = true;
        lastTop.current = node.scrollTop;
      }
    }

    restore();
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => restore());
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `days` is derived
    // from `weekKey`; depending on the array re-runs this every render.
  }, [weekKey, today, scrollWindow.startMin]);
```

Add `useLayoutEffect` to the React import.

- [ ] **Step 4: Replace the render tree**

The outer element becomes the two-axis scroller; the headings move inside it and become sticky.

```tsx
  const marks = hourMarks();

  return (
    <div
      ref={scrollerRef}
      className="overflow-auto relative"
      style={{ height: `${GRID_VIEWPORT_PX}px` }}
    >
      {/* 7 columns cannot be legible on a phone, so the grid scrolls rather
          than squeezing — and it starts on today. 780px keeps a day column
          ~105px. */}
      <div className="min-w-[780px]">
        {/* day headings — sticky so they survive VERTICAL scrolling, over an
            opaque background so blocks pass behind rather than through */}
        <div
          className="grid gap-0 mb-[4px] sticky top-0 bg-bg"
          style={{ gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))`, zIndex: Z_HEADINGS }}
        >
          {/* the corner sits above both rulers, or the axis slides over it */}
          <span className="sticky left-0 bg-bg" style={{ zIndex: Z_CORNER }} />
          {days.map((iso, i) => {
            const cap = dayCapacity?.[i];
            const load = cap ? dayLoadLabel(cap) : null;
            const over = cap ? isOverCommitted(cap) : false;
            return (
              <div key={iso} className="text-center">
                <div className={`font-mono text-tiny tracking-[.12em] uppercase ${iso === today ? 'text-accent' : 'text-muted'}`}>
                  {DOW[i]}
                </div>
                <div className={`text-body tabular-nums ${iso === today ? 'text-ink font-semibold' : 'text-ink-soft'}`}>
                  {parseD(iso).getDate()}
                </div>
                {/* Fixed-height slot whether or not the day has a figure, so one
                    busy day cannot shove the header row down relative to its
                    neighbours. */}
                <div className="h-[12px] leading-[12px]">
                  {load && (
                    <span
                      title={cap ? dayLoadHint(cap) : undefined}
                      className={`font-mono text-eyebrow tabular-nums ${over ? 'text-warn font-semibold' : 'text-muted'}`}
                    >
                      {load}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* the hour grid — a full day tall */}
        <div
          ref={gridRef}
          className="grid relative border-t border-line"
          style={{
            gridTemplateColumns: `${AXIS_WIDTH_PX}px repeat(7, minmax(0, 1fr))`,
            height: `${DAY_HEIGHT_PX}px`,
          }}
        >
          {marks.map((m) => (
            <div
              key={m}
              className="absolute left-0 right-0 border-t border-line-soft pointer-events-none"
              style={{ top: `${minuteToPx(m)}px` }}
              aria-hidden="true"
            />
          ))}

          <div className="relative sticky left-0 bg-bg" style={{ zIndex: Z_AXIS }}>
            {marks.map((m) => (
              <span
                key={m}
                className="absolute right-[6px] -translate-y-1/2 font-mono text-tiny text-muted tabular-nums"
                style={{ top: `${minuteToPx(m)}px` }}
              >
                {clockLabel(m)}
              </span>
            ))}
          </div>

          {days.map((iso) => (
            <DayColumn
              key={iso}
              date={iso}
              isToday={iso === today}
              availabilityWindow={windowForDate(iso, windows)}
              nowMinute={iso === today ? nowMinute : null}
              readOnly={readOnly}
            >
              {children(iso)}
            </DayColumn>
          ))}
        </div>
      </div>
    </div>
  );
```

Note `overflow-auto` replaces `overflow-x-auto`. The hour rules keep their default stacking (`Z_RULES` is 0, which is the static default) rather than carrying an explicit `zIndex` — giving them one would create a stacking context that the absolutely-positioned blocks would then have to compete with.

- [ ] **Step 5: Update the centring test**

`WeekGrid.centring.test.tsx` renders `WeekGrid` directly and will not compile against the new props. Add the two refs and swap `range` for `scrollWindow`. At the top of the test file's render helper:

```tsx
function renderGrid(props: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  const scrollerRef = createRef<HTMLDivElement>();
  const gridRef = createRef<HTMLDivElement>();
  return render(
    <WeekGrid
      days={DAYS}
      today={DAYS[3]}
      nowMinute={null}
      windows={[]}
      scrollWindow={{ startMin: 480, endMin: 1200 }}
      scrollerRef={scrollerRef}
      gridRef={gridRef}
      {...props}
    >
      {() => null}
    </WeekGrid>,
  );
}
```

Import `createRef` from React. Keep every existing assertion — the horizontal centring behaviour is unchanged and these tests are the guard that this task did not break it.

- [ ] **Step 6: Add a vertical restoration test**

Append to `WeekGrid.centring.test.tsx`:

```tsx
describe('vertical restoration', () => {
  it('scrolls to the start of the working window rather than to midnight', () => {
    const scrollerRef = createRef<HTMLDivElement>();
    const gridRef = createRef<HTMLDivElement>();
    render(
      <WeekGrid
        days={DAYS}
        today={DAYS[3]}
        nowMinute={null}
        windows={[]}
        scrollWindow={{ startMin: 540, endMin: 1080 }}
        scrollerRef={scrollerRef}
        gridRef={gridRef}
      >
        {() => null}
      </WeekGrid>,
    );
    // 09:00 at 1px/minute.
    expect(scrollerRef.current?.scrollTop).toBe(540);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/views/plan/WeekGrid.centring.test.tsx`
Expected: PASS, including the new vertical case.

If the vertical case reports `0`: jsdom does not lay out, so `scrollTop` assignment sticks only when the element is considered scrollable. Give the scroller a `scrollHeight` in the test by stubbing `Object.defineProperty(scrollerRef.current!, 'scrollHeight', { value: 1440 })` before asserting — the existing horizontal tests already use this idiom for `scrollWidth`; follow whatever they do rather than inventing a second approach.

- [ ] **Step 8: Commit**

```bash
git add src/views/plan/WeekGrid.tsx src/views/plan/WeekGrid.centring.test.tsx
git commit -m "feat(plan): the week grid scrolls in two axes

Day headings move inside the scroller and become sticky; the hour axis
stays sticky left; the corner sits above both. Content is a full day
tall and the scroller is the 720px the old fixed grid occupied, so the
page layout and the sidebar bounded against it are unchanged.

Restoration is per-axis with separate flags — scrolling sideways to
reach Friday must not forfeit the scroll to working hours. One scroll
event serves both axes, so which flag to set is decided by which offset
moved. The initial scroll is a layout effect: post-paint, the user would
see midnight for a frame before jumping to their working day.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Wire `Plan.tsx` and re-enable auto-scroll

**Files:**
- Modify: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 1, 2, 4, 5 and 6.
- Produces: nothing new. This task makes the build green.

- [ ] **Step 1: Swap the imports**

```ts
import { initialScrollWindow } from '../lib/grid';
import { WeekGrid } from './plan/WeekGrid';
import { windowForDate } from '../lib/availability';
```

Remove `type LaneSpan` from the `grid` import, remove `GRID_HEIGHT_PX` from the `WeekGrid` import, and delete the `scheduledSpans` memo (lines 109–112) — nothing consumes it now that `initialScrollWindow` takes no spans.

- [ ] **Step 2: Replace the range memo**

```ts
  const scrollWindow = useMemo(
    () => initialScrollWindow(days, availability),
    [days, availability],
  );
```

This is strictly cheaper than what it replaces: `visibleRange` depended on `scheduledSpans`, so it recomputed on every edit to any scheduled item. Where to scroll on mount does not change when a block moves.

- [ ] **Step 3: Add the two refs**

Beside the existing `railRef`:

```ts
  // Owned here because `handleDragEnd` needs both live at drop time — see the
  // coordinate-space note in dropTarget.ts.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 4: Rewrite the drop handler's aim**

Change the import at the top of the file from `aimMinuteInRange` to `aimMinuteFor` — Step 8 deletes the former, so leaving the import is a build break, not a style point.

Then replace the `rect`/`initialTop`/`draggedTop`/`aim` block in `handleDragEnd` (lines 341–362) with:

```ts
    /*
     * `active.rect.current.initial.top + delta.y` is the dragged element's
     * CURRENT viewport top: dnd-kit keeps `delta` scroll-adjusted for exactly
     * this. Pairing it with a live scroller rect and a live `scrollTop` is
     * consistent because all three describe the same instant.
     *
     * This replaces an arithmetic that paired the dragged top with
     * `e.over.rect`, measured at drag START. That was correct only while the
     * grid could not scroll. It cannot survive auto-scroll, which is why the
     * comment that used to sit here forbade re-enabling it.
     */
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const initialTop = e.active.rect.current.initial?.top ?? 0;
    const aim = aimMinuteFor({
      draggedTopViewport: initialTop + e.delta.y,
      scrollerTopViewport: scroller.getBoundingClientRect().top,
      scrollTop: scroller.scrollTop,
      gridOffsetPx: gridRef.current?.offsetTop ?? 0,
    });
```

- [ ] **Step 5: Turn auto-scroll on**

Replace the `autoScroll={false}` prop **and the whole comment block above it** — everything from `Auto-scroll OFF, and it must stay off.` down to and including the pointer lines mentioning `aimMinuteFor` and Task 7. Do not go by line number; that block was lengthened after this plan was written. Nothing referring to `aimMinuteInRange` or to re-deriving the aim arithmetic may survive this step. Replace it all with:

```tsx
      /*
       * On, and it needs to be: the grid is a full day tall, so dragging from
       * 09:00 to 18:00 requires the view to follow. The arithmetic this used to
       * be unsafe for is gone — `handleDragEnd` now resolves the aim in the
       * scroller's own content coordinates, which are invariant under scroll.
       * See dropTarget.ts.
       */
      autoScroll
```

- [ ] **Step 6: Fix keyboard placement**

In the `command.kind === 'place'` branch, replace the two `actions.schedule*` calls' `range.startMin` argument. Insert before them:

```ts
      const date = weekDates(weekStart)[command.dow];
      /*
       * Aim at the day's working start, not the grid's.
       *
       * This was `range.startMin`, which under the old stretching grid was
       * roughly 08:00. The grid now begins at 00:00, so the same expression
       * would aim every keyboard placement at midnight and let `resolveSlot`
       * walk forward from there. A day with no window has nothing to aim at and
       * refuses, matching the disabled droppable on that column.
       */
      const dayWindow = windowForDate(date, availability);
      if (!dayWindow) {
        actions.showToast('No working hours on that day.');
        return;
      }
```

and change both calls to pass `dayWindow.startMin`. Update the effect's dependency array from `range.startMin` to `availability`.

- [ ] **Step 7: Pass the new props to `WeekGrid`**

```tsx
          <WeekGrid
            days={days}
            today={today}
            nowMinute={nowMinute}
            windows={availability}
            scrollWindow={scrollWindow}
            readOnly={isPast}
            dayCapacity={capacity.days}
            scrollerRef={scrollerRef}
            gridRef={gridRef}
          >
            {(date) => (
              <DayBlocks
                date={date}
                items={scheduledByDay.get(date) ?? []}
                blocks={[]}
                allDayBlocks={allDayBlocks}
                readOnly={isPast}
                reveal={revealItem}
                onRemove={/* unchanged */}
                onComplete={/* unchanged */}
                onResize={/* unchanged */}
              />
            )}
          </WeekGrid>
```

Keep the three handler bodies and their comments exactly as they are; only `range` and `gridHeightPx` are removed.

- [ ] **Step 8: Delete the percentage API**

This is the last caller. Now — and only now — remove from `src/views/plan/dropTarget.ts` the transitional `aimMinuteInRange` and its doc comment, and from `src/views/plan/dropTarget.test.ts` its `describe` block. Step 4 above replaced its only caller with `aimMinuteFor`.

Then remove from `src/lib/grid.ts`: `visibleRange` and its doc comment, `minuteToPct`, `pctToMinute`, and the `BusyBlock` import that only `visibleRange` used. `floorToHour`/`ceilToHour` stay (`initialScrollWindow` uses them); `MIN_VISIBLE_START`/`MIN_VISIBLE_END` stay; `assignLanes` and its types stay.

From `src/lib/grid.test.ts`, remove the `describe('visibleRange', …)` and `describe('minute ↔ percentage', …)` blocks and the now-unused `block()` and `span()` helpers, the `BusyBlock` type import, and `visibleRange`/`minuteToPct`/`pctToMinute`/`type LaneSpan` from the import list. The `assignLanes` describe declares its own local `span` and is unaffected.

Confirm nothing survived:

Run: `grep -rn "visibleRange\|minuteToPct\|pctToMinute\|GRID_HEIGHT_PX\|gridHeightPx\|aimMinuteInRange" src`
Expected: no matches.

- [ ] **Step 9: Typecheck**

Run: `npx tsc -b`
Expected: clean, no errors.

- [ ] **Step 10: Run the whole suite**

Run: `npm test`
Expected: PASS. If `views.smoke.test.ts` fails, it is rendering `Plan` without a layout — check that `scrollerRef.current` being null is handled (Step 4 returns early) rather than loosening the guard.

- [ ] **Step 11: Commit**

```bash
git add src/views/Plan.tsx src/lib/grid.ts src/lib/grid.test.ts
git commit -m "feat(plan): scroll the day, and let drags scroll it

Wires initialScrollWindow, which no longer depends on scheduled spans —
so it stops recomputing every time a block moves. Resolves the drop aim
in the scroller's content coordinates and turns autoScroll back on,
which a full-day grid needs and which the old viewport arithmetic could
not have survived.

Keyboard placement aims at the day's working start rather than the
grid's: the grid now begins at 00:00, so the old expression would have
aimed every 1-7 placement at midnight.

Removes visibleRange, minuteToPct and pctToMinute with their last
caller, so no commit in this branch is left unbuildable.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Verification sweep

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Full suite and typecheck**

Run: `npm test && npx tsc -b`
Expected: all green.

- [ ] **Step 2: Confirm the deleted API is gone**

Run: `grep -rn "visibleRange\|minuteToPct\|pctToMinute\|GRID_HEIGHT_PX\|gridHeightPx" src`
Expected: no matches. Any hit is a missed call site.

- [ ] **Step 3: Start the app**

Run: `npm run dev`
Open the Plan view.

- [ ] **Step 4: Check the four things that could only break here**

These are behavioural and no unit test covers them:

1. **The grid opens on your working hours, not midnight.** Watch the first paint — a flash of 00:00 before it jumps means the layout effect in Task 6 became an effect.
2. **Density is unchanged.** A 60-minute block should be the same height it was before this plan. If it is not, `PX_PER_MINUTE` moved.
3. **An outlier no longer compresses the week.** Schedule something at 06:00. Every other block on the week must keep its size — this is the defect the whole plan exists to fix.
4. **Drag after scrolling lands where the ghost is.** Scroll the grid down several hours, then drag a block from the rail onto a day. It must land at the hour under the pointer, not offset by the scroll. Then drag from the top of the grid to the bottom and confirm the view follows.

- [ ] **Step 5: Check the stacking order**

Scroll the grid vertically with blocks on screen. Blocks must pass *behind* the day headings, not over them. Open the command palette and reveal a scheduled task — the revealed block's ring must also pass behind the headings (this is the `z-10` regression Task 4 fixed).

- [ ] **Step 6: Commit any fixes**

If steps 4 or 5 found a defect, fix it, re-run `npm test && npx tsc -b`, and commit with a message naming the specific behaviour that was wrong. If nothing was found, there is nothing to commit and this plan is complete.

---

## Self-review

**Spec coverage.** This plan implements spec §1.1–1.8 in full and §2 not at all — direct manipulation is plan 2. Specifically covered: the constant and the density rationale (§1.1, Task 1); `minuteToPx`/`pxToMinute` (§1.2, Task 1); `initialScrollWindow` and the deleted parameters (§1.3, Task 1); scrolling, stickiness and the z-index scale (§1.4, Tasks 4–6); per-axis scroll restoration (§1.5, Task 6); the auto-scroll reversal and the coordinate-space change (§1.6, Tasks 2 and 7); keyboard placement and the no-window case (§1.7, Task 7); and the unaffected list (§1.8) is verified rather than assumed — `assignLanes` keeps its tests in Task 1 and the centring tests are kept green in Task 6.

**Deferred to plans 2 and 3.** §2 (direct manipulation, including `createTaskAt` and `resizeFromStart`), §3 (colour), §4 (capacity temperature, gutter, all-day lane), §5 (motion). Task 3 of this plan builds `canvasCreate.ts` ahead of plan 2 because it is pure and testable in isolation, and having it landed makes plan 2's first component task smaller.

**Known rough edge.** Task 6 Step 7 anticipates a jsdom layout limitation on `scrollTop` and points at the existing `scrollWidth` idiom rather than prescribing a new one. That is deliberate — the existing test file is the authority on how this codebase fakes layout in jsdom, and inventing a second approach beside it would be worse than deferring to it.
