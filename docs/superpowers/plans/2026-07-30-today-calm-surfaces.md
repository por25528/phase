# Today Calm Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut three surfaces from the Today view — Worth considering, Quick add and the month calendar — then flatten the remaining sections so the page reads as one calm document rather than six competing panels.

**Architecture:** Six sequential tasks. Tasks 1–4 delete; Task 5 restyles one shared component and the layout; Task 6 makes the remaining controls quiet. Each task ends green and commits. Nothing here adds logic — the whole change is subtractive, which is why `tsc -b` rather than a new test is the primary correctness signal.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind 3, Dexie/IndexedDB, `@dnd-kit/core`, Vitest (`environment: 'node'`).

Spec: `docs/superpowers/specs/2026-07-30-today-calm-surfaces-design.md`

## Global Constraints

- **Never stage, modify or commit `src/components/GoalTree.tsx`.** It holds unrelated uncommitted user work. **Never `git add -A` or `git add .`** — stage every file explicitly by path.
- **Another worktree is active on this repo** (branch `commander`). Before starting, run `git status --short` and confirm the only unstaged file is `src/components/GoalTree.tsx`. If other files are dirty, stop and ask.
- **`vitest` runs `environment: 'node'` — there is no DOM.** React components cannot be unit-tested. Do not add `jsdom`. Component tasks are gated by `tsc -b` plus the manual smoke checklist each one specifies. **No implementer may claim to have run a browser check.**
- **Visual identity is deliberately being changed, but only subtractively.** Use only tokens already in `tailwind.config.js`. No new colours, fonts, radii or shadows. Adding a hex value is a plan violation.
- `"noUnusedParameters"` and `"noUnusedLocals"` are on — an unused import, prop or local is a hard compile error. This is the mechanism that proves the deletions are complete; treat a clean `tsc -b` as real evidence.
- Commands: `npm test` and `npx tsc -b`. Both work in this shell (npm 11.17.0).
- Dates are local `'YYYY-MM-DD'` strings; they compare lexicographically.
- Commit messages follow the repo's conventional style: `feat(scope): …`, `fix(scope): …`, `refactor(scope): …`, `chore: …`.

## Why these tasks are not red-green TDD

Tasks 1–4 delete code. There is no failing test to write first: the change *removes* behaviour, and the discriminating check is that the compiler finds every orphaned reference. Each deletion task therefore runs:

1. `npx tsc -b` **before** finishing the edits — the cascade of errors is the worklist
2. `npx tsc -b` clean — proof no reference was missed
3. `npm test` — proof nothing surviving changed behaviour

Tasks 5–6 are pure styling with no testable logic, gated by `tsc -b` and a manual checklist.

**Record the test count at every task.** Baseline before Task 1 and after each task. A count that drops by more than the tests you deliberately deleted means you removed coverage by accident.

## File structure

| File | Change |
|---|---|
| `src/views/today/WorthConsideringCard.tsx` | **Delete** (Task 1) |
| `src/views/today/QuickAdd.tsx`, `QuickAdd.test.ts` | **Delete** (Task 2) |
| `src/views/today/MiniCalendar.tsx` | **Delete** (Task 3) |
| `src/lib/calendar.ts`, `calendar.test.ts` | **Delete** (Task 3) |
| `src/lib/dailyWork.ts` | Suggestion engine removed (Task 1) |
| `src/lib/dailyWork.test.ts` | Suggestions describe removed (Task 1) |
| `src/lib/plan.ts` | `pinnedDayCounts` removed (Task 3) |
| `src/views/today/workActions.ts` | `scheduleSuggestionForToday` (Task 1), `dispatchQuickAdd` (Task 2) removed |
| `src/views/today/GoalsCard.tsx` | `onAddGoal` prop replaced by `setView('goals')` (Task 2); quiet control (Task 6) |
| `src/views/today/WeekStrip.tsx` | Presentational (Task 4); flattened (Task 5) |
| `src/state/store.ts` | `shiftDay` removed (Task 4) |
| `src/components/CardSection.tsx` | Flattened (Task 5) |
| `src/views/Today.tsx` | Imports and layout (Tasks 1–5) |
| `src/index.css` | `.today-hero` removed, `.today-main` narrowed, `.quiet-control` added (Tasks 5–6) |
| `src/views/today/DailyWorkRow.tsx` | Dead `action` prop removed (Task 6) |
| `src/views/today/HabitsCard.tsx` | Controls migrated to `quiet-control` (Task 6) |

---

### Task 0: Record the baseline

- [ ] **Step 1: Confirm a clean tree**

Run: `git status --short`
Expected: exactly one modified file, `src/components/GoalTree.tsx`, plus untracked directories. If anything else is modified, **stop and ask** — another worktree is active on this repo.

- [ ] **Step 2: Record the baseline**

Run: `npm test`
Expected: PASS. **Write down the test count and file count** — every later task compares against it.

Run: `npx tsc -b`
Expected: no output.

---

### Task 1: Delete Worth considering and the suggestion engine

**Files:**
- Delete: `src/views/today/WorthConsideringCard.tsx`
- Modify: `src/lib/dailyWork.ts`, `src/lib/dailyWork.test.ts`, `src/views/today/workActions.ts`, `src/views/today/workActions.test.ts`, `src/views/Today.tsx`

**Interfaces:**
- Produces: `DailyWorkSections` loses its `suggestions` field; `DailyWorkItem` loses `reason`; `DailyWorkSource` loses `'suggested'`. Task 3 and later rely on this shape.

`WorthConsideringCard` is the only consumer of the suggestion engine, so the engine goes with it.

- [ ] **Step 1: Delete the component and its usage**

```bash
git rm src/views/today/WorthConsideringCard.tsx
```

In `src/views/Today.tsx` remove the import line:

```tsx
import { WorthConsideringCard } from './today/WorthConsideringCard';
```

and the usage inside the left column:

```tsx
          <WorthConsideringCard sections={dailyWork} today={today} />
```

- [ ] **Step 2: Strip the engine from `src/lib/dailyWork.ts`**

Remove `'suggested'` from the union (line 10):

```ts
export type DailyWorkSource =
  | 'due'
  | 'task-today'
  | 'pinned-today'
  | 'this-week'
  | 'carry-over'
  | 'completed-today';
```

Remove the `reason` field from `DailyWorkItem` (line 25) and the `suggestions` field from `DailyWorkSections` (line 33), leaving:

```ts
export interface DailyWorkSections {
  commitments: DailyWorkItem[];
  carryOvers: DailyWorkItem[];
  completedToday: DailyWorkItem[];
}
```

Delete these four declarations entirely: the `SuggestionQueue` interface (lines 44–48), `suggestionTier` (104–115), `suggestionReason` (117–124) and `milestoneWithin14Days` (126–133). `milestoneWithin14Days` is used only by the suggestion queue builder, so it dies with it.

In `buildDailyWork`, remove `suggestions: []` from the early-return (line 147) and delete the whole block from `const latestSuggestionStart` (line 251) through the closing brace of the round-robin loop (line 292). The final return becomes:

```ts
  return {
    commitments,
    carryOvers,
    completedToday,
  };
```

**Also remove the now-unused `order` field.** It exists only to break ties in the suggestion sort. In the `GoalLeaf` interface delete `order: number;`, and in the leaf-collection loop drop the counter:

```ts
  for (const goal of goals) {
    walkLeaves(goal.nodes, (node) => {
      allLeaves.push({ goal, node });
    });
  }
```

Leave the `addDays` import — `tasksForWeek` still uses it.

- [ ] **Step 3: Remove `scheduleSuggestionForToday` from `src/views/today/workActions.ts`**

Delete the `SuggestionActions` interface and the `scheduleSuggestionForToday` function together — the interface has no other consumer.

- [ ] **Step 4: Delete the tests that covered deleted behaviour**

In `src/lib/dailyWork.test.ts`, delete the entire `describe('buildDailyWork suggestions', …)` block — it starts at line 260 and ends at line 449, immediately before `describe('tasksForWeek', …)`. Also delete this single assertion at line 189, inside the carryovers describe:

```ts
    expect(result.suggestions).toEqual([]);
```

In `src/views/today/workActions.test.ts`, delete the test at lines 118–130:

```ts
  it('accepts a suggestion for today, aiming at the start of the day', () => {
```

and remove `scheduleSuggestionForToday` from the import block at the top of that file.

- [ ] **Step 5: Typecheck — this is the real check**

Run: `npx tsc -b`
Expected: no output. If it reports an unused import or a reference to `suggestions`/`reason`/`'suggested'`, that is a reference you missed — fix it rather than suppressing it.

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: PASS. The count should drop by exactly the tests deleted in Step 4 (the suggestions describe plus one). **If it drops by more, stop** — you deleted coverage you did not intend to.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dailyWork.ts src/lib/dailyWork.test.ts src/views/today/workActions.ts src/views/today/workActions.test.ts src/views/Today.tsx src/views/today/WorthConsideringCard.tsx
git commit -m "refactor(today): remove Worth considering and the suggestion engine"
```

---

### Task 2: Delete Quick add and give "+ Goal" a destination

**Files:**
- Delete: `src/views/today/QuickAdd.tsx`, `src/views/today/QuickAdd.test.ts`
- Modify: `src/views/today/workActions.ts`, `src/views/today/workActions.test.ts`, `src/views/Today.tsx`, `src/views/today/GoalsCard.tsx`

**Interfaces:**
- Produces: `GoalsCard` takes **no props** — `GoalsCard()`. Task 5 renders it that way.

`GoalsCard`'s `+ Goal` button today does nothing but focus QuickAdd, so it must be re-pointed in the same commit or the button breaks.

- [ ] **Step 1: Delete the component and its test**

```bash
git rm src/views/today/QuickAdd.tsx src/views/today/QuickAdd.test.ts
```

- [ ] **Step 2: Remove `dispatchQuickAdd` from `src/views/today/workActions.ts`**

Delete the `QuickAddType` type export, the `QuickAddActions` interface and the `dispatchQuickAdd` function.

- [ ] **Step 3: Re-point `+ Goal` in `src/views/today/GoalsCard.tsx`**

Change the signature from `export function GoalsCard({ onAddGoal }: { onAddGoal: () => void })` to:

```tsx
export function GoalsCard() {
```

and change the button's handler from `onClick={onAddGoal}` to:

```tsx
          onClick={() => actions.setView('goals')}
```

`actions` is already destructured from `useAppStore()` at the top of the component, so no new import is needed. The Goals view owns goal creation through `NewGoalModal` and JSON import.

- [ ] **Step 4: Clean up `src/views/Today.tsx`**

Remove these imports:

```tsx
import { useMemo, useState, useRef } from 'react';   // becomes: import { useMemo } from 'react';
import { QuickAdd } from './today/QuickAdd';
import type { QuickType } from './today/QuickAdd';
```

Remove the `quickRef`, `quickType` and `focusQuick` declarations, the `<QuickAdd … />` element, and change the GoalsCard call site to `<GoalsCard />`.

`Hero` now sits alone in the `today-hero` grid. **Leave that grid in place for now** — Task 5 removes it. This keeps the diff for this task honest.

- [ ] **Step 5: Delete the tests for deleted behaviour**

In `src/views/today/workActions.test.ts` delete the entire `describe('dispatchQuickAdd', …)` block (lines 28–60) and remove `dispatchQuickAdd` from the import block.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc -b`
Expected: no output.

Run: `npm test`
Expected: PASS, count down by the `QuickAdd.test.ts` cases plus the two `dispatchQuickAdd` cases.

- [ ] **Step 7: Smoke checklist for the human**

1. The quick-add box is gone from the top of Today.
2. `+ Goal` on the Goals & projects card switches to the Goals view.
3. `+ Habit` still opens the inline add-habit form.
4. ⌘N still opens task capture and creates a task.

- [ ] **Step 8: Commit**

```bash
git add src/views/today/QuickAdd.tsx src/views/today/QuickAdd.test.ts src/views/today/workActions.ts src/views/today/workActions.test.ts src/views/Today.tsx src/views/today/GoalsCard.tsx
git commit -m "refactor(today): remove quick add and point + Goal at the Goals view"
```

---

### Task 3: Delete the month calendar and its orphaned helpers

**Files:**
- Delete: `src/views/today/MiniCalendar.tsx`, `src/lib/calendar.ts`, `src/lib/calendar.test.ts`
- Modify: `src/lib/plan.ts`, `src/lib/plan.test.ts`, `src/views/Today.tsx`

`MiniCalendar` is the only consumer of `src/lib/calendar.ts` and of `pinnedDayCounts`, so both become unreachable.

- [ ] **Step 1: Confirm the orphan claim before deleting**

Run: `grep -rn "lib/calendar\|pinnedDayCounts" src/`
Expected: hits only in `MiniCalendar.tsx`, `src/lib/calendar.ts`, `src/lib/calendar.test.ts`, `src/lib/plan.ts` and `src/lib/plan.test.ts`. **If any other file appears, stop** — the premise is wrong and `pinnedDayCounts` or `calendar.ts` must stay.

- [ ] **Step 2: Delete the files**

```bash
git rm src/views/today/MiniCalendar.tsx src/lib/calendar.ts src/lib/calendar.test.ts
```

- [ ] **Step 3: Remove `pinnedDayCounts`**

In `src/lib/plan.ts` delete the `pinnedDayCounts` export (around line 457). In `src/lib/plan.test.ts` delete the `describe('pinnedDayCounts', …)` block (around line 390) and remove `pinnedDayCounts` from the import list at line 5.

- [ ] **Step 4: Remove it from `src/views/Today.tsx`**

Remove the import and the `<MiniCalendar />` element. The right column now contains `<GoalsCard />` alone.

- [ ] **Step 5: Typecheck and run the suite**

Run: `npx tsc -b`
Expected: no output.

Run: `npm test`
Expected: PASS, count down by the `calendar.test.ts` cases plus the `pinnedDayCounts` cases. Vitest's *file* count drops by one.

- [ ] **Step 6: Commit**

```bash
git add src/views/today/MiniCalendar.tsx src/lib/calendar.ts src/lib/calendar.test.ts src/lib/plan.ts src/lib/plan.test.ts src/views/Today.tsx
git commit -m "refactor(today): remove the month calendar and its orphaned helpers"
```

---

### Task 4: Make the week strip presentational

**Files:**
- Modify: `src/views/today/WeekStrip.tsx`, `src/state/store.ts`

`selDate` has no readers. After Task 3, `WeekStrip` is seven buttons whose only effect is moving their own highlight, so the buttons become `<div>`s.

**`selDate`, `setSelDate` and `goToToday` all stay.** `src/views/timeline/DaysLane.tsx:33` still calls `setSelDate`, and the decision recorded in the spec is to leave the Timeline untouched. **Do not modify `src/App.tsx` or any file under `src/views/timeline/`.** Only `shiftDay`, which has zero callers, is deleted.

- [ ] **Step 1: Confirm `shiftDay` really is dead**

Run: `grep -rn "shiftDay" src/`
Expected: hits only inside `src/state/store.ts`. If a caller exists, leave the action alone and note it in your report.

- [ ] **Step 2: Make the cells presentational in `src/views/today/WeekStrip.tsx`**

Change the destructure to drop `selDate` and `actions`:

```tsx
  const { goals, habits } = useAppStore();
```

Delete the `const sel = selDate === d;` line. Change the `border` expression to drop the selected case:

```tsx
        const border = isToday ? 'border-accent-soft' : 'border-line';
```

Replace the `<button>` with a `<div>`, dropping `onClick`, `aria-pressed` and `aria-label` — a non-interactive element must not carry them. Keep `key` and every child unchanged:

```tsx
          <div
            key={d}
            className={`text-left rounded-[11px] border px-[11px] py-[7px] min-h-[52px] flex flex-col gap-[3px] ${
              isToday ? 'bg-panel-bright shadow-today' : 'bg-panel'
            } ${border}`}
          >
```

and close with `</div>` instead of `</button>`. Note the `hover:bg-hover` that was in the non-today branch of `border` is gone — a non-interactive cell must not present a hover affordance.

- [ ] **Step 3: Delete `shiftDay` from `src/state/store.ts`**

Remove the whole action:

```ts
  shiftDay(n: number) {
    set({ selDate: addDays(state.selDate, n) });
  },
```

and its declaration in the actions type/interface. If `addDays` becomes unused in that file, `tsc -b` will say so — remove it from the import then, and not before.

- [ ] **Step 4: Typecheck and run the suite**

Run: `npx tsc -b`
Expected: no output.

Run: `npm test`
Expected: PASS with the same count as after Task 3 — this task deletes no tests. **A drop here is a bug.**

- [ ] **Step 5: Smoke checklist for the human**

1. The week strip still shows all seven days with their summaries and the TODAY marker.
2. Clicking a day does nothing, and the cells show no hover or focus affordance.
3. Tabbing through Today no longer stops on seven day cells.
4. Clicking a day in the **Timeline** still navigates to Today, exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/views/today/WeekStrip.tsx src/state/store.ts
git commit -m "refactor(today): make the week strip presentational and drop dead shiftDay"
```

---

### Task 5: Calm surfaces — flatten the cards and the layout

**Files:**
- Modify: `src/components/CardSection.tsx`, `src/views/Today.tsx`, `src/views/today/WeekStrip.tsx`, `src/views/today/GoalsCard.tsx`, `src/index.css`

**Interfaces:**
- Produces: `CardSection` gains a `group` class on its root, which Task 6's `quiet-control` depends on.

`CardSection` has exactly three consumers after Tasks 1–3 — `HabitsCard`, `TodayWorkCard`, `GoalsCard` — and nothing in Goals, Timeline or Plan uses it. Editing it once flattens all three.

- [ ] **Step 1: Flatten `src/components/CardSection.tsx`**

Replace the two className strings in the returned JSX:

```tsx
    <section className={`group ${className ?? ''}`}>
      <div className="flex items-center gap-[12px] pb-[7px] mb-[4px] border-b border-line">
        <span className="font-mono text-[.66rem] tracking-[.13em] uppercase text-faint">{label}</span>
```

The surface (`bg-panel border border-line rounded-card shadow-card px-[16px] py-[12px]`) is gone entirely; the label demotes from `text-muted font-semibold` to `text-faint`; the hairline moves from around the card to under the label. `meta`, `right` and `children` are untouched.

- [ ] **Step 2: Drop the now-meaningless padding override in `src/views/today/GoalsCard.tsx`**

The `className="pb-[6px]"` prop on its `CardSection` compensated for card padding that no longer exists. Remove that prop from the call.

- [ ] **Step 3: Flatten the week strip in `src/views/today/WeekStrip.tsx`**

Change the container from `grid grid-cols-7 gap-[8px]` to a hairline row:

```tsx
    <div className="grid grid-cols-7 border-y border-line">
```

and the cell className to:

```tsx
            className={`text-left px-[11px] py-[7px] min-h-[52px] flex flex-col gap-[3px] border-r border-line-soft last:border-r-0 ${
              isToday ? 'bg-panel-bright' : ''
            }`}
```

The per-cell `rounded-[11px]`, `border`, `bg-panel` and `shadow-today` all go, and the `border` variable computed in Step 2 of Task 4 is no longer used — delete it, or `tsc -b` will fail on the unused local. Today stays legible through `bg-panel-bright` plus its accent weekday, which are unchanged.

- [ ] **Step 4: Update the grids in `src/index.css`**

Delete the `.today-hero` rule at line 136 and narrow the right rail at line 137:

```css
  /* Today dashboard responsive grid */
  .today-main { grid-template-columns: minmax(0, 1fr) 300px; }
```

In the `@media (max-width: 1160px)` block at line 148, drop `.today-hero`:

```css
@media (max-width: 1160px) {
  .today-main { grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: Re-flow `src/views/Today.tsx`**

`Hero` no longer shares a row, and flat sections need whitespace where card borders used to separate them. The whole component becomes:

```tsx
import { useMemo } from 'react';
import { Hero } from './today/Hero';
import { WeekStrip } from './today/WeekStrip';
import { HabitsCard } from './today/HabitsCard';
import { TodayWorkCard } from './today/TodayWorkCard';
import { GoalsCard } from './today/GoalsCard';
import { useAppStore } from '../state/store';
import { useLocalDate } from '../hooks/useLocalDate';
import { buildDailyWork } from '../lib/dailyWork';

export function Today() {
  const { goals, tasks } = useAppStore();
  const today = useLocalDate();
  const dailyWork = useMemo(
    () => buildDailyWork(goals, tasks, today),
    [goals, tasks, today],
  );

  return (
    <div className="pt-[18px]">
      <div className="mb-[18px]">
        <Hero />
      </div>

      <WeekStrip />

      <div className="today-main grid gap-[26px] items-start mt-[26px]">
        <div className="flex flex-col gap-[26px] min-w-0">
          <HabitsCard />
          <TodayWorkCard sections={dailyWork} today={today} />
        </div>
        <div className="flex flex-col gap-[26px] min-w-0">
          <GoalsCard />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc -b`
Expected: no output.

Run: `npm test`
Expected: PASS with the same count as after Task 4 — this is a styling task and deletes no tests.

- [ ] **Step 7: Smoke checklist for the human**

1. **Light theme:** no section renders as a bordered or shadowed box. The only filled surface on the page is today's cell in the week strip.
2. **Dark theme:** the same, and the hairlines are still visible against the black background.
3. Above 1160px: two columns, Goals in a 300px right rail.
4. Below 1160px: one column, nothing clipped or overlapping.
5. Section labels read as quiet uppercase text over a hairline, not as card headers.
6. Habit drag-to-reorder still works now that the section has no padding.

- [ ] **Step 8: Commit**

```bash
git add src/components/CardSection.tsx src/views/Today.tsx src/views/today/WeekStrip.tsx src/views/today/GoalsCard.tsx src/index.css
git commit -m "feat(today): flatten the cards and week strip onto the page"
```

---

### Task 6: Quiet controls

**Files:**
- Modify: `src/index.css`, `src/views/today/HabitsCard.tsx`, `src/views/today/GoalsCard.tsx`, `src/views/today/DailyWorkRow.tsx`

Three identical `bg-ink text-paper` buttons currently compete on the page. `Plan week` stays solid — it is the page's one real call to action and carries the review badge. `+ Habit` and `+ Goal` demote.

**Do not touch the carry-over decision buttons** in `TodayWorkCard` (`Today` / `Tomorrow` / date picker, around lines 141–165). They sit under a "Needs a decision" heading and are deliberately always visible; hiding them behind hover would bury the one thing on the page asking for input.

- [ ] **Step 1: Add the shared class to `src/index.css`**

Append inside the existing `@layer components` block, next to `.ghost-in`:

```css
  /* Quiet controls: always present and reachable, visible on hover or focus.
     Gated on `@media (hover: hover)` because a coarse pointer has no hover
     state — on touch these must stay visible or they become unreachable.
     Uses opacity, never `display:none`, so the control keeps its place in
     the tab order. */
  .quiet-control { opacity: 1; transition: opacity .12s; }
  @media (hover: hover) {
    .group:not(:hover) .quiet-control:not(:focus-visible) { opacity: 0; }
  }
```

Tailwind's own `hover:` variant does **not** gate on `@media (hover: hover)` by default, which is exactly why this is a hand-written class rather than a utility string.

**Verify the rule survives the build.** Tailwind tree-shakes `@layer components` rules whose class names it cannot find in the scanned source. Both `quiet-control` and `group` appear literally in `.tsx` files, so it should be kept — but this file already carries a comment explaining that the `.dark` palette block lives *outside* `@layer` precisely because Tailwind was stripping it. After Step 6 run:

```bash
npm run build && grep -c "quiet-control" dist/assets/*.css
```

Expected: at least 1. **If it is 0, the rule was stripped** — move the block outside `@layer components`, next to the `.dark` block, and re-check. Do not skip this; a stripped rule leaves every quiet control permanently visible, which looks like "the feature just didn't apply" rather than a build problem.

- [ ] **Step 2: Demote `+ Habit` in `src/views/today/HabitsCard.tsx`**

Replace the solid button in the `right` prop (around line 315):

```tsx
      right={
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Add habit"
          className="quiet-control text-muted hover:text-ink text-[1rem] leading-none px-[6px] py-[2px] rounded-field"
        >
          +
        </button>
      }
```

The visible text shrinks to a `+`, so the `aria-label` now carries the meaning — do not omit it.

- [ ] **Step 3: Demote `+ Goal` in `src/views/today/GoalsCard.tsx`**

Replace the solid button in its `right` prop the same way:

```tsx
      right={
        <button
          type="button"
          onClick={() => actions.setView('goals')}
          aria-label="Add goal"
          className="quiet-control text-muted hover:text-ink text-[1rem] leading-none px-[6px] py-[2px] rounded-field"
        >
          +
        </button>
      }
```

- [ ] **Step 4: Migrate the existing hover-reveals to the shared class**

Three call sites already hand-roll this pattern and must move onto `quiet-control` so they pick up the touch guard.

In `src/views/today/GoalsCard.tsx` the "→ today" button (around line 110) — replace `opacity-0 group-hover:opacity-100 focus:opacity-100 … transition-opacity` with `quiet-control`, keeping every other class:

```tsx
                  className="quiet-control flex-none font-mono text-[.62rem] tracking-[.03em] font-semibold text-accent hover:text-accent-deep disabled:opacity-40 disabled:cursor-not-allowed px-[6px] py-[2px] rounded-field"
```

Note this also fixes a real bug: `focus:opacity-100` fires on mouse click as well as keyboard focus, where `:focus-visible` does not.

In `src/views/today/HabitsCard.tsx`, the rename button (line 267) and the remove button (line 276) — replace their `opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity` with `quiet-control`:

```tsx
        className="quiet-control text-faint hover:text-ink flex-none"
```

```tsx
        className="quiet-control text-faint text-[.8rem] hover:text-[#B4453A] flex-none"
```

**These rows need their own `group`.** `CardSection`'s `group` is section-scoped, so without a nearer one the controls reveal whenever the pointer is anywhere in the section. Confirm the habit row's own wrapper carries `group`; add it if it does not.

Leave the grip icon at line 244 alone — it is `pointer-events-none` decoration, not a control.

- [ ] **Step 5: Delete the dead `action` prop from `src/views/today/DailyWorkRow.tsx`**

Neither call site in `TodayWorkCard` (lines 98 and 243) passes it. Remove the `action` parameter, its type, the `ReactNode` import if it becomes unused, and the trailing element:

```tsx
      {action && <div className="flex items-center gap-[4px] flex-none">{action}</div>}
```

Run `grep -rn "DailyWorkRow" src/` first to confirm both call sites; if a third exists that does pass `action`, keep the prop and say so in your report.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc -b`
Expected: no output.

Run: `npm test`
Expected: PASS with the same count as after Task 5.

- [ ] **Step 7: Smoke checklist for the human**

1. `+ Habit` and `+ Goal` are invisible until the pointer enters their section, then fade in.
2. **Tab through the whole page with the mouse parked outside it.** Every quiet control becomes visible as it receives focus, and none is skipped in the tab order.
3. Hovering a single habit row reveals only *that* row's pencil and remove controls, not every row's.
4. `Plan week` is still solid and still shows the review badge when a review is waiting.
5. The carry-over "Needs a decision" buttons are still visible without hovering.
6. In responsive/device-emulation mode with touch emulation on, the quiet controls are permanently visible.
7. Both themes.

- [ ] **Step 8: Commit**

```bash
git add src/index.css src/views/today/HabitsCard.tsx src/views/today/GoalsCard.tsx src/views/today/DailyWorkRow.tsx
git commit -m "feat(today): demote the secondary controls to quiet hover-revealed affordances"
```

---

## Final verification

- [ ] **Step 1: Full green**

Run: `npm test` → PASS. Compare against the Task 0 baseline; the drop must equal exactly the tests deleted in Tasks 1–3.
Run: `npx tsc -b` → no output.
Run: `npm run build` → clean.

- [ ] **Step 2: Confirm nothing leaked**

Run: `git status --short`
Expected: `src/components/GoalTree.tsx` still modified and **never committed**. Run `git log --oneline -7 --stat | grep GoalTree` and expect no output.

- [ ] **Step 3: Confirm the deletions are total**

Run: `grep -rn "WorthConsidering\|QuickAdd\|MiniCalendar\|pinnedDayCounts\|suggestionTier\|dispatchQuickAdd" src/`
Expected: no output.

Run: `grep -rn "lib/calendar" src/`
Expected: no output.
