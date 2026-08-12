# Today coherence — one edge, one mention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Say each task once on Today, and put every task title on one left edge.

**Architecture:** Two independent defects, fixed at the layer that owns each. The duplication is a data question — "Rest of today" must exclude the item the Next block already shows, and `todayPlan` must exclude everything Today already lists — so it is fixed in `lib` and in the view's selection, with tests. The ragged edge is a geometry question, fixed by giving `TaskRow` two new reservation props and having all three of Today's task renderings go through it, so the Next block stops being hand-rolled markup on its own axis.

**Tech Stack:** React 19, TypeScript, Tailwind 3, Vitest + @testing-library/react (jsdom).

## Global Constraints

Copied from `CLAUDE.md` and enforced by `src/lib/designScale.test.ts` — the build fails on any of these:

- No arbitrary font sizes. Use a named `fontSize` key (`meta`, `ui`, `body`, `lead`, …). Never `text-[0.9rem]`.
- Radii: only `rounded-[4px]`, `rounded-[6px]`, `rounded-[11px]`, `rounded-field` (9px), `rounded-card` (14px).
- No literal hex / `rgb()` / `hsl()` colours. Theme tokens only.
- No Unicode icon glyphs (`✕✓✎▶◆◇⠿⋯✦⚠⌕＋`). Use `src/components/Icons.tsx`.
- `font-disp` only in `App.tsx`. `uppercase` only in `views/plan/MonthGrid.tsx`, `views/plan/WeekGrid.tsx`, `views/timeline/DaysLane.tsx`.
- `border-dashed` only in `views/plan/DayColumn.tsx` and `views/plan/EventBlock.tsx`.
- A section label is `text-meta font-semibold text-muted`, sentence case. Do not enlarge Today's section headings.
- Hover-revealed controls use `.quiet-control`, never hand-rolled `opacity-0 group-hover:opacity-100`.
- `jest-dom` is NOT installed. Assert with plain DOM reads (`el.textContent`, `el.className`, `el.getAttribute(...)`), never `expect(el).toBeInTheDocument()`.
- **Nothing interactive may go in `TaskRow`'s `meta`.** The stretched overlay covers it, so a control there is unclickable and the click falls through to `onOpen` — which on the offer list is a persisted schedule write with no undo.
- Run `npm test` and `npx tsc -b` before every commit.

**Baseline before starting:** `tsc -b` clean, 126 test files, 2424 tests passing.

**Two identity facts this plan relies on:** `DailyWorkItem.key` is `` `task:${id}` `` / `` `step:${id}` `` (`dailyWork.ts:89,108`) and `ProposalRow.key` is `` `${kind}:${id}` `` (`todayPlan.ts:97`). They are the same format, so the two surfaces can be compared by key directly.

---

### Task 1: The offer never re-offers what Today already lists

**Files:**
- Modify: `src/lib/todayPlan.ts` (`proposalRows`, `TodayPlanInput`, `todayPlan`)
- Test: `src/lib/todayPlan.test.ts`

**Interfaces:**
- Produces, relied on by Task 4:
  - `proposalRows(goals, tasks, week, today, exclude?: ReadonlySet<string>): ProposalRow[]`
  - `TodayPlanInput` gains `exclude?: ReadonlySet<string>` — keys in `` `${kind}:${id}` `` form.

**The subtlety that must not be missed.** `proposalRows` takes `group.items[0]` — one row per project. If that first item is excluded, the project must fall through to its next unexcluded item, NOT lose its row. A project whose most urgent step is already on today's list still has a queue worth offering.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/todayPlan.test.ts` (keep the file's existing fixtures and imports; add a new `describe`):

```ts
describe('todayPlan exclusions', () => {
  /**
   * A step committed to this week with no block is legitimately BOTH "on
   * today" and "not yet placed", so it was rendered twice on one screen — once
   * in Rest of today and again in the offer below it. The offer's whole claim
   * is that it knows what is worth doing; repeating what the page already says
   * is the fastest way to lose that.
   */
  it('drops a row the caller says is already on the page', () => {
    const rows = proposalRows(GOALS, TASKS, WEEK, TODAY);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    const after = proposalRows(GOALS, TASKS, WEEK, TODAY, new Set([first.key]));
    expect(after.map((r) => r.key)).not.toContain(first.key);
  });

  /**
   * One row per PROJECT. Excluding a project's most urgent item must fall
   * through to its next one, not delete the project from the offer — the queue
   * behind it is still work worth proposing.
   */
  it('falls through to the next item in the same project', () => {
    const all = proposalRows(GOALS, TASKS, WEEK, TODAY);
    const target = all[0];
    const after = proposalRows(GOALS, TASKS, WEEK, TODAY, new Set([target.key]));
    const sameProject = after.find((r) => r.goalTitle === target.goalTitle);
    // The project keeps a row, and it is a DIFFERENT item.
    expect(sameProject).toBeTruthy();
    expect(sameProject!.key).not.toBe(target.key);
  });

  it('threads the exclusion through todayPlan', () => {
    const open = todayPlan({ ...BASE_INPUT });
    expect(open.kind).toBe('offer');
    const keys = open.kind === 'offer' ? open.rows.map((r) => r.key) : [];
    const filtered = todayPlan({ ...BASE_INPUT, exclude: new Set(keys) });
    // Everything it would have offered is already on the page, so it has
    // nothing left to say — and says nothing, rather than repeating.
    expect(filtered.kind).toBe('none');
  });
});
```

If the file's existing fixtures are not named `GOALS` / `TASKS` / `WEEK` / `TODAY` / `BASE_INPUT`, use whatever it already defines rather than inventing new ones — read the file first and adapt these three tests to its fixtures. Do not duplicate a fixture that already exists.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/todayPlan.test.ts`
Expected: FAIL — `proposalRows` takes 4 arguments, and `exclude` is not on `TodayPlanInput`.

- [ ] **Step 3: Implement**

In `src/lib/todayPlan.ts`, change `proposalRows` to take the optional set and pick each project's first UNEXCLUDED item:

```ts
export function proposalRows(
  goals: Goal[],
  tasks: Task[],
  week: string,
  today: string,
  exclude: ReadonlySet<string> = new Set(),
): ProposalRow[] {
  const firsts: { item: BacklogItem; goalTitle: string }[] = [];
  for (const group of backlogGroups(goals, tasks, week, today)) {
    // The first item this project has that the page is not already showing.
    // Skipping the project entirely would delete a real queue from the offer
    // just because its most urgent step is already on today's list.
    const item = group.items.find((i) => !exclude.has(`${i.kind}:${i.id}`));
    if (item) firsts.push({ item, goalTitle: group.goalTitle });
  }
  const ordered = sortByDue(firsts.map((f) => f.item), today);
  const titleFor = new Map(firsts.map((f) => [`${f.item.kind}:${f.item.id}`, f.goalTitle]));
  return ordered
    .slice(0, PROPOSAL_MAX)
    .map((item) => row(item, titleFor.get(`${item.kind}:${item.id}`) ?? ''));
}
```

Add to `TodayPlanInput`:

```ts
  /**
   * Keys (`${kind}:${id}`) the caller is ALREADY showing. Today passes its
   * commitments, so the offer and the list above it never name the same task
   * twice. Same format as `DailyWorkItem.key`.
   */
  exclude?: ReadonlySet<string>;
```

And in `todayPlan`, destructure it and pass it through:

```ts
  const { goals, tasks, availability, blocks, allDayBlocks, today, week, now, exclude } = input;
  ...
  const rows = proposalRows(goals, tasks, week, today, exclude);
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/todayPlan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx tsc -b && npm test
git add src/lib/todayPlan.ts src/lib/todayPlan.test.ts
git commit -m "feat(today): the offer never re-offers what the page already lists"
```

---

### Task 2: `TaskRow` can reserve a column it has no control for

**Files:**
- Modify: `src/components/TaskRow.tsx`
- Test: `src/components/TaskRow.test.tsx`

**Interfaces:**
- Produces, relied on by Task 3. `TaskRowProps` gains exactly two optional booleans; every existing prop keeps its name, type and optionality:

```ts
  /**
   * Keep the leading control's column with no control in it, so a list whose
   * rows have no checkbox still shares a left edge with one whose rows do.
   * Ignored when `lead` is given — that already occupies the column.
   */
  reserveLead?: boolean;
  /** The one row on the page that is the answer. Sets the title one step up. */
  emphasis?: boolean;
```

- [ ] **Step 1: Write the failing tests**

Add to `src/components/TaskRow.test.tsx`:

```tsx
  it('reserves the lead column when asked, with nothing in it', () => {
    render(<TaskRow title="A" reserveLead />);
    const spacer = document.querySelector('[data-row-lead]');
    expect(spacer).toBeTruthy();
    expect(spacer!.className).toContain('w-[22px]');
    expect(spacer!.getAttribute('aria-hidden')).toBe('true');
    // A reserved column is empty by definition — it must not be focusable.
    expect(spacer!.querySelector('button')).toBe(null);
  });

  it('does not double up the lead column when a control is given', () => {
    render(
      <TaskRow title="A" reserveLead lead={<button type="button" aria-label="Mark done" />} />,
    );
    expect(document.querySelectorAll('[data-row-lead]').length).toBe(1);
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeTruthy();
  });

  it('reserves nothing by default', () => {
    render(<TaskRow title="A" />);
    expect(document.querySelector('[data-row-lead]')).toBe(null);
  });

  it('sets the title one step up under emphasis', () => {
    render(<TaskRow title="A" emphasis />);
    expect(screen.getByText('A').className).toContain('text-lead');
    cleanup();
    render(<TaskRow title="A" />);
    expect(screen.getByText('A').className).toContain('text-ui');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/TaskRow.test.tsx`
Expected: FAIL — no `[data-row-lead]` element, and the title is `text-ui` under emphasis.

- [ ] **Step 3: Implement**

In `src/components/TaskRow.tsx`, add both props to `TaskRowProps` with the JSDoc above, then:

Give the EXISTING lead wrapper the marker attribute so both branches are found by one selector — it keeps `relative z-10`:

```tsx
      {lead && <span data-row-lead className="relative z-10 flex-none">{lead}</span>}
      {!lead && reserveLead && (
        <span data-row-lead aria-hidden="true" className="w-[22px] flex-none" />
      )}
```

Note the reserved column carries NO `relative z-10`: there is nothing in it to keep above the click overlay, and raising an empty span would carve a dead patch out of the row's own target.

And make the title size follow `emphasis`:

```tsx
  const titleCls = `block truncate ${emphasis ? 'text-lead' : 'text-ui'} ${
    completed ? 'line-through text-muted' : 'text-ink-soft'
  }`;
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/components/TaskRow.test.tsx`
Expected: PASS, all previous tests still green.

- [ ] **Step 5: Commit**

```bash
npx tsc -b && npm test
git add src/components/TaskRow.tsx src/components/TaskRow.test.tsx
git commit -m "feat(ui): a row can hold a column open, and name the one that matters"
```

---

### Task 3: One edge, one mention, on Today

**Files:**
- Modify: `src/views/Today.tsx`

**Interfaces:** consumes Task 1's `exclude` and Task 2's `reserveLead` / `emphasis`.

Three changes in one file. Behaviour that must NOT change: the offer row keeps its exact accessible name `` `Plan “${row.title}” ${dayLabel(offer.date, today)}` `` with CURLY quotes — `Today.freeTime.test.tsx` selects on it.

- [ ] **Step 1: Compute the rest, and the exclusion**

`open` currently holds every unfinished commitment, and `divider` indexes into it. Below the existing `const open = ...` / `const divider = ...` / `const doneCount = ...` block, replace the `divider` line and add the new derivations:

```tsx
  const open = sections.commitments.filter((i) => !i.done);
  // "Rest of today" means the REST. The Next block above it is already showing
  // `focus.item`; listing it again put the same task on screen twice, and the
  // section's own name promised otherwise.
  const rest = focus ? open.filter((i) => i.key !== focus.item.key) : open;
  // Indexed against the list it is drawn in, not the one it was derived from.
  const divider = nowDividerIndex(rest, nowMinute);
  const doneCount = sections.completedToday.length;
  // One clock column for every row on the page, Next included.
  const anyTimed = open.some((i) => i.startMin !== undefined);
  // What the page is already saying, so the offer below does not repeat it.
  const shown = new Set(open.map((i) => i.key));
```

Delete the old `const anyTimed = ...` line that Task 4 of the previous plan added inside the "Rest of today" section — it is replaced by the one above, which is computed over `open` so the Next row shares the column.

- [ ] **Step 2: Thread the exclusion into the offer**

In the `offer` `useMemo`, add `exclude: shown` to the `todayPlan({...})` argument and add `shown` to the dependency array:

```tsx
  const offer = useMemo(
    () => todayPlan({
      goals, tasks, availability, blocks: [], allDayBlocks,
      today, week: weekOf(today), now: { date: today, minute: nowMinute },
      exclude: shown,
    }),
    [goals, tasks, availability, allDayBlocks, today, nowMinute, shown],
  );
```

`shown` is rebuilt each render, so it changes identity every time and the memo would recompute on every render. Prevent that by deriving it inside a `useMemo` of its own, placed above the `offer` memo:

```tsx
  const shown = useMemo(() => new Set(open.map((i) => i.key)), [open]);
```

Replace the plain `const shown = ...` from Step 1 with this memoised form, keeping it after `open` is defined.

- [ ] **Step 3: The Next block loses its card and becomes a row**

Replace the whole `focus ? ( ... ) : ( ... )` card markup inside `<section aria-label="Now">` with:

```tsx
        {focus ? (
          <>
            {/* The label is the emphasis now. The row below carries the clock,
                the estimate and the title exactly as every other row does, so
                the one thing worth doing sits on the same axis as the rest. */}
            <div className="px-[8px] mb-[2px] text-meta font-semibold text-ink-soft">
              {focus.current ? 'Now' : 'Next'}
            </div>
            <TaskRow
              title={focus.item.title}
              subtitle={focus.item.goalTitle}
              emphasis
              time={
                anyTimed
                  ? (focus.item.startMin === undefined ? '' : clockLabel(focus.item.startMin))
                  : undefined
              }
              onOpen={() => openItem(focus.item)}
              lead={
                <TodayCheckbox
                  checked={false}
                  onToggle={() => complete(focus.item)}
                  ariaLabel={`Mark "${focus.item.title}" as done`}
                />
              }
              meta={
                focus.item.estimateMin === undefined ? undefined : (
                  <span className="tabular-nums">{fmtMinutes(focus.item.estimateMin)}</span>
                )
              }
            />
          </>
        ) : (
          <p className="px-[8px] text-ui text-muted">
            {doneCount > 0
              ? `Nothing left today — ${doneCount} done.`
              : 'Nothing committed to today. Plan a task, or capture one with ⌘N.'}
          </p>
        )}
```

The explicit `Open →` button is gone: the whole row is now the open target, and a button duplicating the row's own click was the last thing on this page doing something the row already did. `IconArrowRight` may now be unused in this file — if `tsc` says so, remove it from the import; `IconWarning` is still used by the Attention list.

- [ ] **Step 4: The rest list renders `rest`, not `open`**

In the "Rest of today" section, change the guard and the map:

```tsx
      {rest.length > 0 && (
        <section aria-label="Today’s plan" className="mb-[24px]">
          <h2 className="text-meta font-semibold text-muted mb-[6px]">Rest of today</h2>
          <ul>
            {rest.map((item, i) => (
```

The old guard `open.length > (focus ? 1 : 0)` is replaced by `rest.length > 0`, which says the same thing without arithmetic: if there is nothing left after the Next block, there is no rest to show. Everything inside the `<li>` stays exactly as it is.

- [ ] **Step 5: Offer rows join the edge**

On the offer's `TaskRow`, add `reserveLead`:

```tsx
                  <TaskRow
                    title={row.title}
                    subtitle={row.goalTitle}
                    reserveLead
                    onOpen={() => place(row, offer.date, offer.today)}
                    ariaLabel={`Plan “${row.title}” ${dayLabel(offer.date, today)}`}
```

An offer row has no checkbox — its click schedules rather than completes — but it holds the column open so its title shares the left edge with the rows above. It deliberately does NOT reserve the clock column: a scheduled list has times and an offer does not, and that is a real difference rather than a ragged one.

- [ ] **Step 6: Verify**

Run: `npx vitest run src/views/Today.freeTime.test.tsx src/views/views.smoke.test.ts`
Expected: PASS. If the offer row's selector fails, the `ariaLabel` drifted — restore it exactly, do not edit the test.

Then the full gate: `npx tsc -b && npm test`. Expected tsc silent, 126 files, 2432+ tests.

- [ ] **Step 7: Commit**

```bash
git add src/views/Today.tsx
git commit -m "feat(today): every task on one edge, and said once"
```

---

## Self-review

**Spec coverage.** Duplication between the Next block and Rest of today — Task 3 Steps 1 and 4. Duplication between the page and the offer — Tasks 1 and 3 Step 2. Three left edges — Task 2 plus Task 3 Steps 3 and 5. The card as the page's only chrome — Task 3 Step 3 (brief §6).

**Deliberately out of scope.** The offer still does not reserve the clock column (justified in Step 5). The Attention rows keep their own shape — an alert has no checkbox, time or estimate, so it is not a task row.

**Type consistency.** `exclude` is `ReadonlySet<string>` in both `proposalRows`' signature and `TodayPlanInput`, and Today passes a `Set<string>` built from `DailyWorkItem.key`, which is the same `${kind}:${id}` format as `ProposalRow.key`. `reserveLead` and `emphasis` are optional booleans, so every existing `TaskRow` call site keeps compiling untouched.

**Risk.** `shown` must be memoised (Task 3 Step 2) or the `offer` memo recomputes on every render — `todayPlan` walks a week of gaps per item, which is exactly the cost the existing `replanOpen` memo was written to avoid paying eagerly.
