# Phase retention core

**Date:** 2026-07-23

**Status:** approved

**Source:** `docs/audits/2026-07-22-usability-audit.md`

## Objective

Make Phase credible as a daily planner without weakening its focus-first project
model. This iteration closes the audit's three largest retention gaps:

1. small, dated work gets a lightweight Task path;
2. Today becomes a trustworthy contract instead of a backlog dump;
3. pace claims use only project dates the user has confirmed.

The result should let someone capture an errand from any view, see it beside
today's project commitments, act on fair project suggestions, and trust every
behind-pace warning.

## Product decisions

- Tasks default to today, may be tagged to a project for context, and never
  affect project progress.
- Task capture is available through Today's Quick Add and through `Cmd+N` from
  every view.
- The global capture dialog uses a title-first layout with visible
  Today/Tomorrow/Pick day and optional-project choices. It does not parse natural
  language.
- Today separates commitments from suggestions into two cards.
- An open project step whose deadline is today or earlier enters Today
  automatically with a `DUE` label.
- Suggestions come only from active Now projects, are round-robin, and show at
  most four items and two items per project.
- Existing project dates remain stored but are untrusted until the user confirms
  them. Untrusted dates never generate pace or behind claims.
- New projects may be undated. A deadline without a start may show a countdown,
  but it cannot produce a pace claim.
- The existing uncommitted `src/components/GoalTree.tsx` work is outside this
  iteration and must not be modified or discarded.

## Scope

### Included

- Task creation, completion, deletion, rescheduling, optional project tagging,
  carry-over triage, and week-planner display
- global `Cmd+N` task capture and a Task mode in Quick Add
- shared pure daily-work rules consumed by Today and the planner
- separate Today and Worth considering cards
- fair and date-aware project suggestions with one-click `+ Today`
- automatic surfacing of due project steps
- completion timestamps needed by a collapsed Done today group
- optional project dates and explicit legacy-date confirmation
- pace gating across the board, drawer, planner, and timeline
- backward-compatible loading and import of existing records

### Excluded

- `Cmd+K` search or a general command palette
- soft delete or a persistent trash view
- click-to-assign controls in the week planner
- close-the-day and weekly-review redesigns
- blocked/waiting status
- natural-language date or project-token parsing
- workstream-aware suggestions
- project templates
- a general-purpose normalized WorkItem persistence model
- step-span editing and the Timeline's seven-day Schedule behavior
- changes to the current `GoalTree.tsx` WIP

## Architecture

Tasks and project steps remain separate persisted domain types. A new pure
module, `src/lib/dailyWork.ts`, adapts both types into one read-only presentation
model:

```ts
type DailyWorkKind = 'task' | 'step';

interface DailyWorkItem {
  key: string; // `${kind}:${id}`
  kind: DailyWorkKind;
  id: string;
  title: string;
  goalId: string | null;
  goalTitle?: string;
  due: boolean;
  source:
    | 'due'
    | 'task-today'
    | 'pinned-today'
    | 'this-week'
    | 'suggested'
    | 'carry-over'
    | 'completed-today';
  plannedDay?: string;
  scheduledDate?: string;
}

interface DailyWorkSections {
  commitments: DailyWorkItem[];
  suggestions: DailyWorkItem[];
  carryOvers: DailyWorkItem[];
  completedToday: DailyWorkItem[];
}
```

The module also exports the week-level task grouping used by the planner. Today
consumes `DailyWorkSections`; the planner consumes the week grouping. Both rely
on the same date and completion predicates, so views do not independently
interpret task dates or deadline precedence. Exact exported names may follow
local naming conventions, but this boundary is fixed.

`src/state/store.ts` remains the only mutation boundary. Views call actions;
actions update the relevant persisted slice through `setAndPersist`. No view
calls Dexie.

The design deliberately avoids a stored `WorkItem` union. Tasks and steps have
different semantics: a task's `date` is its chosen working day, while a step's
`deadline` is a due date. Combining them only for presentation keeps that
difference explicit.

## Domain changes

### Task

Extend the existing dead-but-persisted Task entity:

```ts
interface Task {
  id: string;
  title: string;
  date: string;          // chosen working day, local YYYY-MM-DD
  done: boolean;
  doneAt?: string;       // local YYYY-MM-DD; absent for legacy completions
  goalId: string | null; // context tag only
}
```

Completing a task sets `done = true` and `doneAt = todayStr()`. Uncompleting it
sets `done = false` and removes `doneAt`. Completing it again records the current
local day.

### GoalNode

Add `doneAt?: string` to leaves. `toggleLeaf` maintains `done` and `doneAt`
together using the same rules as Task. Legacy completed leaves without a
timestamp remain valid but do not appear in Done today.

### Goal dates

Change project dates to independently optional and add provenance:

```ts
interface Goal {
  // existing fields...
  start?: string;
  deadline?: string;
  datesConfirmed?: boolean;
}
```

`datesConfirmed` has these semantics:

- `true`: the user has explicitly accepted the current date state, including
  the deliberate choice to leave one or both dates empty;
- absent/false with at least one stored date: legacy dates are untrusted;
- absent/false with no stored dates: treat as undated and do not show a
  confirmation warning.

A shared predicate such as `hasTrustedSchedule(goal)` returns true only when
`datesConfirmed === true` and both dates exist. Every caller must use this
predicate before invoking `expectedPct`, `behindPaceBy`, or pace-based attention
logic.

Deadline-only projects may still show their explicit due date, countdown, and
overdue state. Start-only and undated projects show no pace. Legacy projects
show no behind state until confirmed.

No Dexie index changes are required because these fields live inside existing
records.

## Daily-work rules

### Commitments

Build the Today commitments list in this precedence order:

1. open leaves on active projects where `deadline <= today`;
2. open tasks where `date === today`;
3. open leaves pinned to today in the current planned week;
4. open leaves committed to the current week with no day, or with a planned day
   earlier than today.

An item may satisfy more than one rule. De-duplicate by kind and id, keeping its
highest-precedence source. A due step therefore appears once and retains `DUE`
even if it is also planned today.

Future-day pins remain hidden until their day unless the step becomes due.
Completed items do not appear in commitments.

### Carry-over

- An unfinished task with `date < today` enters Needs a decision.
- An unfinished step whose `plannedWeek` precedes the current week continues to
  use the existing stale-step triage.
- A due step takes precedence over stale triage and appears in commitments.

Task triage actions are Today, Tomorrow, Pick day, and Delete. Step triage keeps
Replan, Break down, and Remove.

### Completed today

Tasks and leaves with `doneAt === today` appear in a collapsed Done today group
inside the Today card. They retain task/project context and can be unchecked
there. This iteration does not add a historical or weekly completed-work view.

### Suggestions

Suggestion candidates are open, never-planned leaves from active Now projects.
Exclude completed projects, future-start projects, and any leaf starting more
than 30 days after today.

Within each project, candidates are ordered stably:

1. a dated step whose active span includes today;
2. an undated step;
3. a step whose start is within the next 30 days.

Tree traversal order breaks ties. Projects with a milestone in the next 14 days
enter each round before other projects; the existing Now-board order breaks
remaining ties.

Emit suggestions round-robin: at most one candidate per project per pass, at
most two per project, and at most four globally. With candidates in at least two
Now projects, the output must contain at least two projects before a project
receives its second suggestion.

Each suggestion has a `+ Today` action. It calls the existing node-planning
boundary with the current week and today's date, then naturally moves from Worth
considering to Today on the next selector result.

## User interface

### Quick Add

Extend `QuickType` to `habit | goal | task`. Task is a peer toggle. Submitting a
Task creates an untagged task dated today, clears the input, and preserves focus.
Submitting a Goal creates a deliberately undated project rather than assigning
December 31.

### Global task capture

`Cmd+N` is handled before the App shell's current modifier-key early return.
Prevent the browser/Electron default, open one task-capture modal, and focus the
title. If the modal is already open, focus its title instead of opening another
instance.

The modal uses the approved capture-first layout:

- required title;
- Today selected by default;
- Tomorrow and Pick day alternatives;
- No project selected by default;
- an optional project picker revealed by Choose project;
- Enter submits the visible defaults;
- Escape closes and restores focus to the previously active element.

The modal does not change the current view after submission. A brief existing
toast confirms capture.

### Today cards

Replace the current visually flat Next Up list with two CardSection surfaces:

1. **Today** shows commitments, Done today, and Needs a decision. Due, Today, and
   This week labels explain why each item is present.
2. **Worth considering** shows suggestions only. Its empty state quietly says
   that Phase has no additional recommendation rather than implying all work is
   complete.

The Plan week button and weekly completion meta remain associated with the Today
card. The selected two-card layout keeps suggestions outside the user's daily
contract until accepted.

### Week planner

Open tasks whose `date` falls within the displayed week appear in their assigned
day columns under a distinct Tasks group. Tagged tasks show a project chip, but
they do not merge into the project's step group and do not appear in the
project-step rail.

Dragging a task to another day updates `Task.date`. The existing step drag
behavior remains unchanged. Completed tasks remain visible with completed
styling so the week does not erase evidence of finished work.

### Date confirmation

New Goal starts with blank Start and Deadline inputs. The manual goal builder
marks the resulting date state confirmed whether the user supplies zero, one,
or two dates.

The existing Goal drawer header is the single edit surface for legacy
confirmation:

- Confirm accepts the displayed dates and sets `datesConfirmed = true`;
- Edit keeps the date fields available and confirms the submitted values;
- Clear dates removes both values and marks the undated state confirmed.

Board cards and the drawer show the quiet status `Dates unconfirmed`. The
planner and timeline omit pace-derived warnings for that project. None of these
surfaces may replace the suppressed warning with an invented percentage.

## Store actions and data flow

Add or extend these mutation boundaries:

- `addTask(title, date, goalId?)`
- `toggleTask(taskId)`
- `rescheduleTask(taskId, date)`
- `removeTask(taskId)`
- `toggleLeaf(nodeId)` to maintain `doneAt`
- one atomic project-date action accepting optional start/deadline and the
  confirmed state

Names may be adjusted to match existing action vocabulary. The behavioral
contracts may not be split across views.

Data flow:

1. capture controls call a store action;
2. the action validates and persists the Task or Goal slice;
3. `useAppStore` notifies subscribers;
4. `buildDailyWork` recomputes deterministic sections;
5. Today and the planner render the new state.

Deleting a tagged project does not delete its tasks. A task whose `goalId` no
longer resolves renders untagged. Undoing the project deletion restores the
visible association because the original id remains on the task.

## Validation, recovery, and accessibility

- Trim titles; an empty title is a no-op and leaves focus in the input.
- Reject a start later than a deadline with inline copy and no mutation.
- Date confirmation, editing, and clearing each persist as one store action.
- Task deletion uses the existing five-second undo system.
- Existing persistence-error and second-tab behavior remains unchanged.
- Capture and task controls use native buttons/inputs, visible focus states,
  labels, and meaningful checkbox state.
- Modal focus trapping and Escape behavior use the existing Modal primitive.
- `Cmd+N` works from inputs as well as passive views; plain `n` does nothing.
- Project-tag lookup failure is non-fatal and renders as No project.

## Verification

### Pure selector tests

Add `src/lib/dailyWork.test.ts` covering:

- commitment ordering and due precedence;
- de-duplication of a due-and-planned step;
- future pins hidden until their day;
- overdue tasks and stale steps entering the correct triage;
- due steps taking precedence over stale triage;
- completed-today membership;
- Now-only suggestions;
- round-robin fairness;
- four-item global and two-per-project limits;
- milestone project ordering;
- stable tree-order tie breaking;
- exclusion of starts beyond 30 days;
- `+ Today` eligibility assumptions.

Extend planning tests for task grouping and planner-week inclusion.

### Store and compatibility tests

Cover:

- task creation defaults, tagging, completion/uncompletion, `doneAt`,
  rescheduling, deletion, and undo;
- leaf `doneAt` behavior;
- atomic confirm, edit, and clear-date actions;
- `hasTrustedSchedule` and suppression of pace for legacy, undated,
  start-only, and deadline-only projects;
- trusted two-date schedules retaining current pace behavior;
- import/load of legacy Goals, GoalNodes, and Tasks without new optional fields.

### Full verification

Run:

- `npm test`
- `npm run build`

Manual smoke paths:

1. From Today, Goals, and Timeline, press `Cmd+N`, type a title, and press Enter.
   The task lands today without changing views.
2. Use Today Quick Add in Task mode. The task appears in Today and never on the
   Goals board.
3. Schedule a task for tomorrow and verify it appears once in tomorrow's planner
   column and does not appear in Today.
4. Use Pick day to create an unfinished task dated yesterday and verify its
   triage actions immediately.
5. Create candidates in three Now projects and verify fair, bounded suggestions;
   accept one with `+ Today`.
6. Give an unplanned step today's deadline and verify it enters Today with
   `DUE`.
7. Load a legacy project and verify no behind claim appears before confirmation.
8. Create an undated project and verify no automatic December 31 date or pace
   line appears.
9. Confirm a valid two-date schedule and verify existing pace behavior returns.
10. Complete and uncomplete both a task and a step; verify Done today and
    `doneAt`.

## Acceptance criteria

- A task can be captured from any view with `Cmd+N`, typing, and Enter in under
  three seconds when using default choices.
- Tasks never appear on the Goals board and never change project percentage.
- Today's commitments visually exclude unaccepted suggestions.
- An unplanned due step cannot be lost in suggestions; it appears in Today.
- With candidates in three Now projects, Worth considering includes at least
  two projects, never more than two items from one project, and never more than
  four items total.
- A suggestion becomes a Today commitment in one click.
- Unfinished prior-day tasks require a rescheduling decision.
- No new project receives an automatic December 31 deadline.
- No missing, partial, or unconfirmed project schedule produces a pace or behind
  claim.
- Existing persisted data loads without destructive migration.
- The complete automated test suite and TypeScript production build pass.
