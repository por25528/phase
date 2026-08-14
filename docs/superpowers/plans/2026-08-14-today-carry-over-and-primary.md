# Today: Carried Over + Primary Row — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today shows the slipped work it currently only counts, and its primary row reads as the page's answer instead of as metadata.

**Architecture:** Two pure helpers land in `src/lib/todaySurface.ts` (`carriedFrom`, `carryOverRows`) so ordering and capping are unit-testable without mounting anything. `Today.tsx` gains one section that reuses its existing `place()` function — no new store action. A shared `rowBtn` in `dialogStyles.ts` replaces one hand-rolled outlined button and promotes `Start session`.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Vitest + @testing-library/react (jsdom).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-14-today-carry-over-and-primary-design.md`
- Run `npm test` and `npx tsc -b` before every commit.
- Pure logic goes in `src/lib` with a sibling `*.test.ts`. Views stay thin and delegate to `actions`.
- No literal hex colours, no arbitrary `text-[Nrem]` — `designScale.test.ts` fails the build on both. Use theme tokens and named `fontSize` steps only.
- A section label is exactly `text-meta font-semibold text-muted`, sentence case.
- `.quiet-control` is the only way to hover-reveal a row control; it needs a literal `group` ancestor (`group/name` does not match).
- An interactive child inside `TaskRow`'s `meta` slot must carry `relative z-10`, or the row's stretched click overlay covers it.
- Visual identity is locked. Do not restyle anything this plan does not name.

---

### Task 1: `carriedFrom` and `carryOverRows`

**Files:**
- Modify: `src/lib/todaySurface.ts`
- Test: `src/lib/todaySurface.test.ts`

**Interfaces:**
- Consumes: `DailyWorkItem` from `./dailyWork`, `parseD` from `./dates`.
- Produces:
  - `MAX_CARRY_OVER: number` (5)
  - `carriedFrom(item: DailyWorkItem, today: string): string | null`
  - `carryOverRows(carryOvers: DailyWorkItem[], today: string): { rows: DailyWorkItem[]; overflow: number }`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/todaySurface.test.ts`:

```ts
describe('carriedFrom', () => {
  const task = (date: string) => item({ kind: 'task', source: 'carry-over', scheduledDate: date });
  const step = (week: string) => item({ kind: 'step', source: 'carry-over', plannedWeek: week });

  it('counts days for anything inside a week', () => {
    expect(carriedFrom(task('2026-08-11'), TODAY)).toBe('Yesterday');
    expect(carriedFrom(task('2026-08-09'), TODAY)).toBe('3d ago');
  });

  /**
   * A step's date is a WEEK commitment and is only ever accurate to the week.
   * Reporting "9d ago" about it would be a precision the stored value does not
   * have, so the phrasing changes at the 7-day boundary rather than tapering.
   */
  it('counts weeks beyond seven days', () => {
    expect(carriedFrom(step('2026-08-03'), TODAY)).toBe('Last week');
    expect(carriedFrom(step('2026-07-20'), TODAY)).toBe('3w ago');
  });

  it('reads a task from its date and a step from its planned week', () => {
    expect(carriedFrom(task('2026-08-10'), TODAY)).toBe('2d ago');
    expect(carriedFrom(step('2026-08-10'), TODAY)).toBe('2d ago');
  });

  it('says nothing for an item carrying no date at all', () => {
    expect(carriedFrom(item({ source: 'carry-over' }), TODAY)).toBeNull();
  });
});

describe('carryOverRows', () => {
  const task = (id: string, date: string) =>
    item({ id, key: `task:${id}`, kind: 'task', source: 'carry-over', scheduledDate: date });
  const step = (id: string, week: string) =>
    item({ id, key: `step:${id}`, kind: 'step', source: 'carry-over', plannedWeek: week });

  /** The thing that slipped furthest has waited longest — `slippedWork`'s rule. */
  it('orders oldest first across both kinds', () => {
    const out = carryOverRows([
      task('recent', '2026-08-11'),
      step('old', '2026-07-27'),
      task('middle', '2026-08-05'),
    ], TODAY);
    expect(out.rows.map((r) => r.id)).toEqual(['old', 'middle', 'recent']);
    expect(out.overflow).toBe(0);
  });

  it('caps the list and reports what it withheld', () => {
    const many = Array.from({ length: 8 }, (_, i) => task(`t${i}`, `2026-08-0${i + 1}`));
    const out = carryOverRows(many, TODAY);
    expect(out.rows).toHaveLength(MAX_CARRY_OVER);
    expect(out.overflow).toBe(3);
  });

  it('drops anything already finished', () => {
    const out = carryOverRows([
      task('done', '2026-08-01'),
      task('open', '2026-08-02'),
    ].map((r) => (r.id === 'done' ? { ...r, done: true } : r)), TODAY);
    expect(out.rows.map((r) => r.id)).toEqual(['open']);
  });

  it('is empty and silent when nothing slipped', () => {
    expect(carryOverRows([], TODAY)).toEqual({ rows: [], overflow: 0 });
  });
});
```

Update the import at the top of the file (line 4) to:

```ts
import {
  MAX_ATTENTION, MAX_CARRY_OVER, attentionItems, carriedFrom, carryOverRows, nowFocus, surfaceReason,
} from './todaySurface';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/todaySurface.test.ts`
Expected: FAIL — `carriedFrom is not a function`, `carryOverRows is not a function`, `MAX_CARRY_OVER` undefined.

- [ ] **Step 3: Implement both helpers**

Add `parseD` to the existing `./dates` import in `src/lib/todaySurface.ts` (it currently imports `fmtD`):

```ts
import { fmtD, parseD } from './dates';
```

Append to `src/lib/todaySurface.ts`:

```ts
/**
 * The most carry-over rows Today will draw.
 *
 * A section listing everything overdue is the second backlog rail this surface
 * must not become. Five is the same number `PROPOSAL_MAX` settled on, for the
 * same reason: past it, a list stops being a decision.
 */
export const MAX_CARRY_OVER = 5;

/** The date a carry-over slipped from: a task's day, a step's week. */
function carriedDate(item: DailyWorkItem): string | undefined {
  return item.kind === 'task' ? item.scheduledDate : item.plannedWeek;
}

/**
 * How long ago a carry-over slipped — the one fact justifying its row.
 *
 * Days inside a week, weeks beyond it. The boundary is a boundary rather than a
 * taper because a step's date is a WEEK commitment: it is only ever accurate to
 * the week, and "9d ago" would claim a precision the stored value does not have.
 */
export function carriedFrom(item: DailyWorkItem, today: string): string | null {
  const from = carriedDate(item);
  if (!from) return null;
  const days = Math.round((parseD(today).getTime() - parseD(from).getTime()) / 86_400_000);
  if (days <= 0) return null;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? 'Last week' : `${weeks}w ago`;
}

/**
 * The rows Today draws, and the count it withheld.
 *
 * Oldest first, for `slippedWork`'s reason: the thing that slipped furthest has
 * waited longest, and a section that leads with yesterday buries the week-old
 * one underneath it.
 */
export function carryOverRows(
  carryOvers: DailyWorkItem[],
  today: string,
): { rows: DailyWorkItem[]; overflow: number } {
  const open = carryOvers.filter((i) => !i.done);
  const ordered = [...open].sort((a, b) => {
    const ad = carriedDate(a) ?? today;
    const bd = carriedDate(b) ?? today;
    return ad.localeCompare(bd);
  });
  return {
    rows: ordered.slice(0, MAX_CARRY_OVER),
    overflow: Math.max(0, ordered.length - MAX_CARRY_OVER),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/todaySurface.test.ts`
Expected: PASS, all suites.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/todaySurface.ts src/lib/todaySurface.test.ts
git commit -m "feat(lib): how long ago it slipped, and which five to show"
```

---

### Task 2: `rowBtn`, and the primary row that reads as one

**Files:**
- Modify: `src/components/dialogStyles.ts`
- Modify: `src/views/Today.tsx` (the `Replan` button ~line 190; `startSessionButton` ~line 143; the three section labels)
- Test: `src/views/Today.freeTime.test.tsx`

**Interfaces:**
- Consumes: `CONTROL_LINE` from `dialogStyles.ts`.
- Produces: `rowBtn: string` — an outlined, row-height button style.

- [ ] **Step 1: Write the failing test**

Append to the `describe('the shared primary', …)` block in `src/views/Today.freeTime.test.tsx`:

```ts
  /**
   * The one action the surface exists to offer used to render as `text-meta
   * text-muted` — eleven-pixel grey text, quieter than the row it sat on.
   */
  it('renders Start session as a button rather than as metadata', async () => {
    await mountToday();

    const btn = screen.getByRole('button', { name: 'Start session on “Draft the intro”' });
    expect(btn.className).toContain('border');
    expect(btn.className).not.toContain('text-muted');
  });

  /** Three labels, three left edges, two colours. One of each now. */
  it('sits every section label on its rows’ axis, in the one label style', async () => {
    await mountToday({
      goals: [{
        id: 'g1', title: 'Thesis', column: 0,
        nodes: [
          { id: 'n1', title: 'Draft the intro', plannedWeek: '2026-07-13' },
          { id: 'n2', title: 'Revise the intro', plannedWeek: '2026-07-13' },
        ],
      }],
    });

    const label = screen.getByText('Rest of today');
    expect(label.className).toContain('px-[8px]');
    expect(label.className).toContain('text-meta font-semibold text-muted');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/Today.freeTime.test.tsx -t 'Start session as a button'`
Expected: FAIL — the className contains `text-muted` and no `border`.

- [ ] **Step 3: Add `rowBtn` to `dialogStyles.ts`**

Append to `src/components/dialogStyles.ts`:

```ts
/**
 * An action that lives inside a list row.
 *
 * `primaryBtn` is 33px, sized for a dialog footer; a filled button of that
 * height inside a row would break the row rhythm and reverse the decision that
 * made the section label the emphasis and put Now on the same axis as every
 * other row. Outlined and row-height reads as an action rather than as
 * metadata without reopening that.
 *
 * 31px: 1 + 4 + 21 + 4 + 1. Two less than `CONTROL_H`, because a row is not a
 * dialog — and stated here so the two cannot drift into "nearly the same".
 */
export const rowBtn =
  `${CONTROL_LINE} inline-flex items-center justify-center px-[10px] py-[4px] rounded-field `
  + 'border border-line-2 bg-panel text-ui font-semibold text-ink hover:bg-hover';
```

- [ ] **Step 4: Spend it in `Today.tsx`**

Add to the imports at the top of `src/views/Today.tsx`:

```ts
import { rowBtn } from '../components/dialogStyles';
```

Replace `startSessionButton`'s `className` (currently `"relative z-10 text-meta font-semibold text-muted hover:text-ink"`):

```tsx
        className={`relative z-10 ${rowBtn}`}
```

Replace the `Replan` button's hand-rolled class list (currently `"text-ui font-semibold text-ink px-[10px] py-[5px] rounded-field border border-line-2 bg-panel hover:bg-hover"`):

```tsx
            className={rowBtn}
```

Unify the three section labels. The Now/Next label and the free-time heading:

```tsx
            <div className="px-[8px] mb-[2px] text-meta font-semibold text-muted">
```

(both occurrences — the `'Now' : 'Next'` one and the `offerHeading` one)

`Rest of today`, the free-time `<h2>`, and `Attention` each gain `px-[8px]`:

```tsx
          <h2 className="px-[8px] text-meta font-semibold text-muted mb-[6px]">Rest of today</h2>
```

```tsx
          <h2 className="px-[8px] text-meta font-semibold text-muted mb-[6px]">
```

```tsx
          <h2 className="px-[8px] text-meta font-semibold text-muted mb-[6px]">Attention</h2>
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. `designScale.test.ts` must stay green — `rowBtn` uses only theme tokens and named `fontSize` steps.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/components/dialogStyles.ts src/views/Today.tsx src/views/Today.freeTime.test.tsx
git commit -m "feat(today): one outlined row button, and labels on one axis"
```

---

### Task 3: The Carried over section

**Files:**
- Modify: `src/views/Today.tsx`
- Test: `src/views/Today.carryOver.test.tsx` (create)

**Interfaces:**
- Consumes: `carriedFrom`, `carryOverRows`, `MAX_CARRY_OVER` (Task 1); `rowBtn` (Task 2); the existing `place(row, date, isToday)` and `complete(item)` in `Today.tsx`.
- Produces: nothing consumed by a later task.

**Note on `place()`:** it takes a `ProposalRow`, which needs `key`, `kind`, `id`, `goalId?`, `title`, `goalTitle`. A `DailyWorkItem` carries all of these except that its `goalId` is `string | null` where `ProposalRow`'s is `string | undefined`. Convert at the call site — do not widen `ProposalRow`.

- [ ] **Step 1: Write the failing test**

Create `src/views/Today.carryOver.test.tsx`. Copy lines 1–102 of `src/views/Today.freeTime.test.tsx` verbatim (the `dbMocks` hoist, both `vi.mock` calls, the `beforeAll` matchMedia shim, `TODAY`, `WORKDAY`, `project`, `mountToday`, `beforeEach`, `afterEach`) — the harness is identical and there is no shared fixture module to import from. Then append:

```tsx
import { blocksOf } from '../lib/blocks';

/** A task whose day has passed, and a step whose week has. */
const slippedTask = (id: string, date: string): Task =>
  ({ id, title: id, done: false, goalId: null, date, estimateMin: 30 });

describe('carried over', () => {
  it('shows the work it used to only count', async () => {
    await mountToday({
      goals: [],
      tasks: [slippedTask('Renew T pass', '2026-07-13')],
    });

    expect(screen.getByText('Carried over')).toBeTruthy();
    expect(screen.getByText('Renew T pass')).toBeTruthy();
    expect(screen.getByText('2d ago')).toBeTruthy();
  });

  it('orders oldest first', async () => {
    await mountToday({
      goals: [],
      tasks: [
        slippedTask('Yesterday thing', '2026-07-14'),
        slippedTask('Old thing', '2026-07-01'),
      ],
    });

    const section = screen.getByLabelText('Carried over');
    const titles = [...section.querySelectorAll('li')].map((li) => li.textContent);
    expect(titles[0]).toContain('Old thing');
    expect(titles[1]).toContain('Yesterday thing');
  });

  it('places a row on today and the row leaves the section', async () => {
    const store = await mountToday({
      goals: [],
      tasks: [slippedTask('Renew T pass', '2026-07-13')],
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Renew T pass” today' }).click();
    });

    const [block] = blocksOf(store.getState().tasks[0]);
    expect(block).toMatchObject({ date: TODAY, startMin: 10 * 60 });
    expect(screen.queryByLabelText('Carried over')).toBeNull();
  });

  /** A distance booking, so a stray press is reversible. */
  it('arms an undo', async () => {
    const store = await mountToday({
      goals: [],
      tasks: [slippedTask('Renew T pass', '2026-07-13')],
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Renew T pass” today' }).click();
    });

    expect(store.getState().pendingUndo?.label).toBe('Scheduled "Renew T pass"');
  });

  it('caps the list and says what it withheld, without offering a way out', async () => {
    await mountToday({
      goals: [],
      tasks: Array.from({ length: 7 }, (_, i) => slippedTask(`slip ${i}`, `2026-07-0${i + 1}`)),
    });

    const section = screen.getByLabelText('Carried over');
    expect(section.querySelectorAll('li')).toHaveLength(5);
    // Static text, never a link: sending it to Plan is the dead end this
    // section exists to retire.
    const more = screen.getByText('+2 more');
    expect(more.closest('button')).toBeNull();
    expect(more.closest('a')).toBeNull();
  });

  it('says nothing at all when nothing slipped', async () => {
    await mountToday({ goals: [], tasks: [] });
    expect(screen.queryByLabelText('Carried over')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/Today.carryOver.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Carried over`.

- [ ] **Step 3: Render the section**

Add to the imports in `src/views/Today.tsx`:

```ts
import { attentionItems, carriedFrom, carryOverRows, surfaceReason } from '../lib/todaySurface';
```

(replacing the existing `todaySurface` import line)

Add below the `offer` memo:

```tsx
  // The work the page used to name and refuse to show. Below the day's own
  // plan, which outranks yesterday's leftovers, and above the exceptions.
  const carried = useMemo(
    () => carryOverRows(sections.carryOvers, today),
    [sections, today],
  );
```

Insert this section between the free-time `</section>` and the `{/* ── Attention ── */}` comment:

```tsx
      {/* ── Carried over ──
          One row per slipped commitment, oldest first. The verb is `place`,
          the same one the offer rows above use, so "put this on today" means
          exactly one thing on this page — and `scheduleTask`/`scheduleNode`
          vacate the stale sitting and arm the undo without help. */}
      {carried.rows.length > 0 && (
        <section aria-label="Carried over" className="mb-[24px]">
          <h2 className="px-[8px] text-meta font-semibold text-muted mb-[6px]">Carried over</h2>
          <ul>
            {carried.rows.map((item) => (
              <li key={item.key}>
                <TaskRow
                  title={item.title}
                  subtitle={item.goalTitle}
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
                      {/* No `surfaceReason` chip: the heading is the reason. */}
                      {carriedFrom(item, today) && <span>{carriedFrom(item, today)}</span>}
                      <button
                        type="button"
                        onClick={() => place(
                          {
                            key: item.key,
                            kind: item.kind,
                            id: item.id,
                            ...(item.goalId ? { goalId: item.goalId } : {}),
                            title: item.title,
                            goalTitle: item.goalTitle ?? '',
                          },
                          today,
                          true,
                        )}
                        aria-label={`Plan “${item.title}” today`}
                        className={`relative z-10 quiet-control ${rowBtn}`}
                      >
                        Today
                      </button>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
          {carried.overflow > 0 && (
            /* Static text. A link here would be the dead end this section
               retires — five rows have already been shown. */
            <p className="px-[8px] mt-[4px] text-meta text-muted">
              +{carried.overflow} more
            </p>
          )}
        </section>
      )}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. Today now renders both the rows and — until Task 4 — the Attention count beside them. That duplication is visible for exactly one commit and is why Task 4 follows immediately.

- [ ] **Step 5: Commit**

```bash
npx tsc -b
git add src/views/Today.tsx src/views/Today.carryOver.test.tsx
git commit -m "feat(today): the page shows the work it names"
```

---

### Task 4: Retire the carry-over exception

**Files:**
- Modify: `src/lib/todaySurface.ts` (the `carried` branch, ~lines 109-116)
- Modify: `src/views/Today.tsx` (the Attention click handler, ~line 383)
- Test: `src/lib/todaySurface.test.ts`, `src/views/Today.carryOver.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AttentionItem.goalId` is now present on every item `attentionItems` returns.

- [ ] **Step 1: Update the tests**

In `src/lib/todaySurface.test.ts`, DELETE these two tests entirely:
- `it('names work that slipped from an earlier day', …)` (lines 96-102)
- `it('does not count a carry-over that has since been finished', …)` (lines 104-107)

Replace them with:

```ts
  /**
   * Carry-overs are rows on the page now. A count in the exceptions region
   * beside the rows themselves is the same fact stated twice, and its click
   * had nowhere to go but Plan.
   */
  it('leaves slipped work to the section that lists it', () => {
    const s = sections({ carryOvers: [item({ id: 'x' }), item({ id: 'y' })] });
    expect(attention([goal('fine')], s)).toEqual([]);
  });

  it('gives every exception a goal to open', () => {
    const doomed = goal('Physics Final', { nodes: [leaf('a', { estimateMin: 100_000 })] });
    expect(attention([doomed]).every((a) => a.goalId !== undefined)).toBe(true);
  });
```

And append to the `describe('carried over', …)` block in
`src/views/Today.carryOver.test.tsx` — the page-level half of the same rule:

```tsx
  /**
   * The whole complaint about the Attention row was that it named work and
   * then sent you somewhere else to find it. Both must not be true at once.
   */
  it('states the count once, as rows, never also as an exception', async () => {
    await mountToday({
      goals: [],
      tasks: [slippedTask('Renew T pass', '2026-07-13')],
    });

    expect(screen.getByText('Renew T pass')).toBeTruthy();
    expect(screen.queryByText(/slipped from an earlier day/)).toBeNull();
  });
```

And in `it('never shows more than three, however bad the week is', …)`, replace the body (lines 147-152) with:

```ts
    const doomed = (id: string) => goal(id, { nodes: [leaf('a', { estimateMin: 100_000 })] });
    const out = attention([doomed('a'), doomed('b'), doomed('c'), doomed('d')]);
    expect(out).toHaveLength(MAX_ATTENTION);
    expect(out[0].kind).toBe('at-risk');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/todaySurface.test.ts -t 'leaves slipped work'`
Expected: FAIL — receives one `carry-over` item, expected `[]`.

- [ ] **Step 3: Remove the branch**

In `src/lib/todaySurface.ts`, delete these lines:

```ts
  const carried = sections.carryOvers.filter((i) => !i.done).length;
  if (carried > 0) {
    out.push({
      id: 'carry-over',
      kind: 'carry-over',
      text: `${carried} task${carried === 1 ? '' : 's'} slipped from an earlier day`,
    });
  }
```

`sections` is now unused by the function body. Keep the parameter — `DailyWorkSections` is part of the signature every caller passes and removing it is a wider change than this task — and prefix it to satisfy the linter:

```ts
export function attentionItems(
  goals: Goal[],
  _sections: DailyWorkSections,
  today: string,
```

Also drop `'carry-over'` from the `AttentionKind` union if it is no longer produced anywhere; run `npx tsc -b` to confirm nothing else referenced it.

- [ ] **Step 4: Remove the dead navigation fallback**

In `src/views/Today.tsx`, the Attention button's handler was `() => (a.goalId ? actions.openProject(a.goalId, a.nodeId) : actions.setView('plan'))`. Every remaining item has a `goalId`, so:

```tsx
                  onClick={() => a.goalId && actions.openProject(a.goalId, a.nodeId)}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/todaySurface.ts src/lib/todaySurface.test.ts src/views/Today.tsx src/views/Today.carryOver.test.tsx
git commit -m "refactor(today): an exception you can act on, or no exception"
```

---

### Task 5: Record the rules in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (the Invariants section)

**Interfaces:**
- Consumes: everything above. Produces: nothing.

- [ ] **Step 1: Add the invariant**

Add this bullet to the Invariants list, after the `Today's free-time offer spends backlogGroups and nothing else` bullet:

```markdown
- **Today shows the slipped work it names, and names it once.** A carry-over is
  a COMMITMENT whose day or week has passed (`task.date < today`,
  `plannedWeek < currentWeek`) — a different population from `slippedWork`,
  which walks `blocksOf` for past SITTINGS, which is why the Replan strip could
  count nothing on a day the page said something had slipped. `carryOverRows`
  orders oldest-first and caps at `MAX_CARRY_OVER` (5) with a `+N more` line
  that is STATIC TEXT, never a link: sending it to Plan is the dead end the
  section was built to retire, and it was the whole complaint about the
  `attentionItems` carry-over row that this replaced. The row's verb is
  `place()` — the same function the free-time offer rows spend — because
  `ScheduleMenu` already spends the word "Today" to mean *place a block today*,
  and one word cannot mean two things on one page. That reuse is also why there
  is no new store action: no `blockId` means a distance booking, so
  `scheduleTask`/`scheduleNode` vacate the stale sitting and arm the undo
  unaided. At 19:00 with the window shut the verb refuses via `describeNoRoom`,
  exactly as the offer row above it does — a fallback that committed without
  placing would put two behaviours behind one label.
- **A row's action is `rowBtn`, and 31px is why.** `primaryBtn` is 33px, sized
  for a dialog footer; filling a row with one would break the row rhythm and
  reverse the decision that made the section label the emphasis. `Start session`
  and the Replan strip's button are the two that spend it. `expectedTimeLabel`
  stays BESIDE it rather than moving into the subtitle: it returns whole phrases
  (`Usually 45–60m`), and there is no honest one-number form of a range.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the section that shows what it names, and the row's own button"
```

---

## Self-Review

**Spec coverage.** Placement (Task 3), membership and order (Task 1), the cap and static overflow (Tasks 1 and 3), the row's shape and no `surfaceReason` chip (Task 3), `carriedFrom`'s 7-day boundary (Task 1), the `place()` verb and its accepted refusal (Task 3), what retires (Task 4), `rowBtn` and the Replan adoption (Task 2), the right-edge cluster and why the estimate does not move (Task 2 — no code change beyond the button, which is the point), section labels (Task 2), tests (each task). No gaps.

**Type consistency.** `carryOverRows` returns `{ rows, overflow }` in Task 1 and is destructured as `carried.rows` / `carried.overflow` in Task 3. `carriedFrom(item, today)` takes the same two arguments in both. `rowBtn` is exported in Task 2 and imported in Tasks 2 and 3. `MAX_CARRY_OVER` is asserted in Task 1's test and drives Task 3's cap test (5 rows from 7 tasks, `+2 more`).

**Every commit is green.** An earlier draft left one test red across the Task 3 / Task 4 boundary, which breaks the repo's "run `npm test` before committing" rule. The test that asserts the count is stated *once* now lives in Task 4, beside the change that makes it true. Tasks 3 and 4 must still land in that order: after Task 3 the page shows the rows *and* the Attention count for exactly one commit. Duplication for one commit is the right way round — the alternative order leaves the page silent about slipped work instead.
