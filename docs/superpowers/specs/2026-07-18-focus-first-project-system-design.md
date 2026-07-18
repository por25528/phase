# Focus-First Project System — Design

**Date:** 2026-07-18
**Status:** Approved design; awaiting written-spec review

## Summary

Phase will become a focus-first personal project system. Its three main views
will have distinct jobs:

- **Today — Execute:** what should I do now?
- **Goals — Prioritize:** which outcomes deserve my attention?
- **Timeline — Anticipate:** will this plan fit, and what is at risk?

The Goals board will use commitment horizons—**Now, Next, Later, Someday**—
instead of abstract priority labels. Timeline will become a focused project
roadmap rather than a second daily calendar. Existing goal trees, weekly
planning, milestones, pace calculations, and date editing remain the shared
source of truth.

The resulting loop is:

`Choose focus → define next action → plan it → execute it → review progress`

Phase will suggest decisions and next actions, but it will not schedule work
automatically.

## Problem

The current Goals and Timeline views contain useful information, but they do
not consistently turn that information into a decision:

- The board's **Highest / High / Medium / Later** labels require repeated,
  abstract priority judgments and do not encourage a limited set of active
  commitments.
- Board cards show progress, expected progress, dates, pace, and a next action,
  but the hierarchy does not make the user's next decision obvious.
- The insight bar reports counts without helping the user act on the affected
  projects.
- Timeline combines roadmap information with daily action and habit detail,
  weakening its purpose.
- Timeline's infinite canvas is powerful, but it lacks a quick way to frame the
  relevant projects and expose schedule problems.
- Completed work has no separate project lifecycle, so finished goals remain
  mixed into active priority decisions.

## Goals

- Make the current focus set immediately legible and keep it intentionally
  small.
- Turn every active project into a clear next action or a clear planning prompt.
- Connect prioritization, weekly planning, daily execution, and roadmap review
  without duplicating data.
- Make schedule risks visible before they become deadline failures.
- Preserve Phase's quiet, minimal visual identity and local-first architecture.
- Migrate existing user data without rewriting project positions.

## Non-goals

- Workflow-status columns such as Backlog / In Progress / Done.
- A second task model or a return of the legacy task/study-log UI.
- Automatic scheduling.
- Dependencies, owners, estimates, resource allocation, time tracking, or team
  collaboration.
- A full Gantt or enterprise portfolio-management system.
- An app-wide visual restyle.

## 1. Product model and view responsibilities

A top-level `Goal` represents a project or meaningful outcome. Its node tree
contains phases, containers, and actionable leaf steps. First-level scheduled
nodes are the phases shown on Timeline; leaf nodes remain the units planned for
a week or day.

### Today — Execute

Today continues to show planned actions and habits. It owns day-level detail
and answers, “What should I do now?” This project does not redesign Today, but
board planning actions must land in the existing weekly/daily planning flow.

### Goals — Prioritize

Goals owns commitment horizons and project attention. It answers, “Which
outcomes deserve my attention?” Moving a project changes its priority horizon;
it never schedules work by itself.

### Timeline — Anticipate

Timeline owns project spans, phase spans, milestones, and schedule risk. It
answers, “Will this plan fit, and what is at risk?” Habit check-ins and planned
action counts leave this view because Today already owns that information.

All three views open the same goal drawer and read the same stored goal tree.
There is no synchronization layer or duplicate project representation.

## 2. Goals board

### 2.1 Commitment horizons

The four persisted column indices keep their existing order and acquire new
labels:

| `Goal.column` | Horizon | Meaning |
|---|---|---|
| `0` | Now | Actively committed projects |
| `1` | Next | Ready when capacity opens |
| `2` | Later | Valuable, but not currently scheduled |
| `3` | Someday | Ideas and possible future outcomes |

This is a label and behavior change, not a data migration. Existing projects
stay in their current columns and order.

**Now has a soft work-in-progress limit of three active projects.** Its header
shows `N / 3`. A fourth project is allowed, but the header and focus summary
show a quiet warning: `Focus is spread across N projects.` Completed projects
do not count toward this limit.

The board remains horizontally arranged at desktop widths. Below the existing
small-screen breakpoint, it shows one horizon at a time through an accessible
horizon switcher instead of compressing or horizontally hiding four full
columns.

### 2.2 Card information hierarchy

Each active card presents information in this order:

1. Project title and nearest meaningful date.
2. Next open action.
3. Current-week commitment, for example `2 of 3 planned steps done`.
4. Compact overall progress.
5. One primary attention signal, if action is needed.

Expected percentage remains available in the drawer and detailed Timeline
tooltip, but it is removed from the default card surface. The card should help
the user choose an action, not compare several progress numbers.

The card has two direct actions:

- **Plan next step:** opens the existing weekly planner with this project
  focused and its open leaves ready to select.
- **Open project:** opens the shared goal drawer.

The full card remains draggable. Destructive actions move from the card's hover
surface into an overflow menu. That menu also provides **Move to Now / Next /
Later / Someday**, giving keyboard and non-drag users an equivalent operation.

### 2.3 Focus summary

The current read-only insight bar becomes a compact focus summary. It reports:

- `N of 3 focus slots used`
- Now projects missing a next step
- Active projects behind schedule
- Planned actions remaining this week

Each non-zero signal is a button. Selecting it keeps all cards in place but
emphasizes matching cards and dims unrelated ones. A visible Clear action
returns to the unfiltered board. This avoids layout jumps during diagnosis and
does not introduce a separate search/filter subsystem.

### 2.4 Project attention

One pure function returns the primary attention state for an active project.
States are mutually exclusive and use this precedence:

1. `overdue` — deadline is before today and the project is not completed.
2. `needs-next-step` — the project has no open actionable leaf.
3. `behind` — the existing authoritative `paceStatus` returns `behind`.
4. `milestone-soon` — a milestone is within the next 14 days and the project
   has no unfinished leaf planned in the current week.
5. `not-planned` — a Now project has an open leaf, but no unfinished leaf is
   planned in the current week.
6. `on-track` — no attention signal is needed; the card renders no badge.

Completed projects are excluded before attention is calculated. A project with
no leaves is `needs-next-step`, not behind. The existing pace threshold and
rounding rules remain authoritative.

The weekly commitment line is separate from the primary signal and may appear
for every Now project. It uses the existing Monday–Sunday `weekOf` and planned
leaf semantics.

### 2.5 Completion lifecycle

Add `Goal.completedAt?: string`, stored as a local `YYYY-MM-DD` date.

- When every actionable leaf is complete, the drawer and card offer **Complete
  project**. Completion is explicit; reaching 100% never makes a project
  disappear automatically.
- Completing sets `completedAt` and removes the project from active columns.
- Completed projects appear in a collapsed **Completed** section below the
  board, newest completion first.
- **Reopen** clears `completedAt` and returns the project to its persisted
  horizon and position.
- A completed project must be reopened before adding or unchecking actionable
  steps. Read-only inspection and non-structural metadata edits remain allowed.

Existing 100%-complete goals have no `completedAt`, so they remain visible and
gain the Complete project action. No existing project is archived during
hydration.

## 3. Timeline roadmap

### 3.1 Scope and grouping

Timeline defaults to **Focus**, which includes active Now and Next projects.
The scope control offers:

- **Focus** — Now and Next
- **All active** — Now, Next, Later, and Someday
- **One project** — a searchable project selector
- **Include completed** — an independent off-by-default toggle

Rows are grouped by horizon in the same order as the board. Empty horizon
groups are omitted. Scope is view-local UI state and is not included in backup
data.

### 3.2 Navigation and framing

The toolbar becomes:

`Today · Fit projects · current period · Week / Month / Quarter · scope`

The existing infinite canvas, cursor-anchored zoom, horizontal pan, and sticky
labels remain.

**Fit projects** considers all dates belonging to the selected projects:
project start/deadline, first-level scheduled phase dates, and milestones. It
frames the earliest and latest dates with 5% padding on both sides, with a
minimum of seven days per side. It then chooses a clamped continuous scale that
fits the padded range into the visible plot width and centers that range. With
one zero-duration date, it uses the Week preset centered on that date. When no
projects are selected, the control is disabled.

### 3.3 Roadmap rows

The project row shows:

- Project title, horizon rank, progress, and deadline.
- Overall project span and progress fill.
- Primary attention state when applicable.
- Milestone markers with short labels when the available space permits.

Expanding a project reveals scheduled first-level phases. Phase names remain in
the sticky label column and appear inside a bar only when they fit. An
`Unscheduled phases (N)` row replaces a potentially long tray of chips; opening
it lists unscheduled phases with **Schedule** and **Open project** actions.

Resize handles become visible on hover and keyboard focus. Dragging and
resizing retain the existing day/week snapping and keyboard behavior. Clicking
a project or phase opens the shared drawer with the relevant node focused when
possible.

At Week zoom, the header remains a readable date ruler, but it no longer shows
habit dots or per-day planned-action counts. Clicking a date may continue to
open that date in Today as a navigation convenience; no action scheduling is
performed on Timeline.

### 3.4 Schedule warnings

Timeline derives warnings from stored dates without modifying them:

- `phase-outside-project` — a scheduled first-level phase starts before the
  project or ends after it.
- `phase-overdue` — a scheduled phase deadline is before today and its subtree
  is incomplete.
- `project-overdue` — the project deadline is before today and the project is
  active.
- `unscheduled-phases` — a Now project has first-level nodes without a complete
  start/deadline pair.
- `focus-overlap` — more than three Now project spans overlap for at least seven
  consecutive days.
- `milestone-unplanned` — a milestone is within 14 days and the project has no
  unfinished leaf planned in the current week.

Warnings appear as text and color, and each warning opens the affected project
or its focused planning flow. The view never silently clamps or rewrites an
existing schedule merely because it is inconsistent.

## 4. Architecture and data flow

### 4.1 Domain and persistence

- `Goal.column` remains the single persisted horizon field.
- `Goal.completedAt?: string` is the only new domain field.
- Dexie keeps its current additive-schema approach; backup import/export
  naturally carries the optional field.
- The store adds completion/reopen actions and a board move action used by the
  accessible menu. All persistence remains behind store actions.
- Planner focus and Timeline scope are UI state, not domain data.

### 4.2 Pure modules

Project attention and roadmap warnings belong in focused, pure modules under
`src/lib`, with sibling tests. Views must not reproduce their date thresholds
or precedence rules.

Suggested interfaces:

```ts
type ProjectAttention =
  | 'overdue'
  | 'needs-next-step'
  | 'behind'
  | 'milestone-soon'
  | 'not-planned'
  | 'on-track';

function projectAttention(goal: Goal, goals: Goal[], today: string): ProjectAttention;
function focusSummary(goals: Goal[], today: string): FocusSummary;
function roadmapWarnings(goal: Goal, nowGoals: Goal[], today: string): RoadmapWarning[];
function fitRoadmapRange(goals: Goal[], viewportWidth: number): FitResult | null;
```

The final implementation may refine parameter shapes to keep each module deep
and cohesive, but these semantics are fixed.

### 4.3 View components

- `Goals.tsx` remains the board orchestrator.
- `Column.tsx` owns horizon headers, counts, and Now capacity presentation.
- `BoardCard.tsx` consumes derived attention and presents card actions.
- The current `InsightBar` becomes or is replaced by `FocusSummary`.
- A small completed-project section owns collapsed archive presentation.
- `Timeline.tsx` remains the canvas orchestrator.
- A focused toolbar/scope component owns roadmap framing controls.
- Goal and phase rows consume pure warnings and retain the shared `SpanBar`.
- The goal drawer and weekly planner accept optional initial project/node focus.

Data flows one way: store snapshot → pure derived model → thin view. User
actions return through store actions. Views never call Dexie directly.

## 5. Error handling and edge cases

- Invalid imported column indices continue to clamp to the four supported
  horizons.
- A zero-leaf project is never considered complete and receives
  `needs-next-step`.
- A partially dated phase counts as unscheduled and is not rendered as a bar.
- Imported `completedAt` values must be valid local date strings; invalid values
  are ignored during normalization rather than hiding a project.
- If planner focus refers to a deleted project, the planner falls back to its
  normal attention-ranked list.
- If Timeline's selected project is deleted or completed while completed work
  is hidden, scope falls back to Focus.
- Date conflicts produce warnings; they do not mutate user data.
- Moving, completing, or reopening a project must not disturb the relative
  order of unrelated projects.

## 6. Accessibility and responsive behavior

- Every drag operation has a menu or keyboard equivalent.
- Horizon controls, focus-summary signals, scope controls, completion actions,
  and Timeline handles expose visible focus states and descriptive labels.
- Warning meaning is never conveyed by color alone.
- Reduced-motion preferences continue to disable nonessential drag and scroll
  animation.
- On narrow screens, one board horizon is shown at a time with counts available
  in the horizon switcher.
- Timeline retains its narrower sticky-label width but preserves access to full
  titles through focus/hover details and the shared drawer.

## 7. Testing and verification

### Unit tests

- Project-attention precedence, including zero-leaf, overdue, behind,
  milestone-soon, and not-planned boundaries.
- Now capacity at 0, 3, and 4 active projects; completed projects excluded.
- Existing column-to-horizon mapping and order preservation.
- Completion/reopen filtering and newest-first completed ordering.
- Fit-project range boundaries, padding, scale clamping, and empty selection.
- Every roadmap warning, including the seven-day focus-overlap boundary.
- Monday–Sunday weekly planning semantics reused by board and Timeline signals.

### Store and persistence tests

- Complete and reopen round-trip through persistence.
- Imported backups with missing, valid, and invalid `completedAt`.
- Accessible move action produces the same column-major order as drag-and-drop.
- Deleted focused projects safely clear or fall back in UI state.

### Manual checks

- Board drag, move menu, planner focus, completion, reopen, and attention
  highlighting.
- Timeline Today/Fit controls, all scopes, zoom levels, drag/resize, warnings,
  and drawer navigation.
- Narrow board horizon switcher and narrow Timeline labels.
- Keyboard-only and reduced-motion flows.
- Light and dark themes.
- Existing data loads without changing column positions or auto-archiving
  complete goals.

### Gates

- `npm test`
- `npm run build`

## 8. Rollout boundaries

This design should ship as one coherent feature set because the board labels,
attention semantics, planner focus, completion lifecycle, and Timeline default
scope reinforce one another. Implementation may be divided into independently
green tasks, but partial releases must not rename columns without also updating
their explanatory copy and all priority consumers.

No existing user goal is moved, completed, or rescheduled during rollout.

## Locked decisions

- Board model: commitment horizon, not workflow status.
- Horizon labels: Now / Next / Later / Someday.
- Now work-in-progress limit: soft limit of three.
- Card unit: project or meaningful goal, not individual task.
- Automation: suggest next actions; never auto-schedule.
- Timeline role: project roadmap.
- Today owns habit and daily-action detail.
- Completion is explicit and reversible.
- Existing local-first store/lib/view boundaries remain.

## Open questions

None blocking.
