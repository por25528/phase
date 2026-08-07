# Plan Month View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** the project-identity colours (`src/lib/projectColour.ts`, shipped) — month chips are coloured by the same hash, so the two views agree on what a project looks like.

**Goal:** A month view beside the week view: six rows of day cells, each showing its day's work as coloured chips, with the same navigation, the same create gesture and the same drag-to-plan the week grid has.

**Architecture:** Month is a **mode of the Plan view**, not a new top-level view — the same derived data, the same `DndContext`, the same actions. `src/lib/calendar.ts` (restored from history) supplies the grid arithmetic. A cell renders chips rather than scaled blocks, because at month density there is no time axis for a duration to mean anything.

**Tech Stack:** React 19, TypeScript, Tailwind, Vitest + @testing-library/react (no jest-dom), dnd-kit, Dexie (one new settings key).

## Global Constraints

- **Never use `YEAR`, `DAYS` or `monthFrac` from `src/lib/dates.ts`.** `YEAR` is hardcoded to 2026 and `DAYS` has February at 28 with no leap-year handling; both exist only for the Timeline's year bar. All month arithmetic goes through `parseD`/`addDays`/`calendar.ts`, which are real `Date` math and cross years correctly.
- Visual identity is locked. Theme tokens only — `designScale.test.ts` fails the build on a literal hex, an arbitrary `text-[Nrem]`, and a `rounded-[Npx]` outside `{4, 6, 11}`.
- Hover-revealed controls use `.quiet-control`, which needs a **literal** `group` ancestor (`group/name` does not match).
- Device preferences persist through `db/db.ts` + `ifOwner` — never through `persist()`, which is a full clear + bulkPut of the four data tables.
- No jest-dom. Use `toBeTruthy()`, `toBeNull()`, `toBe()`, `toEqual()`, direct property reads.
- Component test files need `// @vitest-environment jsdom` on line 1.
- Run `npm test` and `npx tsc -b` before committing.

## Decisions taken

| Question | Decision |
|---|---|
| A new `ViewName`? | **No.** `planMode: 'week' \| 'month'` inside Plan. One concept, one nav entry. |
| What a cell shows | Chips — time + title, coloured by project. Not scaled blocks: there is no time axis. |
| Overflow | `+N more`, which switches to that day in **week** mode. No popover — that is a third surface to build and keep. |
| Click an empty cell | Creates at the day's **first free slot** via `createTaskAt`, exactly as the `1`–`7` keyboard placement aims at `dayWindow.startMin`. |
| Drop on a cell | Same: places at the day's first free slot. Create and drop must not disagree about what landing on a day means. |
| Resize in month | Out of scope. There is nothing to resize against. |
| Leading/trailing days | Shown, dimmed, and fully live — they are real days you can plan into. |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/calendar.ts` | Restore | `ymOf`, `shiftYm`, `ymLabel`, `monthGrid` |
| `src/lib/calendar.test.ts` | Restore | Its tests, including year-boundary crossing |
| `src/db/db.ts` | Modify | `loadPlanMode` / `savePlanMode` |
| `src/db/db.test.ts` | Modify | Total-parse coverage for the new key |
| `src/state/store.ts` | Modify | `planMode` state + `setPlanMode` |
| `src/views/plan/MonthGrid.tsx` | Create | The 7×N cell grid |
| `src/views/plan/MonthCell.tsx` | Create | One day: chips, overflow, droppable |
| `src/views/plan/MonthCell.test.tsx` | Create | Chips, overflow, click-to-create |
| `src/views/plan/WeekHeader.tsx` | Modify | The week/month toggle |
| `src/views/Plan.tsx` | Modify | Mode switch, month navigation, month drops |

---

### Task 1: Restore the month grid arithmetic

**Files:**
- Create: `src/lib/calendar.ts`, `src/lib/calendar.test.ts`

Both files existed and were deleted in `04f00e9` ("remove the month calendar and its orphaned helpers") — **because the Today view that used them was deleted, not because they were wrong.** Restore them verbatim; they are pure, tested, and year-safe.

- [ ] **Step 1: Restore both files from history**

```bash
git show 04f00e9^:src/lib/calendar.ts > src/lib/calendar.ts
git show 04f00e9^:src/lib/calendar.test.ts > src/lib/calendar.test.ts
```

- [ ] **Step 2: Run its tests**

```bash
npx vitest run src/lib/calendar.test.ts
```

Expected: PASS (7 tests). They already cover `shiftYm('2026-12', 1) === '2027-01'` and `shiftYm('2026-01', -1) === '2025-12'`, which is the year-crossing this view depends on.

- [ ] **Step 3: Add the note that stops it being deleted again**

Prepend to `src/lib/calendar.ts`:

```ts
/**
 * Month arithmetic for the Plan view's month mode.
 *
 * Deliberately built on real `Date` rollover — `shiftYm` constructs
 * `new Date(y, m - 1 + n, 1)` and lets the platform normalise it, so December
 * → January and January → December cross the year correctly. Do NOT reach for
 * `YEAR`, `DAYS` or `monthFrac` in `./dates`: `YEAR` is pinned to 2026 and
 * `DAYS` has February at 28 with no leap-year case. Those three exist only for
 * the Timeline's year bar and are wrong for anything that navigates.
 *
 * This module was deleted once (04f00e9) along with the Today view that used
 * it. It is pure and has no view of its own; keep it that way.
 */
```

- [ ] **Step 4: Commit**

```bash
npx vitest run src/lib/calendar.test.ts && npx tsc -b
git add src/lib/calendar.ts src/lib/calendar.test.ts
git commit -m "feat(plan): restore the month grid arithmetic"
```

---

### Task 2: `planMode` as a device preference

**Files:**
- Modify: `src/db/db.ts`, `src/db/db.test.ts`, `src/state/store.ts`

**Interfaces:**
- Produces: `loadPlanMode(): Promise<PlanMode>`, `savePlanMode(mode: PlanMode): Promise<void>`, `type PlanMode = 'week' | 'month'`; store state `planMode` and `actions.setPlanMode`.

Which mode you last used is a **device preference**, like `sidebarPanels` and `scale` — not app data. It must not go through `persist()`, which is a full clear + bulkPut of the four data tables.

- [ ] **Step 1: Write the failing test**

Add to `src/db/db.test.ts`, mirroring the existing `sidebarPanels` parse tests:

```ts
describe('planMode preference', () => {
  it('defaults to week when unset', async () => {
    expect(await loadPlanMode()).toBe('week');
  });

  it('round-trips month', async () => {
    await savePlanMode('month');
    expect(await loadPlanMode()).toBe('month');
  });

  it('falls back to week on a malformed value', async () => {
    // Total parse, as parseSidebarPanels and parseAvailability do: a value we
    // do not recognise yields the default rather than a half-trusted one.
    await db.settings.put({ key: 'planMode', value: 'fortnight' });
    expect(await loadPlanMode()).toBe('week');
  });
});
```

Add `loadPlanMode, savePlanMode` to that file's import from `./db`, and `db` if it is not already imported.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/db/db.test.ts -t planMode
```

Expected: FAIL — `loadPlanMode is not a function`.

- [ ] **Step 3: Implement**

In `src/db/db.ts`, after the `sidebarPanels` block:

```ts
/** Which shape the Plan view is in. A device preference, not app data. */
export type PlanMode = 'week' | 'month';

const PLAN_MODE_KEY = 'planMode';

export async function loadPlanMode(): Promise<PlanMode> {
  const row = await db.settings.get(PLAN_MODE_KEY);
  // Total parse: anything unrecognised is the default, not a half-trusted
  // value. Week is the default because it is the only mode that can place
  // work at a time, which is what the view is for.
  return row?.value === 'month' ? 'month' : 'week';
}

export async function savePlanMode(mode: PlanMode): Promise<void> {
  await db.settings.put({ key: PLAN_MODE_KEY, value: mode });
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/db/db.test.ts -t planMode
```

Expected: PASS (3 tests).

- [ ] **Step 5: Add it to the store**

In `src/state/store.ts`: add `planMode: PlanMode;` to `UIState` (near `sidebarPanels`), `planMode: 'week',` to the initial state, load it in `initStore` alongside `loadSidebarPanels`, and add the action beside `setSidebarPanels`:

```ts
  setPlanMode(mode: PlanMode): void {
    set({ planMode: mode });
    ifOwner(() => savePlanMode(mode));
  },
```

Import `loadPlanMode, savePlanMode, type PlanMode` from `../db/db`.

> `ifOwner` is not optional. A tab that does not own the Web Lock never writes — see CLAUDE.md.

- [ ] **Step 6: Commit**

```bash
npm test && npx tsc -b
git add src/db/db.ts src/db/db.test.ts src/state/store.ts
git commit -m "feat(plan): remember which shape the Plan view was in"
```

---

### Task 3: A day cell

**Files:**
- Create: `src/views/plan/MonthCell.tsx`, `src/views/plan/MonthCell.test.tsx`

**Interfaces:**
- Consumes: `projectBlockClass` (`src/lib/projectColour.ts`), `clockLabel` (`src/lib/clock.ts`), `ScheduledItem` (`src/lib/scheduled.ts`), `useDroppable` (dnd-kit).
- Produces:

```tsx
export const MONTH_CHIP_CAP = 3;

export function MonthCell(props: {
  date: string;
  items: ScheduledItem[];
  inMonth: boolean;
  isToday: boolean;
  readOnly?: boolean;
  onCreate: (date: string) => void;
  onOpenDay: (date: string) => void;
}): JSX.Element
```

**Why a cap.** A cell is a fixed fraction of the viewport; an unbounded list would either overflow or shrink every other row. Three plus an overflow row is what fits at the smallest sensible cell height. The overflow **navigates** rather than expanding, because a day with more than three things on it is a day you want to see on a time axis anyway.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/MonthCell.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import { MonthCell, MONTH_CHIP_CAP } from './MonthCell';
import type { ScheduledItem } from '../../lib/scheduled';

afterEach(() => cleanup());

function item(over: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    kind: 'task', id: 't1', goalId: null, goalTitle: '', title: 'Pset',
    done: false, date: '2026-08-05', startMin: 600, endMin: 660, estimated: true,
    ...over,
  } as ScheduledItem;
}

function mount(items: ScheduledItem[], over: Record<string, unknown> = {}) {
  const onCreate = vi.fn();
  const onOpenDay = vi.fn();
  // MonthCell registers a droppable, so it needs a DndContext ancestor.
  render(createElement(DndContext, null, createElement(MonthCell, {
    date: '2026-08-05', items, inMonth: true, isToday: false,
    onCreate, onOpenDay, ...over,
  })));
  return { onCreate, onOpenDay, user: userEvent.setup() };
}

describe('a day in the month grid', () => {
  it('shows its date number', () => {
    mount([]);
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('lists its work as chips', () => {
    mount([item({ title: 'Read Raft' })]);
    expect(screen.getByText('Read Raft')).toBeTruthy();
  });

  it('caps the chips and offers the rest as one row', () => {
    const many = Array.from({ length: MONTH_CHIP_CAP + 2 }, (_, i) =>
      item({ id: `t${i}`, title: `Item ${i}` }));
    mount(many);

    expect(screen.getAllByTestId('month-chip')).toHaveLength(MONTH_CHIP_CAP);
    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('shows no overflow row when everything fits', () => {
    mount([item()]);
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it('opens the day when the overflow row is used', async () => {
    const many = Array.from({ length: MONTH_CHIP_CAP + 1 }, (_, i) =>
      item({ id: `t${i}`, title: `Item ${i}` }));
    const { onOpenDay, user } = mount(many);

    await user.click(screen.getByText('+1 more'));
    expect(onOpenDay).toHaveBeenCalledWith('2026-08-05');
  });

  it('creates when the empty space is clicked', async () => {
    const { onCreate, user } = mount([]);
    await user.click(screen.getByTestId('month-cell-canvas'));
    expect(onCreate).toHaveBeenCalledWith('2026-08-05');
  });

  it('does not create on a past week', async () => {
    const { onCreate, user } = mount([], { readOnly: true });
    await user.click(screen.getByTestId('month-cell-canvas'));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('dims a day belonging to a neighbouring month', () => {
    mount([], { inMonth: false });
    // Still rendered and still live — a leading/trailing day is a real day you
    // can plan into; it is only quieter.
    expect(screen.getByTestId('month-cell').className).toContain('text-faint');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/views/plan/MonthCell.test.tsx
```

Expected: FAIL — cannot resolve `./MonthCell`.

- [ ] **Step 3: Implement**

Create `src/views/plan/MonthCell.tsx`:

```tsx
import { useDroppable } from '@dnd-kit/core';
import { clockLabel } from '../../lib/clock';
import { projectBlockClass } from '../../lib/projectColour';
import type { ScheduledItem } from '../../lib/scheduled';
import { parseD } from '../../lib/dates';

/**
 * How many chips a cell shows before collapsing the rest.
 *
 * A cell is a fixed fraction of the viewport, so an unbounded list either
 * overflows or shrinks every other row. Three plus an overflow row is what
 * fits at the smallest sensible cell height.
 */
export const MONTH_CHIP_CAP = 3;

/**
 * One day of the month grid.
 *
 * Chips, not scaled blocks: a month cell has no time axis, so a height would
 * encode nothing. The chip carries the start time as text instead, and the
 * project's colour so identity survives the change of scale.
 */
export function MonthCell({
  date, items, inMonth, isToday, readOnly, onCreate, onOpenDay,
}: {
  date: string;
  items: ScheduledItem[];
  /** False for the leading/trailing days of neighbouring months. */
  inMonth: boolean;
  isToday: boolean;
  /** True when the day is in a past week — creation is refused, as on the grid. */
  readOnly?: boolean;
  onCreate: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: !!readOnly });
  const shown = items.slice(0, MONTH_CHIP_CAP);
  const hidden = items.length - shown.length;

  return (
    <div
      ref={setNodeRef}
      data-testid="month-cell"
      data-date={date}
      role="group"
      aria-label={`${date}${isToday ? ' — today' : ''}`}
      className={`relative min-w-0 min-h-0 flex flex-col border-l border-t border-line-soft px-[3px] pt-[2px] ${
        inMonth ? 'text-ink' : 'text-faint bg-hover/30'
      } ${isOver && !readOnly ? 'bg-accent/5' : ''}`}
    >
      {/*
        The create target, rendered FIRST so everything below stacks above it
        in paint order. Not `-z-10`: the cell carries its own background, so a
        negative z-index would paint this behind it and swallow every click.
        Same layering rule DayCanvas uses on the week grid — put the canvas
        underneath by DOM order, not by going negative.
      */}
      <button
        type="button"
        data-testid="month-cell-canvas"
        aria-label={`Add work on ${date}`}
        disabled={!!readOnly}
        onClick={() => onCreate(date)}
        className="absolute inset-0 cursor-default disabled:cursor-not-allowed"
      />

      <div className={`relative flex-none text-tiny tabular-nums text-center ${
        isToday ? 'text-accent font-semibold' : ''
      }`}>
        {parseD(date).getDate()}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden space-y-[1px] pt-[1px]">
        {shown.map((it) => (
          <div
            key={`${it.kind}:${it.id}`}
            data-testid="month-chip"
            title={`${it.title} · ${clockLabel(it.startMin)}`}
            className={`truncate rounded-[4px] border-l-[3px] px-[3px] text-badge leading-[1.3] ${
              projectBlockClass(it.goalId)
            } ${it.done ? 'opacity-55 line-through' : ''}`}
          >
            <span className="text-ink-soft tabular-nums mr-[3px]">{clockLabel(it.startMin)}</span>
            {it.title}
          </div>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => onOpenDay(date)}
            className="w-full text-left truncate text-tiny text-muted hover:text-ink px-[3px]"
          >
            +{hidden} more
          </button>
        )}
      </div>

    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/views/plan/MonthCell.test.tsx
```

Expected: PASS (8 tests).

- [ ] **Step 5: Prove the cap bites**

Temporarily change `items.slice(0, MONTH_CHIP_CAP)` to `items`. Re-run. Expected: `caps the chips and offers the rest as one row` FAILS with 5 chips instead of 3. **Revert.**

- [ ] **Step 6: Commit**

```bash
npm test && npx tsc -b
git add src/views/plan/MonthCell.tsx src/views/plan/MonthCell.test.tsx
git commit -m "feat(plan): a month day, as chips"
```

---

### Task 4: The month grid

**Files:** Create `src/views/plan/MonthGrid.tsx`

**Interfaces:**
- Consumes: `monthGrid` (Task 1), `MonthCell` (Task 3).
- Produces:

```tsx
export function MonthGrid(props: {
  ym: string;                              // 'YYYY-MM'
  today: string;
  itemsByDay: Map<string, ScheduledItem[]>;
  isPastDay: (date: string) => boolean;
  onCreate: (date: string) => void;
  onOpenDay: (date: string) => void;
}): JSX.Element
```

**No unit test of its own.** It is a `monthGrid(ym).map()` over `MonthCell` with no branching beyond `inMonth` and `isToday`, both of which Task 3 already covers at the cell. The arithmetic it depends on is tested in `calendar.test.ts`. Adding a test here would assert that `.map` maps.

- [ ] **Step 1: Implement**

```tsx
import { monthGrid, ymOf } from '../../lib/calendar';
import type { ScheduledItem } from '../../lib/scheduled';
import { MonthCell } from './MonthCell';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The month, as a 7-column grid of days.
 *
 * Rows come from `monthGrid`, which is Monday-first and includes the leading
 * and trailing days of the neighbouring months. Those are rendered dimmed but
 * fully live: they are real days, and refusing to plan into the last three
 * days of a month because the grid calls them "next month" would be an
 * artefact of the layout, not a rule about time.
 *
 * Row count comes from `weeks.length` rather than a fixed 6, and the rows are
 * `minmax(0, 1fr)`: a 5-row month and a 6-row month both fill the same space
 * instead of one leaving a gap and the other overflowing.
 */
export function MonthGrid({
  ym, today, itemsByDay, isPastDay, onCreate, onOpenDay,
}: {
  ym: string;
  today: string;
  itemsByDay: Map<string, ScheduledItem[]>;
  isPastDay: (date: string) => boolean;
  onCreate: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const weeks = monthGrid(ym);

  return (
    <div className="flex flex-col min-h-0 border-r border-b border-line-soft">
      <div className="grid grid-cols-7 flex-none">
        {DOW.map((d) => (
          <div key={d} className="text-center font-mono text-tiny tracking-[.12em] uppercase text-muted pb-[4px]">
            {d}
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7 flex-1 min-h-0"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {weeks.flat().map((date) => (
          <MonthCell
            key={date}
            date={date}
            items={itemsByDay.get(date) ?? []}
            inMonth={ymOf(date) === ym}
            isToday={date === today}
            readOnly={isPastDay(date)}
            onCreate={onCreate}
            onOpenDay={onOpenDay}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc -b && npm test
git add src/views/plan/MonthGrid.tsx
git commit -m "feat(plan): the month, as a grid of days"
```

---

### Task 5: Wire the mode into Plan

**Files:** Modify `src/views/Plan.tsx`, `src/views/plan/WeekHeader.tsx`

**Partly testable — use the smoke test.** `src/views/views.smoke.test.ts` **does** render `Plan`, via `renderToStaticMarkup` against a hydrated store. (Earlier plans in this series claim nothing renders Plan; that was wrong, and it is corrected here.)

What that buys and what it does not:

- **It can** assert what Plan *renders*: with `planMode: 'month'` the markup contains the month grid and not the hour axis. Add that.
- **It cannot** test interaction. `renderToStaticMarkup` returns a string — no hydration, no event handlers, no state updates — so the mode toggle's click, the create gesture and the drop path stay manual.

Add to `views.smoke.test.ts`, beside the existing Plan case:

```ts
  it('Plan draws a month when the preference says month', async () => {
    const store = await readyStore();
    store.actions.setPlanMode('month');

    const { Plan } = await import('./Plan');
    const html = renderToStaticMarkup(createElement(Plan));

    // The month's weekday strip, and none of the week grid's hour axis.
    expect(html).toContain('Mon');
    expect(html).not.toContain('8am');
  });
```

> Check `readyStore()`'s helper name and whether it exposes `actions` before writing this — the existing Plan case uses `store.getState()`. If `actions` is not reachable there, seed the mode through the db mock's `loadPlanMode` instead, which is the more honest route anyway since it exercises hydration.

- [ ] **Step 1: The toggle**

In `src/views/plan/WeekHeader.tsx`, add `mode` and `onModeChange` props and render a two-button segmented control beside the `‹ today ›` group:

```tsx
      <div className="flex items-center rounded-field border border-line-2 overflow-hidden">
        {(['week', 'month'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            aria-pressed={mode === m}
            className={`px-[10px] py-[3px] text-ui capitalize min-h-[24px] ${
              mode === m ? 'bg-fill text-bg' : 'text-muted hover:text-ink hover:bg-hover'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
```

> `aria-pressed`, not `role="tab"`: these are two states of one control, and a tablist would promise arrow-key navigation between panels that do not exist as tabpanels.

The header's range label must follow the mode too — `AUG 3 — AUG 9` is a lie when a whole month is on screen. `WeekHeader` takes a `label` string instead of deriving the range itself, and `Plan` passes `planMode === 'month' ? ymLabel(ym) : <the existing range>`. Keep the derivation in `Plan` rather than passing `mode` down and branching inside the header: the header then has one job, which is rendering whatever it is told.

The capacity figures beside it (`58h 1m free · 5h planned`) are **week** figures from `weekCapacity`, so they must be **hidden** in month mode rather than relabelled. A month's capacity is a different computation this plan does not do, and leaving a week's numbers under a month's heading would be the same contradiction the `plannedMin`/`backlogMin` split exists to prevent.

- [ ] **Step 2: Hold the month in Plan**

`weekStart` already exists and is remembered across unmounts. The month derives from it, so there is **one** cursor rather than two that can disagree:

```tsx
  // Derived, not separate state: one cursor for the view. Switching to month
  // shows the month containing the week you were on, and switching back shows
  // the week you left — which is only true because neither is stored twice.
  const ym = ymOf(weekStart);
```

Add the import: `import { ymOf, shiftYm, ymLabel } from '../lib/calendar';`

- [ ] **Step 3: Month navigation**

The header's `‹` / `›` must move a month in month mode. In `Plan.tsx`, where `setWeekStart` is called for navigation, branch on `planMode`:

```tsx
  function shiftCursor(delta: number): void {
    if (planMode === 'month') {
      // First of the shifted month, then back to its Monday — so the week
      // cursor always names a real week that contains the month shown.
      const [y, m] = shiftYm(ym, delta).split('-').map(Number);
      setWeekStart(weekOf(`${y}-${String(m).padStart(2, '0')}-01`));
      return;
    }
    setWeekStart((current) => addDays(current, delta * 7));
  }
```

Use `shiftCursor(±1)` for both the header buttons and the `resolvePlanKey` `'week'` command.

> **`weekOf(first of month)` can land in the previous month** — that is correct and intended. The cursor names a week; `ymOf(weekStart)` is then used only to pick which month to draw, and `monthGrid` renders the month that week belongs to. Check this specifically for a month starting on a Sunday, where the containing week is mostly the previous month.

**If that proves fragile in the manual checks, store `ym` as its own state** rather than deriving it, and accept the two-cursor cost. Do not paper over it with a `+3 days` fudge.

- [ ] **Step 4: Render the mode**

Replace the `<WeekGrid>…</WeekGrid>` block with a branch:

```tsx
          {planMode === 'month' ? (
            <MonthGrid
              ym={ym}
              today={today}
              itemsByDay={scheduledByDay}
              isPastDay={(date) => date < today}
              onCreate={(date) => setMonthDraft(date)}
              onOpenDay={(date) => { actions.setPlanMode('week'); setWeekStart(weekOf(date)); }}
            />
          ) : (
            <WeekGrid …unchanged… />
          )}
```

> `scheduledByDay` is already a `Map<string, ScheduledItem[]>` built by `scheduledByDate`, but **check its range** — it is built for the visible week. For month mode it must cover the whole grid, so widen its input to `monthGrid(ym).flat()` when `planMode === 'month'`. Getting this wrong renders an empty month, silently.

- [ ] **Step 5: Create from a cell**

A month cell has no minute, so creation aims at the day's working start — exactly as the `1`–`7` keyboard placement does (`Plan.tsx`, the `'place'` branch):

```tsx
  const [monthDraft, setMonthDraft] = useState<string | null>(null);
```

Render a small prompt when `monthDraft` is set — reuse `BlockComposer`'s commit rules but not its geometry, since there is no span to position against. Simplest honest version: a one-field inline row at the top of that cell. On commit:

```tsx
    const dayWindow = windowForDate(monthDraft, availability);
    if (!dayWindow) { actions.showToast('No working hours on that day.'); setMonthDraft(null); return; }
    actions.createTaskAt(title, monthDraft, dayWindow.startMin, DEFAULT_SLOT_MIN);
    setMonthDraft(null);
```

`createTaskAt` resolves against the day's real gaps, so this lands at the first free slot rather than on top of existing work.

- [ ] **Step 6: Drops**

`MonthCell`'s droppable id is `day:${date}` — the same format `DayColumn` uses — so `handleDragEnd`'s existing `overId.startsWith('day:')` branch already matches. What it must **not** do in month mode is call `aimMinuteFor`, which reads a scroller that is not rendered. Branch at the top of that block:

```tsx
    if (planMode === 'month') {
      const dayWindow = windowForDate(date, availability);
      if (!dayWindow) { actions.showToast('No working hours on that day.'); return; }
      if (data.kind === 'task') actions.scheduleTask(data.id, date, dayWindow.startMin);
      else if (data.goalId) actions.scheduleNode(data.goalId, data.id, date, dayWindow.startMin);
      return;
    }
```

> Without this, `scrollerRef.current` is null in month mode and the existing `if (!scroller || !translated) return;` silently swallows every month drop. It would look like drag-and-drop simply does not work, with no error.

- [ ] **Step 7: Typecheck, suite, commit**

```bash
npx tsc -b && npm test
git add src/views/Plan.tsx src/views/plan/WeekHeader.tsx
git commit -m "feat(plan): a month mode beside the week"
```

---

### Task 6: Verification sweep

- [ ] **Step 1: Suite, typecheck, build**

```bash
npm test && npx tsc -b && npm run build
```

This plan adds 18 tests (7 restored + 3 + 8).

- [ ] **Step 2: The year-unsafe helpers stayed out**

```bash
grep -n "YEAR\|DAYS\|monthFrac" src/lib/calendar.ts src/views/plan/MonthGrid.tsx src/views/plan/MonthCell.tsx
```

Expected: **no matches.** `YEAR` is pinned to 2026 and `DAYS` has no leap year; a month view that used either would break in January.

- [ ] **Step 3: The preference did not leak into app data**

```bash
grep -n "planMode" src/db/db.ts | grep -i "persist\|bulkPut"
```

Expected: **no matches.** It is a settings key, written through `ifOwner`.

- [ ] **Step 4: Manual checks** — `npm run dev`:

- [ ] Toggle to month → the month containing the week you were on. Toggle back → the same week you left.
- [ ] `‹` and `›` move by one month, and the label follows.
- [ ] **Navigate from December to January** — the year must increment. Then back. This is the case the hardcoded `YEAR` would have broken.
- [ ] A day with work shows chips in the project's colour, matching that project's blocks in week view.
- [ ] A day with more than three shows `+N more`; clicking it lands on that day in week view.
- [ ] Click an empty cell → name it → it appears, and switching to week view shows it at that day's first free hour.
- [ ] Click an empty cell on a **day off** → the "no working hours" toast, and nothing created.
- [ ] Drag a rail item onto a month cell → it schedules. **This is the one most likely to be silently broken** — if nothing happens, Step 6's branch is missing and the drop is being swallowed by the null scroller check.
- [ ] Leading/trailing days from adjacent months are dimmed but still accept a drop.
- [ ] A month that needs six rows (e.g. one starting on a Sunday) fits without scrolling or squashing.
- [ ] Reload → the view comes back in the mode you left it in.

---

## What this plan does NOT do

- Resize, or any duration editing, in month mode — there is no axis for it.
- A day or 3-day view (explicitly out of scope in the grid remaster spec).
- The gutter, the all-day lane, or the capacity wash in month cells — plan 4 covers those for the week grid; whether they belong in a month cell is a separate question.
- Drag **between** month cells to move existing work. Dropping is handled, but a chip is not yet a draggable source; that is a small follow-up once the drop path is proven.
