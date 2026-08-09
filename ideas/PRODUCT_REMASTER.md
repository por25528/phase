# Phase Product Remaster

This document is a product specification, not a mood board. It evaluates the current checked-in product as a heavy daily user and defines a remaster another design or engineering agent can implement without guessing at the intended hierarchy, vocabulary, or interactions.

The central product promise is:

> I have something meaningful I want to accomplish. Help me turn it into work I can realistically finish.

Phase should optimize the complete loop—capture, decompose, commit, schedule, execute, recover, and review—not merely provide screens for storing goals and tasks.

## 1. Executive Diagnosis

Ranked by impact on repeated daily use:

### 1. The product has multiple overlapping work models

Phase simultaneously exposes projects, goals, sub-goals, steps, tasks, checkpoints, habits, horizons, planned weeks, planned days, and timed blocks. These are not just labels for the same hierarchy; they have different storage, completion, scheduling, and navigation rules. A step can be planned, scheduled, estimated, timed, blocked, or nested. A standalone task has a different creation flow and no equivalent project-tree position. A checkpoint is a leaf that counts toward progress even though users read it as a marker. This creates maintenance work instead of clarity.

The remaster must establish one canonical chain:

**Goal → Area (optional) → Task → Work session**

“Milestone” is a dated marker, not a parent node. “Project” is not a second object type; it is a goal template/type.

### 2. The app has no dominant daily execution surface

The Plan week grid is a planning instrument, Projects is a commitment board, and Timeline is a portfolio visualization. None answers “what do I do now?” with enough authority. The current product can calculate next steps, planned work, capacity, pace, and blocked states, but distributes those answers among card metadata, a focus summary, a sidebar backlog, the project header, and calendar blocks.

The remaster needs a global **Today** surface that shows the current session, the next task, remaining planned workload, approaching deadlines, and a small recovery path when the day slips. It should not become another undifferentiated task list.

### 3. Creation asks for structure before the user has momentum

The New Project modal asks for title, horizon, start, deadline, first steps, and notes before the project exists. This is a form-shaped interpretation of planning. A user with “Physics Final, Aug 24” should be inside a real workspace after two fields, with manual decomposition or a type-specific plan generator available in context. Notes and horizon are premature at creation time.

### 4. Project metadata is more visually authoritative than project work

The project page leads with a display-serif title, two date controls, confirmation/clear actions, a large percentage, a full progress bar, basis text, pace text, weekly counts, next task, and estimate calibration before the user reaches the tree. Roughly the first 140–190 vertical pixels are status explanation. The work tree—the object users came to manipulate—arrives afterward.

The remaster should use a 56–72px compact sticky header. The work surface should occupy most of the viewport.

### 5. Planning state and execution state are conflated

The global project board uses commitment horizons (`Now / Next / Later / Someday`); leaf tasks have status (`todo / doing / blocked / done`); week/day fields represent commitment; start minutes represent scheduling; deadline spans represent another timeline. Users must infer whether moving an item changes priority, status, date, or actual scheduled time.

Every direct manipulation must change one explicit dimension. Board columns change task status. Calendar drag changes time. Goal portfolio controls change goal commitment. Filters change only the view.

### 6. Important functionality exists but is hidden behind local conventions

Phase already has multi-select in the goal tree, keyboard scheduling, undo, fuzzy search, focus signals, status cycling, estimate controls, notes, and drag/drop. Most is discoverable only by accident, hover, a shortcuts overlay, or source-level knowledge. For example, number keys place a focused backlog item on weekdays; `Alt+Arrow` moves project cards; double-click renames; modifier-click selects tree rows. These are good power features with weak affordances and inconsistent reach.

### 7. Modal usage turns fast actions into context switches

Quick task capture is a multi-section modal. New project is a modal. Project import is a modal. AI breakdown is a modal that instructs the user to leave the app. Availability is modal-like. The product treats “needs input” as synonymous with “center a form and block the interface.” Frequent actions need inline composers, popovers, or a right-side inspector. Dialogs should be reserved for destructive confirmation, authentication, and genuinely multi-step imports.

### 8. The visual system is consistent at the token level but not restrained at the product level

The current implementation has a real type scale, accessible muted colors, dark mode, and reusable tokens. The problem is how they are composed: Fraunces display headings, mono uppercase labels, rounded navigation pills, rounded cards, status pills, dashed empty cards, filled focus-summary cards, and bordered fields all compete. A system can be internally consistent and still be too ornamental. The remaster should simplify type roles, reduce container chrome, and reserve elevated surfaces for floating UI.

### 9. Progress is precise-looking but semantically unstable

The percentage can be weighted by estimate only when estimates are sufficiently complete and otherwise falls back to equal leaf weighting. Hierarchical averaging and checkpoints can make 72% look more authoritative than it is. Progress is useful, but it should be secondary to remaining effort, deadline feasibility, and the next actionable task.

### 10. Recovery from missed work is not a first-class workflow

Phase identifies carry-over and overcommitment, but missing Tuesday still forces the user to interpret the backlog, calendar, and deadlines manually. A serious planner must make disruption cheap. “Replan unfinished work” should be a visible, bounded flow that proposes changes, shows consequences, and never silently moves work.

## 2. First-Time User Experience

### Current study-goal setup: where friction accumulates

Scenario: create `Physics Final`, deadline August 24.

1. The first-run landing surface is Plan, but the useful onboarding is on Projects. The empty calendar, empty backlog, and working-hours warning expose implementation dependencies before value.
2. The user must infer that an exam is a “project.”
3. New Project opens a modal and immediately asks for a horizon. `Now / Next / Later / Someday` is a portfolio commitment choice, not information a new user naturally has while entering an exam.
4. Start and deadline are shown as equal fields. For exam preparation, the deadline is certain and the start is usually “now” or derived from capacity.
5. “First steps” is a flat repeated input even though study preparation is naturally topic → activities.
6. Notes appear before a usable plan exists.
7. After creation, the user must discover the small “Break a step into subtasks…” action below the tree.
8. The breakdown flow requires selecting a leaf, copying a prompt, leaving Phase, choosing an external model, pasting, waiting, copying the reply, returning, pasting text/JSON, validating, and submitting.
9. Generated children inherit no clear estimates, schedule, or review cadence unless the external response happens to encode compatible text.
10. Scheduling happens on another global surface, so the user leaves the project immediately after building it.

This is not one flow. It is a chain of loosely connected CRUD operations.

### Ideal study-goal creation

Invoke `New goal` from the header, `Cmd+Shift+N`, or the command palette. A compact composer appears below the header or centered as a command surface:

```text
What do you want to finish?
Physics Final

Deadline                                  Type
Aug 24                                    Study ▾

                                         Create ↵
```

Only the title is required. If the title contains “midterm,” “final,” “exam,” “chapter,” or a course-like pattern, Phase can preselect Study but must make the inference visible and editable.

On Enter, create the goal immediately and open its Work tab. Do not hold creation hostage to plan configuration. The empty work surface becomes the next-step chooser:

```text
Physics Final · due Aug 24

How do you want to start?

[ Generate exam plan ]  [ Add topics manually ]  [ Import syllabus/outline ]
```

`Generate exam plan` opens an inline planning panel, not a modal. Ask only the missing study-specific inputs:

- Topics or pasteable syllabus/exam scope.
- Confidence: unfamiliar / mixed / mostly review.
- Available weekly time, defaulted from calendar capacity.
- Preferred practice style, optional and collapsed.

The result appears as an editable tree diff in place. Accepting it creates Areas and Tasks. A second step proposes work sessions against actual calendar availability. The user can accept structure without accepting the schedule.

Time to a real goal: under 10 seconds. Time to a credible plan: under 2 minutes.

### Current software-project setup: where friction accumulates

Scenario: create `Launch SaaS MVP`.

The same modal assumes the same inputs as an exam. “Start” and “deadline” are useful, but the flat First Steps field discourages feature/workstream structure. The user must decide whether `Authentication` is a sub-goal, step, checkpoint, or project. The current project tree supports nesting, but creation does not teach or exploit it. Status lives on leaves, so a feature container cannot have an explicit workflow state. The global project board moves the entire project through time horizons but offers no project-level work board. The user then toggles among Projects, Timeline, Plan, and a tree inspector to understand one launch.

### Ideal software-project creation

Use the same two-field entry surface:

```text
Launch SaaS MVP
Target date: Sep 30
Type: Project
```

After creation, present type-specific starting points:

```text
[ Start from a launch template ] [ Generate draft plan ] [ Blank workspace ]
```

The launch template proposes Areas such as Product, Engineering, Go-to-market, QA, and Launch, but nothing is created until the user previews it. `Generate draft plan` asks for scope in one large natural-language field and optionally accepts pasted notes. The preview includes tasks, estimates, dependencies, and explicit assumptions. It does not invent arbitrary deadlines for every task.

The user lands in the Work tab with direct tree manipulation and can switch to Board without leaving the goal workspace.

### First-time onboarding sequence

On a completely empty account, do not show the full calendar as the first meaningful object. Use three progressive steps in the real interface:

1. **Create one goal.** Title plus optional deadline.
2. **Turn it into work.** Generate, use a template, paste an outline, or add manually.
3. **Place the first task.** Offer one suggested open slot and a “Choose another time” calendar affordance.

Working hours should default to a reasonable local preset and be editable later. Do not require configuring a weekly availability model before the user can experience scheduling.

Success criterion: a new user creates a goal, decomposes it, and schedules one task without navigating to Settings or reading explanatory prose.

## 3. Daily User Experience

### A representative week in the current product

#### Monday: weekly planning

I open Plan and see the week grid, backlog rail, habits, stats, and availability panels. The capacity sentence is useful but visually subordinate. To understand priorities, I switch to Projects and inspect Now cards. To determine which tasks are actually schedulable, I return to Plan. If I open a project to refine a task and then return, I rely on preserved ephemeral week state. The product makes me shuttle between commitment, decomposition, and time.

Recurring annoyance: the object I am manipulating changes shape across surfaces—a card on Projects, a row in a tree, a grouped backlog row, and a calendar block.

#### Tuesday: executing a packed day

At 10:10, the seven-day grid is still the main surface even though only the current and next block matter. Short calendar blocks are hard to read. A task has project color, title, and time, but “why this matters,” parent Area, deadline risk, and next action are not available without opening other views.

Recurring annoyance: Phase knows my next open leaf and current schedule but does not state one authoritative next action.

#### Wednesday: assignment scope changes

I need to split `Implement parser` into four tasks. I can add children inline one at a time or use the copy-prompt workflow. The latter is too disruptive for routine decomposition, so after two weeks I stop using it. I create vague tasks instead, which harms estimates and scheduling.

Recurring annoyance: a technically available feature loses to friction and becomes dead product weight.

#### Thursday: interruption and missed work

A lab meeting consumes the afternoon. Scheduled blocks remain in the past or unfinished. I must identify what was missed, decide what to move, check available capacity, and preserve deadlines. A carry-over affordance helps, but there is no consequence-aware recovery workspace.

Recurring annoyance: the system is good at representing the plan and weak at renegotiating it.

#### Friday: project review

I open a project and see percentage, pace, planned count, next step, and calibration. These are individually sensible but form a dense status sentence. I want: what changed, what is blocked, what remains, and whether next week is feasible. Notes are in a separate tab but not tied to a review ritual.

Recurring annoyance: project health is reported as metadata rather than converted into decisions.

#### Saturday: side project deep work

The global Projects board is organized by commitment horizon, not workflow. For `Launch SaaS MVP`, I want a Kanban board of its tasks. The tree is excellent for structure but poor for flow. I cannot see WIP, ready work, or blocked tasks spatially within the project.

Recurring annoyance: Kanban exists at the wrong level for day-to-day project work.

#### Sunday: semester overview

Timeline shows spans, but it is a separate global destination. It competes with Plan and Projects even though it is another view of the same goals. I use it occasionally, not daily.

Recurring annoyance: a low-frequency visualization receives top-level navigation weight equal to core execution.

### Remastered daily loop

The remaster separates three questions cleanly:

- **Today:** What should I do now, and what must change today?
- **Plan:** When will committed work happen, and does it fit?
- **Goals:** What outcomes am I committed to, and what work remains?

Today answers the eight required questions as follows:

| User question | Immediate answer |
|---|---|
| What should I work on today? | Current session, then ordered next tasks |
| Why is it important? | Goal and Area breadcrumb plus deadline/priority reason |
| Which goal does it belong to? | Stable project color and visible goal title |
| How much work is left? | Remaining estimate today and remaining goal effort |
| Am I on track? | One health label with explanation: On track, Tight, At risk, Blocked |
| What should I do next? | One primary next action, never five competing signals |
| What happens if I miss today? | Inline impact: “moves goal from On track to Tight” or “2h must move” |
| What deadlines are approaching? | Compact deadline rail for the next 14 days |

Today contains three vertically ordered zones:

1. **Now:** current session or the next suggested task, with Start/Resume/Complete.
2. **Today’s plan:** chronological sessions with unscheduled “must do today” tasks at the bottom.
3. **Attention:** at most three exceptions—overdue work, deadline risk, or an unresolved blocker.

It must not contain portfolio analytics, habits configuration, or generic dashboard cards.

## 4. Information Architecture

### Current architecture

The current top-level architecture is approximately:

```text
Plan
├── Week / Month
├── To plan rail
├── Habits
├── Stats
└── Working hours

Projects
├── Now / Next / Later / Someday board
├── Focus summary
├── New project modal
├── Import project modal
└── Project page
    ├── Steps
    │   └── Step inspector
    └── Notes

Timeline

Global overlays
├── Search / command palette
├── Add task
├── Shortcuts
├── Import backup
└── Header utility menu
```

The hierarchy is not inherently impossible, but it is organized around feature ownership rather than user intent.

### Proposed architecture

```text
PHASE
├── Today                         execution: now, today, exceptions
├── Plan                          time: week/day calendar + unscheduled rail
├── Goals                         portfolio: list / board / timeline views
│   └── Goal workspace
│       ├── Work                  Areas + Tasks; default tab
│       ├── Board                 task workflow
│       ├── Calendar              this goal's sessions and unscheduled tasks
│       └── Notes                 durable project context
├── Command palette               find + act + create
├── Quick add                     task, goal, note-to-inbox
└── Settings
    ├── Calendar & availability
    ├── Appearance
    ├── AI provider & privacy
    ├── Shortcuts
    └── Data                      export, import, storage maintenance
```

### Architectural rules

1. Global destinations correspond to user modes, not data presentations.
2. List, board, and timeline are view modes within Goals, not separate destinations.
3. A goal workspace keeps structure, flow, schedule, and context in one URL/view state.
4. A task opens the same right inspector from Today, Plan, Work, Board, and search.
5. The inspector never replaces the underlying page, so context survives edits.
6. Search results expose actions; search is not a navigation-only index.
7. Settings owns low-frequency system operations.
8. Tabs change the primary representation without losing the selected goal, filter, or scroll state.

### State continuity requirements

- Returning from a goal to Goals restores view mode, filter, selected group, and scroll.
- Switching goal tabs retains selected tasks and inspector subject when meaningful.
- Opening a task from the calendar and closing it returns to the same week and scroll time.
- Search navigation carries a return location.
- `Esc` closes in layers: popover → inspector → goal workspace → no-op. It must never unexpectedly jump multiple levels.

## 5. Goal Model

### Recommended vocabulary

| Concept | Definition | Examples | Why this term |
|---|---|---|---|
| **Goal** | A finishable outcome with an optional deadline | Physics Final, Launch SaaS MVP, Finish CS50 | Works for academic, project, startup, and personal work; aligns with the product promise |
| **Area** | Optional grouping of related work inside a goal | Mechanics, Rotation, Authentication, Payments | Neutral across study topics and project workstreams; not falsely completable by itself |
| **Task** | A concrete completable unit of work | Problems 1–15, Add password reset | Familiar, actionable, schedulable |
| **Milestone** | A meaningful dated marker or gate | Mock exam, Beta ready, Final exam | Useful as a marker; should not own arbitrary children |
| **Work session** | A scheduled calendar block allocated to a task | Problems 1–15, Tue 14:00–15:00 | Separates intended work from time allocation and allows one task to span sessions |
| **Goal type** | A template that changes setup and suggestions | Study, Project, General | Enables opinionated flows without duplicating the engine |

Do not expose “sub-goal” as a primary noun. A nested outcome is either another independent Goal linked to a parent or an Area. Do not use “Step” and “Task” interchangeably. The current distinction costs attention without delivering value.

### Canonical model

```text
Goal
├── properties: title, type, outcome, status, target date, priority, health
├── Areas (optional; one visible level by default)
│   └── Tasks
├── Tasks (may also exist without an Area)
├── Milestones
├── Notes
└── Views

Task
├── title, status, estimate, priority, deadline, labels
├── goalId, optional areaId
├── dependencies, recurrence, notes
└── zero or more Work sessions

Work session
├── taskId
├── start, end
├── planned duration
└── actual duration / completion outcome
```

### Hierarchy rules

- Beginners see Goal → Task. Areas appear only after grouping is useful.
- One visible Area level is the default. Allow nested Areas only as an advanced capability and render them as a tree, not additional navigation.
- Tasks can have a checklist for tiny implementation details, but checklist items are not schedulable and do not independently affect portfolio progress.
- If a checklist item needs an estimate, owner, status, or schedule, promote it to a Task.
- A task can require multiple work sessions. Scheduling a 4-hour task as two 2-hour sessions must not duplicate the task or mark it done after the first block.
- Completion of a session logs effort; completion of a task remains explicit unless the session was declared “finish task.”

### Status and time are separate dimensions

Task status:

```text
Backlog → Ready → In progress → Done
                    ↘ Blocked
```

Planning state is derived:

```text
Unscheduled | Scheduled later | Scheduled today | Overdue
```

Do not store `Today` as a status. Do not store `This week` as a workflow column. A task can be `In progress` and scheduled Friday; those facts should coexist.

### Progress

Primary goal progress should be remaining effort, with task completion as fallback:

1. If all open/done tasks have estimates, use completed estimated effort / total estimated effort.
2. If estimates are incomplete, show task count and an “estimates incomplete” qualifier; do not silently switch the meaning of the same percentage.
3. Milestones do not count as task effort.
4. Areas roll up their tasks; they do not have manually stored completion.
5. Health uses deadline, remaining effort, dependencies, and real calendar capacity—not percentage against elapsed calendar time alone.

Recommended header language:

```text
12h 30m remaining · 8 of 14 tasks · On track
```

The percentage can remain as a compact secondary visualization.

## 6. Project Workspace

Call the object a **Goal** globally. “Project workspace” describes the interaction pattern, not a second data type.

### Screen allocation

The compact header and tabs should consume no more than 104px after the global app bar. The remaining viewport belongs to work.

```text
‹ Goals  Physics Final                    On track · Due Aug 24 · 12h 30m left   •••
         Study                                              62%

         Work     Board     Calendar     Notes
───────────────────────────────────────────────────────────────────────────────
         primary tab content                              optional task inspector
```

### Header

One line on desktop, two lines only when constrained:

- Breadcrumb/back target.
- Editable goal title.
- Health, deadline, remaining effort, and compact progress.
- Overflow menu for pause, duplicate, export goal, complete, and delete.
- No permanently visible start-date field, clear-dates action, calibration prose, or completion lifecycle card.

Clicking the health/deadline cluster opens a popover with detail and editing. This uses progressive disclosure without hiding essential status.

### Tab 1: Work — default

Work is the canonical structural editor and should occupy most of the screen.

```text
▾ Mechanics                                      3/5 · 3h 15m left       +
    ✓ Review Chapter 7                           45m  Done
    ◐ Problems 1–15                              60m  Today 14:00
    ○ Problems 16–30                             60m  Ready
    ! Mock quiz                                  30m  Blocked

▸ Rotation                                       0/3 · 2h 40m left       +

+ Add task                  + Add area                  ✦ Draft a plan
```

Interactions:

- Single click selects and opens the inspector; it does not toggle completion.
- Checkbox toggles done.
- Double-click or Enter on title edits inline.
- `Cmd+Enter` creates a sibling; `Tab`/`Shift+Tab` changes nesting while editing; `Cmd+Shift+Enter` creates a child.
- Drag handle reorders; dragging onto an Area moves the task.
- Estimates, date, and status can be edited inline through compact cells/popovers.
- Multi-select supports move, status, schedule, estimate, label, and delete.
- Completed tasks collapse into a section after seven days by default, with a visible count.

### Tab 2: Board

Board is a workflow view over the same Tasks, not a parallel data structure. Default columns: Backlog, Ready, In progress, Done. Blocked appears as a flagged state within its current/previous column or as an optional fifth column for teams/power users. Areas are swimlanes or filters, not cards that compete with tasks.

### Tab 3: Calendar

This is the goal-scoped execution plan:

- Week calendar in the center.
- Unscheduled tasks for this goal in a 240–280px rail.
- Goal deadline and milestones as all-day markers.
- Other-calendar events remain visible but subdued.
- Other Phase goals can be toggled on for collision context.
- Dragging creates/moves Work sessions, not tasks.

### Tab 4: Notes

One durable notes document with lightweight links to Areas, Tasks, and dates. Notes are for strategy, decisions, links, study summaries, and retrospectives. A note checkbox does not become a task automatically; a selection menu provides “Create task from selection.”

### Why there is no Overview tab in the initial remaster

The compact header is the overview. A separate Overview tab would likely become a dashboard of duplicate progress cards, recent activity, and metadata—the exact hierarchy problem being removed. If later evidence shows users need reviews, add a focused **Review** panel or mode, not a generic overview dumping ground.

## 7. Kanban System

### Where Kanban belongs

Kanban is strongest inside a Goal when users need to manage work state across several parallel tasks. It is especially valuable for software features, startup launches, research projects, and assignments with design/build/test phases.

It may also be an optional view on the global Goals page, where columns represent goal commitment/status. That global board should not be the only way to browse goals.

### Default task board

```text
BACKLOG              READY                IN PROGRESS          DONE
Ideas not yet        Actionable,          Currently active     Recently completed
committed            unblocked work       WIP-limited          and collapsible
```

- Default WIP limit: 3 In Progress tasks per person/device context. Warn, do not hard-block.
- `Blocked` is a state overlay with reason and dependency, not automatically a permanent column. Users may enable a Blocked column in board settings.
- `Done` shows the most recent 20 or current review period, then collapses older work.
- Dragging between columns changes only task status.
- Dropping into In Progress sets `startedAt` and exposes Start session, but does not schedule time automatically.
- Dropping into Done checks dependencies and prompts only when an unresolved child/checklist remains.

### Cards

Cards should contain only:

- Task title, maximum three lines.
- Area breadcrumb or color marker.
- Estimate.
- Scheduled date/time if present.
- Up to two exceptional indicators: overdue, blocked, dependency, high priority.

No progress bar on ordinary task cards. No full notes preview. No permanent action footer. Hover reveals a grab handle and overflow action; clicking opens the inspector.

### Areas and nested goals

- Default: filter by Area using a compact filter row.
- Optional: Areas as horizontal swimlanes when there are 2–6 Areas.
- Never render an Area as a board card among Tasks.
- Linked child Goals appear as a relationship in the parent Goal, not as draggable task cards.

### Filtering

Board filters: Area, assignee if collaboration is introduced, label, priority, deadline window, scheduled/unscheduled, and milestone. Filters compose and can be saved as views. The current filter state appears in the URL/view state and survives tab switches.

### When Kanban should not be shown

- Fewer than five open Tasks unless the user explicitly chooses Board.
- Linear study sequences where order matters more than state, such as reading chapters in order.
- Daily calendar planning, where time is the dominant dimension.
- A single checklist-like assignment.
- Goal portfolio review when deadlines and health matter more than workflow; use a dense list/table.

The empty Board should recommend Work view when the goal does not benefit from columns, not display four large empty drop zones.

## 8. Calendar + Planning

### Core relationship

```text
Goal → Task backlog → Work session on calendar → actual work → Task/Goal progress
```

The calendar is not a separate organizer. It is the execution layer for goal work.

### Global Plan surface

Desktop layout:

```text
Week of Aug 10     31h free · 18h planned · 6h unscheduled · 2h over capacity

UNSCHEDULED            MON        TUE        WED        THU        FRI
Goal-grouped rail      spatial week calendar with external events and sessions
```

- Rail is always the primary sidebar body; Working hours moves to Settings.
- Stats move into the week header or Review.
- Habits appear below Today or in a compact secondary section, not as a planning peer.
- Week and Day are first-class modes. Month is for deadline/milestone awareness and lightweight rescheduling, not detailed time-block creation.
- Mobile defaults to a single-day layout with a date strip and unscheduled bottom sheet.

### Weekly planning ritual

Opening Plan on Monday or invoking `Plan my week` enters a temporary guided mode:

1. Review unfinished work from last week.
2. Review deadlines and milestones in the next 14 days.
3. Select Tasks to commit this week.
4. Estimate any committed but unestimated Tasks.
5. Drag or auto-place Work sessions into free time.
6. Resolve over-capacity conflicts.
7. Confirm the week.

This is one surface with a step indicator in the header, not six wizard pages. Users can exit at any time; changes already made persist and are undoable.

### Unscheduled work rail

Group by urgency first, then Goal:

1. Overdue.
2. Due in 7 days.
3. Committed this week.
4. Later/uncommitted, collapsed.

Each row shows title, goal, estimate, deadline, and reason for its position. The current product already follows the important principle that anything reordered by a deadline should visibly state that deadline; keep it.

Support multi-select and batch scheduling. A drag of multiple selected tasks creates sequential sessions using estimates and available gaps, with a preview before commit if they span multiple days.

### Drag-to-calendar behavior

- While dragging, eligible gaps highlight; impossible days show capacity conflict before drop.
- Dropping an estimated Task creates a session of that duration.
- Dropping an unestimated Task opens a tiny duration popover anchored to the block, defaulting to 30 minutes.
- Holding `Option` creates another session for the same Task rather than moving the existing one.
- Resize changes session duration, not the Task estimate. If planned sessions exceed the estimate, show a quiet discrepancy indicator.
- Dragging a completed Task is disallowed unless it is reopened.
- External events cannot be edited unless calendar write access is explicitly supported.

### All-day goals versus timed work

- Goal deadlines and Milestones render in the all-day row.
- Tasks with a due date but no time render in the all-day task strip and unscheduled rail.
- Work sessions render in the timed grid.
- Never render a Goal itself as a multi-hour timed block. Goals occupy time through their Tasks.

### Missed and overdue work

At the start of a day, unfinished sessions from yesterday appear in an exception strip:

```text
2 sessions unfinished · 1h 45m
[ Replan ] [ Mark done ] [ Leave unscheduled ]
```

`Replan` opens a preview showing proposed moves, capacity after changes, and deadline impact. The user can apply all, modify individual moves, or cancel. Nothing moves silently.

### Feasibility

Goal health should be based on:

- Remaining estimated task effort.
- Scheduled future sessions.
- Available capacity before deadline.
- Dependencies and blocked tasks.
- Historical estimate calibration when enough data exists.

Health language:

- **On track:** remaining effort fits with meaningful buffer.
- **Tight:** fits with less than 15% buffer or relies on unestimated work.
- **At risk:** does not fit available capacity or a critical dependency is late.
- **Blocked:** no actionable path exists.
- **No forecast:** insufficient deadline/estimate data.

Never label a project “behind” solely because elapsed calendar percentage exceeds completed task percentage.

## 9. AI Planning

### Delete the clipboard-plumbing interaction

The current “Break a step into daily tasks” modal explicitly instructs the user to choose a step, copy a prompt, leave the app, ask another AI, copy a reply, return, paste it, inspect a parser preview, and submit. The parser is robust, but robustness around an inherently bad loop does not make the loop good. Keep import-from-text as a fallback power feature; remove it from the primary planning path.

### Native interaction model

AI is an editable proposal engine embedded in the surface where work lives.

On an empty or selected Goal:

```text
✦ Draft a plan
```

On a selected Area or Task:

```text
✦ Break down
✦ Find missing work
✦ Make this smaller
✦ Re-estimate
```

The response streams into an inline diff directly below the selected object:

```text
MECHANICS                                          Proposed
  + Review Chapter 7                    45m
  + Problems 1–15                       60m
  + Problems 16–30                      60m
  + Mock quiz                           30m       milestone: Aug 20

Assumptions: chapters 7–9 are in scope; 6 hours/week available.

[ Accept all ] [ Accept selected ] [ Edit ] [ Regenerate ] [ Dismiss ]
```

Every proposed row is editable before acceptance. Checkboxes select rows. Drag changes order. Estimates and dates are normal controls, not generated prose. Accept is one undoable transaction.

### Goal-level commands

- **Create study plan:** infer Areas from topics, then propose review/practice/mock tasks.
- **Draft project plan:** propose workstreams, tasks, dependencies, and launch gates.
- **Find missing work:** compare title, notes, current Areas, and Tasks; suggest omissions only.
- **Make this realistic:** reduce scope, split oversized Tasks, and flag missing estimates.
- **Plan the next 7 days:** propose sessions within free time and before deadlines.
- **Replan overdue work:** propose calendar changes with consequence preview.
- **Reduce workload by 20%:** identify deferrable or lower-value work; never silently delete.
- **Explain risk:** state which tasks, estimates, or dependencies cause At risk.

### User control and trust

- AI never directly edits live work without acceptance.
- Accepted proposals are one undoable mutation.
- Every proposal states assumptions and which data was used.
- Calendar placement is a separate acceptance step from task generation.
- Existing Tasks are never overwritten; changes use a visible before/after diff.
- Destructive suggestions are phrased as defer, merge, or remove and require explicit selection.
- Private calendar titles and notes are excluded by default. Settings disclose exactly what is sent.
- If no provider is configured, the button explains setup and offers manual templates or “Copy structured prompt” as fallback—not a dead modal.

### Error and latency behavior

- Stream partial suggestions into skeleton rows that become editable only when complete.
- Cancel remains available during generation.
- On failure, keep the user’s input and show Retry / Use manual template.
- Never leave a modal spinner blocking the workspace.
- Cache no provider response beyond accepted work unless the user opts into history.

### What AI should not do

- Be a chatbot home screen.
- Generate motivational text.
- Invent grades, syllabus scope, deadlines, or free calendar time.
- Reschedule silently.
- Produce decorative “insights” without an action.
- Replace deterministic capacity, recurrence, dependency, or progress calculations.

## 10. Study Goal Experience

Study is a Goal type with opinionated setup and review patterns. It uses the same Areas, Tasks, and Work sessions as every other Goal.

### Exam preparation

Input:

- Exam date.
- Topics, pasted outline, or syllabus selection.
- Confidence per topic: low / medium / high, optional.
- Available materials: notes, textbook problems, past exams.

Default Areas are topics (`Mechanics`, `Rotation`, `Fluids`). Default task pattern per topic:

1. Diagnose/review concepts.
2. Active recall or summary.
3. Representative problems.
4. Timed mixed practice.

Create two Milestones by default only when dates permit: diagnostic/mock exam and actual exam. Do not create fake “complete topic” milestones.

Progress emphasizes mastery evidence and remaining effort, not chapters checked. After completing a practice task, optionally record confidence or score. Low performance can suggest another Task, but never auto-create it.

### Course or textbook completion

Input:

- Source outline: chapters/modules.
- Target date or pace.
- Whether exercises are required.

Areas are modules or chapter ranges. Tasks can follow a reusable sequence: read/watch, notes, exercises, review. Recurrence creates weekly review Tasks without cloning the whole Goal. The Work tab can offer a sequential mode that shows the next chapter prominently and collapses future chapters.

### Assignment or academic project

Input:

- Due date.
- Prompt/rubric.
- Submission format.

Default Areas adapt to artifact type:

- Problem set: understand, solve, verify, submit.
- Paper: research, thesis, outline, draft, revise, submit.
- Coding assignment: understand spec, implement, test, write-up, submit.
- Lab: prepare, run, analyze, report.

The rubric can be converted into a checklist attached to a final verification Task. “Submit” is a Milestone or final Task with a hard deadline, depending on whether action is required.

### Spaced revision

Spaced revision is a template, not a separate object type. Completing a review Task schedules the next occurrence according to a simple interval rule. Users can modify or stop the sequence. Calendar sessions remain ordinary Work sessions. The UI shows “Next review Aug 18,” not algorithmic jargon.

### Student-specific Today behavior

- Deadlines show course code or Goal color consistently.
- A “Next class/exam” reason can raise task priority without changing task status.
- Short gaps can surface Tasks whose estimates fit the available window.
- A 45-minute gap should not suggest a 90-minute problem set unless the Task supports splitting into sessions.
- Before an exam, mixed practice should appear above additional passive review when both are Ready, but the user controls the final order.

## 11. Project Goal Experience

### Software feature

Suggested Areas: Scope, Design, Implementation, Verification, Release. The template is intentionally small. Dependencies such as “API contract before frontend integration” are visible in the task inspector and Board. GitHub/Linear integration can be added later, but Phase must remain useful without it.

### Startup launch

Suggested Areas: Product, Engineering, Go-to-market, Operations, Launch. Milestones: scope lock, beta, launch. The Calendar tab shows launch markers and planned work sessions, while Board handles workflow. Health includes critical-path blockers, not only raw remaining hours.

### Personal coding project

Default to a lightweight blank Goal with Work and Board. Avoid enterprise configuration. Quick add can parse:

```text
Implement auth redirect #side-project 90m fri
```

Phase resolves the Goal, estimate, and date, then previews the interpretation before saving when ambiguous.

### Research project

Suggested Areas: Question, Literature, Method, Experiment, Analysis, Writing. Notes are more central, and Tasks can link to note headings or references. A hypothesis or decision is not forced into task form.

### Project-specific capabilities

- Dependencies and blocking reasons.
- Milestones with date and acceptance criteria.
- Reusable templates.
- Task estimates and actual session time.
- Board WIP limits.
- Release/review checklist.
- Goal review showing completed, added, slipped, and blocked work since last review.

Do not add sprints, issue IDs, teams, comments, or assignees until Phase genuinely supports collaboration. Mimicking Linear’s enterprise object model would burden a personal productivity product.

## 12. Navigation Remaster

### Decision table

| Current item | Decision | New location / behavior |
|---|---|---|
| **Plan** | Remain global | Week/day time-planning destination |
| **Projects** | Rename to Goals and remain global | Portfolio list/board/timeline; opens Goal workspaces |
| **Timeline** | Remove as global destination | View toggle inside Goals; goal-specific schedule lives in Calendar tab |
| **Search** | Remain global but become command palette | `Cmd+K`; find and act, not just navigate |
| **Task** | Replace header modal button with Quick add | `Cmd+N`; lightweight composer supporting task/goal/inbox capture |
| **System** | Remove from header text | Appearance choice in Settings; optional icon in utility menu |
| **Export** | Move | Settings → Data; also command palette command |
| **Reclaim Space** | Move and rename | Settings → Data → Storage → Clean unused attachments; never top-level |
| **Import** | Split by meaning | Goal/content import is contextual; backup restore is Settings → Data |

### Add Today as the default global destination

Final primary navigation:

```text
Today      Plan      Goals
```

Search and Quick add remain on the right. Settings is behind one utility/avatar button. On mobile these three destinations become the bottom bar.

### Navigation behavior

- `1`, `2`, `3` may remain as aliases, but add unambiguous `g t`, `g p`, `g g` chords.
- `Cmd+K` can navigate to any Goal tab and run actions.
- Goal pages do not open as modals.
- Task details use one consistent inspector.
- Browser/back-stack behavior should be real even in Electron-style navigation; each Goal/tab state needs a stable internal route.
- Recent and pinned Goals appear in the palette, not in another permanent sidebar.

### Aggressive clutter removal

The header should not teach storage maintenance, backup mechanics, theme state, keyboard shortcuts, and navigation simultaneously. Those are valuable but low-frequency. A premium tool signals confidence by keeping rare operations reachable without advertising them continuously.

## 13. Visual Design System

### Design character

Quiet, neutral, precise, dense. Phase should feel like a workbench, not a lifestyle planner and not a dashboard template.

### Typography

Use Inter Variable for all application UI. Keep Fraunces only in the wordmark if brand recognition matters; remove it from project titles, numbers, modal headings, and task inspectors. The serif currently makes ordinary metadata feel editorial and enlarges headers unnecessarily.

| Token | Size / line height | Weight | Use |
|---|---:|---:|---|
| `display` | 24/30 | 600 | Rare empty-state or onboarding title only |
| `page-title` | 20/26 | 600 | Goal title, top-level page title |
| `section-title` | 15/20 | 600 | Major sections and dialog titles |
| `body` | 14/20 | 400 | Reading text, notes UI |
| `ui` | 13/18 | 450–500 | Rows, buttons, tabs, fields |
| `meta` | 12/16 | 400–500 | Dates, estimates, breadcrumbs |
| `micro` | 11/14 | 500 | Keyboard hints and terse uppercase labels only |

- Use sentence case. Remove most letter-spaced uppercase mono labels.
- Use tabular numerals for time, percentages, estimates, and dates.
- Muted text must remain readable; reserve faint text for placeholders, disabled content, and decorative separators.
- Maximum two font weights in one row.
- Avoid explanatory paragraphs above working surfaces. Use contextual help popovers when necessary.

### Spacing

Base unit: 4px. Allowed tokens: 2, 4, 6, 8, 12, 16, 24, 32.

- Compact row: 32px.
- Standard task row: 36px.
- Touch row: 44px minimum on coarse pointers.
- App bar: 48px desktop, 52px mobile.
- Tab bar: 36px.
- Compact goal header: 56–72px.
- Inspector width: 320px compact, 360px standard, max 40vw.
- Main desktop padding: 20–24px; mobile: 12–16px.
- Section separation: 24px. Related control gap: 6–8px.

Do not use spacing to compensate for weak hierarchy. If two sections need 40px to feel distinct, the grouping or labels are wrong.

### Component density

- Default to rows and divided lists, not cards.
- Cards are allowed for Kanban items, floating suggestions, and compact goal previews.
- Forms use a two-column property grid in inspectors and one-column layout in narrow dialogs.
- Metadata appears on demand or in aligned columns, not scattered beneath titles.

### Border usage

- One-pixel divider between major regions, list rows, and calendar columns.
- Inputs may use a visible border at rest only when their boundaries are otherwise ambiguous; inline fields use a hover/focus background.
- Do not border both a panel and every child within it.
- Dashed borders are reserved for active drop targets, not ordinary empty states.
- Completed or disabled content should not gain extra borders.

### Radius philosophy

- 4px: row hover, compact buttons, checkboxes, task blocks.
- 6px: inputs, popovers, Kanban cards.
- 8px: dialogs and large floating panels.
- Full pills only for semantic tags/statuses and segmented control containers.
- Navigation tabs are not pills.

### Background hierarchy

Light theme reference:

- App canvas: neutral off-white around `#F7F7F5`.
- Primary working surface: `#FFFFFF`.
- Secondary/inspector surface: `#FAFAF9`.
- Hover/selected neutral: `#F2F2EF` / `#ECECE8`.
- Divider: approximately `#E6E6E2`.
- Primary text: approximately `#20201E`.
- Secondary text: approximately `#686864`.

Dark theme should use near-black, not necessarily pure OLED black everywhere: canvas around `#0E0E0F`, primary surface `#141416`, secondary surface `#18181B`, divider `#2A2A2E`. Preserve contrast and surface distinction without heavy shadows.

Keep one product accent. Project identity colors are narrow edge markers or dots, never filled card backgrounds.

### Icons

- One 1.5px-stroke icon family, optical size 14/16/18.
- Icons represent actions or object types; they do not decorate headings.
- Pair unfamiliar icons with labels until learned.
- Never use ASCII glyphs as primary interface icons except literal keyboard keys.
- Destructive actions use a trash icon only inside a labeled menu or with tooltip.

### Interaction states

- **Hover:** neutral background change in 80ms; reveal secondary controls without shifting layout.
- **Pressed:** one shade deeper plus optional 0.98 scale for standalone buttons only.
- **Selected:** neutral selected background plus 2px leading accent or checkmark; do not rely on color alone.
- **Focused:** 2px accent outline with 2px offset, always visible for keyboard navigation.
- **Dragging:** 0.96 opacity, medium shadow, cursor grabbing; source leaves a stable placeholder.
- **Drop target:** accent-tinted insertion line or exact time preview, not a full flashing container.
- **Completed:** checkbox filled, title muted/struck, metadata reduced; still readable.
- **Overdue:** warning text/icon on the date only; do not tint the whole row red.
- **Blocked:** warning icon and reason; preserve ordinary title contrast.
- **Disabled:** 45% opacity only for nonessential controls; critical disabled actions also explain why on hover/focus.

### Shadows

- No shadow on in-layout panels, rows, tabs, or standard calendar blocks.
- Small shadow on popovers and drag overlays: `0 4px 16px rgba(0,0,0,.10)`.
- Dialog shadow: `0 16px 48px rgba(0,0,0,.18)`.
- Dark theme uses stronger ambient separation plus a border.

### Motion

- Hover/color: 80ms.
- Checkbox/status transition: 120ms.
- Inspector/panel: 160ms ease-out.
- Reorder/drag settle: 180ms spring-like easing without bounce.
- Task completion collapses after 180ms while preserving undo location.
- AI suggestions stream/reveal row by row, then settle; no shimmer after content arrives.
- Respect reduced motion by removing transforms and smooth scrolling while retaining state changes.

Motion must answer “what moved, where did it go, and did the action succeed?”

## 14. Component Remaster

### Global navigation

**Current problem:** The sticky header mixes wordmark, three pill tabs, Search, Task, shortcuts, theme, export, reclaim space, import, and an overflow menu. On wide screens low-frequency maintenance actions are permanently visible; on narrow screens they move into overflow.

**Why it feels weak:** Frequency does not determine visual priority. The product looks like it is exposing every implemented feature instead of curating a workflow.

**Recommended redesign:** 48px bar with Today, Plan, Goals as underline/neutral tabs; Search and Quick add on the right; one Settings/utility trigger. Move Timeline into Goals and data tools into Settings.

**Interaction behavior:** `g` chords and number aliases navigate; active tab is indicated by text weight plus bottom/leading marker; no rounded black nav pills.

### Project header

**Current problem:** Title, editable start/deadline, confirmation, clear dates, days left, percentage, full-width progress, basis, pace, weekly count, next action, calibration, and lifecycle controls consume the top of every goal.

**Why it feels weak:** It explains the model before exposing work and gives every metric equal status.

**Recommended redesign:** One compact header with title, deadline, health, remaining effort, and small progress. All metadata opens in a popover or inspector.

**Interaction behavior:** Title edits inline; deadline click opens date popover; health click explains forecast; overflow contains rare lifecycle actions.

### Progress indicator

**Current problem:** A large percentage and bar look precise while basis can change depending on estimates.

**Why it feels weak:** It privileges a potentially misleading number above remaining work.

**Recommended redesign:** `12h 30m remaining · 8/14 tasks` as primary; a 64–96px thin bar and percentage secondary. Explicit “6 tasks unestimated” when applicable.

**Interaction behavior:** Hover/focus opens breakdown by Area; never animate progress on page load, only after completion.

### Tabs

**Current problem:** Project has only Steps and Notes, leaving Board and Calendar global/disconnected. Current active tab uses a thick accent underline but the overall workspace is shallow.

**Why it feels weak:** Tabs do not yet reduce enough navigation depth.

**Recommended redesign:** Work, Board, Calendar, Notes. Do not add Overview initially.

**Interaction behavior:** Arrow keys, Home/End, and `Cmd+1–4` within a Goal; preserve view state per tab; support deep links.

### Task rows

**Current problem:** In the current tree, clicking a row performs a primary action—completion for leaves or expand/collapse for containers—while title double-click renames and modifier-click selects. This is efficient after memorization but unusually dangerous and nonstandard.

**Why it feels weak:** Selection, opening details, completion, and expansion compete for the same row target.

**Recommended redesign:** Checkbox completes; chevron expands; row click selects/opens inspector; title Enter/double-click edits. Align title, status, estimate, schedule, and actions in stable columns.

**Interaction behavior:** `J/K` or arrows move; Space toggles selection; `X`/`Cmd+Enter` completes depending on shortcut policy; hover actions never shift text.

### Goal tree

**Current problem:** The tree is powerful but visually exposes recursive structure without a simple beginner model. A selected Step opens a fixed 300px panel that can compress the tree. Containers and leaves use subtly different status semantics.

**Why it feels weak:** The data structure is visible more strongly than the user’s conceptual structure.

**Recommended redesign:** Areas as clear section rows with task children. One level by default. The inspector overlays or occupies a stable right column at larger widths, rather than being nested inside the tree layout.

**Interaction behavior:** Drag reorder/reparent, inline add, bulk selection, collapse state, and keyboard creation. Guard invalid nesting with insertion preview, not error toast after drop.

### Kanban cards

**Current problem:** Current global goal cards carry title, due/checkpoint chip, next action, weekly state, percentage, progress bar, health badge, blocker information, date confirmation box, primary action, Open project, and menu.

**Why it feels weak:** Cards become miniature dashboards and repeat project-page data. Their action footer and border make every card visually busy.

**Recommended redesign:** Global Goal cards show title, health, target date, and one compact remaining-work line. Task Kanban cards show title, Area, estimate, schedule, and exceptions only.

**Interaction behavior:** Card body opens; handle drags; hover reveals overflow; keyboard move announces destination; dropping changes exactly one dimension.

### Calendar task blocks

**Current problem:** Short blocks compress two lines and multiple controls into very small heights. The calendar owns both Phase work and external busy time but does not always make their difference obvious.

**Why it feels weak:** Spatial truth is undermined when blocks become unreadable or interaction handles dominate content.

**Recommended redesign:** Minimum 24px visual height; below 40px use one line: `14:00  Problems 1–15`. Use a 3px Goal-color edge. External events use neutral fill and lock icon/tooltip; Phase sessions use stronger title contrast.

**Interaction behavior:** Drag to move, resize from bottom, click inspector, double-click quick edit; hover reveals handles; current-time line sits above blocks without obscuring labels.

### Add-task interaction

**Current problem:** `Cmd+N` opens a modal with Task, date choice pills, optional date picker, Choose project toggle, project select, and buttons. It defaults all capture into a date decision.

**Why it feels weak:** Capturing a thought becomes a small form. Project assignment is hidden behind a toggle, and unscheduled inbox capture is impossible or discouraged.

**Recommended redesign:** One-line Quick add:

```text
Add task…   [Goal] [When] [Estimate]                         ↵
```

The title is enough. Natural language tokens are parsed visibly. Unspecified date means Inbox/unscheduled, not Today.

**Interaction behavior:** Enter saves and keeps composer open with `Cmd+Enter`; Tab moves through properties; `#` finds Goal/label, `@` parses date, `~45m` estimate; ambiguous tokens preview before commit.

### AI planning

**Current problem:** Clipboard round-trip modal with prose instructions, step selector, external AI, paste field, JSON parser, preview, and submit.

**Why it feels weak:** It advertises integration while outsourcing the experience.

**Recommended redesign:** Inline proposal/diff attached to Goal, Area, or Task. Native provider with explicit setup; manual template and structured-prompt fallback.

**Interaction behavior:** Stream, edit, select, accept in one transaction, undo. Calendar proposals accepted separately.

### Command palette

**Current problem:** The implementation calls itself “finds and acts,” but its commands are three navigation rows; object results mostly open locations.

**Why it feels weak:** It looks like Linear’s palette without delivering command depth.

**Recommended redesign:** Search plus verbs. Empty state shows recent Goals and high-frequency commands. `>` filters commands; object selection opens an action submenu.

**Interaction behavior:** Examples: Create goal, Add task, Complete, Schedule today, Move to Goal, Set status, Start session, Open settings, Export backup. Destructive commands use undo or explicit confirmation.

### Dialogs

**Current problem:** A single centered Modal primitive is used for many tasks, with display-serif title and generous padding.

**Why it feels weak:** It gives routine editing the visual weight of a decision point and removes context.

**Recommended redesign:** Dialogs only for authentication, import review, destructive irreversible actions, and complex provider setup. Width 440–640px, 8px radius, 16–20px padding, UI-font title.

**Interaction behavior:** Initial focus goes to first meaningful input, not the close button; Enter submits only when safe; Escape closes; destructive primary stays separated.

### Drawers / inspectors

**Current problem:** Step details are embedded as a 300px panel inside the Work layout; other objects lack the same consistent detail surface.

**Why it feels weak:** Opening details reflows the main tree and each surface has different editing affordances.

**Recommended redesign:** One Task inspector, 360px, shared by Work, Board, Calendar, Today, and Search. Goal properties use a smaller popover/inspector variant.

**Interaction behavior:** Inspector subject changes without closing; `[`/`]` or J/K moves among visible Tasks; edits autosave; closing restores focus to source.

### Empty states

**Current problem:** Projects empty state is a dashed bordered card with a paragraph, three buttons, and more helper text. Empty board columns repeat dashed drop zones. Plan’s initial state can show instructions for actions with no draggable work.

**Why it feels weak:** Empty states describe the data model and multiply choices instead of producing the first success.

**Recommended redesign:** One sentence, one primary action, one secondary example/import link. Contextual empty areas use inline `+ Add task`, not cards.

**Interaction behavior:** Empty state disappears immediately into the created object; example data is previewed before load and clearly removable.

### Date/deadline controls

**Current problem:** Start and deadline are exposed as paired editable fields with Confirm and Clear dates controls. Imported goals can create a persistent date-review banner and per-card confirmation panels.

**Why it feels weak:** Date validation mechanics dominate the work surface.

**Recommended redesign:** Most Goals show one Target date. Optional Start date lives in advanced properties. Imported date review happens in one batch review surface, not on every card.

**Interaction behavior:** Natural language entry, calendar popover, quick options, keyboard support, timezone clarity when needed, and explicit “No deadline.” Changing a deadline immediately previews schedule risk.

## 15. Screenshot Critique

The supplied product surfaces are identified by their visible titles rather than attachment filenames. The critique below ties each visible issue to the checked-in interaction that produces it.

### Projects board

- The page heading and explanatory sentence consume vertical space before the board. The sentence explains Now WIP semantics every visit; this belongs in first-use education or a tooltip.
- `Import project` competes visually with `New project` despite being much lower frequency.
- Five focus-summary tiles appear as bordered, rounded mini dashboards above the actual projects. On common laptop heights, these can push the first useful cards below the fold.
- The summary uses large numerals, uppercase/mono labels, sentences, warning states, and filter behavior; users must learn that these are also clickable filters.
- Four horizon columns are reasonable for commitment management, but `Later` and `Someday` include explanatory copy plus dashed empty drop zones. Empty space becomes chrome.
- Each goal card contains too many simultaneous layers: due chip, next action, weekly planning sentence, percentage, progress bar, health badge, blocker text, action footer, and overflow.
- Date confirmation injects another tinted sub-card inside a card. This turns data hygiene into the board’s dominant visual state.
- `Plan next step` and `Open project` duplicate likely intent. The card itself also opens the project, creating three overlapping entry paths.
- Project cards use generous 13px padding and 11px gaps across four columns; density is too low for a heavy user with courses, assignments, exams, and startup work.

### New project dialog

- The dialog is a vertical form with six conceptual decisions before creation.
- Horizon is presented before the user has enough context to make a portfolio commitment choice.
- Start and deadline receive equal weight even though deadlines are far more common and important.
- “First steps” supports only flat items, underselling the product’s central decomposition capability.
- Notes appears in creation even though it is usually empty ceremony at this point.
- The title placeholder asks an abstract question instead of allowing direct capture.
- Enter on the title submits immediately, which can create the Goal before a user reaches optional fields; that shortcut conflicts with the apparent expectation of a multi-field form.
- The dialog has no Study/Project distinction and no transition into planning.

### Project detail / Steps tab

- The back link, large serif title, date row, progress row, dense metadata sentence, tabs, and Steps label create too many hierarchy levels before actionable work.
- The header allocates roughly 150px or more to metadata before the first task row.
- The progress bar spans most of the page, implying it is the project’s primary object.
- `weighted by estimate`, pace, weekly planning count, Next, and calibration are concatenated into a dot-separated line. This is accurate but cognitively expensive and hard to scan.
- Only Steps and Notes tabs exist, so users must leave the workspace for task flow and scheduling.
- “Break a step into subtasks…” is positioned below the add-step input, visually detached from the selected step it affects.
- The empty Steps state is another dashed bordered card inside an already structured page.
- When the Step inspector opens, it consumes 300px and compresses the tree instead of overlaying or using a stable split layout.

### Step detail panel

- Status is rendered as four small bordered buttons, Span as two date fields, Plan as read-only prose, Estimate as another control, Time logged as another, Progress for containers, and Notes as an editor. This resembles a property form rather than an inspector optimized by frequency.
- The panel starts with a second large serif heading, competing with the project title.
- “Close” is rendered as text rather than a conventional icon plus shortcut/tooltip.
- `Checkpoint` is an icon-only diamond whose meaning is not obvious.
- “Not planned—use the Plan view” is a dead end. The user must leave the workspace instead of scheduling in context.
- Sections are separated mostly by 22px whitespace and uppercase labels, producing length without strong grouping.
- Start/end Span is available for every node even when most tasks need only a deadline and scheduled sessions.

### Break a step into daily tasks dialog

- The title promises task decomposition, but the body explains an external workflow.
- A large paragraph is required because the interaction is not self-evident.
- The Step dropdown repeats context the user already had when invoking the action.
- `Copy AI prompt` is the visual primary action, but it is only the beginning of work outside Phase.
- “Paste into ChatGPT, Claude, etc.” advertises product incompleteness.
- The reply field exposes JSON syntax to ordinary users.
- The preview is useful but arrives only after the most expensive context switch.
- The final button says Add subtasks, introducing another noun beside Step and Task.
- This will be tried once, understood, and then avoided by a heavy user.

### Add task dialog

- A fast capture command opens a full modal and asks “When” before project context.
- Today/Tomorrow/Pick day are large pills, overemphasizing a narrow date choice.
- Project assignment is hidden behind a `Choose project` toggle, adding a click before the dropdown.
- There is no visible unscheduled/inbox choice, so capture is biased toward false scheduling.
- Estimate is missing, even though estimate is crucial when the task enters Plan.
- The dialog cannot efficiently capture several tasks in succession.

### Plan week/calendar

- The week grid, rail, week header, capacity, all-day blocks, unestimated panel, recap, habits, stats, and availability compete within one surface.
- The most valuable calculation—free, planned, unscheduled, and over-capacity time—is typographically small compared with the grid.
- The 249px sidebar stacks “To plan,” Habits, Stats, and Working hours as peers even though only To plan is used repeatedly while planning.
- The calendar is a good spatial foundation, but short work blocks become hard to read and operate.
- On mobile, a minimum-width seven-day grid produces a sideways calendar viewport instead of a real day mode.
- Dragging gives insufficient pre-drop capacity feedback; refusal after drop is too late.
- Month and week are global view modes, but there is no strong execution-oriented Today surface.

### Timeline

- Timeline is a full global destination for a lower-frequency presentation of Goal dates.
- Its sticky label lane and infinite/expanding horizontal canvas are useful for semester planning but conceptually belong to Goals.
- The separate destination forces users to remember whether date spans are edited in the project header, step inspector, Timeline, or Plan.
- Timeline should be a view toggle, preserving filters and Goal selection.

### Command palette

- Visual structure is solid: one input, active row, object type, context, and shortcut footer.
- Functionally, empty state offers only three navigation commands.
- Search results open objects but do not expose high-value actions.
- The footer says Open rather than communicating the palette’s supposed command capability.
- A Linear-influenced user will immediately type “new goal,” “complete,” “schedule,” or “move,” and discover the palette is mostly a finder.

### Header and utility menu

- The header’s wordmark, nav pills, bordered Search, solid Task button, shortcut icon, theme text, Export, Reclaim Space, Import, and overflow create a visible inventory of implementation features.
- `RECLAIM SPACE` is system maintenance language with top-level prominence inappropriate for a daily productivity app.
- Export and Import are ambiguous: project import and backup import are different mental models.
- Theme state shown as `SYSTEM / LIGHT / DARK` in the main chrome is excessive.
- The header is responsive through hiding and overflow, but responsive survival is not the same as product prioritization.

## 16. Linear Lessons

| Linear principle | Why it works | How Phase should adapt it |
|---|---|---|
| One canonical object behavior | Issues act consistently in list, board, search, and detail | A Task uses the same status, inspector, actions, and shortcuts everywhere |
| Command palette as action layer | Users can act without navigating through menus | Add create, complete, schedule, move, set status, start session, and settings commands |
| Dense row-based views | More work fits on screen while hierarchy remains legible | Make Work a 32–36px row tree with aligned metadata columns |
| Contextual controls | Secondary actions appear where needed without permanent clutter | Reveal row actions on hover/focus; keep layout stable |
| Inline editing | Editing feels like manipulating the object, not submitting a form | Titles, estimates, status, dates, and Areas edit inline or in anchored popovers |
| Predictable keyboard model | Repeated actions become muscle memory | Same J/K, Enter, E, Space, multi-select, and escape stack across views |
| Fast optimistic state | Actions feel immediate and reversible | Persist locally, animate immediately, and use reliable undo for mutations |
| View/filter composition | Users can change representation without changing data | Goals: list/board/timeline; Goal: Work/Board/Calendar/Notes; saved filters |
| Restraint | Most screens have one obvious working object | Remove summary-card bands and oversized metadata from the Goal workspace |
| Strong information hierarchy | Primary work, secondary metadata, and exceptions are visually distinct | Task title first; estimate/date aligned; warning only on exceptional property |
| Stable spatial layout | Controls do not jump as hover states change | Reserve action gutters and use overlays for menus |
| Opinionated defaults | Useful workflows work before configuration | Goal templates and default status flow; advanced properties remain hidden |

Do not copy Linear’s sidebar density, issue terminology, purple/gray palette, or team/sprint model. Phase’s differentiator is the bridge from meaningful Goal to real calendar time.

## 17. Google Calendar Lessons

| Google Calendar principle | Why it works | How Phase should adapt it |
|---|---|---|
| Time is spatial | Position and height communicate schedule instantly | Work sessions live on a true day/week time grid |
| Direct manipulation | Dragging and resizing are faster than forms | Drag unscheduled Tasks onto time; resize session duration |
| All-day versus timed distinction | Deadlines and events communicate different commitments | Goals/Milestones in all-day row; Work sessions in timed grid |
| Current-time orientation | Users instantly locate themselves | Strong but thin now line and automatically centered Today view |
| Legible short events | Small blocks switch to compact one-line formatting | Use `time + title` under 40px height; minimum interactive size |
| Easy date navigation | Today, previous/next, and date picker are predictable | Preserve one cursor across day/week/month; `T` returns to today |
| Fast event creation | Click/drag creates in context before full details | Drag empty span to create a Task/session composer at that time |
| External context | Other commitments remain visible while planning | Read busy events from connected calendars and include them in capacity |
| Conflict visibility | Overlaps are spatially obvious | Lane overlapping sessions and warn before overbooking |
| Consistent event popover | Details appear without leaving the calendar | Use the shared Task inspector or anchored session popover |

Do not copy Calendar’s weak task hierarchy, color overload, or event-centric model. Phase must keep Goal context visible and treat calendar blocks as allocations of work, not independent events.

## 18. Power-User Features

Prioritized by frequency and leverage:

### P0

1. **Real `Cmd+K` commands:** create, complete, schedule, move, status, start session, navigate.
2. **Universal Quick add:** `Cmd+N`, natural language, unscheduled by default, rapid repeated capture.
3. **Consistent keyboard navigation:** J/K or arrows, Enter open/edit, Escape stack, `g` navigation chords.
4. **Inline editing:** title, estimate, status, deadline, Area.
5. **Multi-select and batch actions:** status, Area, schedule, estimate, delete, move.
6. **Shared Task inspector:** same details and shortcuts from every surface.
7. **Undo for all structural and bulk changes:** visible label and reliable target.

### P1

8. **Saved views:** named filter/sort/view combinations for Goals and Goal Boards.
9. **Natural-language capture:** visible parsing of Goal, date, estimate, priority, and label.
10. **Drag/drop with exact previews:** tree reorder, Board status, calendar time, batch scheduling.
11. **Command aliases and recent actions:** repeat last schedule/status operation.
12. **Bulk estimate:** distribute a total or apply duration to selection.
13. **Dependencies:** set blocker/blocking Task with command or inspector.
14. **Quick switcher:** recent and pinned Goals from `Cmd+K`.
15. **Focus mode:** start a Work session with only task, notes, timer, and stop/complete controls.

### P2

16. **Custom shortcuts:** only after defaults are stable; keep scope small.
17. **Custom Board columns:** advanced, with status mapping validation.
18. **Templates:** reusable Area/Task structures and study patterns.
19. **Recurring Tasks/reviews:** transparent next-occurrence creation.
20. **Cross-goal batch planning:** select work from multiple Goals and auto-place with preview.

## 19. Quality-of-Life Improvements

### P0

1. Preserve scroll, filter, and selected Task when switching tabs/views.
2. Make the entire app’s Escape behavior deterministic and layered.
3. Add an unscheduled option to Quick add; stop defaulting capture to Today.
4. Keep Quick add open after `Cmd+Enter` for rapid entry.
5. Clicking a task row selects/opens it; only the checkbox completes it.
6. Put deadline, estimate, and status in aligned task-row columns.
7. Show why an item is surfaced: overdue, due soon, committed, or blocked.
8. Let users schedule directly from the Task inspector.
9. Allow splitting one Task into multiple Work sessions without duplication.
10. Show capacity fit during drag, before drop.
11. Add one-click “Replan unfinished” with a preview.
12. Make every destructive mutation undoable where technically possible.

### P1

13. Add `T` to return Plan/Today to the current date.
14. Add J/K aliases wherever arrows already navigate rows.
15. Keep focus in a list after completing, deleting, or scheduling an item.
16. Show the next keyboard action in empty rows and composers.
17. Support paste of multiple lines to create multiple Tasks with preview.
18. Allow drag from a Task search result directly into a date/time target when the palette is invoked over Plan.
19. Use one date popover everywhere.
20. Offer recent estimates (25m, 45m, 60m, 90m) before free typing.
21. Add a command to move selected Tasks to another Area/Goal.
22. Collapse completed Tasks by review period while keeping a visible count.
23. Add “duplicate Task” and “duplicate Goal as template.”
24. Make blocked reason editable inline and show the dependency if linked.
25. Show external calendar freshness and connection failure without blocking planning.
26. Warn when changing a Goal deadline makes the current schedule infeasible.
27. Provide a “No deadline” explicit state instead of an empty ambiguous field.
28. Add breadcrumb context to search hits and Today rows.

### P2

29. Remember preferred Goal tab per Goal, but default new Goals to Work.
30. Allow compact/comfortable density at the app level; only two modes.
31. Pin up to five Goals in the command palette/recent switcher.
32. Copy deep links to Goal, Area, Task, or Note heading.
33. Convert selected note text into a Task with backlink.
34. Add `Option`-drag to duplicate a Work session.
35. Add an explicit “Skip occurrence” for recurring review Tasks.
36. Show a tiny actual-versus-estimate delta after a Task is completed.
37. Offer “Mark session done, keep Task open” for multi-session work.
38. Add calendar zoom presets and remember the last desktop zoom.
39. Let users hide weekends without changing availability.
40. Add a command to archive completed Goals in bulk.

## 20. Feature Opportunities

These are opportunities, not a mandate. Each must earn its interaction cost.

1. **Goal health forecast:** deterministic capacity-before-deadline calculation with explainable risk.
2. **Today execution strip:** current/next session and bounded exceptions.
3. **Recovery planner:** consequence-aware rescheduling of unfinished work.
4. **Type-aware Goal templates:** exam, course, assignment, feature, launch, research.
5. **Syllabus/outline import:** extract Topics, deadlines, and draft Tasks into a review surface.
6. **Rubric-to-checklist:** attach verification criteria to assignment completion.
7. **Multiple sessions per Task:** first-class long-work support.
8. **Estimate calibration:** advisory actual/estimate patterns after enough samples.
9. **Deadline feasibility preview:** show effect before changing date/scope/schedule.
10. **Focus session mode:** timer, notes, completion outcome, distraction-free UI.
11. **Weekly planning ritual:** review carry-over, deadlines, commitments, estimates, capacity.
12. **Weekly review:** completed, slipped, added, blocked, estimate accuracy, next commitments.
13. **Milestones:** dated gates distinct from Tasks and Areas.
14. **Dependencies:** lightweight blocker relationships and critical-path warnings.
15. **Saved views:** reusable portfolio and Board filters.
16. **Task templates:** reusable repeatable work patterns without duplicating full Goals.
17. **Spaced revision:** transparent recurring review intervals.
18. **Smart gap suggestions:** find Tasks that fit a free calendar window, respecting priority and deadline.
19. **Scope negotiation:** show which lower-priority Tasks could be deferred to restore feasibility.
20. **Goal linking:** parent/related Goals without recursive task-tree abuse.
21. **Calendar writeback:** optional publication of Phase sessions to a dedicated external calendar.
22. **Import inbox:** review parsed tasks from pasted text, files, or integrations before assignment.
23. **Project review snapshots:** record health and scope changes over time without a full analytics suite.
24. **Offline/manual planning templates:** useful decomposition even without AI configuration.

Avoid adding collaboration, comments, chat, gamification, badges, streak pressure, complex automations, or marketplace integrations until the core execution loop is demonstrably excellent.

## 21. Things to Remove

1. Remove `Timeline` from global navigation; retain it as a Goals view.
2. Remove `System`, `Export`, `Reclaim Space`, and `Import` from persistent header chrome.
3. Remove the external copy-prompt workflow as the primary AI experience.
4. Remove visible JSON from ordinary decomposition flows.
5. Remove the term `subgoal` from primary UI.
6. Remove `Step` as a separate leaf noun; use Task.
7. Remove Checkpoint as a special task toggle; replace with Milestone object.
8. Remove paired Goal start/deadline fields from the always-visible header.
9. Remove permanent `Clear dates` and `Confirm` controls from every Goal header/card.
10. Remove date-confirmation sub-cards from each project card; use one batch review.
11. Remove the Focus Summary card band from the default Projects view. Convert exceptions to a compact filter/attention row.
12. Remove explanatory horizon copy from every visit; keep first-use education and tooltip.
13. Remove action footers from Goal and Kanban cards.
14. Remove the large full-width progress bar from the Goal header.
15. Remove generic Overview/dashboard cards from the proposed workspace.
16. Remove Notes from initial Goal creation.
17. Remove Horizon from initial Goal creation.
18. Remove the `Choose project` toggle in Quick add; show an optional inline Goal property directly.
19. Remove forced Today/Tomorrow selection from Quick add.
20. Remove Working hours from the Plan rail; move it to Settings with contextual access.
21. Remove Stats as a sidebar accordion; place high-value numbers in Plan/Review headers.
22. Remove dashed borders from normal empty states and empty board columns.
23. Remove most uppercase letter-spaced mono section labels.
24. Remove Fraunces from operational UI; retain only wordmark if desired.
25. Consolidate project import and AI paste parsing into a general reviewable Import inbox.
26. Consolidate all Task detail editing into one inspector.
27. Consolidate all date selection into one date control.
28. Consolidate Board filters and portfolio focus signals into one filter system.

## 22. Proposed Final Product

### Monday morning: planning

Phase opens to Today with a quiet notice that the week has not been confirmed. I press `Plan week`. Carry-over from last week appears first: two unfinished sessions totaling 90 minutes. I defer one low-priority side-project task and keep the assignment task.

The next 14 days show a Physics Final, a 6.5840 lab deadline, and the MVP beta milestone. Phase proposes this week’s candidate Tasks based on Ready state, deadlines, and remaining capacity. I select what I actually commit to. Three unestimated Tasks are called out before scheduling because capacity cannot honestly include them.

I drag selected Tasks into the calendar. Days tint based on whether each estimate fits. External class meetings occupy real space. Phase shows `22h free · 18h planned · 2h buffer`. I confirm the week.

### Doing work

At 10:00 Today shows one strong object: `Problems 1–15 · Physics Final / Mechanics · 60m`. I start the session. The interface collapses to the Task, scratch notes, elapsed time, and Stop / Complete. At the end I mark the session complete but keep the Task open because five problems remain. The remaining estimate updates only if I choose to revise it.

### Completing tasks

Checking the Task animates it out of Today into the collapsed completed section. Goal remaining effort and progress update. Undo remains available. The next session becomes primary without a dashboard refresh or navigation.

### Handling interruptions

A professor moves office hours into my planned work block. The external event creates a conflict. Phase flags the affected session, not the entire day. I choose Replan; it proposes two real gaps and shows that moving the work to Friday leaves the Goal On track. I accept one move.

### Missing work

On Thursday I skip a two-hour implementation session. Friday morning the unfinished session appears in Attention. `Replan` shows that simply pushing it to Saturday makes the MVP Tight and crowds exam practice. Phase suggests splitting it into two one-hour sessions and deferring a lower-priority design polish Task. I edit and accept. Nothing moves without review.

### Project work

Inside Launch SaaS MVP, Work shows Areas and Tasks. Board shows Ready, In progress, and Done without losing the same Task identities. I drag `Webhook retries` to In progress; its calendar sessions remain Tuesday and Thursday because status and time are separate. The shared inspector shows dependency, estimate, notes, sessions, and history.

### Finishing a project

When all required Tasks are done and the launch Milestone passes, the Goal header offers Complete goal. A review summarizes outcome, planned versus actual effort, deferred scope, and notes. Completing archives it from active Goals but preserves it in search, Timeline, and reviews. Monday planning no longer sees its Tasks. The product feels finished because the whole lifecycle closes cleanly.

The remastered product should feel fast enough that structure is cheaper than vagueness, and honest enough that scheduling is a commitment rather than decoration.

## 23. Remaster Roadmap

### Phase 0 — Foundations

**Changes**

- Define Goal, Area, Task, Milestone, and Work session schemas.
- Add migration mapping current GoalNode containers to Areas and leaves to Tasks.
- Unify standalone tasks and tree leaves behind one Task interface.
- Add multi-session scheduling and explicit planning-state derivation.
- Standardize routing/view state, inspector contract, command registry, date control, and undoable bulk mutations.
- Add product event instrumentation locally/opt-in for flow timing if acceptable.

**Rationale:** The current concepts cannot support a coherent UI through CSS changes alone. Shared behavior must precede new surfaces.

**User impact:** Mostly invisible initially; protects data and prevents later inconsistencies.

**Implementation complexity:** XL.

**Dependencies:** Migration tests, backup compatibility, store action refactor, progress/health specifications.

**Risks:** Data loss, broken undo semantics, performance regression on full-state persistence, ambiguous migration of checkpoints and nested containers. Build migrations as reversible versioned transformations and test real backup fixtures.

### Phase 1 — Information architecture

**Changes**

- Add Today, Plan, Goals primary navigation.
- Move Timeline into Goals view modes.
- Move utilities to Settings → Data.
- Replace Task header modal entry with Quick add shell.
- Add stable Goal/tab routes and return-state preservation.
- Introduce shared Task inspector on existing data adapters.

**Rationale:** Users need a legible product map before deeper component work.

**User impact:** High. Fewer global destinations, less header clutter, predictable return behavior.

**Implementation complexity:** L.

**Dependencies:** Routing/view-state foundation, command registry, inspector contract.

**Risks:** Existing keyboard shortcuts and escape precedence can regress; saved ephemeral view state may conflict with routes. Add integration tests for every navigation/escape path.

### Phase 2 — Project workspace

**Changes**

- Replace Project header with compact Goal header.
- Replace Steps with Work: Areas + Tasks row tree.
- Add Task Board over the same data.
- Add Goal-scoped Calendar shell and retain Notes.
- Implement direct inline creation/editing, reorder, reparent, multi-select, and shared inspector.
- Replace checkpoints with Milestones.
- Redesign progress around remaining effort and explicit fallback.

**Rationale:** This is the product’s core transformation from CRUD detail page to working environment.

**User impact:** Very high. Decomposition, prioritization, flow, and task editing stay in one context.

**Implementation complexity:** XL.

**Dependencies:** Phase 0 data model; Phase 1 routing/inspector; drag/drop primitives.

**Risks:** Tree/Board synchronization, migration of nested nodes, selection behavior, large-goal performance, and conflicting drag semantics. Board and Work must be projections of one Task store, never duplicated arrays.

### Phase 3 — Planning/calendar

**Changes**

- Build Today execution surface.
- Refocus Plan on unscheduled rail + day/week calendar.
- Move availability to Settings and stats to headers/review.
- Add multi-session Tasks, multi-select placement, drag capacity previews, readable short blocks, and mobile day mode.
- Add weekly planning and unfinished-work recovery previews.
- Add deterministic goal feasibility/health.

**Rationale:** Phase’s differentiator is conversion from Goal work into realistic time.

**User impact:** Critical. Users can plan and recover without cross-surface bookkeeping.

**Implementation complexity:** XL.

**Dependencies:** Unified Tasks/Sessions, calendar connection, capacity engine, undoable bulk schedule actions.

**Risks:** Timezone/DST correctness, external calendar staleness, overlap resolution, partial batch failures, and misleading forecasts from missing estimates. Keep deterministic warnings conservative and explain missing data.

### Phase 4 — AI planning

**Changes**

- Add provider setup/privacy controls.
- Build inline proposal/diff framework.
- Implement Goal draft, Task breakdown, missing-work review, realistic-scope, and replan commands.
- Add type-aware Study/Project prompts and manual-template fallback.
- Add streaming, cancellation, retry, assumption display, selective acceptance, and one-step undo.
- Retain structured paste import as fallback inside Import inbox.

**Rationale:** AI removes decomposition friction only after the underlying objects and planning engine are coherent.

**User impact:** High for setup and replanning; optional for daily execution.

**Implementation complexity:** L–XL depending on provider architecture.

**Dependencies:** Stable model, diffable bulk actions, command registry, calendar feasibility APIs.

**Risks:** Privacy, hallucinated scope/dates, provider latency/cost, non-deterministic tests, and overreliance. Keep all suggestions previewable and separate deterministic scheduling math from model output.

### Phase 5 — Visual polish

**Changes**

- Apply compact type, spacing, radius, surface, and state tokens.
- Remove Fraunces from operational UI and reduce uppercase mono labels.
- Replace card bands with rows/dividers.
- Standardize hover, focus, selection, dragging, overdue, blocked, completed, and disabled states.
- Add motion durations and reduced-motion equivalents.
- Audit responsive layouts, contrast, focus order, targets, truncation, and empty states.

**Rationale:** Polish should consolidate a coherent product, not disguise an incoherent one.

**User impact:** High perceived quality, scan speed, and trust.

**Implementation complexity:** L.

**Dependencies:** Stable component architecture from Phases 1–3.

**Risks:** Large visual diff, accessibility regression, and token churn. Use visual regression screenshots and interaction-state stories for every major component.

### Phase 6 — Power-user interactions

**Changes**

- Expand command palette verbs and object actions.
- Complete cross-view keyboard model.
- Add saved views, advanced filters, natural-language capture, batch actions, templates, dependencies, and recurring Tasks.
- Add focus sessions, note-to-task, pinned/recent Goals, and deep links.

**Rationale:** Power features compound value only after basic behavior is predictable.

**User impact:** Very high for daily heavy users; moderate for beginners due to progressive disclosure.

**Implementation complexity:** L–XL across slices.

**Dependencies:** Command/action registry, shared selection model, stable routes, unified objects.

**Risks:** Shortcut collisions, discoverability, feature creep, and settings proliferation. Require a frequency hypothesis and command-palette path before adding visible controls.

### Delivery discipline

Each phase should ship in vertical slices, not as a long-lived visual branch. Suggested quality gates:

- Data migrations round-trip representative backups.
- Every mutation has undo/confirmation semantics specified.
- Keyboard and pointer paths reach the same result.
- A 13-inch laptop shows actionable Goal work above the fold.
- A phone has a real day experience, not a horizontally clipped desktop view.
- No empty state instructs an impossible action.
- No progress or health label changes meaning without visible qualification.

## 24. Top 15 Changes

Scoring uses **Impact × Frequency × Ease**, where Impact and Frequency are 1–5 and Ease is 3 for small effort, 2 for medium, 1 for large. The formula rewards improvements users feel often and prevents very large projects from automatically outranking quick structural wins. Architectural dependencies can still force a lower-scoring foundation to ship first.

| Rank | Change | I | F | Ease | Score | Why it changes perceived quality |
|---:|---|---:|---:|---:|---:|---|
| 1 | Compact Goal header; put Work above the fold | 5 | 5 | 3 | 75 | Every Goal visit becomes task-first instead of metadata-first |
| 2 | Make task row behavior conventional and consistent | 5 | 5 | 3 | 75 | Eliminates daily accidental/context-conflicting interactions |
| 3 | Remove header utilities and demote Timeline | 4 | 5 | 3 | 60 | Makes the whole product map feel deliberate immediately |
| 4 | Turn `Cmd+K` into a real action palette | 5 | 5 | 2 | 50 | Delivers the expected keyboard-first speed across the app |
| 5 | Replace Task modal with one-line Quick add | 5 | 5 | 2 | 50 | Reduces the highest-frequency capture workflow from form to action |
| 6 | Add Work / Board / Calendar / Notes Goal tabs | 5 | 4 | 2 | 40 | Converts project detail into a coherent workspace and removes context switching |
| 7 | Establish Goal → Area → Task → Work session vocabulary | 5 | 4 | 2 | 40 | Removes the semantic tax behind most current friction |
| 8 | Add native inline AI proposal/diff planning | 5 | 3 | 2 | 30 | Makes decomposition usable instead of demonstrative |
| 9 | Make remaining effort + feasibility primary progress | 5 | 3 | 2 | 30 | Replaces decorative certainty with decision-relevant truth |
| 10 | Add Today execution surface | 5 | 5 | 1 | 25 | Answers the product’s most frequent question directly |
| 11 | Support multiple Work sessions per Task | 5 | 4 | 1 | 20 | Makes scheduling realistic for study and engineering work |
| 12 | Add recovery/replan preview for missed work | 5 | 4 | 1 | 20 | Makes Phase resilient enough for real life rather than ideal plans |
| 13 | Refocus Plan rail and add capacity feedback during drag | 4 | 4 | 1 | 16 | Turns capacity into direct manipulation rather than post-action refusal |
| 14 | Add type-aware Study and Project creation flows | 4 | 3 | 1 | 12 | Speeds meaningful setup without splitting the product model |
| 15 | Apply the restrained visual system and interaction states | 4 | 3 | 1 | 12 | Converts the structural remaster into premium perceived quality |

The first implementation milestone should combine changes 1, 2, 3, 5, and the smallest viable portion of 7. That slice does not require AI or a complete calendar rewrite, yet it would make Phase feel materially faster, clearer, and more intentional on every use.
