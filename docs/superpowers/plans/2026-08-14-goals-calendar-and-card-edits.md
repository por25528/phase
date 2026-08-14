# Goals Calendar and Card Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace New goal's typed deadline with a calendar popover, and give the board card routes to rename and re-deadline a goal without leaving the board.

**Architecture:** One new component, `components/DatePopover.tsx`, built on the existing `Popover` primitive and the existing `lib/calendar.ts` month arithmetic. `Popover` gains measured flip so it can hold a taller panel near the viewport bottom. `BoardCard`'s hand-rolled menu folds into `Popover`, and `CardFace` gains two optional slots so the interactive card and the inert drag overlay can differ without a second component.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind (token scale only), Vitest + @testing-library/react, jsdom.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-14-goals-calendar-and-card-edits-design.md`.
- **`src/lib/calendar.ts` already exists.** Its exports are `ymOf`, `ymOfWeek`, `weekShowingMonth`, `shiftYm`, `ymLabel`, `monthGrid`. The spec's names (`monthOf`, `shiftMonth`, `monthLabel`) were written before this was known — **use the real names**. Do not add parallel helpers.
- **Do not change `monthGrid`.** It returns the weeks a month actually touches (4, 5 or 6). `views/plan/MonthGrid.tsx` sizes rows `minmax(0, 1fr)` against a fixed viewport and depends on that natural length. The picker gets a new padded variant instead.
- **Dates are strings**, `'YYYY-MM-DD'`, built through `pad`/`parseD`/`addDays` from `src/lib/dates.ts`. Never `toISOString()` — it shifts a UK-evening selection back a day.
- **No literal colours, no arbitrary font sizes.** `src/lib/designScale.test.ts` fails the build on a literal hex/rgb, on `text-[Nrem]`, and on `rounded-[Npx]` outside `{4, 6, 11}`. Use theme tokens and named scale steps.
- **Hover-revealed controls use `.quiet-control`**, never a hand-rolled `group-hover:opacity-100` — `designScale.test.ts` pins the one survivor and will fail on a new one.
- **`uppercase` is pinned** to three files in `designScale.test.ts`. Task 3 adds a fourth deliberately and edits that assertion.
- Anything inside the card that receives a pointer must `stopPropagation` on `pointerdown` and `click` — the card root carries dnd-kit's drag listeners and an open-the-goal `onClick`.
- Run `npm test` and `npx tsc -b` before every commit (CLAUDE.md conventions).
- Branch is `goals-calendar-and-card-edits`, already created.

---

### Task 1: `paddedMonthGrid` and `deadlinePresets`

**Files:**
- Modify: `src/lib/calendar.ts` (append; do not edit existing exports)
- Test: `src/lib/calendar.test.ts` (append two `describe` blocks)

**Interfaces:**
- Consumes: existing `monthGrid`, `ymOf`, `shiftYm`, `ymLabel` from `./calendar`; `pad`, `addDays` from `./dates`.
- Produces:
  - `paddedMonthGrid(ym: string): string[][]` — always exactly 6 rows of 7 ISO dates.
  - `interface DatePreset { label: string; date: string }`
  - `deadlinePresets(today: string): DatePreset[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/calendar.test.ts`. Also add `paddedMonthGrid`, `deadlinePresets` to the existing import from `./calendar` on line 2.

```ts
describe('the grid a picker needs', () => {
  it('is always six rows of seven, whatever the month', () => {
    for (const ym of ['2026-08', '2026-02', '2021-02', '2026-05', '2027-01']) {
      const weeks = paddedMonthGrid(ym);
      expect(weeks.length, ym).toBe(6);
      weeks.forEach((w) => expect(w.length, ym).toBe(7));
    }
  });

  // Feb 2021 started on a Monday and has 28 days — exactly four rows, the
  // smallest a month can be. An `if` that padded once would leave it at five.
  it('pads a four-row month all the way to six', () => {
    expect(monthGrid('2021-02')).toHaveLength(4);
    expect(paddedMonthGrid('2021-02')).toHaveLength(6);
  });

  it('keeps every day monthGrid produced, in order', () => {
    const natural = monthGrid('2026-08').flat();
    expect(paddedMonthGrid('2026-08').flat().slice(0, natural.length)).toEqual(natural);
  });

  it('runs continuously across the padding seam', () => {
    const days = paddedMonthGrid('2021-02').flat();
    days.slice(1).forEach((d, i) => expect(d).toBe(addDays(days[i], 1)));
  });
});

describe('deadline presets', () => {
  it('offers two weeks out, the month end and the year end', () => {
    expect(deadlinePresets('2026-08-14')).toEqual([
      { label: 'In 2 weeks', date: '2026-08-28' },
      { label: 'End of month', date: '2026-08-31' },
      { label: 'End of year', date: '2026-12-31' },
    ]);
  });

  it('knows February in a leap year from February in an ordinary one', () => {
    expect(deadlinePresets('2028-02-01')[1].date).toBe('2028-02-29');
    expect(deadlinePresets('2026-02-01')[1].date).toBe('2026-02-28');
  });

  /**
   * Two buttons that write the same date are one button and a lie about the
   * choice on offer. In December the month end IS the year end.
   */
  it('drops a preset that duplicates one already offered', () => {
    expect(deadlinePresets('2026-12-05').map((p) => p.label))
      .toEqual(['In 2 weeks', 'End of month']);
  });
});
```

The `addDays` helper is needed by the seam test — add it to the `./dates` import at the top of `calendar.test.ts`, or import it fresh: `import { addDays } from './dates';`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/calendar.test.ts`
Expected: FAIL — `paddedMonthGrid is not a function` / `deadlinePresets is not a function`.

- [ ] **Step 3: Implement both**

Append to `src/lib/calendar.ts`:

```ts
/**
 * The month grid a PICKER needs: always six rows.
 *
 * `monthGrid` returns the weeks a month actually touches — four for a February
 * that starts on a Monday, six for a long month starting late — and the Plan
 * view sizes its rows `minmax(0, 1fr)` inside a fixed viewport, so a varying
 * count costs it nothing.
 *
 * A popover has no such viewport: it is sized by its content. Paging `›` from a
 * five-row month into a six-row one would grow the panel under the cursor and
 * slide the day being aimed at out from under it. Six is the most rows any
 * month can touch, so this is a ceiling rather than a guess.
 */
export function paddedMonthGrid(ym: string): string[][] {
  const weeks = monthGrid(ym).map((week) => [...week]);
  while (weeks.length < 6) {
    const tail = weeks[weeks.length - 1][6];
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(tail, i + 1)));
  }
  return weeks;
}

export interface DatePreset {
  label: string;
  date: string;
}

/**
 * The shortcuts under the grid, for a GOAL deadline.
 *
 * A preset earns its place by covering what the grid is SLOW at. Any day in the
 * visible month is already one click, so `End of year` — five presses of `›`
 * from August — is the clearest case. `End of month` is the exception that
 * proves the rule: it is one click away, but it asks you to know which day the
 * month ends on, and February is why that is not free.
 *
 * `Today` and `Tomorrow`, which `ScheduleMenu` offers a task, are deliberately
 * absent. They are task-shaped. A goal deadline is a semester-scale fact.
 */
export function deadlinePresets(today: string): DatePreset[] {
  const [y, m] = today.split('-').map(Number);
  const candidates: DatePreset[] = [
    { label: 'In 2 weeks', date: addDays(today, 14) },
    { label: 'End of month', date: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` },
    { label: 'End of year', date: `${y}-12-31` },
  ];
  const seen = new Set<string>();
  const out: DatePreset[] = [];
  for (const preset of candidates) {
    if (seen.has(preset.date)) continue;
    seen.add(preset.date);
    out.push(preset);
  }
  return out;
}
```

`new Date(y, m, 0)` is day zero of the month AFTER `m`, which the platform normalises to the last day of `m` — the same real-`Date` rollover `shiftYm` already relies on, and the reason this handles leap years without a table.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/calendar.test.ts`
Expected: PASS, including the pre-existing `ym helpers` and week-round-trip blocks.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/calendar.ts src/lib/calendar.test.ts
git commit -m "feat(calendar): a six-row grid and the presets a deadline wants"
```

---

### Task 2: `Popover` gains measured flip

**Files:**
- Modify: `src/components/Popover.tsx`
- Test: `src/components/Popover.test.tsx` (append one `describe`)

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change. `Popover` renders its panel above the trigger when the panel does not fit below and does fit above. Every existing caller inherits it.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Popover.test.tsx`:

```ts
/**
 * A panel that opens downward off the bottom of the window is unreachable, and
 * `BoardCard` worked around it with `MENU_HEIGHT_PX = 210` — a hardcoded guess
 * at its own height, in the one file whose menu was about to grow. Measuring is
 * what lets the guess be deleted.
 */
describe('flip', () => {
  function stubLayout({ triggerTop, panelHeight, viewport }: {
    triggerTop: number; panelHeight: number; viewport: number;
  }) {
    const rect = Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: triggerTop, bottom: triggerTop + 24, left: 0, right: 0, width: 0, height: 24 }),
    });
    const height = Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => panelHeight,
    });
    const prev = window.innerHeight;
    window.innerHeight = viewport;
    return () => {
      delete (Element.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
      window.innerHeight = prev;
      void rect; void height;
    };
  }

  const panelClasses = () =>
    (screen.getByRole('dialog').getAttribute('class') ?? '');

  it('opens above when there is no room below and room above', async () => {
    const restore = stubLayout({ triggerTop: 700, panelHeight: 210, viewport: 768 });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(panelClasses()).toContain('bottom-[calc(100%+4px)]');
    expect(panelClasses()).not.toContain('top-[calc(100%+4px)]');
    restore();
  });

  it('stays below when the panel fits there', async () => {
    const restore = stubLayout({ triggerTop: 40, panelHeight: 210, viewport: 768 });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(panelClasses()).toContain('top-[calc(100%+4px)]');
    restore();
  });

  /**
   * Flipping a panel taller than the space above it trades one clipped edge for
   * another. When neither side fits, below is still the right answer — it is
   * where the reading eye already is.
   */
  it('stays below when neither side has room', async () => {
    const restore = stubLayout({ triggerTop: 120, panelHeight: 400, viewport: 300 });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(panelClasses()).toContain('top-[calc(100%+4px)]');
    restore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/Popover.test.tsx`
Expected: FAIL on the first case — the panel still carries `top-[calc(100%+4px)]`.

- [ ] **Step 3: Implement flip**

In `src/components/Popover.tsx`, change the React import on line 1 to include `useLayoutEffect`:

```tsx
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
```

Add state and a panel ref beside the existing `useState`/`useRef` declarations (after `const panelId = useId();`):

```tsx
  const panelRef = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
```

Add this effect immediately after the existing dismissal `useEffect`:

```tsx
  /**
   * Measured on open, never derived.
   *
   * `BoardCard` carried a `MENU_HEIGHT_PX = 210` constant for this — a number
   * standing in for a panel whose real height depends on how many lives the
   * user has named. A layout effect runs after the panel is in the DOM and
   * before paint, so the flip is decided from the actual box and never renders
   * in the wrong place first.
   *
   * Both sides are checked. Flipping a panel that is also taller than the space
   * ABOVE it just moves which edge gets clipped, so below stays the default.
   */
  useLayoutEffect(() => {
    if (!open) {
      setFlip(false);
      return;
    }
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height = panel.offsetHeight;
    const fitsBelow = height + 4 <= window.innerHeight - rect.bottom;
    const fitsAbove = height + 4 <= rect.top;
    setFlip(!fitsBelow && fitsAbove);
  }, [open, triggerRef]);
```

Attach the ref and swap the placement class on the panel `<div>`:

```tsx
        <div
          id={panelId}
          ref={panelRef}
          role={role}
          aria-label={label}
          style={panelWidth ? { width: `${panelWidth}px` } : undefined}
          className={`absolute z-40 ${
            flip ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]'
          } ${align === 'end' ? 'right-0' : 'left-0'} bg-panel border border-line-2 rounded-card shadow-card py-[5px] ${panelClassName}`}
        >
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. In jsdom `offsetHeight` is 0 and `innerHeight` is 768 for every unstubbed test, so `fitsBelow` is true and no existing popover moves.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b
git add src/components/Popover.tsx src/components/Popover.test.tsx
git commit -m "feat(popover): flip above when the panel does not fit below"
```

---

### Task 3: `DatePopover`

**Files:**
- Create: `src/components/DatePopover.tsx`
- Test: `src/components/DatePopover.test.tsx`
- Modify: `src/lib/designScale.test.ts:~288` (the `reserves uppercase for terse date labels` assertion)

**Interfaces:**
- Consumes: `Popover` (`components/Popover.tsx`), `IconCalendar`/`IconChevronRight` (`components/Icons.tsx`), `CONTROL_H`/`CONTROL_LINE` (`components/dialogStyles.ts`), `paddedMonthGrid`/`deadlinePresets`/`shiftYm`/`ymLabel`/`ymOf` (`lib/calendar.ts`), `addDays`/`fmtD`/`parseD` (`lib/dates.ts`).
- Produces:

```tsx
export function DatePopover(props: {
  value: string;               // 'YYYY-MM-DD' or '' for unset
  today: string;               // 'YYYY-MM-DD'
  onCommit: (next: string) => void;  // '' means cleared
  ariaLabel: string;           // 'Deadline' — the trigger's name is `${ariaLabel}: ${state}`
  placeholder?: string;        // shown when value is '' — default 'No date'
  prefix?: string;             // printed before the date when one is set, e.g. 'Due · '
  size?: 'field' | 'chip';
  triggerClassName?: string;   // tone only; size owns padding, radius and type step
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}): JSX.Element
```

- [ ] **Step 1: Write the failing test**

Create `src/components/DatePopover.test.tsx`:

```tsx
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePopover } from './DatePopover';

afterEach(cleanup);

function mount(props: Partial<Parameters<typeof DatePopover>[0]> = {}) {
  const onCommit = vi.fn<(next: string) => void>();
  render(
    createElement(DatePopover, {
      value: '',
      today: '2026-08-14',
      onCommit,
      ariaLabel: 'Deadline',
      placeholder: 'No deadline',
      ...props,
    }),
  );
  return { onCommit, user: userEvent.setup() };
}

const trigger = () => screen.getByRole('button', { name: /^Deadline:/ });

describe('the trigger', () => {
  it('states the fact rather than naming a field', async () => {
    mount();
    expect(trigger().textContent).toContain('No deadline');
    expect(trigger().getAttribute('aria-label')).toBe('Deadline: not set');
  });

  it('carries the date in its accessible name once one is set', () => {
    mount({ value: '2026-08-30' });
    expect(trigger().getAttribute('aria-label')).toBe('Deadline: Aug 30, 2026');
    expect(trigger().textContent).toContain('Aug 30');
  });

  it('prints a prefix in front of the date when asked', () => {
    mount({ value: '2026-08-30', prefix: 'Due · ' });
    expect(trigger().textContent).toContain('Due · Aug 30');
  });
});

describe('picking a day', () => {
  it('opens on the month holding today when nothing is set', async () => {
    const { user } = mount();
    await user.click(trigger());
    expect(screen.getByText('August 2026')).toBeTruthy();
  });

  it('opens on the month holding the value', async () => {
    const { user } = mount({ value: '2027-01-09' });
    await user.click(trigger());
    expect(screen.getByText('January 2027')).toBeTruthy();
  });

  it('commits the day that was clicked and closes', async () => {
    const { onCommit, user } = mount();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Aug 30, 2026' }));

    expect(onCommit).toHaveBeenCalledWith('2026-08-30');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('commits a preset', async () => {
    const { onCommit, user } = mount();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'End of year' }));

    expect(onCommit).toHaveBeenCalledWith('2026-12-31');
  });

  /**
   * An empty string, not `undefined`: the caller decides what "no date" means
   * in its own model, and a picker that invented `undefined` would be making
   * that decision for it.
   */
  it('clears with an empty string, and offers Clear only when set', async () => {
    const { onCommit, user } = mount({ value: '2026-08-30' });
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Clear deadline' }));
    expect(onCommit).toHaveBeenCalledWith('');

    cleanup();
    const second = mount();
    await second.user.click(trigger());
    expect(screen.queryByRole('button', { name: 'Clear deadline' })).toBeNull();
  });

  it('pages months without committing anything', async () => {
    const { onCommit, user } = mount();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('September 2026')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('July 2026')).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

/**
 * A calendar that cannot be driven from the keyboard is a REGRESSION from the
 * text input it replaced, not a polish item. Roving tabindex is what keeps the
 * grid one tab stop instead of forty-two.
 */
describe('the keyboard', () => {
  it('opens with exactly one cell focused, on the selected day', async () => {
    const { user } = mount({ value: '2026-08-30' });
    await user.click(trigger());

    const cell = screen.getByRole('button', { name: 'Aug 30, 2026' });
    expect(document.activeElement).toBe(cell);
    expect(
      screen.getAllByRole('gridcell').filter((c) => c.querySelector('[tabindex="0"]')),
    ).toHaveLength(1);
  });

  it('moves a day with the arrows and a week with up and down', async () => {
    const { onCommit, user } = mount({ value: '2026-08-14' });
    await user.click(trigger());

    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aug 22, 2026' }));

    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith('2026-08-22');
  });

  it('pages the month with PageUp and PageDown', async () => {
    const { user } = mount({ value: '2026-08-14' });
    await user.click(trigger());

    await user.keyboard('{PageDown}');
    expect(screen.getByText('September 2026')).toBeTruthy();
    await user.keyboard('{PageUp}{PageUp}');
    expect(screen.getByText('July 2026')).toBeTruthy();
  });

  it('goes to the ends of the week with Home and End', async () => {
    const { user } = mount({ value: '2026-08-13' }); // a Thursday
    await user.click(trigger());

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aug 10, 2026' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aug 16, 2026' }));
  });

  /**
   * Arrowing off the edge pages rather than dead-ending. The padded days of the
   * neighbouring month are visible and live, so the month only turns once the
   * cursor leaves the drawn grid entirely.
   */
  it('follows the cursor into the next month rather than stopping', async () => {
    const { user } = mount({ value: '2026-08-31' });
    await user.click(trigger());

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByText('September 2026')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/DatePopover.test.tsx`
Expected: FAIL — `Failed to resolve import "./DatePopover"`.

- [ ] **Step 3: Write the component**

Create `src/components/DatePopover.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Popover } from './Popover';
import { IconCalendar, IconChevronRight } from './Icons';
import { CONTROL_H, CONTROL_LINE } from './dialogStyles';
import { deadlinePresets, paddedMonthGrid, shiftYm, ymLabel, ymOf } from '../lib/calendar';
import { addDays, fmtD, parseD } from '../lib/dates';

/**
 * A date, picked rather than spelled.
 *
 * `DateField` — still the control in the project workspace — exists because
 * `<input type="date">` renders in the browser's locale, and `02/08/2026` is
 * Feb 8 to a US reader and Aug 2 to everyone else. It answered that by refusing
 * the ambiguous form, which is correct but leaves the user carrying the format:
 * `parseDateInput` is 59 lines of grammar for month names, word order and
 * omitted years, every one of them recovering from the fact that somebody had
 * to type a date out.
 *
 * A grid has no format to get wrong, no year to omit and nothing to reject.
 *
 * `size` rather than a merged `className`, for the reason `DateField` documents:
 * class lists are APPENDED, not cascaded, so a caller passing `rounded-field`
 * against a base `rounded-[6px]` leaves which one applies to the order Tailwind
 * happened to emit them in. `triggerClassName` carries TONE only.
 */
const SIZES = {
  /** A form field in a dialog — 33px, matching `fieldCls` exactly. */
  field: `w-full justify-start ${CONTROL_H} ${CONTROL_LINE} gap-[7px] px-[8px] py-[5px] rounded-field border border-line-2 text-ui`,
  /** A chip on a board card. */
  chip: 'gap-[4px] px-[6px] py-[3px] rounded-[6px] text-meta whitespace-nowrap',
} as const;

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `Aug 30, 2026` — a cell's name must be unambiguous read out of context. */
function dayLabel(date: string): string {
  return `${fmtD(date)}, ${date.slice(0, 4)}`;
}

/** 0 = Monday … 6 = Sunday, the app's week, as `weekDates` computes it. */
function dayOfWeek(date: string): number {
  return (parseD(date).getDay() + 6) % 7;
}

export function DatePopover({
  value,
  today,
  onCommit,
  ariaLabel,
  placeholder = 'No date',
  prefix = '',
  size = 'field',
  triggerClassName = '',
  triggerRef,
}: {
  value: string;
  today: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  prefix?: string;
  size?: keyof typeof SIZES;
  triggerClassName?: string;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Popover
      // The pattern `TaskPage` set: the name carries the VALUE, so the control
      // and the panel it opens can never drift about what is selected.
      label={`${ariaLabel}: ${value ? dayLabel(value) : 'not set'}`}
      role="dialog"
      panelWidth={252}
      triggerRef={triggerRef}
      triggerClassName={`inline-flex items-center text-left ${SIZES[size]} ${triggerClassName}`}
      trigger={
        <>
          <span className="flex-none text-muted inline-flex" aria-hidden="true">
            <IconCalendar size={13} />
          </span>
          {/*
            An unset value is `text-muted` and never `text-faint`. It is read,
            and it is the only affordance for setting one, so it takes the tone
            that clears AA.
          */}
          <span className={`flex-1 min-w-0 truncate ${value ? 'text-ink' : 'text-muted'}`}>
            {value ? `${prefix}${fmtD(value)}` : placeholder}
          </span>
          <span className="flex-none text-faint inline-flex rotate-90" aria-hidden="true">
            <IconChevronRight size={11} />
          </span>
        </>
      }
    >
      {(close) => (
        <Calendar
          value={value}
          today={today}
          clearLabel={`Clear ${ariaLabel.toLowerCase()}`}
          onPick={(date) => {
            onCommit(date);
            close();
          }}
          onClear={() => {
            onCommit('');
            close();
          }}
        />
      )}
    </Popover>
  );
}

function Calendar({
  value,
  today,
  clearLabel,
  onPick,
  onClear,
}: {
  value: string;
  today: string;
  clearLabel: string;
  onPick: (date: string) => void;
  onClear: () => void;
}) {
  /*
   * `Popover` calls its children only while open, so this component mounts on
   * open and these initialisers ARE the "which month does it open on" rule:
   * the month holding the current value, else the month holding today. Focus
   * starts on the value, else on today — which by construction is inside the
   * month just chosen, so the grid never opens with focus off screen.
   */
  const [ym, setYm] = useState(() => ymOf(value || today));
  const [focused, setFocused] = useState(() => value || today);
  const gridRef = useRef<HTMLDivElement>(null);

  const weeks = paddedMonthGrid(ym);

  // Roving tabindex: the focused cell is the only tab stop, and moving focus is
  // how this component "navigates". Runs on mount too, which is what gives the
  // grid a focused cell the moment it opens.
  useEffect(() => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
      ?.focus();
  }, [focused, ym]);

  function page(n: number): void {
    const next = shiftYm(ym, n);
    setYm(next);
    setFocused(`${next}-01`);
  }

  /**
   * Move the cursor, and let the month follow it off the edge.
   *
   * The test is membership of the DRAWN grid, not of `ym` — the padded days of
   * the neighbouring months are visible and live, so stepping onto one should
   * not turn the page out from under the eye. Only leaving the drawn six rows
   * pages.
   */
  function move(days: number): void {
    const next = addDays(focused, days);
    setFocused(next);
    if (!weeks.some((week) => week.includes(next))) setYm(ymOf(next));
  }

  return (
    <div className="px-[8px] pb-[4px]">
      <div className="flex items-center justify-between gap-[4px] px-[2px] pb-[6px]">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => page(-1)}
          className="w-[24px] h-[24px] grid place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink"
        >
          <span className="inline-flex rotate-180" aria-hidden="true"><IconChevronRight size={12} /></span>
        </button>
        <div className="text-ui font-medium text-ink">{ymLabel(ym)}</div>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => page(1)}
          className="w-[24px] h-[24px] grid place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink"
        >
          <IconChevronRight size={12} />
        </button>
      </div>

      {/* The weekday strip — the one thing a terse uppercase micro label is
          genuinely for, and the same treatment `views/plan/MonthGrid.tsx` gives
          its own. `designScale.test.ts` pins the list of files allowed to do
          this; this file is on it deliberately. */}
      <div className="grid grid-cols-7" aria-hidden="true">
        {DOW.map((d) => (
          <div key={d} className="text-center font-mono text-tiny tracking-[.12em] uppercase text-muted pb-[3px]">
            {d.slice(0, 1)}
          </div>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={ymLabel(ym)}
        onKeyDown={(e) => {
          const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (step !== undefined) {
            e.preventDefault();
            move(step);
            return;
          }
          if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault();
            page(e.key === 'PageUp' ? -1 : 1);
            return;
          }
          if (e.key === 'Home') {
            e.preventDefault();
            move(-dayOfWeek(focused));
            return;
          }
          if (e.key === 'End') {
            e.preventDefault();
            move(6 - dayOfWeek(focused));
          }
        }}
      >
        {weeks.map((week) => (
          <div key={week[0]} role="row" className="grid grid-cols-7">
            {week.map((date) => {
              const inMonth = ymOf(date) === ym;
              const selected = date === value;
              return (
                <div key={date} role="gridcell" className="grid place-items-center">
                  <button
                    type="button"
                    data-date={date}
                    tabIndex={date === focused ? 0 : -1}
                    aria-label={dayLabel(date)}
                    aria-pressed={selected}
                    aria-current={date === today ? 'date' : undefined}
                    onClick={() => onPick(date)}
                    className={`w-[30px] min-h-[28px] grid place-items-center rounded-[6px] text-ui tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      selected
                        ? 'bg-ink text-paper font-semibold'
                        : `hover:bg-hover ${
                            // A day already gone is still selectable — a goal
                            // recorded after its deadline passed is a real
                            // thing to record — but it is not what you are
                            // looking for. `text-muted`, never `text-faint`:
                            // it is READ while scanning the grid. `text-faint`
                            // is spent on the neighbouring month instead,
                            // which genuinely is peripheral.
                            !inMonth ? 'text-faint' : date < today ? 'text-muted' : 'text-ink'
                          }`
                    } ${date === today && !selected ? 'ring-1 ring-accent' : ''}`}
                  >
                    {parseD(date).getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-[6px] pt-[6px] border-t border-line flex flex-wrap gap-[4px]">
        {deadlinePresets(today).map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onPick(preset.date)}
            className="text-meta text-ink-soft px-[7px] py-[3px] rounded-field hover:bg-hover hover:text-ink"
          >
            {preset.label}
          </button>
        ))}
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="text-meta text-muted px-[7px] py-[3px] rounded-field hover:bg-hover hover:text-ink"
          >
            {clearLabel}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Allow this file to use `uppercase`**

`src/lib/designScale.test.ts` pins which files may set all-caps. Update the assertion in the `reserves uppercase for terse date labels` test (~line 288) to:

```ts
    expect([...new Set(files)].sort()).toEqual([
      'components/DatePopover.tsx',
      'views/plan/MonthGrid.tsx',
      'views/plan/WeekGrid.tsx',
      'views/timeline/DaysLane.tsx',
    ]);
```

And extend that test's docstring so the next reader knows this was a decision:

```
   * A letter-spaced uppercase mono eyebrow over every group is a second
   * typeface doing a job a font weight already does. The survivors are the
   * weekday strips on the calendars, which is what a terse uppercase micro
   * label is genuinely for — including the date picker's, which is a weekday
   * strip by the same definition as the other three.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/DatePopover.test.tsx src/lib/designScale.test.ts`
Expected: PASS.

If the `moves a day with the arrows` case fails on focus, check that the `useEffect` dependency array includes `ym` — paging and moving can land on the same `focused` string in different months.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/components/DatePopover.tsx src/components/DatePopover.test.tsx src/lib/designScale.test.ts
git commit -m "feat(components): a date you pick, with a keyboard-driven grid"
```

---

### Task 4: New goal picks its deadline

**Files:**
- Modify: `src/views/goals/NewGoalModal.tsx`
- Test: `src/views/goals/NewGoalModal.test.tsx:104-128` (rewrite one test)

**Interfaces:**
- Consumes: `DatePopover` from Task 3.
- Produces: no change to `onAdd`'s `Goal` shape. A picked deadline still writes `datesConfirmed: true`.

- [ ] **Step 1: Rewrite the failing test**

Replace the whole `treats a typed deadline as already confirmed` test (lines 104–128) with:

```ts
  /**
   * `datesConfirmed` exists for IMPORTED dates nobody has read. A date the user
   * just picked needs no review, and asking for one would make the first thing
   * a new goal does be a warning about itself.
   *
   * The `fireEvent.focus/change/keyDown` dance this replaces was working around
   * `DateField`'s draft lifecycle. A grid has no draft: the click IS the value.
   */
  it('treats a picked deadline as already confirmed', async () => {
    const { onAdd, user } = mount();

    await user.type(title(), 'Physics Final');
    await user.click(screen.getByRole('button', { name: /^Deadline:/ }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: /^Sep 24, / }));

    await user.click(title());
    await user.keyboard('{Enter}');

    const created = onAdd.mock.calls[0][0];
    expect(created.deadline).toMatch(/^\d{4}-09-24$/);
    expect(created.datesConfirmed).toBe(true);
  });

  it('offers no textbox for the deadline at all', () => {
    mount();
    expect(screen.queryByRole('textbox', { name: 'Deadline' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Deadline: not set' })).toBeTruthy();
  });
```

`fireEvent` is now unused in this file — remove it from the `@testing-library/react` import on line 3.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/views/goals/NewGoalModal.test.tsx`
Expected: FAIL — no button named `/^Deadline:/`; the deadline is still a textbox.

- [ ] **Step 3: Swap the control and delete the dead branch**

In `src/views/goals/NewGoalModal.tsx`:

Replace the `DateField` import (line 4) with:

```tsx
import { DatePopover } from '../../components/DatePopover';
```

Remove the now-unused `projectDateError` import (line 7) and add `todayStr`:

```tsx
import { todayStr } from '../../lib/dates';
```

Delete the `dateError` const (line 55). Replace the `submit` guard on line 59:

```tsx
    if (!t) return;
```

Replace the `<DateField …/>` block (lines 107–113) with:

```tsx
              <DatePopover
                value={deadline}
                today={todayStr()}
                onCommit={setDeadline}
                ariaLabel="Deadline"
                placeholder="No deadline"
                size="field"
              />
```

Delete the error paragraph (line 130):

```tsx
          {dateError && <p role="alert" className="text-ui text-warn">{dateError}</p>}
```

And drop the error half of the submit button's `disabled` (line 136):

```tsx
          <button type="submit" className={primaryBtn} disabled={!title.trim()}>
```

Finally, extend the component docstring so the deletion is on the record. Append this paragraph after the existing closing sentence:

```
 * The deadline is PICKED, not typed. `projectDateError` used to guard this
 * form; a grid cannot emit a malformed date and this dialog never sets `start`,
 * so the check and its error paragraph were unreachable and are gone.
 * `projectDateError` itself still guards `setGoalDates`, which is where an
 * imported or hand-edited date actually arrives.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/views/goals/NewGoalModal.test.tsx`
Expected: PASS, all 9 tests. `asks for no horizon, no start date…` still passes — `queryByLabelText(/^Start/)` finds nothing, and the picker's name begins `Deadline:`.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b
git add src/views/goals/NewGoalModal.tsx src/views/goals/NewGoalModal.test.tsx
git commit -m "feat(goals): New goal picks a deadline instead of parsing one"
```

---

### Task 5: The card's menu becomes a `Popover`

**Files:**
- Modify: `src/views/goals/BoardCard.tsx:1-5, 29-30, 226-245, 325-422`
- Test: `src/views/goals/BoardCard.keyboard.test.tsx` (verify only — no edit expected)

**Interfaces:**
- Consumes: `Popover`, `PopoverItem`, `PopoverSeparator` from `components/Popover.tsx`; flip from Task 2.
- Produces: no prop changes. The overflow trigger keeps its `aria-label="More actions"`.

- [ ] **Step 1: Confirm the current tests pass, so a break is attributable**

Run: `npx vitest run src/views/goals/`
Expected: PASS. Note the count.

- [ ] **Step 2: Replace the hand-rolled menu**

In `src/views/goals/BoardCard.tsx`:

Add to the imports:

```tsx
import { Popover, PopoverItem, PopoverSeparator } from '../../components/Popover';
```

Delete `useEffect` and `useRef` from the React import if nothing else uses them — `useState` stays for Task 6. Delete the `MENU_HEIGHT_PX` const (lines 29–30) and its comment.

Delete `menuOpen`, `menuUp`, `menuRef` (lines 226–228) and the entire dismissal `useEffect` (lines 231–245).

Replace the whole `<div className="absolute top-[7px] right-[7px]" ref={menuRef}> … </div>` block (lines 325–422) with:

```tsx
      {/*
        The overflow, revealed on hover, holding what the card body cannot do:
        rename it, re-date it, move it, and delete it.

        Wrapped rather than handed handlers: `Popover` renders its own trigger,
        so there is nowhere to hang `onPointerDown`. The wrapper catches the
        pointer before dnd-kit's listeners on the card root see it, and the
        click before the card's own open-the-goal handler does — the same job
        `act` and `stopPointer` did for the buttons this replaces.

        The above/below flip that used to live here as `MENU_HEIGHT_PX = 210` is
        now measured inside `Popover`, for every caller.
      */}
      <div
        className="absolute top-[7px] right-[7px]"
        onPointerDown={stopPointer}
        onClick={(e) => e.stopPropagation()}
      >
        <Popover
          label="More actions"
          role="menu"
          align="end"
          panelWidth={186}
          triggerClassName="quiet-control text-faint px-[6px] min-h-[24px] inline-flex items-center rounded-field bg-panel hover:bg-hover hover:text-ink"
          trigger={<IconDots />}
        >
          {(close) => (
            <>
              <div className="px-[12px] py-[3px] text-meta text-muted">Move to</div>
              {HORIZON_LABELS.map((label, i) => (
                <PopoverItem
                  key={label}
                  close={close}
                  disabled={i === currentCol}
                  // The card's `aria-label` already promises "Alt with arrow
                  // keys to move" to a screen reader. The hint is the same
                  // promise, made to everyone else.
                  hint={i === currentCol - 1 ? '⌥←' : i === currentCol + 1 ? '⌥→' : undefined}
                  onSelect={() => onMove(goal.id, i)}
                >
                  {label}{i === currentCol ? ' · current' : ''}
                </PopoverItem>
              ))}

              {lives.length > 0 && (
                <>
                  <PopoverSeparator />
                  <div className="px-[12px] py-[3px] text-meta text-muted">Life</div>
                  {sortedLives(lives).map((l) => (
                    <PopoverItem
                      key={l.id}
                      close={close}
                      disabled={l.id === life?.id}
                      onSelect={() => onSetLife(goal.id, l.id)}
                    >
                      {l.title}{l.id === life?.id ? ' · current' : ''}
                    </PopoverItem>
                  ))}
                  <PopoverItem close={close} disabled={life === null} onSelect={() => onSetLife(goal.id, null)}>
                    None
                  </PopoverItem>
                </>
              )}

              <PopoverSeparator />
              <PopoverItem close={close} tone="danger" onSelect={() => onDelete(goal.id)}>
                Delete goal
              </PopoverItem>
            </>
          )}
        </Popover>
      </div>
```

The `act` helper (lines 258–263) is now unused — delete it. `stopPointer` stays.

- [ ] **Step 3: Run the Goals tests**

Run: `npx vitest run src/views/goals/`
Expected: PASS at the same count as Step 1.

If a test queried the menu by `screen.getByRole('menu')` while closed, it now correctly finds nothing until the trigger is clicked — that is the primitive's behaviour, and the test should click first rather than the component being changed back.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc -b
git add src/views/goals/BoardCard.tsx
git commit -m "refactor(goals): the card menu is the popover primitive, not a fourth copy"
```

---

### Task 6: Rename from the card

**Files:**
- Modify: `src/views/goals/BoardCard.tsx` (`CardFace` signature, `BoardCard` props and body)
- Modify: `src/views/Goals.tsx:519-533` (pass `onRename`)
- Test: `src/views/goals/BoardCard.rename.test.tsx` (create)

**Interfaces:**
- Consumes: `InlineEdit` from `components/InlineEdit.tsx`; `renameGoal(goalId: string, title: string)` from the store.
- Produces:
  - `CardFace` gains `titleSlot?: React.ReactNode` — when present it replaces the `<h3>`.
  - `BoardCard` gains a required prop `onRename: (id: string, title: string) => void`.

- [ ] **Step 1: Write the failing test**

Create `src/views/goals/BoardCard.rename.test.tsx`:

```tsx
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { BoardCard } from './BoardCard';
import type { Goal } from '../../db/types';

afterEach(cleanup);

function renderCard(over: Partial<Goal> = {}) {
  const onRename = vi.fn();
  const onOpen = vi.fn();
  const goal: Goal = { id: 'g', title: 'Finish CS:APP', nodes: [], ...over };
  render(
    createElement(DndContext, null,
      createElement(BoardCard, {
        goal,
        today: '2026-08-14',
        onOpen,
        onMove: vi.fn(),
        onRank: vi.fn(),
        onDelete: vi.fn(),
        onRename,
        onSetDeadline: vi.fn(),
        reducedMotion: false,
        dimmed: false,
        matched: false,
        lives: [],
        onSetLife: vi.fn(),
      }),
    ),
  );
  return { onRename, onOpen, user: userEvent.setup() };
}

async function openRename(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
}

describe('renaming from the board', () => {
  it('turns the title into a field and commits on Enter', async () => {
    const { onRename, user } = renderCard();
    await openRename(user);

    const field = screen.getByRole('textbox');
    await user.clear(field);
    await user.type(field, 'Finish CS:APP labs{Enter}');

    expect(onRename).toHaveBeenCalledWith('g', 'Finish CS:APP labs');
  });

  it('abandons the edit on Escape without writing', async () => {
    const { onRename, user } = renderCard();
    await openRename(user);

    await user.type(screen.getByRole('textbox'), ' more{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  /**
   * The card root opens the goal on click and carries dnd-kit's drag listeners.
   * A text field that let either through would open the project on the first
   * click into the word you meant to fix.
   */
  it('does not open the goal when you click into the field', async () => {
    const { onOpen, user } = renderCard();
    await openRename(user);

    await user.click(screen.getByRole('textbox'));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/views/goals/BoardCard.rename.test.tsx`
Expected: FAIL — no menuitem named `Rename`.

- [ ] **Step 3: Add the slot, the state and the menu item**

In `src/views/goals/BoardCard.tsx`:

Import `InlineEdit`:

```tsx
import { InlineEdit } from '../../components/InlineEdit';
```

Give `CardFace` the slot. Add to its props type:

```tsx
  /**
   * Replaces the title when the card is being renamed. A slot rather than a
   * `renaming` flag plus two callbacks: `CardFace` does not need to know what
   * an edit IS, only that something else is drawing the title this time. The
   * drag overlay passes none and keeps its `<h3>`.
   */
  titleSlot?: React.ReactNode;
```

…destructure `titleSlot` alongside `goal`, and replace the `<h3>` (lines 78–85) with:

```tsx
        {titleSlot ?? (
          <h3
            title={goal.title}
            className="text-title font-semibold tracking-[-0.01em] leading-[1.24] flex-1 min-w-0 line-clamp-3"
          >
            {goal.title}
          </h3>
        )}
```

Add `onRename` to `BoardCard`'s props type and destructuring:

```tsx
  onRename: (id: string, title: string) => void;
```

Add the state beside the existing `useState`:

```tsx
  const [renaming, setRenaming] = useState(false);
```

Pass the slot into the existing `<CardFace … />` call (line 310):

```tsx
      <CardFace
        goal={goal}
        today={today}
        suppressDateBadge
        life={life}
        titleSlot={renaming ? (
          // Both handlers, for two different escapes: the pointer must not
          // reach dnd-kit's listeners on the root, and the click must not
          // reach the root's open-the-goal handler.
          <div
            className="flex-1 min-w-0"
            onPointerDown={stopPointer}
            onClick={(e) => e.stopPropagation()}
          >
            <InlineEdit
              value={goal.title}
              className="text-title font-semibold tracking-[-0.01em] leading-[1.24]"
              onCommit={(v) => { setRenaming(false); onRename(goal.id, v); }}
              onCancel={() => setRenaming(false)}
            />
          </div>
        ) : undefined}
      />
```

Add the menu item as the FIRST entry in the popover's children, above the `Move to` heading:

```tsx
              <PopoverItem close={close} onSelect={() => setRenaming(true)}>
                Rename
              </PopoverItem>
              <PopoverSeparator />
```

- [ ] **Step 4: Wire it in `Goals.tsx`**

In the `<BoardCard … />` call (around line 519), add:

```tsx
                      onRename={actions.renameGoal}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/views/goals/`
Expected: PASS. The four other `BoardCard.*` test files construct `BoardCard` without `onRename` and will now fail typecheck — add `onRename: vi.fn(),` to each of their prop objects (`BoardCard.keyboard.test.tsx`, `BoardCard.life.test.tsx`, `BoardCard.progress.test.tsx`, `BoardCard.unblock.test.tsx`).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/views/goals/ src/views/Goals.tsx
git commit -m "feat(goals): rename a goal from its card"
```

---

### Task 7: Deadline from the card

**Files:**
- Modify: `src/views/goals/BoardCard.tsx` (`CardFace` chip row, `BoardCard` props and body)
- Modify: `src/views/Goals.tsx` (pass `onSetDeadline`)
- Test: `src/views/goals/BoardCard.deadline.test.tsx` (create)

**Interfaces:**
- Consumes: `DatePopover` (Task 3); `setGoalDates(goalId, start?, deadline?): boolean` from the store.
- Produces:
  - `CardFace` gains `deadlineControl?: React.ReactNode` — when present it replaces the `Due ·` chip; the `Milestone ·` chip is unaffected.
  - `BoardCard` gains a required prop `onSetDeadline: (id: string, deadline: string | undefined) => void`.

- [ ] **Step 1: Write the failing test**

Create `src/views/goals/BoardCard.deadline.test.tsx`:

```tsx
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { BoardCard } from './BoardCard';
import type { Goal } from '../../db/types';

afterEach(cleanup);

function renderCard(over: Partial<Goal> = {}) {
  const onSetDeadline = vi.fn();
  const goal: Goal = {
    id: 'g', title: 'Finish CS:APP', nodes: [], datesConfirmed: true, ...over,
  };
  render(
    createElement(DndContext, null,
      createElement(BoardCard, {
        goal,
        today: '2026-08-14',
        onOpen: vi.fn(),
        onMove: vi.fn(),
        onRank: vi.fn(),
        onDelete: vi.fn(),
        onRename: vi.fn(),
        onSetDeadline,
        reducedMotion: false,
        dimmed: false,
        matched: false,
        lives: [],
        onSetLife: vi.fn(),
      }),
    ),
  );
  return { onSetDeadline, user: userEvent.setup() };
}

describe('the deadline chip', () => {
  /**
   * Direct manipulation is the whole point: the chip already STATES the
   * deadline, so it should be the control that sets it. A menu item opening a
   * picker somewhere else is a longer route to the same place.
   */
  it('is the control that sets the date it prints', async () => {
    const { onSetDeadline, user } = renderCard({ deadline: '2026-08-30' });

    const chip = screen.getByRole('button', { name: 'Deadline: Aug 30, 2026' });
    expect(chip.textContent).toContain('Due · Aug 30');

    await user.click(chip);
    await user.click(screen.getByRole('button', { name: 'Aug 20, 2026' }));

    expect(onSetDeadline).toHaveBeenCalledWith('g', '2026-08-20');
  });

  it('clears with undefined, not an empty string', async () => {
    const { onSetDeadline, user } = renderCard({ deadline: '2026-08-30' });

    await user.click(screen.getByRole('button', { name: 'Deadline: Aug 30, 2026' }));
    await user.click(screen.getByRole('button', { name: 'Clear deadline' }));

    expect(onSetDeadline).toHaveBeenCalledWith('g', undefined);
  });

  it('offers a quiet control when there is no deadline yet', () => {
    renderCard();
    const control = screen.getByRole('button', { name: 'Deadline: not set' });
    expect(control.textContent).toContain('Due');
    expect(control.className).toContain('quiet-control');
  });

  it('reaches the same popover from the menu, for the keyboard', async () => {
    const { onSetDeadline, user } = renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Deadline…' }));
    await user.click(screen.getByRole('button', { name: 'Aug 20, 2026' }));

    expect(onSetDeadline).toHaveBeenCalledWith('g', '2026-08-20');
  });

  /**
   * `nearestMeaningfulDate` returns a checkpoint when one falls before the
   * deadline, so the chip does not always name the deadline. Wiring a chip
   * reading `Milestone · Sep 3` to a control that writes `goal.deadline` would
   * be the card lying about what the click does.
   */
  it('leaves a Milestone chip inert and shows the deadline control beside it', () => {
    // `checkpoint?: boolean` on the node — NOT a `kind` discriminator. The
    // `kind: 'checkpoint'` in this test's sibling assertions is
    // `nearestMeaningfulDate`'s return shape, which is a different type.
    renderCard({
      deadline: '2026-12-31',
      nodes: [{ id: 'n', title: 'Draft done', checkpoint: true, deadline: '2026-09-03' }],
    });

    expect(screen.getByText(/Milestone · Sep 3/).closest('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Deadline: Dec 31, 2026' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/views/goals/BoardCard.deadline.test.tsx`
Expected: FAIL — no button named `Deadline: …`.

- [ ] **Step 3: Split the chip out of `CardFace`**

In `src/views/goals/BoardCard.tsx`, import the picker:

```tsx
import { DatePopover } from '../../components/DatePopover';
```

Add a tone helper above `CardFace`:

```tsx
/** A date chip's tone. Past is the only thing that changes it. */
function chipTone(past: boolean): string {
  return `text-meta px-[6px] py-[3px] rounded-[6px] whitespace-nowrap tabular-nums flex-none mt-[1px] ${
    past ? 'text-warn bg-warn-tint' : 'text-chip-ink bg-chip'
  }`;
}
```

Add to `CardFace`'s props type:

```tsx
  /**
   * The interactive deadline control, when there is one. Present on the real
   * card and absent on the drag overlay, which must stay inert — so `CardFace`
   * keeps drawing a plain `Due ·` chip when nothing is passed, and the two
   * never need to be different components.
   */
  deadlineControl?: React.ReactNode;
```

Replace the `{dateInfo && (…)}` chip block (lines 87–95) with:

```tsx
        {dateInfo?.kind === 'checkpoint' && (
          <span className={chipTone(dateInfo.past)}>
            Milestone · {fmtD(dateInfo.date)}
          </span>
        )}
        {deadlineControl ?? (dateInfo?.kind === 'deadline' && (
          <span className={chipTone(dateInfo.past)}>Due · {fmtD(dateInfo.date)}</span>
        ))}
```

- [ ] **Step 4: Supply the control from `BoardCard`**

Add the prop to `BoardCard`'s type and destructuring:

```tsx
  onSetDeadline: (id: string, deadline: string | undefined) => void;
```

Add a ref beside the other state:

```tsx
  const deadlineRef = useRef<HTMLButtonElement>(null);
```

(re-add `useRef` to the React import if Task 5 removed it.)

Pass `deadlineControl` on the `<CardFace …/>` call:

```tsx
        deadlineControl={
          <div
            className="flex-none mt-[1px]"
            onPointerDown={stopPointer}
            onClick={(e) => e.stopPropagation()}
          >
            <DatePopover
              value={goal.deadline ?? ''}
              today={today}
              onCommit={(next) => onSetDeadline(goal.id, next || undefined)}
              ariaLabel="Deadline"
              // With no date there is no chip to click, so the affordance is
              // hover-revealed — through `.quiet-control`, which carries the
              // `@media (hover: hover)` gate that keeps it reachable on touch,
              // and the 24px target floor. A hand-rolled reveal has neither.
              placeholder="Due"
              prefix="Due · "
              size="chip"
              triggerRef={deadlineRef}
              triggerClassName={
                goal.deadline
                  ? chipTone(dateChipPast(goal, today))
                  : 'quiet-control text-muted hover:bg-hover hover:text-ink'
              }
            />
          </div>
        }
```

Add the small helper `dateChipPast` above `BoardCard`, so the control wears the same warn tint the chip did:

```tsx
/** The tone the chip would have taken — a deadline already gone reads warn. */
function dateChipPast(goal: Goal, today: string): boolean {
  const info = nearestMeaningfulDate(goal, today);
  return info?.kind === 'deadline' && info.past;
}
```

Add the menu item, directly under `Rename`:

```tsx
              <PopoverItem close={close} onSelect={() => deadlineRef.current?.click()}>
                Deadline…
              </PopoverItem>
```

This is the pattern `GoalTree` already uses for `⇧S` and its schedule popover — `close()` runs before `onSelect`, so the menu is gone before the picker opens, and there is no nesting.

- [ ] **Step 5: Wire it in `Goals.tsx`**

Add to the `<BoardCard … />` call:

```tsx
                      onSetDeadline={(id, deadline) => {
                        const g = goalById.get(id);
                        // `start` passed through: `setGoalDates` deletes any
                        // field it is not given, so omitting it would silently
                        // drop a start date the user never touched.
                        if (g) actions.setGoalDates(id, g.start, deadline);
                      }}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/views/goals/`
Expected: PASS. Add `onSetDeadline: vi.fn(),` to the four older `BoardCard.*` test files' prop objects, as in Task 6 Step 5.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -b
git add src/views/goals/ src/views/Goals.tsx
git commit -m "feat(goals): the deadline chip is the control that sets it"
```

---

### Task 8: Date chips disclose the year

**Files:**
- Modify: `src/lib/dates.ts` (append `fmtDY`)
- Test: `src/lib/dates.test.ts` (append; create the file if absent)
- Modify: `src/views/goals/BoardCard.tsx` (both chips)
- Modify: `src/views/Goals.tsx` (`CompletedSection`)

**Interfaces:**
- Consumes: existing `fmtD`.
- Produces: `fmtDY(s: string, today: string): string` — `fmtD`'s output within the current year, `'Jun 30, 2027'` outside it.

- [ ] **Step 1: Write the failing test**

`src/lib/dates.test.ts` already exists. Extend its line-2 import to
`import { fmtD, fmtDY, millisecondsUntilNextLocalMidnight, weekDates } from './dates';`
and append this block — do not re-import `describe`/`it`/`expect`:

```ts
/**
 * `Due · Jun 30` on a Someday card means June 2027 as often as June 2026, and
 * the two are the same six characters. On the board's most-read chip that is
 * not an inconvenience, it is misinformation.
 */
describe('fmtDY', () => {
  it('says nothing extra inside the current year', () => {
    expect(fmtDY('2026-06-30', '2026-08-14')).toBe('Jun 30');
    expect(fmtDY('2026-06-30', '2026-08-14')).toBe(fmtD('2026-06-30'));
  });

  it('names the year outside it, in both directions', () => {
    expect(fmtDY('2027-06-30', '2026-08-14')).toBe('Jun 30, 2027');
    expect(fmtDY('2025-12-31', '2026-08-14')).toBe('Dec 31, 2025');
  });

  it('compares years and not distance — Dec 31 and Jan 1 are a day apart', () => {
    expect(fmtDY('2027-01-01', '2026-12-31')).toBe('Jan 1, 2027');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL — `fmtDY is not a function`.

- [ ] **Step 3: Implement it**

Append to `src/lib/dates.ts`:

```ts
/**
 * A date, with the year only when the year is not obvious.
 *
 * `fmtD` prints `Jun 30`, which is right almost everywhere — inside a week
 * grid, a month cell or a project header the year is fixed by the surface. On
 * a Someday card it is not: the board can hold a goal due this June and one due
 * June two years out, and it printed them identically.
 *
 * `fmtD` itself is untouched. Most of its callers sit inside a context that
 * already fixes the year, and a suffix there would be noise.
 */
export function fmtDY(s: string, today: string): string {
  return s.slice(0, 4) === today.slice(0, 4) ? fmtD(s) : `${fmtD(s)}, ${s.slice(0, 4)}`;
}
```

- [ ] **Step 4: Spend it on the two surfaces**

In `src/views/goals/BoardCard.tsx`, add `fmtDY` to the `../../lib/dates` import and swap both chips written in Task 7:

```tsx
        {dateInfo?.kind === 'checkpoint' && (
          <span className={chipTone(dateInfo.past)}>
            Milestone · {fmtDY(dateInfo.date, today)}
          </span>
        )}
        {deadlineControl ?? (dateInfo?.kind === 'deadline' && (
          <span className={chipTone(dateInfo.past)}>Due · {fmtDY(dateInfo.date, today)}</span>
        ))}
```

In `src/components/DatePopover.tsx`, the trigger should match. Change the trigger's value span to take `today` into account:

```tsx
            {value ? `${prefix}${fmtDY(value, today)}` : placeholder}
```

…importing `fmtDY` alongside `fmtD`. `dayLabel` already carries the year unconditionally and stays as it is — an accessible name is read out of context, where the year is never obvious.

In `src/views/Goals.tsx`, `CompletedSection` needs today. Change its signature and call:

```tsx
function CompletedSection({ goals, today, onReopen }: { goals: Goal[]; today: string; onReopen: (id: string) => void }) {
```

```tsx
              {g.completedAt && <span className="font-mono text-tiny text-muted whitespace-nowrap">{fmtDY(g.completedAt, today)}</span>}
```

```tsx
      {completed.length > 0 && <CompletedSection goals={completed} today={currentDate} onReopen={actions.reopenGoal} />}
```

…and swap the `fmtD` import in `Goals.tsx` for `fmtDY`.

- [ ] **Step 5: Update the deadline test's expectation**

`BoardCard.deadline.test.tsx` renders with `today: '2026-08-14'` and a `2026-08-30` deadline, so `fmtDY` prints `Aug 30` and the assertions in Task 7 still hold. The Milestone case uses `2026-09-03` — also the current year. No edit needed; run to confirm.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/dates.ts src/lib/dates.test.ts src/views/goals/BoardCard.tsx src/views/Goals.tsx src/components/DatePopover.tsx
git commit -m "fix(goals): a date chip discloses the year when it is not this one"
```

---

## Verification

- [ ] `npm test` — full suite green, including `designScale.test.ts` and `views.smoke.test.ts`.
- [ ] `npx tsc -b` — clean.
- [ ] `npm run dev`, then by hand on the Goals board:
  - `⌘N` → the Deadline control reads **No deadline** and opens a calendar; Tab reaches it as one stop; arrows move a day; Enter commits and closes; Escape closes the picker and leaves the dialog open.
  - A card's `⋯` → **Rename**, **Deadline…**, Move to (with `⌥←`/`⌥→` beside the neighbouring horizons), Life, Delete goal.
  - A card at the very bottom of a tall column → the `⋯` menu opens **upward**.
  - Hovering a card with no deadline reveals a quiet **Due** chip; clicking it picks a date; the card then reads `Due · <date>` and Undo offers `Updated dates for "…"`.
  - A goal due next year reads `Due · Jun 30, 2027`.
