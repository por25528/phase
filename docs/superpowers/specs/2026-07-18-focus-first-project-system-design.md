# Focus-First Project System — Design

**Date:** 2026-07-18 · **Revised:** 2026-07-19 (spec review — ten decisions grilled and folded in)
**Status:** Reviewed written spec — ready to implement

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

A top-level `Goal` (the persisted type) is presented to the user as a
**project**. Its node tree contains phases, containers, and actionable leaf
steps. First-level scheduled nodes are the phases shown on Timeline; leaf nodes
remain the units planned for a week or day.

**Naming.** "Project" is the single user-facing noun for a top-level `Goal`. The
code type stays `Goal` for backup and schema compatibility (see §4.1); the nav
keeps the label **Goals**; all card and control copy says **project**.

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
do not count toward this limit; a `ready-to-complete` project still occupies a
slot until it is archived (that is the nudge to complete it).

The board remains horizontally arranged at desktop widths. Below the existing
small-screen breakpoint, it shows one horizon at a time through an accessible
horizon switcher instead of compressing or horizontally hiding four full
columns.

### 2.2 Card information hierarchy

Each active card presents information in this order:

1. **Project title and nearest meaningful date.** The nearest meaningful date is
   the soonest *upcoming* date among the project deadline, the next unpassed
   milestone, and the next unpassed scheduled first-level phase deadline, shown
   with its kind: `Due · Aug 30`, `Milestone · Jul 24`. If every such date is in
   the past, the overdue one is shown (pairing with the `overdue` signal).
2. **Next open action.** The project's open leaf planned for the current week is
   preferred; absent one, the first open leaf in board tree order; absent any
   open leaf, the attention prompt (for example `Define the first step`).
3. **Current-week commitment**, for Now projects — this project's leaves planned
   in the current week, for example `2 of 3 planned steps done`.
4. **Compact overall progress.**
5. **One primary attention signal**, if action is needed.

Expected percentage remains available in the drawer and detailed Timeline
tooltip, but it is removed from the default card surface. The card should help
the user choose an action, not compare several progress numbers.

The card has two direct actions:

- **Plan next step** (label follows the attention verdict — see §2.4): opens the
  weekly planner focused on this project (see §4.3).
- **Open project:** opens the shared goal drawer.

The full card remains draggable. Destructive actions move from the card's hover
surface into an overflow menu. That menu also provides **Move to Now / Next /
Later / Someday**, giving keyboard and non-drag users an equivalent operation.

### 2.3 Focus summary

The current read-only insight bar becomes a compact focus summary with exactly
four signals:

- `N of 3 focus slots used` — over the limit it reads a literal `4 of 3` and
  adds the quiet line `Focus is spread across N projects`.
- Now projects that need a first actionable step.
- Active projects behind schedule.
- Planned actions remaining this week.

The old per-column board-shape counts are dropped (each column now carries its
own `N / 3` header) and the aggregate "due soon" count is dropped (it is now a
per-card `due-soon` / `overdue` signal).

Each non-zero signal is a button. Selecting it keeps all cards in place but
emphasizes matching cards and dims unrelated ones. A visible Clear action
returns to the unfiltered board. This avoids layout jumps during diagnosis and
does not introduce a separate search/filter subsystem.

### 2.4 Project attention

`projectAttention` becomes the single project-level attention authority. It is
not parallel to the existing attention model:

- `paceStatus` remains the lower-level, **horizon-blind** schedule-pace
  primitive and continues to own `behind`, `quiet-ahead`, `on-pace`,
  `needs-breakdown`, and `complete`.
- `projectAttention` calls `paceStatus` and combines that verdict with lifecycle,
  overdue-leaf, deadline, milestone, horizon, and current-week planning data.
- The existing `attentionRank` becomes a stable ordered projection of
  `projectAttention`; it does not maintain a second score table.

The mutually exclusive project states use this precedence:

0. `completed` — `completedAt` is set; excluded from active attention and the
   planner.
1. `ready-to-complete` — `paceStatus` is `complete`, but `completedAt` is not
   set; excluded from the planner and shown with a Complete project action.
2. `overdue` — the project deadline, or any incomplete scheduled leaf deadline,
   is before today.
3. `needs-breakdown` — `paceStatus` is `needs-breakdown`.
4. `behind` — `paceStatus` is `behind`.
5. `due-soon` — the project deadline is within `DUE_SOON_DAYS` (14), inclusive.
   This preserves the planner's existing due-soon priority.
6. `milestone-soon` — a milestone is within `MILESTONE_SOON_DAYS` (14) and the
   project has no unfinished leaf planned in the current week.
7. `not-planned` — a Now project has an open leaf, but no unfinished leaf is
   planned in the current week.
8. `on-track` — no attention signal is needed; the card renders no badge.

**Horizon gating.** The states divide into two classes, and `projectAttention`
reads `goal.column` to decide which apply:

- **Factual / terminal** — `completed`, `ready-to-complete`, `overdue` — surface
  on **every** horizon. A finished project or a real deadline breach is worth
  knowing anywhere; an overdue Someday project has a clear fix (push the date or
  promote it).
- **Active-work** — `needs-breakdown`, `behind`, `due-soon`, `milestone-soon`,
  `not-planned` — surface only for the committed horizons, **Now and Next**. On
  **Later and Someday** they collapse to `on-track`, so those columns stay quiet
  by construction: a Someday idea is never nagged to "define a step," and a Later
  project is not flagged "behind" for a schedule it was deliberately not given.

There is no separate `needs-next-step` state. Under the goal-tree model, a
project without an open actionable leaf is either `needs-breakdown` (no
actionable leaves exist) or `ready-to-complete` (all actionable leaves are
done). `paceStatus` is authoritative for that distinction, preventing an
unarchived 100%-complete project from being told to define another step.

`attentionRank` excludes `completed` and `ready-to-complete`, sorts the remaining
projects by the precedence above, and preserves board order for ties. The board,
planner, and focus summary therefore cannot disagree about which project needs
attention first. The existing pace threshold and rounding rules remain
authoritative.

The weekly commitment line is separate from the primary signal and may appear
for every Now project. It uses the existing Monday–Sunday `weekOf` and planned
leaf semantics.

Card actions follow the verdict: `needs-breakdown` offers **Define first step**
and opens the project drawer; `ready-to-complete` offers **Complete project**;
other active states may offer **Plan next step** and open the focused planner.

### 2.5 Completion lifecycle

Add `Goal.completedAt?: string`, stored as a local `YYYY-MM-DD` date.

- When every actionable leaf is complete, the drawer and card offer **Complete
  project**. Completion is explicit; reaching 100% never makes a project
  disappear automatically.
- Completing sets `completedAt` and removes the project from active columns. It
  is **undo-aware** — the action snapshots `completedAt` through the existing
  five-second `scheduleUndo` window. **Reopen** is its exact inverse and needs
  no undo.
- Completed projects appear in a collapsed **Completed** section below the
  board, newest completion first.
- **Reopen** clears `completedAt` and returns the project to its persisted
  horizon and position.

**The completion freeze.** A completed project is frozen for anything that
changes its *progress or actionable structure*: toggling a leaf done, adding or
deleting a node, and planning or unplanning a leaf. Non-structural edits remain
available: title, notes, project and phase dates, milestones, and horizon
(`column`) moves. Reopen is the only way to resume structural editing.

This is enforced in the store, not merely the UI: a single `guardActive(goalId)`
early-returns at the top of each frozen action, so Today, the weekly planner, and
a stale drawer all hit the same gate. The UI additionally renders a completed
project's tree read-only, so no live-looking checkbox or add control is offered.

Existing 100%-complete goals have no `completedAt`, so they remain visible as
`ready-to-complete` and gain the Complete project action. No existing project is
archived during hydration.

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
minimum of seven days per side. It then chooses the largest scale that fits the
padded range into the visible plot width, clamped to the canvas zoom limits
(`3`–`260` px/day).

Fit is **best-effort within those limits**: a selection too wide to fit even at
minimum zoom settles at `3` px/day, centered on the range midpoint, and the user
pans through it — Fit never narrows the selection to force a fit. (In practice
the maximum clamp does not bind, because the seven-day-per-side floor keeps the
smallest padded range well under `260` px/day at any real plot width.) When the
padded range collapses to a single day — start equals deadline, or all
considered dates coincide — it uses the Week preset centered on that date. When
no projects are selected, the control is disabled.

Fit is computed from the **visible plot width** (viewport minus the active
sticky-label column, not the raw viewport) and returns a target scale plus a
center date; the view owns the responsive label-width and hands the pure
function the plot width.

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
**Schedule** assigns the default seven-day phase span (anchored to the project
start, or to today if the project is already underway) and opens the phase for
adjustment, rather than opening a separate date picker.

Resize handles become visible on hover and keyboard focus. Dragging and
resizing retain the existing day/week snapping and keyboard behavior. Clicking
a project or phase opens the shared drawer with the relevant node focused when
possible (see §4.3).

At Week zoom, the header remains a readable date ruler, but it no longer shows
habit dots or per-day planned-action counts. Clicking a date may continue to
open that date in Today as a navigation convenience; no action scheduling is
performed on Timeline.

### 3.4 Schedule warnings

Timeline derives warnings from stored dates without modifying them. Five are
**per-project** and derive from the project and today alone:

- `phase-outside-project` — a scheduled first-level phase starts before the
  project or ends after it.
- `phase-overdue` — a scheduled phase deadline is before today and its subtree
  is incomplete.
- `project-overdue` — the project deadline is before today and the project is
  active.
- `unscheduled-phases` — a Now project has first-level nodes without a complete
  start/deadline pair.
- `milestone-unplanned` — a milestone is within 14 days and the project has no
  unfinished leaf planned in the current week. This uses the **same** milestone
  window and unplanned-this-week predicates as the board's `milestone-soon`
  signal; the shared predicates live once in the plan module (§4.2), so the two
  surfaces cannot drift.

One warning is **portfolio-level**, not a per-project row badge:

- `focus-overlap` — more than three Now project spans overlap for at least seven
  consecutive days. It is computed once across the Now set (a single sweep-line),
  surfaced as a Timeline banner/band over the crowded window rather than stamped
  on every participating row, and it opens a "move a project out of Now" action
  rather than a single project. It is Timeline-only: it can only fire when Now
  already holds four or more projects, a state the board's focus summary is
  already flagging by count.

Warnings appear as text and color, and each per-project warning opens the
affected project or its focused planning flow. The view never silently clamps or
rewrites an existing schedule merely because it is inconsistent.

## 4. Architecture and data flow

### 4.1 Domain and persistence

- `Goal.column` remains the single persisted horizon field.
- `Goal.completedAt?: string` is the only new domain field.
- The code type stays `Goal`; "project" is a presentation term only. Renaming the
  type is explicitly out of scope — it would churn the store, Dexie table,
  backups, and tests for no user benefit.
- Dexie keeps its current additive-schema approach; backup import/export
  naturally carries the optional field.
- The store adds completion/reopen actions, a `guardActive(goalId)` guard shared
  by the structural mutations (§2.5), and a board-move action used by the
  accessible menu. All persistence remains behind store actions.
- Planner focus and Timeline scope are UI state, not domain data.

### 4.2 Pure modules

Project attention and roadmap warnings belong in focused, pure modules under
`src/lib`, with sibling tests. `paceStatus`, `projectAttention`, and
`attentionRank` must live behind one cohesive module boundary—either by
extending `src/lib/plan.ts` or extracting all three together. The shared date
thresholds and predicates live in that same boundary and are composed by both
`projectAttention` and `roadmapWarnings`; views must not reproduce them.

Shared constants and predicates:

```ts
const DUE_SOON_DAYS = 14;
const MILESTONE_SOON_DAYS = 14; // separate constant, same value — tunable independently

function deadlineBefore(date: string, today: string): boolean;
function milestoneWithin(goal: Goal, days: number, today: string): boolean;
function hasUnplannedOpenLeafThisWeek(goal: Goal, today: string): boolean;
```

Suggested interfaces:

```ts
type ProjectAttention =
  | 'completed'
  | 'ready-to-complete'
  | 'overdue'
  | 'needs-breakdown'
  | 'behind'
  | 'due-soon'
  | 'milestone-soon'
  | 'not-planned'
  | 'on-track';

// Reads goal.column to apply horizon gating (§2.4); paceStatus stays horizon-blind.
function projectAttention(goal: Goal, today: string): ProjectAttention;
function attentionRank(goals: Goal[], today: string): Goal[];
function focusSummary(goals: Goal[], today: string): FocusSummary;

// Five per-project warnings only — no nowGoals parameter (§3.4).
function roadmapWarnings(goal: Goal, today: string): RoadmapWarning[];
// The portfolio-level overlap signal, computed once across the Now set.
function focusOverlap(nowGoals: Goal[]): OverlapWindow | null;

// Takes the visible plot width, not the raw viewport; returns scale + center date.
function fitRoadmapRange(goals: Goal[], plotWidth: number): FitResult | null;
// FitResult = { scale: number; scrollToCenterDate: string }
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
- A focused toolbar/scope component owns roadmap framing controls; a
  Timeline-level banner owns the `focus-overlap` presentation.
- Goal and phase rows consume pure warnings and retain the shared `SpanBar`.
- **Drawer focus:** `openDrawer(goalId, nodeId?)` — with a node given, the drawer
  expands to and highlights it; otherwise it opens at the project root. The node
  is a soft hint: a missing or deleted node opens the drawer normally.
- **Planner focus:** the weekly planner accepts an optional `focusGoalId`
  (and `focusNodeId`). A per-card **Plan next step** opens the planner directly
  on its plan step — bypassing the weekly recap **without** marking the week
  reviewed, so the Monday recap still appears the next time the planner is opened
  from its top-level entry. The focused project is scrolled to, expanded, and
  briefly emphasized with its next open leaf ready to select. Focus is a display
  hint only: it never filters the pane and never auto-plans a leaf, and a missing
  target falls back to the normal attention-ranked list.

Data flows one way: store snapshot → pure derived model → thin view. User
actions return through store actions. Views never call Dexie directly.

## 5. Error handling and edge cases

- Invalid imported column indices continue to clamp to the four supported
  horizons.
- A zero-leaf project is never considered complete and receives
  `needs-breakdown` through `paceStatus`.
- A partially dated phase counts as unscheduled and is not rendered as a bar.
- Imported `completedAt` values must be valid local date strings; invalid values
  are ignored during normalization rather than hiding a project.
- A frozen structural action on a completed project is refused by `guardActive`;
  the UI presents the tree read-only rather than surfacing an error.
- If planner focus refers to a deleted project, the planner falls back to its
  normal attention-ranked list.
- If Timeline's selected project is deleted or completed while completed work
  is hidden, scope falls back to Focus.
- A Fit selection too wide to fit at minimum zoom settles at minimum zoom,
  centered — it is never narrowed to force a fit.
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

- Project-attention precedence, including lifecycle-completed,
  ready-to-complete, zero-leaf, overdue project, overdue leaf, behind,
  due-soon, milestone-soon, and not-planned boundaries.
- Horizon gating: active-work states (`needs-breakdown`, `behind`, `due-soon`,
  `milestone-soon`, `not-planned`) are suppressed to `on-track` on Later and
  Someday; factual states (`completed`, `ready-to-complete`, `overdue`) surface
  on every horizon.
- `attentionRank` delegates to project-attention precedence, drops completed
  and ready-to-complete projects, and preserves board order for ties.
- Card derivations: nearest-meaningful-date selection and its kind label; next
  action prefers the current-week-planned leaf, then the first open leaf, then
  the prompt.
- Now capacity at 0, 3, and 4 active projects; completed projects excluded, a
  `ready-to-complete` project still counted.
- Existing column-to-horizon mapping and order preservation.
- Completion/reopen filtering and newest-first completed ordering.
- Shared-predicate reuse: `milestone-soon` (board) and `milestone-unplanned`
  (Timeline) agree for the same project and date.
- Fit-project range boundaries, padding, minimum-zoom clamping (wide range
  settles centered, not narrowed), single-day collapse to Week, plot-width
  input, and empty selection.
- Per-project roadmap warnings from `(goal, today)` alone.
- `focusOverlap` portfolio sweep: the seven-day / more-than-three boundary and a
  single reported window.
- Monday–Sunday weekly planning semantics reused by board and Timeline signals.

### Store and persistence tests

- Complete and reopen round-trip through persistence; Complete is undo-aware,
  Reopen is its inverse.
- `guardActive` refuses the frozen structural mutations (toggle leaf done, add or
  delete node, plan or unplan a leaf) on a completed project from every calling
  surface, and allows metadata and horizon-move actions.
- Imported backups with missing, valid, and invalid `completedAt`.
- Accessible move action produces the same column-major order as drag-and-drop.
- Deleted focused projects safely clear or fall back in UI state.

### Manual checks

- Board drag, move menu, planner focus (recap bypassed without marking the week
  reviewed), completion, reopen, and attention highlighting.
- `openDrawer` with and without a focus node.
- Timeline Today/Fit controls, all scopes, zoom levels, drag/resize, warnings,
  focus-overlap band, and drawer navigation.
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
- Now work-in-progress limit: soft limit of three; a `ready-to-complete` project
  still holds a slot until archived.
- Card unit: a project (a top-level `Goal`), not an individual task.
- Naming: user-facing "project"; code type stays `Goal`; nav stays "Goals".
- Attention: `projectAttention` is the single authority over a horizon-blind
  `paceStatus`; active-work signals are gated to Now + Next.
- Completion is explicit and reversible, frozen by a store-level `guardActive`
  guard, and undo-aware.
- Automation: suggest next actions; never auto-schedule.
- Timeline role: project roadmap; `focus-overlap` is a portfolio-level,
  Timeline-only signal.
- `Fit projects` is best-effort within the zoom limits and never narrows the
  selection to force a fit.
- Today owns habit and daily-action detail.
- Existing local-first store/lib/view boundaries remain.

## Open questions

None blocking. Interactive mocks of the board and Timeline exist from the
2026-07-19 design review.
