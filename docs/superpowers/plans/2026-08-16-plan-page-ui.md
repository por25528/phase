# Plan Page UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Plan view a focal point, a capacity readout that works in both week and month mode, dense month cells with a week gutter, and a rail whose structure matches the calendar beside it.

**Architecture:** Everything is a new *reader* of figures `capacity.ts` already
produces. `capacity.ts`, the token scale and the palette are untouched. The one
new arithmetic module (`monthCapacity.ts`) only aggregates existing
`weekCapacity` calls, and lives in the plan view's folder beside
`capacityLabel.ts` because it is a presentation of capacity for one surface,
not a new fact about time.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind (custom token theme),
Vitest + @testing-library/react, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-16-plan-page-ui-design.md`

## Global Constraints

- **Never write a literal hex colour, an arbitrary `text-[Nrem]`, or a corner
  radius outside `[4px]`, `[6px]`, `rounded-field`, `rounded-card`,
  `rounded-full`.** `src/lib/designScale.test.ts` fails the build on all three.
- **`font-disp` (Fraunces) is display-only** and may not be added anywhere in
  this plan. `designScale.test.ts` enforces its allowlist.
- **All-caps travels with `font-mono`.** Uppercase in the UI face is a build
  failure.
- **A section label is `sectionLabel`** from `src/components/sectionLabel.ts` —
  import it, never hand-write the class string.
- **`border-dashed` is reserved** for the drop preview and guessed-hour blocks.
  Do not use it for empty states.
- **Hover-revealed row controls use `.quiet-control`**, never a hand-rolled
  `opacity-0 group-hover:opacity-100`. It needs a literal `group` ancestor
  (`group/name` does not match).
- **`text-faint` is decorative only.** Anything a user must read is `text-muted`
  at minimum — `paletteContrast.test.ts` asserts the AA floor.
- **Do not edit** `designScale.test.ts`, `paletteContrast.test.ts`, or
  `projectColour.test.ts`. If a change requires editing one, the change is
  wrong.
- **Do not modify `src/lib/capacity.ts`.**
- Run `npm test` and `npx tsc -b` before every commit.
- Test command for one file: `npx vitest run --config vitest.config.ts <path>`

---

## File Structure

**Created:**
- `src/views/plan/monthCapacity.ts` — aggregates `weekCapacity` over the month grid's week rows.
- `src/views/plan/monthCapacity.test.ts`
- `src/views/plan/CapacityMeter.tsx` — the stacked bar, presentation only.
- `src/views/plan/MonthGutter.tsx` — the month grid's left week rail.
- `src/views/plan/PlanNotice.tsx` — the single notice slot.
- `src/views/plan/PlanSkeleton.tsx` — the hydration placeholder.

**Modified:**
- `src/views/plan/capacityLabel.ts` — add `capacityMeter`.
- `src/views/plan/capacityLabel.test.ts` — cover it.
- `src/components/Icons.tsx` — add `IconChevronLeft`.
- `src/views/plan/WeekHeader.tsx` — title, meter, nav group; figures in both modes.
- `src/views/plan/MonthGrid.tsx` — gutter column, pass day capacity.
- `src/views/plan/MonthCell.tsx` — density, left-cornered date, today pill, load figure.
- `src/lib/projectColour.ts` — add `projectSpineClass`.
- `src/views/plan/sidebar/Backlog.tsx` — spine, grip removal, group-header route, header total.
- `src/views/plan/sidebar/Habits.tsx` — demote three `bg-ink` buttons, empty-state copy.
- `src/views/Plan.tsx` — wire month capacity, notice slot, skeleton.

---

## Task 1: `capacityMeter` — the bar and the text as one function

**Files:**
- Modify: `src/views/plan/capacityLabel.ts`
- Test: `src/views/plan/capacityLabel.test.ts`

**Interfaces:**
- Consumes: `CapacityFigures`, `isOverCommitted` — both already in `capacityLabel.ts`.
- Produces: `MeterGeometry` interface and `capacityMeter(c)`. Task 2 renders it;
  Task 7's gutter uses it too. Named `MeterGeometry` and **not** `CapacityMeter`
  on purpose: Task 2 adds a *component* called `CapacityMeter`, and a type and a
  component sharing one name across two modules is a collision waiting for the
  first file that imports both.

- [ ] **Step 1: Write the failing tests**

Append to `src/views/plan/capacityLabel.test.ts`. Check the file's existing
imports first and extend the `import { … } from './capacityLabel'` line to
include `capacityMeter` rather than adding a second import statement.

```ts
describe('capacityMeter', () => {
  const base = { freeMin: 600, plannedMin: 0, backlogMin: 0 };

  it('spans freeMin when the week fits', () => {
    const m = capacityMeter({ ...base, plannedMin: 300, backlogMin: 150 });
    expect(m.over).toBe(false);
    expect(m.plannedFrac).toBeCloseTo(0.5);
    expect(m.backlogFrac).toBeCloseTo(0.25);
    // 1.0 means "the mark is the bar's own right edge" — not drawn.
    expect(m.capacityMarkFrac).toBeCloseTo(1);
  });

  it('spans the committed total when over, and marks where free ran out', () => {
    const m = capacityMeter({ freeMin: 600, plannedMin: 700, backlogMin: 100 });
    expect(m.over).toBe(true);
    // D = 800. Segments fill the whole bar.
    expect(m.plannedFrac).toBeCloseTo(0.875);
    expect(m.backlogFrac).toBeCloseTo(0.125);
    expect(m.plannedFrac + m.backlogFrac).toBeCloseTo(1);
    expect(m.capacityMarkFrac).toBeCloseTo(0.75);
  });

  it('never lets the segments exceed the bar', () => {
    for (const c of [
      { freeMin: 0, plannedMin: 300, backlogMin: 0 },
      { freeMin: 60, plannedMin: 0, backlogMin: 999 },
      { freeMin: 1000, plannedMin: 1, backlogMin: 1 },
    ]) {
      const m = capacityMeter(c);
      expect(m.plannedFrac + m.backlogFrac).toBeLessThanOrEqual(1.0000001);
      expect(m.plannedFrac).toBeGreaterThanOrEqual(0);
      expect(m.backlogFrac).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns zeros rather than NaN when there is nothing at all', () => {
    const m = capacityMeter({ freeMin: 0, plannedMin: 0, backlogMin: 0 });
    expect(m.plannedFrac).toBe(0);
    expect(m.backlogFrac).toBe(0);
    expect(m.capacityMarkFrac).toBe(1);
    expect(m.over).toBe(false);
  });

  // The whole reason this function exists: the bar cannot contradict the text.
  it('agrees with isOverCommitted on every input', () => {
    const table = [
      { freeMin: 600, plannedMin: 0, backlogMin: 0 },
      { freeMin: 600, plannedMin: 600, backlogMin: 0 },
      { freeMin: 600, plannedMin: 599, backlogMin: 2 },
      { freeMin: 600, plannedMin: 0, backlogMin: 601 },
      { freeMin: 0, plannedMin: 0, backlogMin: 0 },
      { freeMin: 0, plannedMin: 1, backlogMin: 0 },
    ];
    for (const c of table) {
      expect(capacityMeter(c).over).toBe(isOverCommitted(c));
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/views/plan/capacityLabel.test.ts`
Expected: FAIL — `capacityMeter is not a function` / TS error that it is not exported.

- [ ] **Step 3: Implement it**

Append to `src/views/plan/capacityLabel.ts`:

```ts
/**
 * The header's load bar, as fractions of one track.
 *
 * The bar spans `D = max(freeMin, plannedMin + backlogMin)`, NOT `freeMin`.
 * That single choice is what makes the over-committed case well-defined: with
 * `freeMin` as the denominator the segments run past 1.0 the moment you take on
 * more than you have, and every renderer then has to invent its own clamping.
 * Spanning the larger of the two means the segments always fit exactly, and the
 * over case is expressed by the bar being FULL and by `capacityMarkFrac` moving
 * inward to show where the free time ran out.
 *
 * `over` is `isOverCommitted(c)` — delegated, never recomputed. The bar and the
 * text beside it are read as one statement, so they must be one derivation; a
 * bar reading full above text reading healthy is the planned/to-place
 * contradiction all over again.
 *
 * Note the denominator is `freeMin` and not `weekFreeSplit`'s `leftMin`. Using
 * the remaining-today figure would be more intuitive and would make the bar
 * disagree with its own warn state on every day but Monday, because
 * `isOverCommitted` compares against the whole week's `freeMin`. Two numbers
 * that get compared to each other have to cover the same days.
 */
export interface MeterGeometry {
  /** 0–1 of the bar's width. */
  plannedFrac: number;
  /** 0–1 of the bar's width. */
  backlogFrac: number;
  /**
   * Where free time runs out, as a fraction of the bar. Rendered as a hairline
   * tick, and ONLY when `over` — on a healthy week it is 1.0, which is the
   * bar's own right edge and therefore says nothing.
   */
  capacityMarkFrac: number;
  over: boolean;
}

export function capacityMeter(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'>,
): MeterGeometry {
  const committed = c.plannedMin + c.backlogMin;
  const span = Math.max(c.freeMin, committed);
  // No availability and nothing committed: there is no bar to draw, and
  // dividing by zero here would put NaN into a style attribute.
  if (span <= 0) {
    return { plannedFrac: 0, backlogFrac: 0, capacityMarkFrac: 1, over: false };
  }
  return {
    plannedFrac: c.plannedMin / span,
    backlogFrac: c.backlogMin / span,
    capacityMarkFrac: Math.min(1, c.freeMin / span),
    over: isOverCommitted(c),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run --config vitest.config.ts src/views/plan/capacityLabel.test.ts`
Expected: PASS, all `capacityMeter` cases green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/views/plan/capacityLabel.ts src/views/plan/capacityLabel.test.ts
git commit -m "feat(plan): the load bar and the load text are one derivation"
```

---

## Task 2: `CapacityMeter` component

**Files:**
- Create: `src/views/plan/CapacityMeter.tsx`
- Create: `src/views/plan/CapacityMeter.test.tsx`

**Interfaces:**
- Consumes: `capacityMeter`, `CapacityMeter` (Task 1); `formatMinutes`, `unestimatedLabel` from `capacityLabel.ts`.
- Produces: `<CapacityMeter figures parts unestimated onToggleUnestimated unestimatedOpen spanLabel />`. Task 3 mounts it in the header; Task 7 reuses it for the month.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/CapacityMeter.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CapacityMeter } from './CapacityMeter';

afterEach(cleanup);

const healthy = { freeMin: 600, plannedMin: 300, backlogMin: 60, unestimated: 0, hasData: false };
const over = { freeMin: 600, plannedMin: 700, backlogMin: 100, unestimated: 3, hasData: false };

describe('CapacityMeter', () => {
  it('renders the parts it is given', () => {
    render(<CapacityMeter figures={healthy} parts={['10h free', '5h planned']} />);
    expect(screen.getByText('10h free')).toBeTruthy();
    expect(screen.getByText('5h planned')).toBeTruthy();
  });

  it('hides the capacity tick when the week fits', () => {
    const { container } = render(<CapacityMeter figures={healthy} parts={[]} />);
    expect(container.querySelector('[data-testid="capacity-mark"]')).toBeNull();
  });

  it('shows the capacity tick and warns when over', () => {
    const { container } = render(<CapacityMeter figures={over} parts={[]} />);
    expect(container.querySelector('[data-testid="capacity-mark"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="meter-planned"]')?.className)
      .toContain('bg-warn');
  });

  it('states its span when given one', () => {
    render(<CapacityMeter figures={healthy} parts={[]} spanLabel="Jul 27 – Sep 6" />);
    expect(screen.getByText('Jul 27 – Sep 6')).toBeTruthy();
  });

  it('offers the unestimated count as a button when it can be opened', () => {
    render(
      <CapacityMeter
        figures={over}
        parts={[]}
        unestimatedOpen={false}
        onToggleUnestimated={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /unestimated/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('states the unestimated count as text when there is nowhere to open it', () => {
    render(<CapacityMeter figures={over} parts={[]} />);
    expect(screen.queryByRole('button', { name: /unestimated/i })).toBeNull();
    expect(screen.getByText('3 unestimated')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/views/plan/CapacityMeter.test.tsx`
Expected: FAIL — cannot resolve `./CapacityMeter`.

- [ ] **Step 3: Implement it**

Create `src/views/plan/CapacityMeter.tsx`:

```tsx
import type { CapacityFigures } from './capacityLabel';
import { capacityMeter, unestimatedLabel } from './capacityLabel';

/**
 * The header's load readout: one stacked bar over the figures it summarises.
 *
 * This is PRESENTATION ONLY. Every number it draws arrives already computed —
 * `parts` from `weekLoadParts`, the geometry from `capacityMeter` — so there is
 * no arithmetic here that could drift from the text beside it.
 *
 * Colour fires in exactly one circumstance: `meter.over`. A healthy week is
 * accent-on-track and reads as chrome, which is the point — a bar that is
 * always coloured is a bar nobody looks at.
 *
 * `spanLabel` exists for month mode, where the figure covers the week rows the
 * grid draws rather than the calendar month in the title. A meter that reports
 * a different span from the heading above it has to say so.
 */
export function CapacityMeter({
  figures,
  parts,
  spanLabel,
  unestimatedOpen,
  onToggleUnestimated,
}: {
  figures: CapacityFigures;
  /** Already-formatted phrases, e.g. `weekLoadParts(capacity, today)`. */
  parts: string[];
  /** What the figures cover, when that is not what the heading says. */
  spanLabel?: string;
  unestimatedOpen?: boolean;
  /** Omitted where there is nowhere to open the list (tests, future hosts). */
  onToggleUnestimated?: () => void;
}) {
  const meter = capacityMeter(figures);
  const unestimated = unestimatedLabel(figures);
  const fill = meter.over ? 'bg-warn' : 'bg-accent';

  return (
    <div className="min-w-[180px] max-w-[420px] flex-1">
      <div className="relative h-[6px] rounded-full bg-track overflow-hidden">
        <div className="absolute inset-0 flex">
          <div
            data-testid="meter-planned"
            className={`h-full ${fill}`}
            style={{ width: `${meter.plannedFrac * 100}%` }}
          />
          {/* "To place" is committed but not on the grid, so it is the same
              bar at a lower contrast — not a second colour. `faint-2` is
              decorative here by definition: the figure beside it carries the
              information. */}
          <div
            data-testid="meter-backlog"
            className={`h-full ${meter.over ? 'bg-warn/45' : 'bg-faint-2'}`}
            style={{ width: `${meter.backlogFrac * 100}%` }}
          />
        </div>
        {meter.over && (
          <div
            data-testid="capacity-mark"
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-px bg-panel"
            style={{ left: `${meter.capacityMarkFrac * 100}%` }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-[13px] gap-y-[2px] mt-[6px] text-meta tabular-nums text-muted">
        {parts.map((part) => (
          <span key={part}>{part}</span>
        ))}
        {unestimated && (
          onToggleUnestimated ? (
            <button
              type="button"
              onClick={onToggleUnestimated}
              aria-expanded={unestimatedOpen ?? false}
              title="Show the work that has no estimate"
              className="tabular-nums text-muted underline decoration-dotted underline-offset-[3px] min-h-[24px] inline-flex items-center px-[2px] rounded-[4px] hover:text-ink hover:bg-hover"
            >
              {unestimated}
            </button>
          ) : (
            <span className="tabular-nums">{unestimated}</span>
          )
        )}
        {/* `text-muted`, NOT `text-faint`. This states which days the figures
            cover, and a reader who does not take it in will read a six-week
            total as a month's — it is the opposite of decorative. */}
        {spanLabel && (
          <span className="font-mono text-micro text-muted">{spanLabel}</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run --config vitest.config.ts src/views/plan/CapacityMeter.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc -b && npm test`
Expected: no TS output; suite green.

- [ ] **Step 6: Commit**

```bash
git add src/views/plan/CapacityMeter.tsx src/views/plan/CapacityMeter.test.tsx
git commit -m "feat(plan): a bar that spends colour only when you are over"
```

---

## Task 3: `IconChevronLeft`

**Files:**
- Modify: `src/components/Icons.tsx`

**Interfaces:**
- Produces: `IconChevronLeft(p: IconProps)`. Task 4 uses it.

`Icons.test.tsx` iterates the module's own exports, so this icon is covered by
the existing stroke/grid assertions the moment it is exported. No new test.

- [ ] **Step 1: Add it beside `IconChevronRight`**

In `src/components/Icons.tsx`, immediately after the `IconChevronRight`
function (around line 153), insert:

```tsx
/**
 * Step backwards. The mirror of `IconChevronRight`, written out rather than
 * rotated at the call site: this one is a NAVIGATION control sitting next to
 * its opposite, and a `rotate-180` there would make the pair's markup
 * asymmetric for no reason a reader could see.
 */
export function IconChevronLeft(p: IconProps) {
  return <Icon {...p}><path d="M14.5 5.5L8 12l6.5 6.5" /></Icon>;
}
```

- [ ] **Step 2: Run the icon suite**

Run: `npx vitest run --config vitest.config.ts src/components/Icons.test.tsx`
Expected: PASS. The export-iterating assertions pick up the new icon
automatically and confirm it draws an `<svg>` at the shared stroke and grid.

- [ ] **Step 3: Commit**

```bash
git add src/components/Icons.tsx
git commit -m "feat(icons): a left chevron, so the nav pair is two icons not two glyphs"
```

---

## Task 4: The header — title, meter, nav group, figures in both modes

**Files:**
- Modify: `src/views/plan/WeekHeader.tsx`
- Create: `src/views/plan/WeekHeader.test.tsx`

**Interfaces:**
- Consumes: `CapacityMeter` (Task 2), `IconChevronLeft` (Task 3).
- Produces: `WeekHeader` gains an optional `monthCapacity?: WeekCapacity` and
  `monthSpanLabel?: string`. Task 7 passes them. When absent (week mode) the
  week figures render as before.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/WeekHeader.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WeekHeader } from './WeekHeader';
import type { WeekCapacity } from '../../lib/capacity';

afterEach(cleanup);

const cap: WeekCapacity = {
  days: [
    { date: '2026-08-10', freeMin: 300, plannedMin: 60, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
    { date: '2026-08-11', freeMin: 300, plannedMin: 60, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
  ],
  freeMin: 600, plannedMin: 120, backlogMin: 0, unestimated: 2, hasData: false,
};

const noop = () => {};
const base = {
  weekStart: '2026-08-10',
  today: '2026-08-10',
  isPast: false,
  capacity: cap,
  onPrev: noop, onNext: noop, onToday: noop,
};

describe('WeekHeader', () => {
  it('renders the range as a real heading, not a section label', () => {
    render(<WeekHeader {...base} />);
    const h = screen.getByRole('heading', { level: 2 });
    expect(h.className).toContain('text-h1');
    expect(h.className).not.toContain('uppercase');
  });

  it('gives the nav arrows accessible names', () => {
    render(<WeekHeader {...base} />);
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
  });

  it('names the month on the arrows in month mode', () => {
    render(<WeekHeader {...base} mode="month" monthCapacity={cap} />);
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeTruthy();
  });

  // The bug this whole change exists to fix.
  it('reports capacity in month mode too', () => {
    render(
      <WeekHeader
        {...base}
        mode="month"
        monthCapacity={cap}
        monthSpanLabel="Jul 27 – Sep 6"
      />,
    );
    expect(screen.getByText('Jul 27 – Sep 6')).toBeTruthy();
    expect(screen.getByText('2 unestimated')).toBeTruthy();
  });

  it('says nothing about capacity in month mode until the month figure arrives', () => {
    render(<WeekHeader {...base} mode="month" />);
    // No month capacity handed down ⇒ no week figures relabelled as a month's.
    expect(screen.queryByText('2 unestimated')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/views/plan/WeekHeader.test.tsx`
Expected: FAIL — heading is not level 2 / has no `text-h1`; `Previous week` not found (current label is on a `‹` button but the heading assertions fail first).

- [ ] **Step 3: Rewrite the header**

Replace the whole return block of `src/views/plan/WeekHeader.tsx` (lines 62–127)
with the following, and add the imports listed under it:

```tsx
  const isMonth = mode === 'month';
  const note = calendarAvailable && !isMonth ? capacityNote(capacity) : null;
  /*
   * Month mode reports the MONTH's figures, not the week's.
   *
   * This used to hide every figure behind `!isMonth`, and the reasoning was
   * sound — a week's numbers under a month's heading would be a lie. The fix
   * is not to relabel them but to hand down a real month figure; until one
   * arrives (`monthCapacity` absent) the header still says nothing rather than
   * guessing. See monthCapacity.ts for why that figure covers the week rows
   * drawn rather than the calendar month, and why `monthSpanLabel` therefore
   * has to be on screen beside it.
   */
  const figures = isMonth ? monthCapacity : capacity;
  const parts = isMonth
    ? (monthCapacity ? loadParts(monthCapacity) : [])
    : weekLoadParts(capacity, today);

  return (
    <div className="flex items-start gap-[14px] mb-[12px] flex-wrap">
      <h2 className="text-h1 font-semibold tracking-[-.012em] leading-[1.15] whitespace-nowrap">
        {isMonth ? ymLabel(ymOf(weekStart)) : `${fmtD(weekStart)} – ${fmtD(addDays(weekStart, 6))}`}
      </h2>

      {figures && (
        <CapacityMeter
          figures={figures}
          parts={parts}
          spanLabel={isMonth ? monthSpanLabel : undefined}
          unestimatedOpen={unestimatedOpen}
          onToggleUnestimated={onToggleUnestimated}
        />
      )}

      {note && (
        <span className="text-eyebrow text-muted truncate max-w-[240px]" title={note}>{note}</span>
      )}
      {isPast && (
        <span className="text-meta text-muted italic">past week — read only</span>
      )}

      <span className="flex-1" />

      <div className="flex items-center gap-[8px]">
        {onModeChange && (
          // `aria-pressed`, not `role="tab"`: these are two states of one
          // control, and a tablist would promise arrow-key navigation between
          // tabpanels that do not exist.
          <SegmentedSwitch
            label="Calendar range"
            value={mode}
            options={PLAN_RANGES}
            onChange={onModeChange}
            size="sm"
          />
        )}
        {/*
          One joined group, because these three are one control: step back, go
          home, step forward. As three loose glyphs — two of which were `‹` and
          `›`, typographic characters the subsetted UI face does not carry —
          they read as three unrelated bits of text floating at the page edge.
        */}
        <div className="inline-flex items-center border border-line-2 rounded-field overflow-hidden">
          <button
            type="button"
            onClick={onPrev}
            aria-label={isMonth ? 'Previous month' : 'Previous week'}
            className="text-muted hover:text-ink hover:bg-hover px-[9px] h-[26px] inline-flex items-center"
          >
            <IconChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="text-meta text-muted hover:text-ink hover:bg-hover h-[26px] px-[12px] border-x border-line inline-flex items-center"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label={isMonth ? 'Next month' : 'Next week'}
            className="text-muted hover:text-ink hover:bg-hover px-[9px] h-[26px] inline-flex items-center"
          >
            <IconChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

Update the import block at the top of the file to:

```tsx
import type { WeekCapacity } from '../../lib/capacity';
import type { PlanMode } from '../../db/db';
import { SegmentedSwitch } from '../../components/SegmentedControl';
import { IconChevronLeft, IconChevronRight } from '../../components/Icons';
import { fmtD, addDays } from '../../lib/dates';
import { ymOf, ymLabel } from '../../lib/calendar';
import { weekLoadParts, loadParts, capacityNote } from './capacityLabel';
import { CapacityMeter } from './CapacityMeter';
```

`sectionLabel`, `unestimatedLabel` and `isOverCommitted` are no longer used
here — remove them from the imports. `unestimatedLabel` and the over-commit
colouring now live inside `CapacityMeter`.

Add these two props to the destructured parameter list and its type:

```tsx
  monthCapacity, monthSpanLabel,
```

```tsx
  /**
   * The month's figures, when the grid below is a month. Absent in week mode.
   * A separate prop rather than overloading `capacity`: the two cover
   * different spans, and one variable holding either is how a week's numbers
   * end up under a month's heading.
   */
  monthCapacity?: WeekCapacity;
  /** What `monthCapacity` covers, e.g. `Jul 27 – Sep 6`. */
  monthSpanLabel?: string;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run --config vitest.config.ts src/views/plan/WeekHeader.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Full suite and typecheck**

Run: `npx tsc -b && npm test`
Expected: green. `WeekGrid.centring.test.tsx` and `DayColumn.test.tsx` do not
mount `WeekHeader`, so nothing else should move.

- [ ] **Step 6: Commit**

```bash
git add src/views/plan/WeekHeader.tsx src/views/plan/WeekHeader.test.tsx
git commit -m "feat(plan): the page says its own name, and both modes report load"
```

---

## Task 5: `monthCapacity` — the aggregation whose rows sum to its total

**Files:**
- Create: `src/views/plan/monthCapacity.ts`
- Create: `src/views/plan/monthCapacity.test.ts`

**Interfaces:**
- Consumes: `weekCapacity`, `WeekCapacity` (`lib/capacity.ts`); `monthGrid`
  (`lib/calendar.ts`); `weekOf`, `plannedLeaves` (`lib/plan.ts`);
  `tasksForWeek` (`lib/dailyWork.ts`).
- Produces:

```ts
export interface MonthCapacity {
  rows: MonthCapacityRow[];
  total: WeekCapacity;
  spanLabel: string;
}
export interface MonthCapacityRow {
  week: string;            // the row's Monday, 'YYYY-MM-DD'
  isoWeekLabel: string;    // 'W32'
  capacity: WeekCapacity;
}
export function monthCapacity(input: MonthCapacityInput): MonthCapacity
```

Tasks 6 and 7 consume it.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/monthCapacity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { monthCapacity } from './monthCapacity';
import type { Goal, Task } from '../../db/types';

// AvailabilityWindow.dow is 0 = MONDAY … 6 = Sunday, matching weekDates()
// order — NOT the JS Date convention. 0-4 is Mon-Fri; 1-5 would be Tue-Sat.
const windows = [
  { dow: 0, startMin: 540, endMin: 1020 },
  { dow: 1, startMin: 540, endMin: 1020 },
  { dow: 2, startMin: 540, endMin: 1020 },
  { dow: 3, startMin: 540, endMin: 1020 },
  { dow: 4, startMin: 540, endMin: 1020 },
];

const input = {
  ym: '2026-08',
  goals: [] as Goal[],
  tasks: [] as Task[],
  windows,
  now: { date: '2026-08-16', minute: 600 },
  allDayBlocks: false,
};

describe('monthCapacity', () => {
  it('returns one row per week the grid draws', () => {
    const m = monthCapacity(input);
    // August 2026 starts Sat 1st and ends Mon 31st: 6 Monday-first rows.
    expect(m.rows.length).toBe(6);
    expect(m.rows[0].week).toBe('2026-07-27');
  });

  // THE invariant. If this fails the header and the gutter are lying to each
  // other, which is the entire reason this module exists rather than a
  // month-wide capacity computation.
  it('sums its rows exactly into its total', () => {
    const m = monthCapacity(input);
    const sum = (pick: (c: { freeMin: number; plannedMin: number; backlogMin: number; unestimated: number }) => number) =>
      m.rows.reduce((n, r) => n + pick(r.capacity), 0);
    expect(m.total.freeMin).toBe(sum((c) => c.freeMin));
    expect(m.total.plannedMin).toBe(sum((c) => c.plannedMin));
    expect(m.total.backlogMin).toBe(sum((c) => c.backlogMin));
    expect(m.total.unestimated).toBe(sum((c) => c.unestimated));
  });

  it('labels its span with the first and last day it actually covers', () => {
    const m = monthCapacity(input);
    expect(m.spanLabel).toMatch(/^Jul 27\b/);
    expect(m.spanLabel).toMatch(/Sep 6$/);
  });

  it('counts a straddling week once, in its own row', () => {
    const m = monthCapacity(input);
    const weeks = m.rows.map((r) => r.week);
    expect(new Set(weeks).size).toBe(weeks.length);
  });

  it('handles a five-row month', () => {
    // February 2027 starts Mon 1st and ends Sun 28th — exactly 4 rows.
    const m = monthCapacity({ ...input, ym: '2027-02' });
    expect(m.rows.length).toBe(4);
    expect(m.total.freeMin).toBe(m.rows.reduce((n, r) => n + r.capacity.freeMin, 0));
  });

  it('numbers its rows', () => {
    const m = monthCapacity(input);
    expect(m.rows.every((r) => /^W\d{1,2}$/.test(r.isoWeekLabel))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/views/plan/monthCapacity.test.ts`
Expected: FAIL — cannot resolve `./monthCapacity`.

- [ ] **Step 3: Implement it**

Create `src/views/plan/monthCapacity.ts`:

```ts
import type { AvailabilityWindow, Goal, Task } from '../../db/types';
import { weekCapacity, type Now, type WeekCapacity } from '../../lib/capacity';
import { monthGrid } from '../../lib/calendar';
import { weekOf, plannedLeaves } from '../../lib/plan';
import { tasksForWeek } from '../../lib/dailyWork';
import { fmtD, isoWeekNumber } from '../../lib/dates';

export interface MonthCapacityRow {
  /** The row's Monday, 'YYYY-MM-DD'. */
  week: string;
  /** 'W32' — what the gutter prints. */
  isoWeekLabel: string;
  capacity: WeekCapacity;
}

export interface MonthCapacity {
  rows: MonthCapacityRow[];
  /** The sum of `rows`. See the note below on why this is not the month. */
  total: WeekCapacity;
  /** What `total` covers, e.g. 'Jul 27 – Sep 6'. */
  spanLabel: string;
}

export interface MonthCapacityInput {
  ym: string;
  goals: Goal[];
  tasks: Task[];
  windows: AvailabilityWindow[];
  now: Now;
  allDayBlocks: boolean;
}

/**
 * Capacity for the month grid: one figure per week row, and their sum.
 *
 * ── Why this is the weeks DRAWN and not the calendar month ───────────────────
 *
 * `WeekHeader` used to hide every figure in month mode, and its comment gave
 * the right reason: "A month's capacity is a different computation." It is,
 * and the difficulty is `plannedWeek`. A leaf committed to a week carries no
 * day, so a week straddling 31 July and 2 August has no principled owner for
 * its committed minutes — and whichever month you award them to, the OTHER
 * month's figure stops matching the rows on its own screen.
 *
 * So this does not compute a month. It computes the six (or four, or five)
 * weeks the grid actually draws, and adds them up. The consequences are all
 * the point:
 *
 *  - The gutter rows sum to the header EXACTLY, by construction rather than by
 *    a test that has to keep two computations in step.
 *  - Week-committed work is billed to its own week, the only place it has a
 *    real claim, and is counted once.
 *  - `lib/capacity.ts` is untouched. This is a projection for one surface, not
 *    a new fact about time, which is why it lives in the view folder beside
 *    `capacityLabel.ts` rather than up in `lib`.
 *
 * The cost is that `total` does NOT cover the month named in the heading, and
 * that is precisely what `spanLabel` is for: the header prints it next to the
 * figures, so the reader is never invited to read 'August' onto a number that
 * starts on 27 July. A figure whose span is not the heading's has to say so.
 */
export function monthCapacity(input: MonthCapacityInput): MonthCapacity {
  const { ym, goals, tasks, windows, now, allDayBlocks } = input;
  const grid = monthGrid(ym);
  // `monthGrid` is Monday-first, so the first cell of each row IS that row's
  // Monday — no need to re-derive it. `weekOf` is used anyway as the single
  // definition of "which week is this date in", so a change there cannot leave
  // this module holding a different opinion.
  const weeks = grid.map((row) => weekOf(row[0]));

  const rows: MonthCapacityRow[] = weeks.map((week) => ({
    week,
    isoWeekLabel: `W${isoWeekNumber(week)}`,
    capacity: weekCapacity({
      week,
      windows,
      blocks: [],
      leaves: plannedLeaves(goals, week),
      tasks: tasksForWeek(tasks, week),
      now,
      allDayBlocks,
      hasData: false,
    }),
  }));

  const total: WeekCapacity = {
    days: rows.flatMap((r) => r.capacity.days),
    freeMin: rows.reduce((n, r) => n + r.capacity.freeMin, 0),
    plannedMin: rows.reduce((n, r) => n + r.capacity.plannedMin, 0),
    backlogMin: rows.reduce((n, r) => n + r.capacity.backlogMin, 0),
    unestimated: rows.reduce((n, r) => n + r.capacity.unestimated, 0),
    hasData: false,
  };

  const first = grid[0][0];
  const lastRow = grid[grid.length - 1];
  const last = lastRow[lastRow.length - 1];

  return { rows, total, spanLabel: `${fmtD(first)} – ${fmtD(last)}` };
}
```

- [ ] **Step 4: Check whether `isoWeekNumber` exists**

Run: `grep -n "isoWeekNumber\|weekNumber" src/lib/dates.ts`

If it does not exist, add it to `src/lib/dates.ts` and a case to
`src/lib/dates.test.ts`:

```ts
/**
 * The ISO-8601 week number for a date. Thursday-anchored: the week belongs to
 * whichever year holds its Thursday, which is what stops 29 December landing in
 * week 1 of the wrong year.
 */
export function isoWeekNumber(date: string): number {
  const d = parseD(date);
  const thursday = new Date(d);
  // getDay(): Sunday 0 … Saturday 6. Shift so Monday is 0, then step to Thursday.
  thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(
    firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3,
  );
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}
```

```ts
it('numbers ISO weeks from the Thursday that anchors them', () => {
  expect(isoWeekNumber('2026-01-01')).toBe(1);
  expect(isoWeekNumber('2026-08-10')).toBe(33);
  expect(isoWeekNumber('2027-01-03')).toBe(53);
});
```

Verify the expected numbers against a reference before committing them — if
they differ, trust the reference and correct the test, not the implementation.

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run --config vitest.config.ts src/views/plan/monthCapacity.test.ts src/lib/dates.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b && npm test
git add src/views/plan/monthCapacity.ts src/views/plan/monthCapacity.test.ts src/lib/dates.ts src/lib/dates.test.ts
git commit -m "feat(plan): a month figure whose rows sum to it by construction"
```

---

## Task 6: The month cell — density, corner date, today pill, load figure

**Files:**
- Modify: `src/views/plan/MonthCell.tsx`
- Modify: `src/views/plan/MonthCell.test.tsx`

**Interfaces:**
- Consumes: `DayCapacity` (`lib/capacity.ts`), `formatMinutes`,
  `isOverCommitted`, `dayLoadHint` (`capacityLabel.ts`).
- Produces: `MonthCell` gains `capacity?: DayCapacity`. Task 7 passes it.

- [ ] **Step 1: Write the failing tests**

Append to `src/views/plan/MonthCell.test.tsx`. Read the file first and reuse
its existing render helper and fixtures rather than inventing new ones.

```tsx
const dayCap = (over: boolean) => ({
  date: '2026-08-06',
  freeMin: 300,
  plannedMin: over ? 540 : 180,
  backlogMin: 0,
  unestimated: 0,
  blockedBy: [] as string[],
  hasData: false,
});

describe('MonthCell load figure', () => {
  it('states the planned time for the day', () => {
    render(
      <MonthCell
        date="2026-08-06" items={[]} inMonth isToday={false}
        capacity={dayCap(false)} onCreate={() => {}} onOpenDay={() => {}}
      />,
    );
    expect(screen.getByText('3h')).toBeTruthy();
  });

  it('warns when the day is over-committed', () => {
    const { container } = render(
      <MonthCell
        date="2026-08-06" items={[]} inMonth isToday={false}
        capacity={dayCap(true)} onCreate={() => {}} onOpenDay={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="month-day-load"]')?.className)
      .toContain('text-warn');
  });

  // Same silence rule dayLoadLabel already keeps: an empty day looks empty.
  it('says nothing on a day with nothing planned', () => {
    const { container } = render(
      <MonthCell
        date="2026-08-06" items={[]} inMonth isToday={false}
        capacity={{ ...dayCap(false), plannedMin: 0 }}
        onCreate={() => {}} onOpenDay={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="month-day-load"]')).toBeNull();
  });

  it('marks today with a filled pill rather than coloured text', () => {
    const { container } = render(
      <MonthCell
        date="2026-08-16" items={[]} inMonth isToday
        onCreate={() => {}} onOpenDay={() => {}}
      />,
    );
    const num = container.querySelector('[data-testid="month-day-number"]');
    expect(num?.className).toContain('bg-ink');
    expect(num?.className).not.toContain('text-accent');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/views/plan/MonthCell.test.tsx`
Expected: FAIL — `3h` not found; no `month-day-load`; no `month-day-number`.

- [ ] **Step 3: Rewrite the cell**

Replace the body of `src/views/plan/MonthCell.tsx` from the `useDroppable` line
to the end of the component with:

```tsx
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: !!readOnly });
  const shown = items.slice(0, MONTH_CHIP_CAP);
  const hidden = items.length - shown.length;
  /*
   * The same silence rule `dayLoadLabel` keeps: a day with nothing planned that
   * is not over-committed reports nothing, because an empty cell already looks
   * empty and 42 instances of "0m" is noise on the calmest surface in the app.
   * The figure is `plannedMin` ALONE, not `dayLoadLabel`'s "1h 30m / 6h" — that
   * form is sized for a week column heading and does not fit an 86px cell.
   */
  const over = capacity ? isOverCommitted(capacity) : false;
  const load = capacity && (capacity.plannedMin > 0 || over)
    ? formatMinutes(capacity.plannedMin)
    : null;

  return (
    <div
      ref={setNodeRef}
      data-testid="month-cell"
      data-date={date}
      role="group"
      aria-label={`${date}${isToday ? ' — today' : ''}`}
      className={`relative min-w-0 min-h-0 flex flex-col border-l border-t border-line-soft px-[5px] pt-[4px] ${
        inMonth ? 'text-ink' : 'text-faint bg-hover/30'
      } ${isOver && !readOnly ? 'bg-accent/5' : ''}`}
    >
      {/*
        The create target, rendered FIRST so everything below stacks above it in
        paint order. Not `-z-10`: the cell carries its own background, so a
        negative z-index would paint this behind it and swallow every click.
      */}
      <button
        type="button"
        data-testid="month-cell-canvas"
        aria-label={`Add work on ${date}`}
        disabled={!!readOnly}
        onClick={() => onCreate(date)}
        className="absolute inset-0 cursor-default disabled:cursor-not-allowed"
      />

      {/* Date left, load right. Centring the number was the one thing on this
          grid that no other calendar does — a date is an anchor, and an anchor
          goes in a corner. */}
      <div className="relative flex-none flex items-baseline justify-between gap-[4px]">
        <span
          data-testid="month-day-number"
          className={`text-meta tabular-nums ${
            isToday
              ? 'bg-ink text-paper rounded-full w-[18px] h-[18px] inline-flex items-center justify-center font-semibold -ml-[2px]'
              : 'text-ink-soft'
          }`}
        >
          {parseD(date).getDate()}
        </span>
        {load && (
          <span
            data-testid="month-day-load"
            title={capacity ? dayLoadHint(capacity) : undefined}
            className={`font-mono text-micro tabular-nums ${
              over ? 'text-warn font-semibold' : 'text-muted'
            }`}
          >
            {load}
          </span>
        )}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden space-y-[1px] pt-[2px]">
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
            className="w-full text-left truncate text-meta text-muted hover:text-ink px-[3px]"
          >
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  );
}
```

Add to the props destructure and its type:

```tsx
  date, items, inMonth, isToday, readOnly, capacity, onCreate, onOpenDay,
```

```tsx
  /**
   * This day's figures. Absent in hosts that have none (tests, future
   * callers) — the cell then draws no load and reads exactly as it did before.
   */
  capacity?: DayCapacity;
```

Add the imports:

```tsx
import type { DayCapacity } from '../../lib/capacity';
import { formatMinutes, isOverCommitted, dayLoadHint } from './capacityLabel';
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run --config vitest.config.ts src/views/plan/MonthCell.test.tsx`
Expected: PASS, including the pre-existing cases in the file.

- [ ] **Step 5: Commit**

```bash
npx tsc -b
git add src/views/plan/MonthCell.tsx src/views/plan/MonthCell.test.tsx
git commit -m "feat(plan): a month cell that reports its own load"
```

---

## Task 7: The week gutter, and wiring the month figure through

**Files:**
- Create: `src/views/plan/MonthGutter.tsx`
- Modify: `src/views/plan/MonthGrid.tsx`
- Modify: `src/views/plan/MonthGrid.test.tsx`
- Modify: `src/views/Plan.tsx`

**Interfaces:**
- Consumes: `MonthCapacity`, `MonthCapacityRow` (Task 5); `capacityMeter` (Task 1); `MonthCell.capacity` (Task 6); `WeekHeader.monthCapacity`/`monthSpanLabel` (Task 4).
- Produces: `MonthGrid` gains `capacity?: MonthCapacity` and `onOpenWeek?: (week: string) => void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/views/plan/MonthGrid.test.tsx`:

```tsx
import { monthCapacity } from './monthCapacity';

const cap = monthCapacity({
  ym: '2026-08',
  goals: [], tasks: [],
  windows: [
    // 0 = Monday. See the note in monthCapacity.test.ts.
    { dow: 0, startMin: 540, endMin: 1020 },
    { dow: 1, startMin: 540, endMin: 1020 },
  ],
  now: { date: '2026-08-16', minute: 600 },
  allDayBlocks: false,
});

describe('MonthGrid gutter', () => {
  it('renders one gutter button per week row', () => {
    render(
      <MonthGrid
        ym="2026-08" today="2026-08-16" itemsByDay={new Map()}
        isPastDay={() => false} onCreate={() => {}} onOpenDay={() => {}}
        capacity={cap} onOpenWeek={() => {}}
      />,
    );
    expect(screen.getAllByTestId('month-gutter-row').length).toBe(cap.rows.length);
  });

  it('routes a gutter click to that row’s week', () => {
    const opened: string[] = [];
    render(
      <MonthGrid
        ym="2026-08" today="2026-08-16" itemsByDay={new Map()}
        isPastDay={() => false} onCreate={() => {}} onOpenDay={() => {}}
        capacity={cap} onOpenWeek={(w) => opened.push(w)}
      />,
    );
    fireEvent.click(screen.getAllByTestId('month-gutter-row')[1]);
    expect(opened).toEqual([cap.rows[1].week]);
  });

  it('names each gutter button so it is reachable without a pointer', () => {
    render(
      <MonthGrid
        ym="2026-08" today="2026-08-16" itemsByDay={new Map()}
        isPastDay={() => false} onCreate={() => {}} onOpenDay={() => {}}
        capacity={cap} onOpenWeek={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /^Open week W\d+/ })).toBeTruthy();
  });

  it('draws no gutter when it has no figures', () => {
    render(
      <MonthGrid
        ym="2026-08" today="2026-08-16" itemsByDay={new Map()}
        isPastDay={() => false} onCreate={() => {}} onOpenDay={() => {}}
      />,
    );
    expect(screen.queryAllByTestId('month-gutter-row').length).toBe(0);
  });
});
```

Ensure `fireEvent` and `screen` are imported at the top of the file.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/views/plan/MonthGrid.test.tsx`
Expected: FAIL — `month-gutter-row` not found.

- [ ] **Step 3: Create the gutter**

Create `src/views/plan/MonthGutter.tsx`:

```tsx
import { capacityMeter } from './capacityLabel';
import { formatMinutes } from './capacityLabel';
import type { MonthCapacityRow } from './monthCapacity';

/** The gutter's width, shared with `MonthGrid`'s two grid templates. */
export const MONTH_GUTTER_PX = 44;

/**
 * One week row's summary, and the route into that week.
 *
 * This is the answer to the question month mode exists to ask — "which weeks am
 * I underwater?" — put on the row that IS the week, rather than left to be
 * assembled by eye from seven day figures. It is also the second route into
 * week mode: the range switch is in the far top-right, and the week you want to
 * open is right here under the cursor.
 *
 * A `<button>`, not a click handler on a div: it is real navigation and has to
 * be reachable from the keyboard. The accessible name carries the load, because
 * the bar beside it is decorative and the figure alone would announce as a
 * bare number.
 */
export function MonthGutter({ row, onOpen }: {
  row: MonthCapacityRow;
  onOpen: (week: string) => void;
}) {
  const meter = capacityMeter(row.capacity);
  const planned = formatMinutes(row.capacity.plannedMin);
  const empty = row.capacity.plannedMin === 0 && row.capacity.backlogMin === 0;

  return (
    <button
      type="button"
      data-testid="month-gutter-row"
      onClick={() => onOpen(row.week)}
      aria-label={`Open week ${row.isoWeekLabel} — ${planned} planned`}
      className="group border-b border-line-soft flex flex-col justify-center items-end gap-[2px] pr-[8px] text-right hover:bg-hover"
    >
      {/* `text-muted`, NOT `text-faint`: this names the week and is read.
          Task 2's review caught the identical slip on the header's span
          label — the Global Constraints reserve `faint` for decoration. */}
      <span className="font-mono text-micro tracking-[.08em] text-muted group-hover:text-ink">
        {row.isoWeekLabel}
      </span>
      {/* A week with nothing on it says nothing — the same silence rule the day
          cells keep, for the same reason. */}
      {!empty && (
        <>
          <span
            className={`font-mono text-meta tabular-nums font-semibold ${
              meter.over ? 'text-warn' : 'text-ink'
            }`}
          >
            {planned}
          </span>
          <span aria-hidden="true" className="w-[26px] h-[3px] rounded-full bg-track overflow-hidden">
            <span
              className={`block h-full ${meter.over ? 'bg-warn' : 'bg-accent'}`}
              style={{ width: `${Math.min(1, meter.plannedFrac + meter.backlogFrac) * 100}%` }}
            />
          </span>
        </>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Wire it into `MonthGrid`**

In `src/views/plan/MonthGrid.tsx`, add to the props destructure and type:

```tsx
  ym, today, itemsByDay, isPastDay, capacity, onCreate, onOpenDay, onOpenWeek,
```

```tsx
  /** Per-week figures for the gutter. Absent ⇒ no gutter is drawn. */
  capacity?: MonthCapacity;
  /** Open a week in week mode. Absent ⇒ no gutter is drawn. */
  onOpenWeek?: (week: string) => void;
```

Add imports:

```tsx
import type { DayCapacity } from '../../lib/capacity';
import type { MonthCapacity } from './monthCapacity';
import { MonthGutter, MONTH_GUTTER_PX } from './MonthGutter';
```

Replace the return block with:

```tsx
  const weeks = monthGrid(ym);
  const gutter = capacity && onOpenWeek ? capacity : null;
  const cols = gutter ? `${MONTH_GUTTER_PX}px repeat(7, minmax(0, 1fr))` : 'repeat(7, minmax(0, 1fr))';
  // One flat lookup so a cell's figure costs nothing to find. `monthCapacity`
  // already produced every DayCapacity the grid needs; re-deriving them per
  // cell would be the seven-passes-per-render mistake Plan.tsx's memo block
  // exists to prevent.
  const dayCap = new Map<string, DayCapacity>(
    (capacity?.total.days ?? []).map((d) => [d.date, d]),
  );

  return (
    <div
      data-testid="month-grid"
      className="flex flex-col min-h-0 border-r border-b border-line-soft"
      style={{ height: `${GRID_VIEWPORT_PX}px` }}
    >
      <div className="grid flex-none" style={{ gridTemplateColumns: cols }}>
        {gutter && <span />}
        {DOW.map((d) => (
          <div
            key={d}
            className="text-center font-mono text-micro tracking-[.12em] uppercase text-muted pb-[4px]"
          >
            {d}
          </div>
        ))}
      </div>
      <div
        className="grid flex-1 min-h-0"
        style={{
          gridTemplateColumns: cols,
          gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))`,
        }}
      >
        {weeks.map((row, i) => (
          <Fragment key={row[0]}>
            {gutter && gutter.rows[i] && (
              <MonthGutter row={gutter.rows[i]} onOpen={onOpenWeek!} />
            )}
            {row.map((date) => (
              <MonthCell
                key={date}
                date={date}
                items={itemsByDay.get(date) ?? []}
                capacity={dayCap.get(date)}
                inMonth={ymOf(date) === ym}
                isToday={date === today}
                readOnly={isPastDay(date)}
                onCreate={onCreate}
                onOpenDay={onOpenDay}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
```

Add `Fragment` to the React import at the top of the file:

```tsx
import { Fragment } from 'react';
```

- [ ] **Step 5: Run and watch it pass**

Run: `npx vitest run --config vitest.config.ts src/views/plan/MonthGrid.test.tsx src/views/plan/MonthCell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire `Plan.tsx`**

In `src/views/Plan.tsx`, add the import:

```tsx
import { monthCapacity } from './plan/monthCapacity';
```

After the existing `capacity` computation (around line 170), add:

```tsx
  /*
   * Month mode's figures. Memoised on the data, NOT recomputed per render: this
   * is six `weekCapacity` calls plus six leaf-tree walks, and the now-line ticks
   * every 60 seconds — the exact hazard the memo block above exists for.
   *
   * `now` is rebuilt every render (it closes over `nowMinute`), so it cannot be
   * a dependency; `today` and `nowMinute` are listed instead, which is the same
   * pair it is built from.
   */
  const monthCap = useMemo(
    () => (planMode === 'month'
      ? monthCapacity({ ym, goals, tasks, windows: availability, now: { date: today, minute: nowMinute }, allDayBlocks })
      : null),
    [planMode, ym, goals, tasks, availability, today, nowMinute, allDayBlocks],
  );
```

Pass them to `WeekHeader`:

```tsx
            monthCapacity={monthCap?.total}
            monthSpanLabel={monthCap?.spanLabel}
```

Pass them to `MonthGrid`:

```tsx
              capacity={monthCap ?? undefined}
              onOpenWeek={(week) => { actions.setPlanMode('week'); setWeekStart(week); }}
```

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
npx tsc -b && npm test
git add src/views/plan/MonthGutter.tsx src/views/plan/MonthGrid.tsx src/views/plan/MonthGrid.test.tsx src/views/Plan.tsx
git commit -m "feat(plan): the month says which week is underwater, and opens it"
```

---

## Task 8: `projectSpineClass`

**Files:**
- Modify: `src/lib/projectColour.ts`
- Modify: `src/lib/projectColour.test.ts`

**Interfaces:**
- Produces: `projectSpineClass(goalId: string | null): string`. Task 9 uses it.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/projectColour.test.ts`:

```ts
describe('projectSpineClass', () => {
  it('agrees with projectBlockClass about which hue a project owns', () => {
    for (const id of ['a1b2c3d', 'zzz9999', 'q0w9e8r']) {
      const i = projectColourIndex(id);
      expect(projectSpineClass(id)).toContain(`border-proj-${i}`);
      expect(projectBlockClass(id)).toContain(`border-l-proj-${i}`);
    }
  });

  it('gives a loose task the neutral line, never an invented hue', () => {
    expect(projectSpineClass(null)).toContain('border-line-2');
    expect(projectSpineClass(null)).not.toMatch(/proj-\d/);
  });
});
```

Extend the file's existing import from `./projectColour` to include
`projectSpineClass` and `projectColourIndex`.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/lib/projectColour.test.ts`
Expected: FAIL — `projectSpineClass is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/projectColour.ts`:

```ts
/**
 * The rail's group spine — the same hue that project's blocks wear on the
 * calendar, as a plain left border.
 *
 * Written out in full for the same reason `BLOCK_CLASSES` is: Tailwind's
 * scanner reads source TEXT and cannot evaluate `border-proj-${i}`, so an
 * interpolated class generates no CSS and every spine would render invisible.
 *
 * No fill and no alpha. A block on the calendar is an object and takes a wash;
 * a spine is a grouping mark on a 249px rail, and a tinted background behind
 * four rows of text would be the loudest thing in the sidebar.
 */
const SPINE_CLASSES = [
  'border-proj-0',
  'border-proj-1',
  'border-proj-2',
  'border-proj-3',
  'border-proj-4',
  'border-proj-5',
] as const;

/** Left rail for a rail group belonging to `goalId` (null ⇒ loose tasks). */
export function projectSpineClass(goalId: string | null): string {
  return goalId === null ? 'border-line-2' : SPINE_CLASSES[projectColourIndex(goalId)];
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run --config vitest.config.ts src/lib/projectColour.test.ts`
Expected: PASS, including the pre-existing contrast assertions.

- [ ] **Step 5: Commit**

```bash
npx tsc -b
git add src/lib/projectColour.ts src/lib/projectColour.test.ts
git commit -m "feat(plan): the rail's spine is the calendar's hue"
```

---

## Task 9: The rail — spine, grip removal, group-header route, header total

**Files:**
- Modify: `src/views/plan/sidebar/Backlog.tsx`
- Create: `src/views/plan/sidebar/Backlog.test.tsx`

**Interfaces:**
- Consumes: `projectSpineClass` (Task 8), `formatMinutes` (`capacityLabel.ts`), `IconArrowUpRight` (`Icons.tsx`), `actions.openProject`.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/sidebar/Backlog.test.tsx`.

The `dbMocks` block is copied verbatim from
`src/views/plan/UnestimatedPanel.test.tsx` lines 17–62 — copy it from there
rather than retyping it, so a new persistence key added to `db.ts` breaks both
files at once instead of only one.

`column: 0` puts the goal in the **Now** horizon. `backlogGroups` is scoped to
`PLANNING_HORIZONS` (Now and Next), so a fixture without it produces an empty
rail and every assertion below passes vacuously.

The `DndContext` wrapper is required: `BacklogRow` calls `useDraggable`, and
without a provider its listeners resolve to no-ops — the rows would render but
`data-backlog-row` focus behaviour would silently differ from the real app.

```tsx
// @vitest-environment jsdom
import { createElement } from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Task } from '../../../db/types';

// ── copy dbMocks + vi.mock + matchMedia stub from
//    src/views/plan/UnestimatedPanel.test.tsx lines 17–62, adjusting the mock
//    paths from '../../db/db' to '../../../db/db' and '../../lib/tabLock' to
//    '../../../lib/tabLock'. ──

const WEEK = '2026-08-10';
const TODAY = '2026-08-12';

const PROJECT: Goal = {
  id: 'g1',
  title: 'Studying Roblox',
  column: 0, // Now — inside PLANNING_HORIZONS, or the rail is empty
  nodes: [
    { id: 'n1', title: 'Break each topic into daily study goals', estimateMin: 45 },
    { id: 'n2', title: 'Estimate time for each study goal', estimateMin: 60 },
  ],
};

const LOOSE: Task = { id: 't1', title: 'Buy a new keyboard', done: false };

type Store = typeof import('../../../state/store');

async function mountRail(
  seed: { goals: Goal[]; tasks: Task[] },
): Promise<{ store: Store; user: ReturnType<typeof userEvent.setup> }> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(seed.goals), habits: [], tasks: structuredClone(seed.tasks), sessions: [],
  });
  const store = await import('../../../state/store');
  await store.initStore();
  const { Backlog } = await import('./Backlog');
  render(
    createElement(
      DndContext,
      null,
      createElement(Backlog, {
        weekStart: WEEK, today: TODAY, onFocusItem: () => {}, reveal: null,
      }),
    ),
  );
  return { store, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('the backlog rail', () => {
  it('opens the project from the group header', async () => {
    const { store, user } = await mountRail({ goals: [PROJECT], tasks: [] });
    await user.click(
      screen.getByRole('button', { name: 'Open project “Studying Roblox”' }),
    );
    expect(store.getState().openGoalId).toBe('g1');
  });

  it('leaves the loose-task group inert — it has no project to open', async () => {
    await mountRail({ goals: [], tasks: [LOOSE] });
    expect(screen.getByText('Loose tasks')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open project/ })).toBeNull();
  });

  it('states the rail total as a count and a time', async () => {
    await mountRail({ goals: [PROJECT], tasks: [] });
    // 45 + 60 = 1h 45m across 2 items.
    expect(screen.getByText('2 · 1h 45m')).toBeTruthy();
  });

  it('states a bare count when nothing carries an estimate', async () => {
    await mountRail({ goals: [], tasks: [LOOSE] });
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  // NOTE: an earlier draft asserted `querySelectorAll('svg circle')` was empty
  // to prove the grip glyph is gone. DROPPED in pre-flight review, and do not
  // reinstate it: it passes only because no OTHER circle-bearing icon
  // (IconClock, IconDots, IconCircle, IconSearch) happens to sit in the rail
  // today, so adding one next month breaks a test whose failure message talks
  // about circles. Removing a decorative glyph is a visual fact and Task 12's
  // visual pass covers it.

  it('still deletes a loose task from the row', async () => {
    const { store, user } = await mountRail({ goals: [], tasks: [LOOSE] });
    await user.click(screen.getByRole('button', { name: 'Delete "Buy a new keyboard"' }));
    expect(store.getState().tasks.find((t) => t.id === 't1')).toBeUndefined();
  });

  it('offers no delete on a goal leaf — it is deleted where its tree is visible', async () => {
    await mountRail({ goals: [PROJECT], tasks: [] });
    expect(screen.queryByRole('button', { name: /^Delete "/ })).toBeNull();
  });
});
```

If `store.getState().openGoalId` is not the field `openProject` sets, read
`src/state/store.ts:3017` and assert on whatever it actually writes — do not
change `openProject` to match the test.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/views/plan/sidebar/Backlog.test.tsx`
Expected: FAIL — no `Open project` button.

- [ ] **Step 3: Remove the grip from `BacklogRow`**

Delete this block from `BacklogRow`'s JSX:

```tsx
      <span aria-hidden="true" className="flex-none text-faint-2">
        <IconGrip size={12} />
      </span>
```

Remove `IconGrip` from the `Icons` import on line 12.

Replace the row's doc comment paragraph beginning "It DOES carry a grip,
reversing the earlier call here…" with:

```
 * It carries NO grip, which reverses the reversal recorded here before it. The
 * argument for the glyph was that `cursor-grab` "only says it once the pointer
 * is already on the row", and that is still true — but the group SPINE now
 * makes the same statement statically, and groups the rows while doing it, so
 * the glyph was the second mark saying one thing. Removing it returns 18px to a
 * 249px row, which is the difference between one line and two for most titles;
 * `showPlanHint` still names both routes in a sentence until the first
 * placement retires it.
```

- [ ] **Step 4: Add the total and the spine**

Replace the `<h3>` header block with:

```tsx
      <h3 className={`flex items-baseline gap-[6px] py-[6px] px-[6px] ${sectionLabel}`}>
        <span className="flex-1">To plan</span>
        {/* Count AND time. The count alone cannot be checked against the
            header's meter, and those two figures being comparable is the point
            of showing either. Summed over `items`, never `shown`, for the same
            reason the count is. */}
        <span className="text-muted tabular-nums">
          {totalMin > 0 ? `${total} · ${formatMinutes(totalMin)}` : total}
        </span>
      </h3>
```

Add above the `return`, beside the existing `total`:

```tsx
  const totalMin = groups.reduce(
    (sum, g) => sum + g.items.reduce((n, it) => n + (it.estimateMin ?? 0), 0),
    0,
  );
```

Replace the group `map` body with:

```tsx
        capped.map((group, i) => (
          <div
            key={group.key}
            className={`border-l-2 ml-[6px] pl-[7px] ${projectSpineClass(group.goalId)} ${
              i === 0 ? '' : 'mt-[14px]'
            }`}
          >
            <div className="flex items-baseline gap-[6px] pr-[6px]">
              {/*
                The project's name is the route to the project. A rail row has
                never had one — the only way to reach the tree a step belongs to
                was to leave for Goals and find it — and the name was already
                sitting here doing nothing. One control per GROUP rather than a
                `⋯` on every row, which is less UI for the same capability.
              */}
              {group.goalId ? (
                <button
                  type="button"
                  onClick={() => actions.openProject(group.goalId!)}
                  title={group.goalTitle}
                  aria-label={`Open project “${group.goalTitle}”`}
                  className="group flex items-center gap-[4px] flex-1 min-w-0 text-body font-semibold text-ink text-left rounded-[4px] hover:text-accent"
                >
                  <span className="truncate">{group.goalTitle}</span>
                  <span aria-hidden="true" className="quiet-control flex-none text-faint">
                    <IconArrowUpRight size={11} />
                  </span>
                </button>
              ) : (
                <span title={group.goalTitle} className="text-body font-semibold text-ink flex-1 min-w-0 truncate">
                  {group.goalTitle}
                </span>
              )}
              {group.goalId && (
                <span className="flex-none font-mono text-eyebrow text-muted tabular-nums">
                  {group.pct}%
                </span>
              )}
            </div>
            {group.shown.map((item) => (
              <BacklogRow
                key={`${item.kind}:${item.id}`}
                item={item}
                onFocusItem={onFocusItem}
                revealed={reveal?.kind === item.kind && reveal.id === item.id}
                today={today}
              />
            ))}
            {group.expandable && (
              <button
                type="button"
                onClick={() => toggle(group.key)}
                className="px-[6px] py-[3px] min-h-[24px] inline-flex items-center text-meta text-muted hover:text-ink rounded-[6px] hover:bg-hover"
              >
                {group.hidden > 0 ? `+${group.hidden} more` : 'Show less'}
              </button>
            )}
          </div>
        ))
```

Add to the imports:

```tsx
import { IconArrowUpRight, IconCheck, IconX } from '../../../components/Icons';
import { projectSpineClass } from '../../../lib/projectColour';
import { formatMinutes } from '../capacityLabel';
```

- [ ] **Step 5: Run and watch it pass**

Run: `npx vitest run --config vitest.config.ts src/views/plan/sidebar/Backlog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
npx tsc -b && npm test
git add src/views/plan/sidebar/Backlog.tsx src/views/plan/sidebar/Backlog.test.tsx
git commit -m "feat(plan): the rail wears the calendar's colours, and its names are doors"
```

---

## Task 10: Demote the rail's filled buttons

**Files:**
- Modify: `src/views/plan/sidebar/Habits.tsx`

`App.tsx:475` says of the app header's `+ New task`: *"The one filled control in
the header, and the only one that writes anything."* `Habits.tsx` renders three
more `bg-ink text-paper` buttons inside the rail, so that claim is false on this
page. This restores it.

- [ ] **Step 1: Demote the three buttons**

At `src/views/plan/sidebar/Habits.tsx` lines 97, 204 and 361, replace

```
className="… rounded-field bg-ink text-paper text-ui font-semibold hover:bg-ink-hover …"
```

with

```
className="… rounded-field border border-line-2 bg-panel text-ink-soft text-ui font-semibold hover:bg-hover hover:text-ink …"
```

preserving each button's existing padding and layout classes exactly.

- [ ] **Step 2: Relabel and ice the empty state**

Change the line-361 button's content from `+ Habit` to:

```tsx
          <IconPlus size={12} />
          New habit
```

and add `inline-flex items-center gap-[5px]` to its class list. Import
`IconPlus` from `../../../components/Icons`.

Replace the empty-state copy — currently italic prose reading `No habits yet.
Add one to start a streak.` — with:

```tsx
        <p className="px-[6px] text-body text-muted">
          Habits repeat on a schedule and build a streak.
        </p>
```

Not italic, and `text-muted` rather than `text-faint`: it is text a user reads,
so it takes the tone that clears AA. It states what the thing IS rather than
that it is absent, because the button beside it already offers the action.

- [ ] **Step 3: Verify no `bg-ink` button survives in the rail**

Run: `grep -n "bg-ink" src/views/plan/sidebar/Habits.tsx`
Expected: only the cadence-toggle selected state at line ~63 (`cadence === c ?
'bg-ink text-paper' : …`), which is a *selected segment*, not a commit button —
leave it.

- [ ] **Step 4: Suite, typecheck, commit**

```bash
npx tsc -b && npm test
git add src/views/plan/sidebar/Habits.tsx
git commit -m "fix(plan): one filled control per screen, and it is not + Habit"
```

---

## Task 11: The notice slot and the skeleton

**Files:**
- Create: `src/views/plan/PlanNotice.tsx`
- Create: `src/views/plan/PlanSkeleton.tsx`
- Create: `src/views/plan/PlanNotice.test.tsx`
- Modify: `src/views/Plan.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/PlanNotice.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanNotice } from './PlanNotice';

afterEach(cleanup);

describe('PlanNotice', () => {
  it('shows the availability notice when hours are unset', () => {
    render(<PlanNotice needsHours showHint onOpenSettings={() => {}} />);
    expect(screen.getByRole('button', { name: 'Set your working hours' })).toBeTruthy();
  });

  // Both at once used to render two identical bordered boxes stacked, pushing
  // the grid down. Availability wins: it describes a state that makes the
  // hint's advice impossible to follow.
  it('shows only the availability notice when both apply', () => {
    render(<PlanNotice needsHours showHint onOpenSettings={() => {}} />);
    expect(screen.queryByText(/onto a day/)).toBeNull();
  });

  it('shows the hint when hours are set', () => {
    render(<PlanNotice needsHours={false} showHint onOpenSettings={() => {}} />);
    expect(screen.getByText(/onto a day/)).toBeTruthy();
  });

  it('renders nothing when neither applies', () => {
    const { container } = render(
      <PlanNotice needsHours={false} showHint={false} onOpenSettings={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/views/plan/PlanNotice.test.tsx`
Expected: FAIL — cannot resolve `./PlanNotice`.

- [ ] **Step 3: Create both components**

Create `src/views/plan/PlanNotice.tsx`:

```tsx
/**
 * The plan view's one notice slot.
 *
 * These were two separately-rendered boxes wearing the same border, the same
 * padding and the same tone, and nothing stopped them stacking — which pushed
 * the calendar down by two rows and made the page's first impression a pile of
 * advice. At most one shows now, and availability outranks the hint because it
 * describes a state in which the hint's instruction cannot be carried out: you
 * cannot drag anything onto a day when every day is off.
 *
 * Neither is dismissible, and neither needs to be: both retire themselves the
 * moment their condition is met.
 */
export function PlanNotice({ needsHours, showHint, onOpenSettings }: {
  needsHours: boolean;
  showHint: boolean;
  onOpenSettings: () => void;
}) {
  if (needsHours) {
    return (
      <div className="mb-[10px] px-[10px] py-[8px] rounded-field border border-line-2 bg-panel text-body text-ink-soft">
        No working hours set — every day is off, so nothing can be scheduled.{' '}
        <button
          type="button"
          onClick={onOpenSettings}
          className="font-semibold text-accent hover:text-accent-deep"
        >
          Set your working hours
        </button>
      </div>
    );
  }
  if (!showHint) return null;
  return (
    <div className="mb-[10px] px-[10px] py-[8px] rounded-field border border-line-2 bg-panel text-body text-ink-soft">
      Drag anything from <span className="font-semibold text-ink">To plan</span> onto a day
      to schedule it — or click a row and press{' '}
      <kbd className="font-mono text-kbd border border-line-2 rounded-[4px] px-[4px] py-[1px] text-muted">1</kbd>
      –
      <kbd className="font-mono text-kbd border border-line-2 rounded-[4px] px-[4px] py-[1px] text-muted">7</kbd>{' '}
      for Mon–Sun.
    </div>
  );
}
```

Create `src/views/plan/PlanSkeleton.tsx`:

```tsx
import { GRID_VIEWPORT_PX } from '../../lib/grid';

/**
 * What Plan shows before hydration.
 *
 * A skeleton is a SURFACE, not three bars of ink — the lesson the shelf's
 * skeleton already learned. So this mirrors the real layout: the 272px rail
 * column, the divider, the header strip and one grid-sized block. Its job is to
 * stop the page jumping when the data lands, which a centred "Loading…" cannot
 * do because it occupies none of the space the calendar is about to claim.
 */
export function PlanSkeleton() {
  return (
    <div role="status" aria-label="Loading your plan" className="grid grid-cols-1 md:grid-cols-[272px_1fr] gap-[18px] md:gap-0">
      <div className="min-w-0 md:relative md:border-r md:border-line">
        <div className="flex flex-col gap-[8px] md:pr-[18px]">
          <div className="h-[14px] w-[80px] rounded-[4px] bg-fill/10" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[22px] rounded-[6px] bg-fill/10" />
          ))}
        </div>
      </div>
      <div className="min-w-0 md:pl-[18px]">
        <div className="flex items-center gap-[14px] mb-[12px]">
          <div className="h-[24px] w-[160px] rounded-[6px] bg-fill/10" />
          <div className="h-[6px] flex-1 max-w-[420px] rounded-full bg-fill/10" />
        </div>
        <div className="rounded-card bg-fill/5" style={{ height: `${GRID_VIEWPORT_PX}px` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire them into `Plan.tsx`**

Replace the hydration guard (lines 527–529):

```tsx
  if (hydration !== 'ready') return <PlanSkeleton />;
```

Replace the two inline notice blocks (the `availability.length === 0` block and
the `planHint` block) with the single:

```tsx
          <PlanNotice
            needsHours={availability.length === 0}
            showHint={planHint}
            onOpenSettings={onOpenSettings}
          />
```

Add the imports:

```tsx
import { PlanNotice } from './plan/PlanNotice';
import { PlanSkeleton } from './plan/PlanSkeleton';
```

- [ ] **Step 5: Run and watch it pass**

Run: `npx vitest run --config vitest.config.ts src/views/plan/PlanNotice.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
npx tsc -b && npm test
git add src/views/plan/PlanNotice.tsx src/views/plan/PlanSkeleton.tsx src/views/plan/PlanNotice.test.tsx src/views/Plan.tsx
git commit -m "feat(plan): one notice at a time, and a skeleton shaped like the page"
```

---

## Task 12: Verify against the real app

**Files:** none — this is the check that the preceding eleven tasks produced
something a person can use.

- [ ] **Step 1: Full suite and typecheck**

```bash
npm test && npx tsc -b && npm run build
```
Expected: all green, build succeeds.

- [ ] **Step 2: Confirm the guards never moved**

```bash
git diff --stat main -- src/lib/designScale.test.ts src/lib/paletteContrast.test.ts src/lib/capacity.ts
```
Expected: **empty output.** Any change to these means a constraint was worked
around rather than met — stop and report it.

- [ ] **Step 3: Look at it**

Run the app (`npm run dev`) and check, in both light and dark:

- Week mode: title reads as the page's first thing; meter shows planned/to-place
  over free; over-committing a week turns the bar `warn` **and** the text at the
  same moment.
- Month mode: figures are present; the span label reads e.g. `Jul 27 – Sep 6`
  and is not mistakable for the heading; gutter shows a total per row; clicking
  a gutter row lands in that week.
- Rail: spines match the colour of the same project's blocks on the grid; no
  grip glyphs; clicking a project name opens it; `+` button is no longer filled.
- Reload with a throttled connection: the skeleton occupies the calendar's
  space and the page does not jump when data lands.

- [ ] **Step 4: Report**

State plainly what works and what does not. If a visual does not match the
approved mockups, say so rather than adjusting the spec to fit what was built.

---

## Self-Review Notes

**Spec coverage.** §1 → Tasks 1–4. §2 → Task 5. §3 → Tasks 6–7. §4 → Tasks
8–10. §5 → Task 11. Invariant 4 (one filled control) → Task 10.

**Known gap, deliberate:** the spec's §4 mentions the rail header total should
derive from "the same `weekCapacity` the header meter uses". Task 9 sums
`estimateMin` over `groups` instead, because `backlogGroups` and `weekCapacity`
are scoped differently — the rail is unplaced work for the *visible week*,
`backlogMin` is committed-not-placed. Summing the rail's own items is the
figure that matches the rows beneath it, which is the property that matters.
Flagged here rather than silently diverging.
