# Planner declutter + subgoal redesign

**Date:** 2026-07-22
**Status:** approved, implemented
**Area:** `src/views/plan/PlanWeekOverlay.tsx`, `src/lib/plan.ts`

## Problem

"Plan your week" felt cluttered and hard to use:

1. **The rail was a flat wall.** Every project's every step stacked at once — a
   12-chapter project alone produced 12 full-width cards, so the rail ran ~1800px
   before Fitness/Japanese even started.
2. **"BREAK" repeated on every row** (~19×) — pure visual static.
3. **"12 pts behind · 0%" repeated on every project header** — the same alarm on
   all three turned real signal into wallpaper.
4. **The board floated in dead space.** Because the tall rail defined the panel
   height while the day columns were short (168px), a large empty area sat below
   the board.
5. The intro was a wordy three lines.

Plus a request: **show subgoals** — plan at the grain of a project's structure,
not one flat list.

## Decisions (from the user)

- Rail at rest: **focus one project** — a single-open accordion.
- Assigning: **drag-only, just cleaner** — no click-to-assign popover.

## Design

### Rail → single-open accordion

Each active project (attention order) is a collapsible section. The header shows:
caret · **project title** · one small amber **behind dot** (only when behind, with
a tooltip giving the points + pct) · a muted **step count** ("12 steps" / "no
steps"). One project is expanded at a time; opening another collapses the rest;
clicking the open header collapses it. Default open = the focused project (a board
"Plan next step" deep-link), else the top of attention order.

State lives in `PlanStep` as `openId` (nullable). No persistence — a planning
session is short and starts from the most-urgent project.

### Show subgoals — nested rail tree

New pure helper `railTree(g, week): RailTreeNode[]` in `src/lib/plan.ts`. It walks
the goal tree and returns the same open, not-yet-this-week leaves as
`unplannedOpenLeaves` (whose flat count still powers the header), but keeps their
container ancestors as sub-headings, dropping any container with no visible
descendant. Rendered by a recursive `RailTreeView`: leaves become draggable
`RailStep`s; containers become quiet uppercase subgoal sub-headings with their
children indented (absolute `depth × 10px`, so nesting never compounds).

Because breaking a step down (`addChildren`) turns it into a container, its new
subtasks now appear **nested beneath it** in place — the "show subgoal" behavior
falls out of the same tree.

### Quieter chips

`RailStep` now takes `nodeId` / `title` (not a whole `GoalNode`) plus `depth`. The
**Break** control is hidden by default and revealed on `group-hover` /
`group-focus-within` (still taught in the trimmed one-line intro), so the rail
reads calm at rest. Drag-to-plan, click-to-plan, and the inline breakdown editor
are unchanged.

### Board fills the space

Day columns grow from `min-h-[168px]` to `min-h-[300px]`; the rail is capped at
`max-h-[440px]` with internal scroll and a sticky "To plan" header. Together the
two columns are balanced heights, so the panel sizes tightly and the dead space is
gone. The intro is trimmed to one line.

## Non-goals / constraints

- No schema change; reuse `addChildren` / `planNode` / `unplanNode`.
- Visual identity locked — reuse existing tokens (`warn`, `accent-tint`,
  `line-soft`, `font-disp`, mono labels); no new palette.
- `railTree` is the only new pure logic and ships with sibling tests in
  `plan.test.ts` (flat leaves, nested container, all-done container dropped, deep
  nesting, empty project).

## Testing

- `railTree` unit tests (5 cases).
- Manual: accordion opens one project; behind dot + count read at a glance; Break
  hidden until hover; breaking a step nests its subtasks; drag onto days still
  works; board no longer floats in empty space.
- `npx tsc -b` + `npm test` + `npm run build` all green (338 tests).
