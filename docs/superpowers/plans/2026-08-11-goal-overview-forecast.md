# Goal Overview — am I on track, and what does this week hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Overview tab answer the third question it was named for — *am I on track?* — and say what this week actually holds, using answers the codebase already computes and currently hides in a popover.

**Architecture:** Nothing new is invented. `goalHealth` (a verdict plus a sentence, always) runs today only in `ProjectHeader`; `describeVelocity(projectVelocity(...))` runs only inside `GoalMetaPopover`; and the week's planned load is computed inline in that same popover. This plan extracts the week figure into `lib/overview.ts` so both surfaces share one answer, then renders all three on the tab whose whole job is those questions. A "Next action" block gains a Schedule control, which is the one genuinely new interaction.

**Tech Stack:** React 19, TypeScript, Tailwind 3, Vitest + @testing-library/react (jsdom).

## Global Constraints

Copied from `CLAUDE.md` and enforced by `src/lib/designScale.test.ts` — the build fails on any of these:

- No arbitrary font sizes. Named `fontSize` keys only (`meta`, `ui`, `body`, `lead`, …).
- Radii: only `rounded-[4px]`, `rounded-[6px]`, `rounded-[11px]`, `rounded-field` (9px), `rounded-card` (14px).
- No literal hex / `rgb()` / `hsl()` colours. Theme tokens only.
- No Unicode icon glyphs (`✕✓✎▶◆◇⠿⋯✦⚠⌕＋`). Use `src/components/Icons.tsx`.
- `font-disp` only in `App.tsx`. `uppercase` only in the three named calendar files.
- `border-dashed` only in `views/plan/DayColumn.tsx` and `views/plan/EventBlock.tsx`.
- A section label is `text-meta font-semibold text-muted`, sentence case.
- `jest-dom` is NOT installed. Plain DOM reads only.
- **A `<button>` may never contain another `<button>`.** Overview's Next rows are buttons today; Task 3 restructures rather than nesting.
- Run `npm test` and `npx tsc -b` before every commit.

**Baseline before starting:** `tsc -b` clean, 126 test files, 2447 tests passing.

## The brief says "At current pace: Dec 18". We are deliberately not doing that.

`describeVelocity`'s own docstring (`src/lib/velocity.ts:99-108`) says:

> *Deliberately never claims a date. The output is a rate and a rough runway, which is what a trailing average can honestly support; printing "finishes Nov 3" from three data points would be the invented authority this codebase refuses everywhere else.*

`MIN_VELOCITY_SAMPLES` is 3 — a forecast date would be extrapolated from as few as three completions. So the Forecast section states what the app can stand behind: the **health verdict and its sentence**, the **observed rate and runway**, and the **deadline**, which is a stored fact rather than a prediction. That answers "am I on track?" without inventing a date the data cannot support.

---

### Task 1: One answer for "what is planned this week"

**Files:**
- Modify: `src/lib/overview.ts`
- Modify: `src/views/project/GoalMetaPopover.tsx` (use the helper instead of its inline pair)
- Test: `src/lib/overview.test.ts`

**Interfaces:**
- Produces, relied on by Task 2:

```ts
export interface GoalWeekLoad {
  /** Leaves planned into this week, done or not. */
  total: number;
  done: number;
  /** Σ estimates of the OPEN ones. Priced work only. */
  minutes: number;
  /** Open ones carrying no estimate — the reason `minutes` is a floor. */
  unestimated: number;
}

export function goalWeekLoad(goal: Goal, week: string): GoalWeekLoad;
```

Membership comes from `plannedLeaves` (`src/lib/plan.ts:104`) and nothing else — it already owns the rule that a leaf is "this week" when `plannedWeek === week` OR it has a block landing in the week. Do not restate that rule.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/overview.test.ts` (import `goalWeekLoad` from `./overview`; reuse the file's existing goal-building helpers rather than inventing new ones — read the file first):

```ts
describe('goalWeekLoad', () => {
  const WEEK = weekOf('2026-08-12');

  it('counts leaves committed to the week and prices the open ones', () => {
    const g = goalWith([
      { id: 'a', title: 'A', plannedWeek: WEEK, estimateMin: 60 },
      { id: 'b', title: 'B', plannedWeek: WEEK, estimateMin: 30 },
    ]);
    const load = goalWeekLoad(g, WEEK);
    expect(load.total).toBe(2);
    expect(load.done).toBe(0);
    expect(load.minutes).toBe(90);
    expect(load.unestimated).toBe(0);
  });

  /** A finished task is still planned this week; it is just not work left. */
  it('counts a done leaf in total but not in minutes', () => {
    const g = goalWith([
      { id: 'a', title: 'A', plannedWeek: WEEK, estimateMin: 60, status: 'done' },
      { id: 'b', title: 'B', plannedWeek: WEEK, estimateMin: 30 },
    ]);
    const load = goalWeekLoad(g, WEEK);
    expect(load.total).toBe(2);
    expect(load.done).toBe(1);
    expect(load.minutes).toBe(30);
  });

  /**
   * An unpriced open leaf must not read as free. `minutes` stays a floor and
   * the count says why — the same split `GoalEffort.unestimated` exists for.
   */
  it('reports unpriced open work separately rather than as zero minutes', () => {
    const g = goalWith([
      { id: 'a', title: 'A', plannedWeek: WEEK, estimateMin: 45 },
      { id: 'b', title: 'B', plannedWeek: WEEK },
    ]);
    const load = goalWeekLoad(g, WEEK);
    expect(load.minutes).toBe(45);
    expect(load.unestimated).toBe(1);
  });

  it('ignores leaves committed to a different week', () => {
    const g = goalWith([
      { id: 'a', title: 'A', plannedWeek: WEEK, estimateMin: 45 },
      { id: 'b', title: 'B', plannedWeek: weekOf('2026-09-30'), estimateMin: 45 },
    ]);
    expect(goalWeekLoad(g, WEEK).total).toBe(1);
  });

  it('is all zeroes for a goal with nothing planned', () => {
    const load = goalWeekLoad(goalWith([{ id: 'a', title: 'A' }]), WEEK);
    expect(load).toEqual({ total: 0, done: 0, minutes: 0, unestimated: 0 });
  });
});
```

If the file has no `goalWith` helper, build the `Goal` objects the way its existing tests do.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/overview.test.ts`
Expected: FAIL — `goalWeekLoad` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/overview.ts` (import `plannedLeaves` from `./plan`):

```ts
export interface GoalWeekLoad {
  /** Leaves planned into this week, done or not. */
  total: number;
  done: number;
  /** Σ estimates of the OPEN ones. Priced work only. */
  minutes: number;
  /** Open ones carrying no estimate — the reason `minutes` is a floor. */
  unestimated: number;
}

/**
 * What this goal has committed to the week.
 *
 * Membership is `plannedLeaves`' rule and nothing else — a leaf belongs to the
 * week when it carries `plannedWeek` or has a sitting landing inside it — so
 * this figure cannot start disagreeing with the Plan rail about what "this
 * week" means.
 *
 * `minutes` counts only OPEN, PRICED leaves: a finished task is not work left,
 * and an unpriced one is unknown rather than free, which is why the count of
 * those is reported beside it instead of being folded in as zero.
 */
export function goalWeekLoad(goal: Goal, week: string): GoalWeekLoad {
  const leaves = plannedLeaves([goal], week);
  let done = 0;
  let minutes = 0;
  let unestimated = 0;
  for (const leaf of leaves) {
    if (leaf.done) { done += 1; continue; }
    if (leaf.estimateMin === undefined) unestimated += 1;
    else minutes += leaf.estimateMin;
  }
  return { total: leaves.length, done, minutes, unestimated };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/overview.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the popover, so there is one answer**

`src/views/project/GoalMetaPopover.tsx` computes the same thing inline:

```tsx
  const wk = plannedLeaves([g], weekOf(today));
  const wkDone = wk.filter((l) => l.done).length;
```

Replace those two lines with `const wk = goalWeekLoad(g, weekOf(today));` and update the render sites: `wk.length` becomes `wk.total`, `wkDone` becomes `wk.done`. **The rendered text must not change** — this is a mechanical swap, not a redesign. Remove the now-unused `plannedLeaves` import if nothing else in the file uses it; `weekOf` is still needed.

Run `npx vitest run src/views/project/` and confirm nothing regressed.

- [ ] **Step 6: Commit**

```bash
npx tsc -b && npm test
git add src/lib/overview.ts src/lib/overview.test.ts src/views/project/GoalMetaPopover.tsx
git commit -m "feat(overview): one answer for what a week holds"
```

---

### Task 2: Overview says whether the goal is on track, and what the week holds

**Files:**
- Modify: `src/views/project/OverviewTab.tsx`
- Test: `src/views/project/OverviewTab.test.tsx` (create if absent; check first)

**Interfaces:** consumes `goalWeekLoad` (Task 1).

- [ ] **Step 1: Widen the store read and derive the three answers**

In `src/views/project/OverviewTab.tsx`, replace `const { actions } = useAppStore();` with:

```tsx
  const { availability, allDayBlocks, actions } = useAppStore();
  const today = todayStr();
```

and delete the existing inline `todayStr()` call in `goalOverview(g, todayStr())`, passing `today` instead.

Add these imports:

```tsx
import { goalWeekLoad } from '../../lib/overview';   // extend the existing overview import
import { goalHealth, HEALTH_WORD } from '../../lib/health';
import { describeVelocity, projectVelocity } from '../../lib/velocity';
import { weekOf } from '../../lib/plan';
```

Then, after `const pct = ...`:

```tsx
  /*
   * `blocks` is empty because no calendar is connected in this build — the same
   * argument `ProjectHeader` passes, for the same reason: when one lands the
   * figure only shrinks, which is the direction `goalHealth` is already
   * conservative in.
   */
  const verdict = goalHealth({
    goal: g, effort: o.effort, today, windows: availability, blocks: [], allDayBlocks,
  });
  const pace = describeVelocity(projectVelocity(g, today));
  const week = goalWeekLoad(g, weekOf(today));
```

- [ ] **Step 2: Add the Forecast section**

Insert this as a new `<section>` immediately AFTER the existing Progress section and BEFORE the `Upcoming` block:

```tsx
      <section>
        <h3 className="m-0 text-meta font-semibold text-muted mb-[6px]">Forecast</h3>
        <p className="m-0 px-[6px] text-ui text-ink-soft">
          <span
            className={
              verdict.health === 'at-risk' || verdict.health === 'blocked'
                ? 'font-semibold text-warn'
                : 'font-semibold text-ink'
            }
          >
            {HEALTH_WORD[verdict.health]}
          </span>
          {' — '}
          {verdict.reason}
        </p>
        {/* The observed rate and runway, never a predicted finish date:
            `describeVelocity` refuses to name one from a trailing average, and
            this surface is not the place to overrule it. */}
        {pace && <p className="m-0 mt-[4px] px-[6px] text-meta text-muted">{pace}</p>}
      </section>
```

- [ ] **Step 3: Add the This week section**

Immediately after the Forecast section:

```tsx
      <section>
        <h3 className="m-0 text-meta font-semibold text-muted mb-[6px]">This week</h3>
        {week.total === 0 ? (
          <p className="m-0 px-[6px] text-ui text-muted">
            Nothing committed to this week yet.
          </p>
        ) : (
          <p className="m-0 px-[6px] text-ui text-ink-soft">
            <span className="tabular-nums">{week.total}</span>
            {week.total === 1 ? ' task' : ' tasks'}
            {week.minutes > 0 && (
              <> · <span className="tabular-nums">{fmtMinutes(week.minutes)}</span></>
            )}
            {week.unestimated > 0 && (
              <span className="text-muted"> · {week.unestimated} unestimated</span>
            )}
            {week.done > 0 && (
              <span className="text-muted"> · <span className="tabular-nums">{week.done}</span> done</span>
            )}
          </p>
        )}
      </section>
```

- [ ] **Step 4: Test it**

Check whether `src/views/project/OverviewTab.test.tsx` exists. If it does, extend it; if not, create it with `// @vitest-environment jsdom` on line 1, mounting `OverviewTab` the way the neighbouring project tests mount their components (read `src/views/project/TaskPage.test.tsx` for the `dbMocks` + `initStore` harness shape, and follow it).

Cover:

1. **The verdict is stated with its sentence.** A goal with tasks renders `HEALTH_WORD[...]` and the verdict's `reason` text.
2. **The week line counts what is committed.** Two leaves with `plannedWeek` set to the current week and estimates of 60 and 30 render "2 tasks" and the formatted 1h 30m.
3. **Nothing planned says so** rather than printing zeroes.
4. **No predicted finish date.** Assert the Forecast section does NOT contain the goal's deadline formatted as an "at this pace" claim — concretely, assert the rendered text does not match `/at current pace/i`. This pins the deliberate decision above, so a future contributor who adds a predicted date has to delete a test that explains why.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/views/project/ src/lib/overview.test.ts`, then `npx tsc -b && npm test`.

- [ ] **Step 6: Commit**

```bash
git add src/views/project/OverviewTab.tsx src/views/project/OverviewTab.test.tsx
git commit -m "feat(overview): the tab answers whether the goal is on track"
```

---

### Task 3: The next action can be scheduled from here

**Files:**
- Modify: `src/views/project/OverviewTab.tsx`
- Test: `src/views/project/OverviewTab.test.tsx`

**Interfaces:** none new.

Today every `o.next` row is a `<button>` that opens the task. A Schedule control cannot go inside one — `<button>` inside `<button>` is invalid and swallows the inner label. So the FIRST item is promoted out of the list into its own block with two sibling controls; items 2..n keep the existing row treatment untouched.

- [ ] **Step 1: Add the imports and the node lookup**

```tsx
import { Popover } from '../../components/Popover';
import { ScheduleMenu } from '../../components/SchedulePopover';
import { findNode } from '../../lib/tree';
import { fmtMinutes } from '../../lib/effort';   // already imported — do not duplicate
```

- [ ] **Step 2: Promote the first Next item**

Replace the body of the `Next` section's non-empty branch. The first item becomes:

```tsx
          <div className="-mx-[6px]">
            {(() => {
              const lead = o.next[0]!;
              const leadNode = findNode(g.nodes, lead.id);
              return (
                <div className="flex items-center gap-[8px] px-[6px] py-[5px]">
                  <button
                    type="button"
                    onClick={() => actions.openProject(g.id, lead.id)}
                    className="flex-1 min-w-0 text-left rounded-[6px] hover:bg-hover px-[4px] py-[3px] -mx-[4px]"
                  >
                    <span className="block truncate text-lead text-ink">{lead.title}</span>
                    <span className="block text-meta text-muted">
                      {lead.parentTitle && <>{lead.parentTitle}</>}
                      {lead.parentTitle && lead.estimateMin !== undefined && ' · '}
                      {lead.estimateMin !== undefined && (
                        <span className="tabular-nums">{fmtMinutes(lead.estimateMin)}</span>
                      )}
                    </span>
                  </button>
                  {leadNode && (
                    <Popover
                      label="Schedule"
                      panelRole="menu"
                      trigger={(props) => (
                        <button
                          {...props}
                          type="button"
                          className="flex-none text-meta font-semibold text-accent-deep px-[8px] py-[5px] rounded-[6px] hover:bg-accent-tint"
                        >
                          Schedule
                        </button>
                      )}
                    >
                      {(close) => <ScheduleMenu goalId={g.id} node={leadNode} close={close} />}
                    </Popover>
                  )}
                </div>
              );
            })()}
            {o.next.slice(1).map((item) => (
              /* ...the EXISTING row button, unchanged... */
            ))}
          </div>
```

**`Popover`'s real API must be used, not this sketch.** Read `src/components/Popover.tsx` and `src/views/project/TaskPage.tsx`'s Schedule chip first, and call it exactly the way `TaskPage` already does — same prop names, same trigger/children shape, same `panelRole`. If `Popover` does not take a `trigger` render-prop, follow whatever shape TaskPage uses. Do not change `Popover` itself.

Keep the existing `o.next.slice(1)` rows byte-identical to the current row markup, including the `IconCircle` marker, `started` colouring and estimate.

- [ ] **Step 3: Test it**

Add to `src/views/project/OverviewTab.test.tsx`:

1. The first Next item renders a "Schedule" control; clicking it opens the menu (assert a menu item the `ScheduleMenu` renders, e.g. one matching `/Today|Tomorrow|week/i` — read `SchedulePopover.tsx` for its real labels and assert one of them verbatim).
2. **No nested buttons.** After opening nothing, assert the Schedule button is not a descendant of the open-task button: get both by role/name and assert `openButton.contains(scheduleButton) === false`. This is the invariant the restructure exists to satisfy.
3. Scheduling from here actually writes: click Schedule, choose the option that plans it for today, and assert the node now has a block or a `plannedWeek` via the store.

If test 3 proves awkward against the harness, assert instead that the store action was reached by re-reading the goal from the store after the click — do not delete the test.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc -b && npm test
git add src/views/project/OverviewTab.tsx src/views/project/OverviewTab.test.tsx
git commit -m "feat(overview): the next action can be put on the calendar from here"
```

---

## Self-review

**Spec coverage.** Brief §12's "How am I doing?" — the existing Progress section plus Task 2's week line. "What should I do next?" — the existing Next list, promoted in Task 3 with a Schedule affordance. "Am I on track?" — Task 2's Forecast section. THIS WEEK — Task 2 Step 3.

**Knowingly deviating.** §12's "At current pace: Dec 18" is not built; reasoned above, and Task 2 Step 4 test 4 pins the decision so it cannot be quietly reversed.

**Type consistency.** `goalWeekLoad(goal: Goal, week: string): GoalWeekLoad` is called in Task 2 with `weekOf(today)`, the same argument `GoalMetaPopover` uses. `goalHealth` takes `HealthInput` whose `effort` is a `GoalEffort` — `o.effort` from `goalOverview` is exactly that. `ScheduleMenu` requires a full `GoalNode`, which is why Task 3 resolves one via `findNode(g.nodes, lead.id)` and renders the control only when it is found.

**Risk.** Task 3 is the only task that changes an interaction rather than adding a read. Its lead item duplicates styling the row below it already has; if that duplication becomes awkward, the honest fix is a shared row — not copying the markup a third time.
