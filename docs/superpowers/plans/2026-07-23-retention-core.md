# Phase Retention Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight dated tasks, a fair shared Today model, and user-confirmed project schedules so Phase can hold a real mixed day without making false pace claims.

**Architecture:** Keep persisted `Task` and project-step entities distinct, then adapt them through a pure `dailyWork` module for Today and the week planner. Gate every pace calculation through a trusted-schedule predicate, preserve legacy dates as unconfirmed, and keep all mutations behind the existing store actions.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Tailwind 3.4, Dexie 4, Vitest 3, dnd-kit

---

## Fixed context and constraints

- Design source: `docs/superpowers/specs/2026-07-23-retention-core-design.md`
- Baseline on 2026-07-23: 338 tests pass across 15 files; `npm run build` is clean.
- The working tree already contains user-owned changes in
  `src/components/GoalTree.tsx` and unrelated untracked files. Do not edit,
  discard, stash, or stage them.
- Never use `git add .`. Every commit command below names the exact files owned
  by that task.
- Preserve the column-major goal invariant and route every persistent mutation
  through `setAndPersist`.
- Keep local dates as `YYYY-MM-DD` strings. Do not persist `Date` objects.
- Reuse the current color tokens, typography, `CardSection`, `Modal`,
  `TodayCheckbox`, and store patterns. The visual identity is locked.
- Each task ends with targeted tests, the full suite, the production build, and
  an isolated commit.

## File responsibility map

### New files

- `src/lib/schedule.ts` — trusted/partial/unconfirmed project-schedule
  predicates and date validation.
- `src/lib/schedule.test.ts` — schedule provenance and validation tests.
- `src/lib/dailyWork.ts` — the sole adapter from Tasks + Goal leaves to Today
  sections and planner task groups.
- `src/lib/dailyWork.test.ts` — precedence, triage, completion, suggestion, and
  planner-grouping tests.
- `src/components/TaskCaptureModal.tsx` — global capture-first `Cmd+N` dialog.
- `src/views/today/DailyWorkRow.tsx` — shared task/step presentation and toggle
  dispatch.
- `src/views/today/TodayWorkCard.tsx` — commitments, Done today, triage, and Plan
  week entry.
- `src/views/today/WorthConsideringCard.tsx` — bounded suggestions and
  one-click `+ Today`.

### Existing files with focused changes

- `src/db/types.ts` — optional project dates, provenance, and completion
  timestamps.
- `src/lib/plan.ts` / `src/lib/plan.test.ts` — pace gating and removal of the
  superseded `nextUp`/`carryOvers` Today selector.
- `src/lib/roadmap.ts` / `src/lib/roadmap.test.ts` — suppress project-date
  warnings for untrusted schedules and ignore projects without complete spans.
- `src/lib/goalImport.ts` / `src/lib/goalImport.test.ts` — stop inventing project
  dates and mark deliberate imports/manual goals confirmed.
- `src/state/store.ts` / `src/state/store.test.ts` — task CRUD, `doneAt`, atomic
  date actions, and session-only banner dismissal.
- `src/db/db.test.ts` — prove legacy records load without destructive migration.
- `src/App.tsx` — global capture shortcut and modal host.
- `src/views/Today.tsx`, `src/views/today/QuickAdd.tsx` — Task quick-add and the
  new two-card composition.
- `src/views/today/NextUpCard.tsx` — delete after its responsibilities move to
  the two focused cards.
- `src/views/plan/PlanWeekOverlay.tsx` — distinct task groups and task drag
  rescheduling.
- `src/views/Goals.tsx`, `src/views/goals/BoardCard.tsx`,
  `src/views/goals/NewGoalModal.tsx`, `src/components/GoalDrawer.tsx` —
  explicit optional dates and per-project review.
- `src/views/today/GoalsCard.tsx`, `src/views/Timeline.tsx`,
  `src/views/timeline/GoalRow.tsx`, `src/views/timeline/NodeLane.tsx` —
  safe rendering when dates are missing or untrusted.

---

### Task 1: Establish trusted schedule semantics before dates become optional

**Files:**
- Create: `src/lib/schedule.ts`
- Create: `src/lib/schedule.test.ts`
- Modify: `src/db/types.ts`
- Modify: `src/lib/plan.ts`
- Modify: `src/lib/plan.test.ts`
- Modify: `src/lib/roadmap.ts`
- Modify: `src/lib/roadmap.test.ts`
- Modify: `src/views/goals/BoardCard.tsx`
- Modify: `src/views/today/GoalsCard.tsx`
- Modify: `src/components/GoalDrawer.tsx`
- Modify: `src/views/plan/PlanWeekOverlay.tsx`
- Modify: `src/views/timeline/GoalRow.tsx`

- [ ] **Step 1: Write failing schedule-provenance tests**

Create `src/lib/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import {
  hasGoalSpan,
  hasTrustedSchedule,
  needsDateConfirmation,
  projectDateError,
} from './schedule';

function goal(patch: Partial<Goal> = {}): Goal {
  return {
    id: 'g',
    title: 'G',
    start: '2026-01-01',
    deadline: '2026-12-31',
    nodes: [],
    ...patch,
  };
}

describe('project schedule provenance', () => {
  it('treats legacy stored dates as unconfirmed', () => {
    const g = goal();
    expect(needsDateConfirmation(g)).toBe(true);
    expect(hasGoalSpan(g)).toBe(true);
    expect(hasTrustedSchedule(g)).toBe(false);
  });

  it('trusts only an explicitly confirmed complete span', () => {
    expect(hasTrustedSchedule(goal({ datesConfirmed: true }))).toBe(true);
    expect(hasTrustedSchedule(goal({ datesConfirmed: false }))).toBe(false);
  });

  it('rejects reversed project dates without silently swapping them', () => {
    expect(projectDateError('2026-12-31', '2026-01-01')).toBe(
      'Start must be on or before the deadline.',
    );
    expect(projectDateError('2026-01-01', '2026-12-31')).toBeNull();
  });
});
```

In the `goal()` fixture at the top of `src/lib/plan.test.ts`, add
`datesConfirmed: true` so existing pace tests continue to describe trusted
schedules. Add:

```ts
it('never reports pace or behind for legacy unconfirmed dates', () => {
  const g = goal({
    datesConfirmed: undefined,
    nodes: [{ id: 'a', title: 'A', done: false }],
  });
  expect(paceStatus(g, TODAY)).toBe('no-schedule');
  expect(projectAttention(g, TODAY)).not.toBe('behind');
  expect(attentionBadge(g, TODAY)).toEqual({
    label: 'Dates unconfirmed',
    tone: 'step',
  });
});
```

Add a roadmap regression in `src/lib/roadmap.test.ts` using that file's goal
fixture:

```ts
it('does not call an unconfirmed legacy project deadline overdue', () => {
  const g = goal({
    datesConfirmed: undefined,
    deadline: '2026-07-01',
    nodes: [{ id: 'n', title: 'N', done: false }],
  });
  expect(roadmapWarnings(g, TODAY)).not.toContainEqual(
    expect.objectContaining({ kind: 'project-overdue' }),
  );
});
```

- [ ] **Step 2: Run the targeted tests and verify red**

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/schedule.test.ts src/lib/plan.test.ts src/lib/roadmap.test.ts
```

Expected: FAIL because `datesConfirmed`, `schedule.ts`, and the `no-schedule`
pace state do not exist.

- [ ] **Step 3: Add provenance to the domain and implement the schedule seam**

Add to `Goal` in `src/db/types.ts` without making dates optional yet:

```ts
datesConfirmed?: boolean; // true only after the user explicitly accepts the current dates
```

Create `src/lib/schedule.ts`:

```ts
import type { Goal } from '../db/types';

export type GoalWithSpan = Goal & {
  start: string;
  deadline: string;
};

export type TrustedGoalSchedule = GoalWithSpan & {
  datesConfirmed: true;
};

export function hasGoalSpan(goal: Goal): goal is GoalWithSpan {
  return typeof goal.start === 'string' && typeof goal.deadline === 'string';
}

export function needsDateConfirmation(goal: Goal): boolean {
  return goal.datesConfirmed !== true && Boolean(goal.start || goal.deadline);
}

export function hasTrustedSchedule(goal: Goal): goal is TrustedGoalSchedule {
  return goal.datesConfirmed === true && hasGoalSpan(goal);
}

export function projectDateError(start?: string, deadline?: string): string | null {
  if (start && deadline && start > deadline) {
    return 'Start must be on or before the deadline.';
  }
  return null;
}
```

- [ ] **Step 4: Gate pure pace and attention logic**

In `src/lib/plan.ts`:

```ts
import { hasTrustedSchedule, needsDateConfirmation } from './schedule';

export type PaceState =
  | 'behind'
  | 'quiet-ahead'
  | 'on-pace'
  | 'needs-breakdown'
  | 'complete'
  | 'no-schedule';
```

In `paceStatus`, keep the no-leaf/complete checks first, then add:

```ts
if (!hasTrustedSchedule(g)) return 'no-schedule';
```

Only derive `diff` after that guard. In project attention:

```ts
const projectOverdue =
  g.datesConfirmed === true && deadlineBefore(g.deadline, today);
if (projectOverdue || hasOverdueLeaf(g, today)) return 'overdue';
```

Only return `due-soon` when `g.datesConfirmed === true`. In
`attentionBadge`, place this after completed/ready-to-complete but before
pace-derived badges:

```ts
if (needsDateConfirmation(g)) {
  return { label: 'Dates unconfirmed', tone: 'step' };
}
```

Change `nearestMeaningfulDate` to return `MeaningfulDate | null`. For
unconfirmed projects, return the nearest upcoming milestone when present and
otherwise `null`; never fall back to the legacy deadline.

In `src/lib/roadmap.ts`, wrap the project-deadline overdue warning with
`goal.datesConfirmed === true`. Keep overdue node warnings unchanged.

- [ ] **Step 5: Gate all view-level pace calculations**

Use `hasTrustedSchedule` at every direct `expectedPct` or `behindPaceBy`
call site:

```ts
const trusted = hasTrustedSchedule(goal);
const behind = trusted
  ? Math.round(behindPaceBy(pct, goal.start, goal.deadline, today))
  : 0;
```

Apply that pattern in:

- `src/components/GoalDrawer.tsx`
- `src/views/plan/PlanWeekOverlay.tsx`
- `src/views/timeline/GoalRow.tsx`
- `src/views/today/GoalsCard.tsx`

In `BoardCard.tsx`, render the date chip only when
`nearestMeaningfulDate(goal, today)` is non-null. In the drawer and Today goal
rail, render `Dates unconfirmed` instead of expected percentage or behind copy.
The timeline may still draw the stored legacy span, but must not render a pace
warning from it.

- [ ] **Step 6: Run targeted tests, full tests, and build**

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/schedule.test.ts src/lib/plan.test.ts src/lib/roadmap.test.ts
npm test
npm run build
```

Expected: schedule/plan/roadmap tests pass; all tests pass; TypeScript and Vite
build cleanly.

- [ ] **Step 7: Commit only the trusted-schedule foundation**

```bash
git add src/db/types.ts src/lib/schedule.ts src/lib/schedule.test.ts src/lib/plan.ts src/lib/plan.test.ts src/lib/roadmap.ts src/lib/roadmap.test.ts src/views/goals/BoardCard.tsx src/views/today/GoalsCard.tsx src/components/GoalDrawer.tsx src/views/plan/PlanWeekOverlay.tsx src/views/timeline/GoalRow.tsx
git commit -m "fix(schedule): trust only user-confirmed project dates"
```

---

### Task 2: Make project dates optional and stop inventing defaults

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/lib/schedule.ts`
- Modify: `src/lib/schedule.test.ts`
- Modify: `src/lib/goalImport.ts`
- Modify: `src/lib/goalImport.test.ts`
- Modify: `src/lib/plan.ts`
- Modify: `src/lib/plan.test.ts`
- Modify: `src/lib/roadmap.ts`
- Modify: `src/lib/roadmap.test.ts`
- Modify: `src/state/store.ts`
- Modify: `src/state/store.test.ts`
- Modify: `src/views/goals/NewGoalModal.tsx`
- Modify: `src/views/today/QuickAdd.tsx`
- Modify: `src/components/GoalDrawer.tsx`
- Modify: `src/views/goals/BoardCard.tsx`
- Modify: `src/views/today/GoalsCard.tsx`
- Modify: `src/views/Timeline.tsx`
- Modify: `src/views/timeline/GoalRow.tsx`
- Modify: `src/views/timeline/NodeLane.tsx`

- [ ] **Step 1: Write failing tests for deliberate undated/partial projects**

Replace the default-date assertions in `src/lib/goalImport.test.ts` with:

```ts
it('keeps an import with no dates deliberately undated', () => {
  const [g] = ok(parseGoalImport('{ "title": "Solo" }', TODAY));
  expect(g.start).toBeUndefined();
  expect(g.deadline).toBeUndefined();
  expect(g.datesConfirmed).toBe(true);
});

it('keeps one explicit project date without inventing the other', () => {
  const [g] = ok(parseGoalImport(
    '{ "title": "Solo", "deadline": "2026-10-01" }',
    TODAY,
  ));
  expect(g.start).toBeUndefined();
  expect(g.deadline).toBe('2026-10-01');
  expect(g.datesConfirmed).toBe(true);
});

it('rejects a reversed explicit project span', () => {
  expect(err(parseGoalImport(JSON.stringify({
    title: 'Bad dates',
    start: '2026-12-31',
    deadline: '2026-01-01',
  }), TODAY))).toMatch(/start must be/i);
});
```

Add to `src/state/store.test.ts`:

```ts
it('quick-added projects are deliberately undated', async () => {
  const { actions, getState } = await freshStore();
  actions.addGoal('No fake deadline');
  expect(getState().goals[0]).toMatchObject({
    title: 'No fake deadline',
    datesConfirmed: true,
  });
  expect(getState().goals[0].start).toBeUndefined();
  expect(getState().goals[0].deadline).toBeUndefined();
});

it('rejects reversed project dates atomically', async () => {
  const { actions, getState } = await freshStore();
  actions.addGoal('G');
  const id = getState().goals[0].id;
  expect(actions.setGoalDates(id, '2026-12-31', '2026-01-01')).toBe(false);
  expect(getState().goals[0].start).toBeUndefined();
  expect(getState().goals[0].deadline).toBeUndefined();
});
```

- [ ] **Step 2: Run tests and verify the current defaults fail**

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/goalImport.test.ts src/state/store.test.ts
```

Expected: FAIL because import/manual/Quick Add still create today-to-Dec-31
spans and `addGoal` still requires a deadline.

- [ ] **Step 3: Make the domain and builders represent zero, one, or two dates**

Change `Goal`:

```ts
start?: string;
deadline?: string;
```

Change `ManualGoalInput`:

```ts
start?: string;
deadline?: string;
```

In `buildManualGoal`, reject reversed pairs with `projectDateError`, copy each
non-empty date independently, and always set `datesConfirmed: true`:

```ts
const error = projectDateError(input.start, input.deadline);
if (error) throw new Error(error);

const goal: Goal = {
  id: uid(),
  title: input.title.trim(),
  nodes,
  column: input.column,
  datesConfirmed: true,
  ...(input.start ? { start: input.start } : {}),
  ...(input.deadline ? { deadline: input.deadline } : {}),
};
```

Apply the same independent-date rule to imported goals. If both explicit dates
are reversed, return the validation error from `parseGoalImport`; do not call
`clampSpan`. Validate inside the parse loop before `buildImportedGoal`:

```ts
const goalSpec = spec as GoalSpec;
const start = isDateStr(goalSpec.start) ? goalSpec.start : undefined;
const deadline = isDateStr(goalSpec.deadline) ? goalSpec.deadline : undefined;
const dateError = projectDateError(start, deadline);
if (dateError) return { error: `Goal #${i + 1}: ${dateError}` };
goals.push(buildImportedGoal(goalSpec, start, deadline));
```

Change `buildImportedGoal` to accept the already-validated optional `start` and
`deadline`, copy them independently, and set `datesConfirmed: true`. Remove
`defaultDeadline`, update `FORMAT_HINT`, and change the AI prompt so omitted
project dates remain omitted.

- [ ] **Step 4: Change store date actions to atomic optional-date actions**

Change the convenience action:

```ts
addGoal(title: string) {
  const clean = title.trim();
  if (!clean) return;
  actions.addGoals([{
    id: uid(),
    title: clean,
    nodes: [],
    column: 0,
    datesConfirmed: true,
  }]);
},
```

Replace `setGoalDates` with:

```ts
setGoalDates(goalId: string, start?: string, deadline?: string): boolean {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal || projectDateError(start, deadline)) return false;
  const goals = state.goals.map((g) => {
    if (g.id !== goalId) return g;
    const next = { ...g, datesConfirmed: true };
    if (start) next.start = start;
    else delete next.start;
    if (deadline) next.deadline = deadline;
    else delete next.deadline;
    return next;
  });
  withUndo(`Updated dates for "${goal.title}" · Undo`, 'goals', goals);
  return true;
},
```

Import `projectDateError` from `src/lib/schedule.ts`. Update store tests and
callers from `addGoal(title, deadline)` to `addGoal(title)`.

- [ ] **Step 5: Update creation and editing UI**

In `NewGoalModal.tsx`, initialize both date states to `''`, compute
`const dateError = projectDateError(start || undefined, deadline || undefined)`,
show that exact inline message, and disable Add project while it is non-null.
Pass undefined for blank fields to `buildManualGoal`.

In `QuickAdd.tsx`, remove `todayStr` and call:

```ts
if (type === 'goal') actions.addGoal(val);
```

In the drawer, use controlled values `g.start ?? ''` and `g.deadline ?? ''`.
Do not call date helpers unless the corresponding value exists. A deadline-only
project may render `daysLeftLabel(g.deadline)`; a start-only project renders no
countdown.

- [ ] **Step 6: Guard span-only consumers**

Use `hasGoalSpan` as a type guard:

```ts
const drawableGoals = goals.filter(hasGoalSpan);
```

Apply it before passing goals to Timeline geometry, `GoalRow`, `NodeLane`, and
roadmap overlap/fit calculations. Change those component props to
`GoalWithSpan`. Undated and partial projects are omitted from the canvas. When
no drawable active goals exist, Timeline's empty state must read:

```text
Add both a start and deadline to show a project on the Timeline.
```

In `plan.ts`, replace direct optional comparisons:

```ts
if (g.start && g.start > today) continue;
```

Only compare a project deadline when it exists and is confirmed. Update
`nearestMeaningfulDate` so milestones remain eligible without a project
deadline and a confirmed deadline is merely the fallback.

- [ ] **Step 7: Run focused tests, full tests, and build**

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/schedule.test.ts src/lib/goalImport.test.ts src/lib/plan.test.ts src/lib/roadmap.test.ts src/state/store.test.ts
npm test
npm run build
```

Expected: all targeted tests pass; all tests pass; no optional-date TypeScript
errors remain.

- [ ] **Step 8: Commit the optional-date slice**

```bash
git add src/db/types.ts src/lib/schedule.ts src/lib/schedule.test.ts src/lib/goalImport.ts src/lib/goalImport.test.ts src/lib/plan.ts src/lib/plan.test.ts src/lib/roadmap.ts src/lib/roadmap.test.ts src/state/store.ts src/state/store.test.ts src/views/goals/NewGoalModal.tsx src/views/today/QuickAdd.tsx src/components/GoalDrawer.tsx src/views/goals/BoardCard.tsx src/views/today/GoalsCard.tsx src/views/Timeline.tsx src/views/timeline/GoalRow.tsx src/views/timeline/NodeLane.tsx
git commit -m "fix(projects): make dates explicit and optional"
```

---

### Task 3: Add per-project date confirmation on the Goals board

**Files:**
- Modify: `src/state/store.ts`
- Modify: `src/state/store.test.ts`
- Modify: `src/views/Goals.tsx`
- Modify: `src/views/goals/BoardCard.tsx`
- Modify: `src/components/GoalDrawer.tsx`

- [ ] **Step 1: Write failing store tests for per-project confirmation**

Add:

```ts
it('confirms one legacy project without blessing its siblings', async () => {
  const { loadState } = await import('../db/db');
  vi.mocked(loadState).mockResolvedValueOnce({
    goals: [
      { id: 'a', title: 'A', start: '2026-01-01', deadline: '2026-12-31', nodes: [] },
      { id: 'b', title: 'B', start: '2026-02-01', deadline: '2026-10-01', nodes: [] },
    ],
    habits: [], tasks: [], sessions: [],
  });
  const store = await freshStore();
  await store.initStore();
  store.actions.confirmGoalDates('a');
  expect(store.getState().goals.find((g) => g.id === 'a')?.datesConfirmed).toBe(true);
  expect(store.getState().goals.find((g) => g.id === 'b')?.datesConfirmed).toBeUndefined();
});

it('dismisses the date-review banner only in UI state', async () => {
  const { actions, getState } = await freshStore();
  expect(getState().dateReviewDismissed).toBe(false);
  actions.dismissDateReview();
  expect(getState().dateReviewDismissed).toBe(true);
  expect(dbMocks.persist).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the store tests and verify red**

Run:

```bash
npx vitest run --config vitest.config.ts src/state/store.test.ts
```

Expected: FAIL because the actions and UI state do not exist.

- [ ] **Step 3: Implement confirmation and session-only dismissal**

Add to `UIState` and initial state:

```ts
dateReviewDismissed: boolean;
// initial value
dateReviewDismissed: false,
```

Add actions:

```ts
confirmGoalDates(goalId: string): void {
  const goals = state.goals.map((g) =>
    g.id === goalId ? { ...g, datesConfirmed: true } : g,
  );
  setAndPersist({ goals });
},

dismissDateReview(): void {
  set({ dateReviewDismissed: true });
},
```

Do not add a bulk confirm action and do not infer trust from a non-Dec-31
deadline.

- [ ] **Step 4: Add the board banner and direct card controls**

In `Goals.tsx`:

```ts
const { goals, dateReviewDismissed, actions } = useAppStore();
const unconfirmed = active.filter(needsDateConfirmation);

function reviewDates() {
  const goal = unconfirmed[0];
  if (!goal) return;
  if (!wide) setActiveHorizon(goal.column ?? 0);
  requestAnimationFrame(() => {
    document.getElementById(`goal-card-${goal.id}`)?.focus();
  });
}
```

Render above `FocusSummary` when `unconfirmed.length > 0` and
`!dateReviewDismissed`:

```tsx
<div className="mt-[16px] flex items-center gap-[10px] rounded-card border border-line bg-panel px-[13px] py-[10px]">
  <span className="text-[.82rem] text-ink-soft flex-1">
    {unconfirmed.length} project{unconfirmed.length === 1 ? '' : 's'} have unconfirmed dates
  </span>
  <button onClick={reviewDates} className="text-[.78rem] font-semibold text-accent-deep">
    Review
  </button>
  <button onClick={actions.dismissDateReview} aria-label="Dismiss date review" className="text-muted">
    ✕
  </button>
</div>
```

Add `id={`goal-card-${goal.id}`}` to the BoardCard root. Extend BoardCard props
with `onConfirmDates` and `onEditDates`. For unconfirmed cards, show the stored
range and:

```tsx
<button onClick={act(() => onConfirmDates(goal.id))}>Confirm</button>
<button onClick={act(() => onEditDates(goal.id))}>Edit</button>
```

`Edit` calls `actions.openDrawer`. `Confirm` confirms that project only.

- [ ] **Step 5: Make the drawer the sole date-value editor**

Keep local `draftStart`, `draftDeadline`, and `dateError` in `DrawerHeader`.
Expose:

- Confirm — `actions.confirmGoalDates(g.id)` with no value changes;
- Save dates — `actions.setGoalDates(g.id, draftStart || undefined,
  draftDeadline || undefined)`;
- Clear dates — `actions.setGoalDates(g.id, undefined, undefined)`.

Show `projectDateError` inline and disable Save dates when non-null. Sync draft
state when `g.id`, `g.start`, or `g.deadline` changes.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx vitest run --config vitest.config.ts src/state/store.test.ts src/lib/schedule.test.ts
npm test
npm run build
```

Then:

```bash
git add src/state/store.ts src/state/store.test.ts src/views/Goals.tsx src/views/goals/BoardCard.tsx src/components/GoalDrawer.tsx
git commit -m "feat(goals): review legacy dates per project"
```

---

### Task 4: Activate Task persistence and completion timestamps

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/state/store.ts`
- Modify: `src/state/store.test.ts`

- [ ] **Step 1: Write failing Task and leaf timestamp tests**

Add to `src/state/store.test.ts`:

```ts
describe('tasks', () => {
  it('creates a trimmed task with date and optional project context', async () => {
    const { actions, getState } = await freshStore();
    actions.addTask('  Email TA  ', '2026-07-23', 'g1');
    expect(getState().tasks[0]).toMatchObject({
      title: 'Email TA',
      date: '2026-07-23',
      done: false,
      goalId: 'g1',
    });
  });

  it('sets and clears doneAt when a task is toggled', async () => {
    vi.setSystemTime(new Date(2026, 6, 23));
    const { actions, getState } = await freshStore();
    actions.addTask('Email TA', '2026-07-23');
    const id = getState().tasks[0].id;
    actions.toggleTask(id);
    expect(getState().tasks[0]).toMatchObject({ done: true, doneAt: '2026-07-23' });
    actions.toggleTask(id);
    expect(getState().tasks[0].done).toBe(false);
    expect(getState().tasks[0].doneAt).toBeUndefined();
  });

  it('reschedules and undoably deletes a task', async () => {
    const { actions, getState } = await freshStore();
    actions.addTask('Email TA', '2026-07-23');
    const id = getState().tasks[0].id;
    actions.rescheduleTask(id, '2026-07-24');
    expect(getState().tasks[0].date).toBe('2026-07-24');
    actions.removeTask(id);
    expect(getState().tasks).toEqual([]);
    actions.undoLastDelete();
    expect(getState().tasks[0].id).toBe(id);
  });
});

it('sets and clears doneAt with leaf completion', async () => {
  vi.setSystemTime(new Date(2026, 6, 23));
  const { actions, getState } = await freshStore();
  actions.addGoal('G');
  const gid = getState().goals[0].id;
  actions.addRootNode(gid, 'Leaf');
  const nid = getState().goals[0].nodes[0].id;
  actions.toggleLeaf(nid);
  expect(getState().goals[0].nodes[0].doneAt).toBe('2026-07-23');
  actions.toggleLeaf(nid);
  expect(getState().goals[0].nodes[0].doneAt).toBeUndefined();
});
```

- [ ] **Step 2: Run store tests and verify red**

Run:

```bash
npx vitest run --config vitest.config.ts src/state/store.test.ts
```

Expected: FAIL because Task actions and `doneAt` do not exist.

- [ ] **Step 3: Extend the domain**

Add `doneAt?: string` to `GoalNode` and `Task` in `src/db/types.ts`. Document it
as a local completion date and keep it optional for legacy data.

- [ ] **Step 4: Implement Task actions and timestamped leaf completion**

In `store.ts`:

```ts
addTask(title: string, date = todayStr(), goalId: string | null = null): void {
  const clean = title.trim();
  if (!clean) return;
  const task: Task = { id: uid(), title: clean, date, done: false, goalId };
  setAndPersist({ tasks: [...state.tasks, task] });
},

toggleTask(taskId: string): void {
  const tasks = state.tasks.map((task) => {
    if (task.id !== taskId) return task;
    if (task.done) {
      const next = { ...task, done: false };
      delete next.doneAt;
      return next;
    }
    return { ...task, done: true, doneAt: todayStr() };
  });
  setAndPersist({ tasks });
},

rescheduleTask(taskId: string, date: string): void {
  const tasks = state.tasks.map((task) =>
    task.id === taskId ? { ...task, date } : task,
  );
  setAndPersist({ tasks });
},

removeTask(taskId: string): void {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  withUndo(
    `Deleted "${task.title}" · Undo`,
    'tasks',
    state.tasks.filter((t) => t.id !== taskId),
  );
},
```

Import `Task`. Update `toggleLeaf` to set `doneAt: todayStr()` when completing
and delete it when unchecking. When `addChild` or `addChildren` converts a leaf
to a container, also delete `doneAt`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx vitest run --config vitest.config.ts src/state/store.test.ts
npm test
npm run build
```

Then:

```bash
git add src/db/types.ts src/state/store.ts src/state/store.test.ts
git commit -m "feat(tasks): add persistent task actions and completion dates"
```

---

### Task 5: Build the shared daily-work selector

**Files:**
- Create: `src/lib/dailyWork.ts`
- Create: `src/lib/dailyWork.test.ts`

- [ ] **Step 1: Write the selector contract tests**

Create fixtures in `src/lib/dailyWork.test.ts` with `TODAY = '2026-07-23'`,
`WEEK = '2026-07-20'`, and goals whose `datesConfirmed` is true. Cover these
assertions:

```ts
expect(buildDailyWork(goals, tasks, TODAY).commitments.map((i) => i.source))
  .toEqual(['due', 'task-today', 'pinned-today', 'this-week']);

expect(buildDailyWork([dueAndPlanned], [], TODAY).commitments)
  .toMatchObject([{ id: 'same', source: 'due', due: true }]);

expect(buildDailyWork([], [yesterdayTask], TODAY).carryOvers)
  .toMatchObject([{ kind: 'task', source: 'carry-over' }]);

expect(buildDailyWork([staleDueStep], [], TODAY).carryOvers).toEqual([]);

expect(buildDailyWork([completedStep], [completedTask], TODAY).completedToday)
  .toHaveLength(2);
```

For suggestions, create three active Now projects with at least two open,
unplanned leaves each and assert:

```ts
const ids = result.suggestions.map((i) => i.goalId);
expect(result.suggestions).toHaveLength(4);
expect(new Set(ids.slice(0, 3))).toEqual(new Set(['g1', 'g2', 'g3']));
expect(Math.max(...['g1', 'g2', 'g3'].map(
  (id) => ids.filter((candidate) => candidate === id).length,
))).toBeLessThanOrEqual(2);
```

Also test:

- completed/Next/Later/Someday projects are excluded;
- a leaf starting more than 30 days away is excluded;
- an active-span leaf sorts before undated, then a within-30-days leaf;
- a project with a milestone in the next 14 days enters the first round first;
- tree order breaks equal-tier ties;
- a Task whose `goalId` no longer resolves has no `goalTitle` and still renders;
- `tasksForWeek` includes completed and open tasks in date order.

- [ ] **Step 2: Run the new test file and verify red**

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/dailyWork.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the presentation model and precedence**

Create `src/lib/dailyWork.ts` with these public types:

```ts
import type { Goal, GoalNode, Task } from '../db/types';
import { addDays, weekDates } from './dates';

export type DailyWorkSource =
  | 'due'
  | 'task-today'
  | 'pinned-today'
  | 'this-week'
  | 'suggested'
  | 'carry-over'
  | 'completed-today';

export interface DailyWorkItem {
  key: string;
  kind: 'task' | 'step';
  id: string;
  title: string;
  goalId: string | null;
  goalTitle?: string;
  due: boolean;
  done: boolean;
  source: DailyWorkSource;
  plannedDay?: string;
  scheduledDate?: string;
}

export interface DailyWorkSections {
  commitments: DailyWorkItem[];
  suggestions: DailyWorkItem[];
  carryOvers: DailyWorkItem[];
  completedToday: DailyWorkItem[];
}
```

Use one private depth-first leaf walker. Build commitments in exact source
precedence: due steps, today's tasks, today's pins, then current-week unpinned
or slipped pins. Maintain a `Set<string>` of `${kind}:${id}` keys so due wins
without duplication.

Use these adapters so a deleted project tag is a non-fatal missing lookup:

```ts
function asTask(
  task: Task,
  goalTitles: Map<string, string>,
  source: DailyWorkSource,
): DailyWorkItem {
  const goalTitle = task.goalId ? goalTitles.get(task.goalId) : undefined;
  return {
    key: `task:${task.id}`,
    kind: 'task',
    id: task.id,
    title: task.title,
    goalId: goalTitle ? task.goalId : null,
    ...(goalTitle ? { goalTitle } : {}),
    due: false,
    done: task.done,
    source,
    scheduledDate: task.date,
  };
}

function asStep(
  goal: Goal,
  node: GoalNode,
  source: DailyWorkSource,
): DailyWorkItem {
  return {
    key: `step:${node.id}`,
    kind: 'step',
    id: node.id,
    title: node.title,
    goalId: goal.id,
    goalTitle: goal.title,
    due: source === 'due',
    done: Boolean(node.done),
    source,
    ...(node.plannedDay ? { plannedDay: node.plannedDay } : {}),
    ...(node.deadline ? { scheduledDate: node.deadline } : {}),
  };
}
```

Build carry-over after commitments:

```ts
const carryOvers = [
  ...tasks
    .filter((task) => !task.done && task.date < today)
    .map((task) => asTask(task, goalTitles, 'carry-over')),
  ...staleSteps.filter((item) => !commitmentKeys.has(item.key)),
];
```

Build completed today from `doneAt === today`; do not infer dates for legacy
completed records.

- [ ] **Step 4: Implement bounded round-robin suggestions**

For each active Now project:

1. skip the project if its explicit start is after today;
2. collect open leaves with no `plannedWeek`;
3. exclude due leaves and starts after `addDays(today, 30)`;
4. rank active spans `0`, undated leaves `1`, within-30-day future starts `2`;
5. preserve depth-first order inside a rank.

Sort project queues by whether the project has a milestone in
`today..today+14`, then by existing goal-array order. Emit:

```ts
const suggestions: DailyWorkItem[] = [];
for (let round = 0; round < 2 && suggestions.length < 4; round++) {
  for (const queue of queues) {
    const node = queue.nodes[round];
    if (!node) continue;
    suggestions.push(asStep(queue.goal, node, 'suggested'));
    if (suggestions.length === 4) break;
  }
}
```

Export:

```ts
export function tasksForWeek(tasks: Task[], week: string): Task[] {
  const end = addDays(weekDates(week)[0], 6);
  const start = weekDates(week)[0];
  return tasks
    .filter((task) => task.date >= start && task.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
```

- [ ] **Step 5: Run tests, full suite, and build**

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/dailyWork.test.ts
npm test
npm run build
```

Expected: all daily-work tests pass; full suite and build remain green.

- [ ] **Step 6: Commit the pure module**

```bash
git add src/lib/dailyWork.ts src/lib/dailyWork.test.ts
git commit -m "feat(today): derive shared daily work sections"
```

---

### Task 6: Replace Next Up with Today and Worth considering cards

**Files:**
- Create: `src/views/today/DailyWorkRow.tsx`
- Create: `src/views/today/TodayWorkCard.tsx`
- Create: `src/views/today/WorthConsideringCard.tsx`
- Modify: `src/views/Today.tsx`
- Modify: `src/views/today/QuickAdd.tsx`
- Delete: `src/views/today/NextUpCard.tsx`
- Modify: `src/lib/plan.ts`
- Modify: `src/lib/plan.test.ts`

- [ ] **Step 1: Add Task mode to Quick Add**

Change:

```ts
export type QuickType = 'habit' | 'goal' | 'task';
```

Add Task placeholder/label, include it in the toggle array, and submit:

```ts
if (type === 'task') actions.addTask(val, todayStr());
```

Keep Goal submission as `actions.addGoal(val)`.
Re-add `todayStr` to the imports in this file; Task submission is now its only
date dependency.

- [ ] **Step 2: Create one row that dispatches by item kind**

`DailyWorkRow.tsx` accepts:

```ts
interface DailyWorkRowProps {
  item: DailyWorkItem;
  onToggle: (item: DailyWorkItem) => void;
  action?: React.ReactNode;
}
```

Render `TodayCheckbox`, title, `DUE`/`TODAY`/`THIS WEEK` source label, and the
project `Tag` when `goalTitle` exists. Toggle dispatch in parents:

```ts
const toggle = (item: DailyWorkItem) =>
  item.kind === 'task'
    ? actions.toggleTask(item.id)
    : actions.toggleLeaf(item.id);
```

Use `item.done` for `checked`; do not hardcode `false`.

- [ ] **Step 3: Implement TodayWorkCard**

Consume:

```ts
const sections = buildDailyWork(goals, tasks, today);
```

Keep the existing Plan week button/review suffix and weekly planned-step meta.
Render:

- commitments using `DailyWorkRow`;
- a collapsed Done today button with `aria-expanded`;
- task carry-over actions Today and Tomorrow;
- a Pick day button that reveals an `<input type="date">`;
- Delete for task carry-over;
- existing Replan/Break down/Remove actions for step carry-over.

For a task action:

```ts
actions.rescheduleTask(item.id, today);
actions.rescheduleTask(item.id, addDays(today, 1));
actions.removeTask(item.id);
```

For a step action, use `item.goalId!` with existing `planNode`, `openDrawer`,
and `unplanNode`.

- [ ] **Step 4: Implement WorthConsideringCard**

Render only `sections.suggestions`. Each row's action is:

```tsx
<button
  type="button"
  onClick={() => actions.planNode(
    item.goalId!,
    item.id,
    weekOf(today),
    today,
  )}
>
  + Today
</button>
```

Use the empty state:

```text
No additional recommendation right now.
```

Do not render checkboxes that complete unaccepted suggestions.

- [ ] **Step 5: Compose Today and remove obsolete selectors**

In `Today.tsx`, replace `NextUpCard` with:

```tsx
<TodayWorkCard />
<WorthConsideringCard />
```

Delete `NextUpCard.tsx`. Remove `nextUp`, `carryOvers`, their types, and their
superseded tests from `plan.ts`/`plan.test.ts` only after `rg` confirms no other
consumer:

```bash
rg -n "nextUp|carryOvers|NextUpCard" src
```

Expected before deletion: matches only in the obsolete file and plan tests.
Expected after deletion: no matches.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test
npm run build
```

Then:

```bash
git add src/views/today/DailyWorkRow.tsx src/views/today/TodayWorkCard.tsx src/views/today/WorthConsideringCard.tsx src/views/Today.tsx src/views/today/QuickAdd.tsx src/lib/plan.ts src/lib/plan.test.ts
git add -u src/views/today/NextUpCard.tsx
git commit -m "feat(today): separate commitments from suggestions"
```

---

### Task 7: Add global capture-first Task modal

**Files:**
- Create: `src/components/TaskCaptureModal.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement the modal with visible choices**

Create `TaskCaptureModal.tsx`. Reset state whenever it opens:

```ts
type DateChoice = 'today' | 'tomorrow' | 'pick';

const [title, setTitle] = useState('');
const [choice, setChoice] = useState<DateChoice>('today');
const [pickedDate, setPickedDate] = useState(todayStr());
const [chooseProject, setChooseProject] = useState(false);
const [goalId, setGoalId] = useState('');
```

On open, reset to Today/No project and focus the title with the same zero-delay
pattern used by `NewGoalModal`.

Resolve the date:

```ts
const date =
  choice === 'today'
    ? todayStr()
    : choice === 'tomorrow'
      ? addDays(todayStr(), 1)
      : pickedDate;
```

Submit through a `<form>`:

```ts
function submit(e: React.FormEvent) {
  e.preventDefault();
  const clean = title.trim();
  if (!clean || !date) return;
  actions.addTask(clean, date, chooseProject && goalId ? goalId : null);
  actions.showToast('Task added');
  onClose();
}
```

Render three visible choice buttons, show the date input only for Pick day, and
show the project select only after Choose project. Use active non-completed
projects as options. Enter submits the current choices; Modal owns Escape and
focus restoration.

- [ ] **Step 2: Host the modal and intercept `Cmd+N` before input/modifier exits**

In `App.tsx`:

```ts
const [taskCaptureOpen, setTaskCaptureOpen] = useState(false);
```

At the top of `onKey`:

```ts
if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'n') {
  e.preventDefault();
  setTaskCaptureOpen(true);
  return;
}
```

This check must precede the input-target and modifier early returns. Render:

```tsx
<TaskCaptureModal
  open={taskCaptureOpen}
  onClose={() => setTaskCaptureOpen(false)}
/>
```

The modal must not call `setView`.

- [ ] **Step 3: Build and manually verify the keyboard contract**

Run:

```bash
npm test
npm run build
npm run dev
```

Manual checks:

1. On each of Today, Goals, and Timeline, `Cmd+N`, type a title, Enter.
2. Repeat while an input is focused.
3. Confirm the current view does not change.
4. Confirm Today is the default date.
5. Confirm Tomorrow, Pick day, and project tagging persist correctly.
6. Confirm Escape restores focus to the opener.

- [ ] **Step 4: Commit**

```bash
git add src/components/TaskCaptureModal.tsx src/App.tsx
git commit -m "feat(capture): add global task entry shortcut"
```

---

### Task 8: Show and reschedule Tasks in the week planner

**Files:**
- Modify: `src/views/plan/PlanWeekOverlay.tsx`
- Modify: `src/lib/dailyWork.test.ts`

- [ ] **Step 1: Extend week-grouping tests**

Add:

```ts
it('keeps completed and open tasks in their assigned week days', () => {
  const tasks = [
    { id: 'a', title: 'Open', date: '2026-07-20', done: false, goalId: null },
    { id: 'b', title: 'Done', date: '2026-07-21', done: true, doneAt: '2026-07-21', goalId: 'g1' },
    { id: 'c', title: 'Other week', date: '2026-07-27', done: false, goalId: null },
  ];
  expect(tasksForWeek(tasks, '2026-07-20').map((t) => t.id)).toEqual(['a', 'b']);
});
```

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/dailyWork.test.ts
```

Expected: PASS if Task 5's contract is complete; otherwise make only the
minimal pure-function correction before touching JSX.

- [ ] **Step 2: Add a discriminated planner drag payload**

In `PlanWeekOverlay.tsx`:

```ts
type PlannerDragData =
  | { kind: 'step'; goalId: string; nodeId: string; title: string }
  | { kind: 'task'; taskId: string; title: string };
```

Add `kind: 'step'` to existing rail/placed step payloads. Use
`tasksForWeek(tasks, week)` and bucket tasks by `Task.date`.

Update drag end:

```ts
const data = e.active.data.current as PlannerDragData | undefined;
if (!data) return;
const zone = String(e.over.id);

if (data.kind === 'task') {
  if (zone.startsWith('day:')) {
    actions.rescheduleTask(data.taskId, zone.slice(4));
  }
  return;
}

if (zone === 'rail') actions.unplanNode(data.goalId, data.nodeId);
else if (zone === 'anyday') actions.planNode(data.goalId, data.nodeId, week);
else if (zone.startsWith('day:')) {
  actions.planNode(data.goalId, data.nodeId, week, zone.slice(4));
}
```

Tasks cannot drop into Any day or the project rail because every Task always
has a chosen working date.

- [ ] **Step 3: Render a distinct Tasks group in each day**

Change `DayContent` to accept both leaves and tasks. Above project step groups:

```tsx
{tasks.length > 0 && (
  <div className="flex flex-col gap-[3px]">
    <span className="font-mono text-[.5rem] tracking-[.08em] uppercase text-faint px-[1px]">
      Tasks
    </span>
    {tasks.map((task) => (
      <TaskChip
        key={task.id}
        task={task}
        goalTitle={task.goalId ? goalTitles.get(task.goalId) : undefined}
        onToggle={() => actions.toggleTask(task.id)}
      />
    ))}
  </div>
)}
```

`TaskChip` uses `useDraggable` with `{ kind: 'task', taskId, title }`, disables
drag when done, keeps completed tasks visible with check/line-through styling,
and shows a compact project tag when the goal still exists.

Update the week count to include open Tasks as well as open planned leaves.

- [ ] **Step 4: Verify planner behavior and commit**

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/dailyWork.test.ts
npm test
npm run build
npm run dev
```

Manual checks:

1. Today's and tomorrow's tasks appear under Tasks, not a project group.
2. A tagged task shows context but does not enter the project rail.
3. Dragging an open task between days changes its persisted date.
4. Completed tasks remain visible and cannot be dragged.
5. Existing step drag, Any day, Break, and recap behavior still work.

Commit:

```bash
git add src/views/plan/PlanWeekOverlay.tsx src/lib/dailyWork.test.ts
git commit -m "feat(plan): place dated tasks in the week"
```

---

### Task 9: Pin backward compatibility and run the retention-core acceptance pass

**Files:**
- Modify: `src/db/db.test.ts`
- Modify: `src/lib/goalImport.test.ts`
- Modify: `src/state/store.test.ts`

- [ ] **Step 1: Add legacy-record compatibility tests**

In `src/db/db.test.ts`, import a backup containing:

```ts
const legacyGoal = {
  id: 'legacy-goal',
  title: 'Legacy',
  start: '2026-07-01',
  deadline: '2026-12-31',
  nodes: [{ id: 'legacy-node', title: 'Done before timestamps', done: true }],
};
const legacyTask = {
  id: 'legacy-task',
  title: 'Old task',
  date: '2026-07-20',
  done: true,
  goalId: null,
};
```

Assert after `importStateFromFile`:

```ts
expect(result.goals[0].datesConfirmed).toBeUndefined();
expect(result.goals[0].nodes[0].doneAt).toBeUndefined();
expect(result.tasks[0].doneAt).toBeUndefined();
```

Also assert an imported goal created through `parseGoalImport` has
`datesConfirmed === true`, while a backup record is not rewritten to true.

- [ ] **Step 2: Run the compatibility tests**

Run:

```bash
npx vitest run --config vitest.config.ts src/db/db.test.ts src/lib/goalImport.test.ts src/state/store.test.ts
```

Expected: PASS with no Dexie schema-version change.

- [ ] **Step 3: Run the complete automated gate**

Run:

```bash
npm test
npm run build
```

Expected: all test files pass and Vite production output builds.

- [ ] **Step 4: Run repository-wide consistency scans**

Run:

```bash
rg -n "defaultDeadline|nextUp|carryOvers|NextUpCard" src
rg -n "expectedPct\\(|behindPaceBy\\(" src --glob '*.{ts,tsx}'
rg -n "addGoal\\([^)]*," src --glob '*.{ts,tsx}'
git diff --check
git status --short
```

Expected:

- no obsolete default-date or Next Up selector references;
- every remaining pace call is visibly dominated by `hasTrustedSchedule`;
- no two-argument `addGoal` calls remain;
- no whitespace errors;
- `src/components/GoalTree.tsx` remains modified but unstaged and unchanged by
  this implementation.

- [ ] **Step 5: Run the manual acceptance matrix**

With `npm run dev`:

1. Quick Add Task creates today's untagged task and preserves input focus.
2. `Cmd+N` captures from all three views in under three seconds with defaults.
3. Tasks never appear on the Goals board and never change goal percentage.
4. Due steps appear once at the top of Today with `DUE`.
5. Suggestions are separate, max four, max two/project, and `+ Today` moves one
   into commitments.
6. A yesterday Task enters Needs a decision and supports Today, Tomorrow, Pick
   day, and Delete.
7. Completing a Task and a step moves them into collapsed Done today;
   unchecking restores them.
8. An undated new project shows no Dec-31 date, countdown, pace, or timeline
   span.
9. A legacy project shows Dates unconfirmed and no pace/behind claim.
10. Goals-board Review focuses an unconfirmed card; Confirm affects only that
    card; Edit opens the drawer; banner dismissal lasts until App restart.
11. A deadline-only confirmed project shows its countdown but no pace.
12. The planner shows Tasks separately and task dragging reschedules dates.
13. Dark mode, narrow Goals horizon mode, keyboard focus, and reduced-motion
    behavior remain usable.

- [ ] **Step 6: Commit the compatibility pins**

```bash
git add src/db/db.test.ts src/lib/goalImport.test.ts src/state/store.test.ts
git commit -m "test(retention): pin legacy task and date compatibility"
```

---

## Completion criteria

The implementation is complete only when:

- all nine task commits exist;
- `npm test` passes;
- `npm run build` passes;
- the repository scans in Task 9 have the expected output;
- every manual acceptance item passes;
- the pre-existing `GoalTree.tsx` modification and unrelated untracked files
  remain untouched and unstaged.
