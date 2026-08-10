# Today remaster and the shared `TaskRow` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Phase one list-row primitive with deliberate states, adopt it on Today's two task lists, and make the now-boundary a legible time marker instead of an unlabelled accent hairline.

**Architecture:** `TaskRow` is a presentational shell in `src/components/`. It solves the one structural problem Today has: a row needs BOTH an interactive leading control (the checkbox) and a full-row click target, which cannot be a button inside a button. The row therefore renders the title as a single `<button>` carrying an absolutely-positioned overlay that stretches across the row, with the lead control as a sibling raised above it. One focusable element per row, a full-row hit area, no nested interactives. `NowDivider` is split out as a pure component so the boundary label is testable without mounting Today and its store harness.

**Tech Stack:** React 19, TypeScript, Tailwind 3, Vitest + @testing-library/react (jsdom).

## Global Constraints

Copied from `CLAUDE.md` and enforced by `src/lib/designScale.test.ts` — the build fails on any of these:

- No arbitrary font sizes. Use a named `fontSize` key from `tailwind.config.js` (`meta`, `ui`, `body`, `lead`, …). Never `text-[0.8rem]`.
- Radii: only `rounded-[4px]`, `rounded-[6px]`, `rounded-[11px]`, `rounded-field` (9px), `rounded-card` (14px).
- No literal hex / `rgb()` / `hsl()` colours. Theme tokens only.
- No Unicode icon glyphs (`✕✓✎▶◆◇⠿⋯✦⚠⌕＋`). Use `src/components/Icons.tsx`.
- `font-disp` may appear only in `App.tsx`. `uppercase` only in `views/plan/MonthGrid.tsx`, `views/plan/WeekGrid.tsx`, `views/timeline/DaysLane.tsx`.
- `border-dashed` only in `views/plan/DayColumn.tsx` and `views/plan/EventBlock.tsx`.
- Every class declared in `index.css` must be applied by some markup.
- Hover-revealed controls use `.quiet-control`, never a hand-rolled `opacity-0 group-hover:opacity-100`. It requires a literal `group` ancestor (`group/name` does not match).
- A section label is `text-meta font-semibold text-muted`, sentence case. Do not enlarge Today's section headings.
- `jest-dom` is NOT installed. Assert with plain DOM reads (`el.textContent`, `el.className`, `el.getAttribute(...)`), never `expect(el).toBeInTheDocument()`.
- Run `npm test` and `npx tsc -b` before every commit.

**Baseline before starting:** `tsc -b` clean, 123 test files, 2404 tests passing.

---

### Task 1: The `TaskRow` primitive

**Files:**
- Create: `src/components/TaskRow.tsx`
- Test: `src/components/TaskRow.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TaskRow`, a React component with this exact prop type, relied on by Tasks 3 and 4:

```ts
export interface TaskRowProps {
  title: string;
  subtitle?: string;
  /** Interactive leading control (a checkbox). Rendered ABOVE the row overlay. */
  lead?: React.ReactNode;
  /** Fixed-width tabular time cell, e.g. "14:00". Reserves width only when given. */
  time?: string;
  /** Trailing metadata — reason chips, due chips, estimates. Not interactive. */
  meta?: React.ReactNode;
  /** Activates the row. Renders the title as a button stretched across the row. */
  onOpen?: () => void;
  /** Accessible name for the row button. Defaults to `title`. */
  ariaLabel?: string;
  completed?: boolean;
}
```

- [ ] **Step 1: Write the failing test**

Create `src/components/TaskRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskRow } from './TaskRow';

afterEach(cleanup);

/**
 * A row needs an interactive checkbox AND a full-row click target. A button
 * inside a button is invalid and swallows the inner control's label, so the
 * row stretches ONE button across itself and raises the lead control above it.
 * These tests pin that shape, because it is the whole reason the component
 * exists rather than each surface hand-rolling its own row.
 */
describe('TaskRow', () => {
  it('renders the title and subtitle', () => {
    render(<TaskRow title="A Tour of Computer Systems" subtitle="CS:APP" />);
    expect(screen.getByText('A Tour of Computer Systems')).toBeTruthy();
    expect(screen.getByText('CS:APP')).toBeTruthy();
  });

  it('calls onOpen when the row is activated', () => {
    const onOpen = vi.fn();
    render(<TaskRow title="Read chapter 1" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Read chapter 1' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('never nests the lead control inside the row button', () => {
    render(
      <TaskRow
        title="Read chapter 1"
        onOpen={() => {}}
        lead={<button type="button" aria-label="Mark done" />}
      />,
    );
    const rowButton = screen.getByRole('button', { name: 'Read chapter 1' });
    const lead = screen.getByRole('button', { name: 'Mark done' });
    expect(rowButton.contains(lead)).toBe(false);
  });

  it('does not open the row when the lead control is clicked', () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <TaskRow
        title="Read chapter 1"
        onOpen={onOpen}
        lead={<button type="button" aria-label="Mark done" onClick={onToggle} />}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('prefers an explicit ariaLabel over the title', () => {
    render(<TaskRow title="Read chapter 1" ariaLabel="Plan “Read chapter 1” tomorrow" onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Plan “Read chapter 1” tomorrow' })).toBeTruthy();
  });

  it('renders a static row with no button when onOpen is absent', () => {
    render(<TaskRow title="Read chapter 1" />);
    expect(screen.queryByRole('button')).toBe(null);
  });

  it('marks a completed row without hiding its text', () => {
    render(<TaskRow title="Read chapter 1" completed />);
    const title = screen.getByText('Read chapter 1');
    expect(title.className).toContain('line-through');
  });

  it('reserves the time cell only when a time is given', () => {
    const { container: withTime } = render(<TaskRow title="A" time="14:00" />);
    expect(withTime.textContent).toContain('14:00');
    cleanup();
    const { container: without } = render(<TaskRow title="A" />);
    expect(without.querySelector('[data-row-time]')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/TaskRow.test.tsx`
Expected: FAIL — `Failed to resolve import "./TaskRow"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/TaskRow.tsx`:

```tsx
import type { ReactNode } from 'react';

export interface TaskRowProps {
  title: string;
  subtitle?: string;
  /** Interactive leading control (a checkbox). Rendered ABOVE the row overlay. */
  lead?: ReactNode;
  /** Fixed-width tabular time cell, e.g. "14:00". Reserves width only when given. */
  time?: string;
  /** Trailing metadata — reason chips, due chips, estimates. Not interactive. */
  meta?: ReactNode;
  /** Activates the row. Renders the title as a button stretched across the row. */
  onOpen?: () => void;
  /** Accessible name for the row button. Defaults to `title`. */
  ariaLabel?: string;
  completed?: boolean;
}

/**
 * One list row, for every surface that lists work.
 *
 * Today alone hand-rolled three of these — a commitment row, an offer row and
 * the card in `Now` — which is how the same page ended up with a hover
 * background on one list and none on the list above it.
 *
 * The shape is dictated by one constraint: a row needs an interactive leading
 * control AND a full-row click target, and `<button>` inside `<button>` is
 * invalid — it swallows the inner control's accessible name. So the title is
 * the ONLY button and it carries an absolutely-positioned overlay stretched
 * across the row; the lead control is a sibling raised above that overlay.
 * One focusable element, a full-row target, no nesting.
 *
 * Focus lands on the row rather than the title because `focus-within` is on
 * the shell: a ring around 14px of text inside a 720px row reads as a bug.
 */
export function TaskRow({
  title,
  subtitle,
  lead,
  time,
  meta,
  onOpen,
  ariaLabel,
  completed = false,
}: TaskRowProps) {
  const titleCls = `block truncate text-ui ${
    completed ? 'line-through text-muted' : 'text-ink-soft'
  }`;

  return (
    <div
      className={`relative flex items-center gap-[8px] px-[8px] py-[6px] rounded-[6px] transition-colors duration-150 focus-within:ring-2 focus-within:ring-accent ${
        onOpen ? 'hover:bg-hover' : ''
      }`}
    >
      {lead && <span className="relative z-10 flex-none">{lead}</span>}

      {time !== undefined && (
        <span
          data-row-time
          className="relative z-10 w-[48px] flex-none text-meta text-muted tabular-nums"
        >
          {time}
        </span>
      )}

      <span className="min-w-0 flex-1">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={ariaLabel ?? title}
            className="block w-full text-left focus:outline-none"
          >
            {/* The stretched target. `aria-hidden` because the button already
                has its name, and an empty span would otherwise be announced. */}
            <span aria-hidden="true" className="absolute inset-0 rounded-[6px]" />
            <span className={titleCls}>{title}</span>
            {subtitle && <span className="block truncate text-meta text-muted">{subtitle}</span>}
          </button>
        ) : (
          <>
            <span className={titleCls}>{title}</span>
            {subtitle && <span className="block truncate text-meta text-muted">{subtitle}</span>}
          </>
        )}
      </span>

      {meta && (
        <span className="relative z-10 flex-none flex items-center gap-[8px] text-meta text-muted">
          {meta}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/TaskRow.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc -b && npm test`
Expected: `tsc` silent; 124 test files, 2412 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/TaskRow.tsx src/components/TaskRow.test.tsx
git commit -m "feat(ui): one list row, with a target the whole row can carry"
```

---

### Task 2: `NowDivider` — the boundary, said out loud

**Files:**
- Create: `src/views/today/NowDivider.tsx`
- Test: `src/views/today/NowDivider.test.tsx`

**Interfaces:**
- Consumes: `clockLabel` from `src/lib/clock.ts` (existing: `clockLabel(minutes: number): string`).
- Produces: `NowDivider`, used by Task 3:

```ts
export function NowDivider({ nowMinute }: { nowMinute: number }): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `src/views/today/NowDivider.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NowDivider } from './NowDivider';

afterEach(cleanup);

/**
 * The boundary between the day behind you and the day ahead was a bare
 * `h-px bg-accent` marked `aria-hidden`: it spent the app's one accent colour
 * on a rule that said nothing, and said nothing at all to a screen reader.
 * A separator that earns the accent names the minute it is drawn at.
 */
describe('NowDivider', () => {
  it('names the current time', () => {
    render(<NowDivider nowMinute={14 * 60 + 32} />);
    expect(screen.getByText('14:32')).toBeTruthy();
  });

  it('is a labelled separator, not a hidden rule', () => {
    render(<NowDivider nowMinute={9 * 60} />);
    const sep = screen.getByRole('separator');
    expect(sep.getAttribute('aria-label')).toBe('Now, 09:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/today/NowDivider.test.tsx`
Expected: FAIL — `Failed to resolve import "./NowDivider"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/views/today/NowDivider.tsx`:

```tsx
import { clockLabel } from '../../lib/clock';

/**
 * Where the day turns from behind you to ahead of it.
 *
 * This was an `aria-hidden` hairline. The accent is the app's scarcest signal
 * — it means action, overdue or now — and spending it on an unlabelled rule
 * asks the reader to infer the one thing the rule exists to state.
 */
export function NowDivider({ nowMinute }: { nowMinute: number }) {
  const label = clockLabel(nowMinute);
  return (
    <div
      role="separator"
      aria-label={`Now, ${label}`}
      className="flex items-center gap-[8px] my-[4px]"
    >
      <span className="text-meta font-semibold text-accent tabular-nums">{label}</span>
      <span aria-hidden="true" className="flex-1 h-px bg-accent" />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/today/NowDivider.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
npx tsc -b && npm test
git add src/views/today/NowDivider.tsx src/views/today/NowDivider.test.tsx
git commit -m "feat(today): the now-boundary names the minute it is drawn at"
```

---

### Task 3: Adopt `TaskRow` and `NowDivider` in Today

**Files:**
- Modify: `src/views/Today.tsx:192-237` (the "Rest of today" list), `src/views/Today.tsx:260-296` (the free-time offer list), imports at `src/views/Today.tsx:1-15`
- Test: `src/views/Today.freeTime.test.tsx` (regression only — do not rewrite it)

**Interfaces:**
- Consumes: `TaskRow` (Task 1), `NowDivider` (Task 2).
- Produces: no new exports.

**Behaviour that must not change:** the offer row still calls `place(row, offer.date, offer.today)` and keeps its exact accessible name `Plan “<title>” <dayLabel>`, because `Today.freeTime.test.tsx` selects on it.

- [ ] **Step 1: Add the imports**

In `src/views/Today.tsx`, after the existing `TodayCheckbox` import (line 3), add:

```tsx
import { TaskRow } from '../components/TaskRow';
import { NowDivider } from './today/NowDivider';
```

- [ ] **Step 2: Replace the "Rest of today" list body**

Replace `src/views/Today.tsx` lines 195–235 (the `<ul className="border-t border-line">` block through its closing `</ul>`) with:

```tsx
          <ul>
            {open.map((item, i) => (
              <li key={item.key}>
                {/* One rule, where the day turns from behind you to ahead. */}
                {i === divider && i > 0 && <NowDivider nowMinute={nowMinute} />}
                <TaskRow
                  title={item.title}
                  subtitle={item.goalTitle}
                  time={item.startMin === undefined ? undefined : clockLabel(item.startMin)}
                  onOpen={() => openItem(item)}
                  lead={
                    <TodayCheckbox
                      checked={false}
                      onToggle={() => complete(item)}
                      ariaLabel={`Mark "${item.title}" as done`}
                    />
                  }
                  meta={
                    <>
                      {/* Why this row is here at all. Absent where the row
                          already says it — a block at 14:00 does not need a
                          chip reading "placed today". */}
                      {surfaceReason(item) && <span>{surfaceReason(item)}</span>}
                      {item.estimateMin !== undefined && (
                        <span className="tabular-nums">{fmtMinutes(item.estimateMin)}</span>
                      )}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
```

- [ ] **Step 3: Replace the offer list body**

Replace `src/views/Today.tsx` lines 265–294 (the offer `<ul className="border-t border-line">` block through its closing `</ul>`) with:

```tsx
          <ul>
            {offer.rows.map((row) => {
              const chip = dueChip(row.due, today);
              return (
                <li key={row.key}>
                  <TaskRow
                    title={row.title}
                    subtitle={row.goalTitle}
                    onOpen={() => place(row, offer.date, offer.today)}
                    ariaLabel={`Plan “${row.title}” ${dayLabel(offer.date, today)}`}
                    meta={
                      <>
                        {chip && (
                          <span className={chip.overdue ? 'text-warn' : undefined}>{chip.text}</span>
                        )}
                        {row.estimateMin !== undefined && (
                          <span className="tabular-nums">{fmtMinutes(row.estimateMin)}</span>
                        )}
                      </>
                    }
                  />
                </li>
              );
            })}
          </ul>
```

- [ ] **Step 4: Run the Today suites**

Run: `npx vitest run src/views/Today.freeTime.test.tsx src/views/views.smoke.test.ts`
Expected: PASS. If a selector fails on the offer row's name, the `ariaLabel` in Step 3 has drifted — restore it exactly, do not edit the test.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc -b && npm test`
Expected: `tsc` silent; all tests passing.

`tsc` will flag `clockLabel` or `TodayCheckbox` as unused only if a replacement dropped a call site — both are still used above, so any such error means a step was applied incorrectly.

- [ ] **Step 6: Commit**

```bash
git add src/views/Today.tsx
git commit -m "refactor(today): both task lists are the same row"
```

---

### Task 4: Density and chrome pass on Today

**Files:**
- Modify: `src/views/Today.tsx` (section margins; the `Attention` list)

**Interfaces:** none.

**The deliberate call in this task:** per-row `border-b` hairlines are gone (Task 3 already dropped them with the `<ul>` rewrite). Rows are separated by hover, rhythm and alignment instead — brief §6 asks for ~30% less chrome, and the offer list already worked this way, so the two lists now agree. Section spacing moves from `mb-[22px]` to `mb-[24px]`, which is a real step on the 4/8/12/16/24/32 scale.

- [ ] **Step 1: Put section rhythm on the scale**

In `src/views/Today.tsx`, replace every `mb-[22px]` on a `<section>` (lines 140, 193, 244, 261 in the pre-Task-3 file) with `mb-[24px]`, and the trailing `mt-[22px]` on the done-count paragraph (line 325) with `mt-[24px]`.

- [ ] **Step 2: Align the Attention rows with the task lists**

Replace the `Attention` list at `src/views/Today.tsx` (the `<ul className="flex flex-col gap-[2px]">` block) with:

```tsx
          <ul>
            {attention.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => (a.goalId ? actions.openProject(a.goalId, a.nodeId) : actions.setView('plan'))}
                  className="w-full text-left flex items-center gap-[8px] px-[8px] py-[6px] rounded-[6px] transition-colors duration-150 hover:bg-hover"
                >
                  <span className="text-warn flex-none inline-flex" aria-hidden="true">
                    <IconWarning size={13} />
                  </span>
                  <span className="flex-1 min-w-0 truncate text-ui text-ink-soft">{a.text}</span>
                  <span className="flex-none text-faint inline-flex" aria-hidden="true">
                    <IconArrowRight size={12} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
```

This matches `TaskRow`'s metrics exactly (`gap-[8px] px-[8px] py-[6px] rounded-[6px]`) without pretending an alert is a task — it has no checkbox, no time and no estimate, so it does not take the primitive.

- [ ] **Step 3: Verify nothing regressed**

Run: `npx tsc -b && npm test`
Expected: all tests passing.

- [ ] **Step 4: Confirm the design guards still hold**

Run: `npx vitest run src/lib/designScale.test.ts`
Expected: PASS — in particular "uses only the five agreed corner radii" and "declares no arbitrary font sizes".

- [ ] **Step 5: Commit**

```bash
git add src/views/Today.tsx
git commit -m "feat(today): rows carry their own rhythm, not a hairline each"
```

---

## Self-review

**Spec coverage.** Brief §4 (shared `TaskRow` with deliberate default/hover/focus/completed states) — Task 1. §5 (contextual, hover-revealed rather than permanent chrome) — Tasks 3, 4. §6 (fewer borders) — Task 4. §7 (spacing on the 4/8/12/16/24 scale) — Task 4. §8 (Today's now-boundary and row system) — Tasks 2, 3. §18 (120–200ms transitions) — `duration-150` in Tasks 1 and 4. §20 (visible focus, semantic buttons, no nested interactives) — Task 1's third and fourth tests.

**Deliberately out of scope**, to be raised as their own groups: the `[ Start ]` affordance in brief §8 implies a timer Phase does not have, and inventing one is a feature, not a remaster. Today's greeting, empty-state copy, and the slipped-work strip are already contextual and actionable, and the audit found no defect in them.

**Type consistency.** `TaskRowProps` in Task 1 is the type used verbatim in Task 3. `time` is `string | undefined` and Task 3 passes `item.startMin === undefined ? undefined : clockLabel(item.startMin)`. `subtitle` is optional and `item.goalTitle` / `row.goalTitle` are both `string | undefined`. `NowDivider` takes `nowMinute: number`; Today holds `nowMinute` in state at `Today.tsx:35`.

**Risk.** The stretched overlay covers trailing metadata for pointer events. Nothing in `meta` is interactive on either list today, and `meta` is raised with `relative z-10` regardless, so a future interactive chip keeps working.
