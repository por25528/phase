# Planner inline breakdown

**Date:** 2026-07-21
**Status:** approved, ready to plan
**Area:** `src/views/plan/PlanWeekOverlay.tsx`

## Problem

In "Plan your week," the left "To plan" rail lists project **steps** (leaf nodes —
e.g. *"Build the game map"*). You drag them onto days. But many steps are
multi-day chunks, not day-sized, so a day column ends up holding one oversized
commitment. The only way to break a step down today is to leave the planner:
close it, open the project drawer, run "Break a step into daily tasks," then
reopen the planner. The coarse step just sits in the rail, effectively
un-plannable at the grain the user wants.

Diagnosis (from the user): *steps are too coarse* — they want to plan at the
grain of actual daily tasks. Preferred fix: type the day-sized pieces themselves,
inline, without leaving the overlay.

## Approach

Bring breakdown into the planner rail. Every open step in the rail gets a quiet
**"Break into days"** control. Clicking it drops a compact one-task-per-line
editor under that step. The user types the pieces and commits; the step is
replaced in the rail by its new day-sized children, ready to drag onto days.

This reuses the existing tree-children model exactly. Because the rail is derived
from `unplannedOpenLeaves` (which walks *leaves*), giving a leaf children makes it
stop being a leaf — it disappears from the rail and its children (new leaves)
appear in its place automatically. No new data type, no schema change, no new
store action.

Rejected alternatives:

- **Break down while placing** (split on drop into that-day + spillover): tangles
  scheduling with structure; the split lives half in the plan. More surface.
- **Dedicated triage pre-step** (a stage that forces breakdown before the grid):
  heavy; adds a whole step to a flow the user already finds fiddly.

## Design

### Component change — `RailChip` → `RailStep`

Today `RailChip` is a single draggable `<button onClick={plan}>`. A nested editor
cannot live inside a `<button>`, so restructure into a small **stateful**
component:

- Outer `<div>` (the drag node, `useDraggable` ref + `data-step`).
- Row: the draggable **title / plan region** (unchanged behavior — click plans it
  to the week, drag moves it onto a day) **+** a small **"break down" button**
  beside it (`aria-label="Break \"<title>\" into daily tasks"`).
- Local state `editing: boolean` and `text: string`.
- When `editing`, render a compact `<textarea>` under the row:
  - placeholder *"One task per line…"*, autofocused
  - **⌘/Ctrl+Enter** or an **"Add tasks"** button commits
  - **Esc** or a **Cancel** button closes without saving
  - commit → `actions.addChildren(node.id, text.split(/\r?\n/))`
    (`addChildren` already trims each line and drops blanks; an all-blank list is
    a no-op), then `actions.showToast("Added N tasks")` and close the editor.
    N counts non-blank lines.

The drag handle (`⠿`) and focus ring (`focus` prop → target of the T9
focus/pulse) are preserved.

### Copy

Update the `PlanStep` intro paragraph to mention that a big step can be broken
into day-sized tasks in place, so the affordance is discoverable.

### Non-goals / constraints

- No new store action; reuse `addChildren`.
- No new lib file: splitting on newlines is trivial and the cleaning
  (trim + drop-blank) already lives in `addChildren`. No new pure logic to test.
- Completed-project freeze is already enforced: the rail only lists active goals
  (`attentionRank` drops completed / ready-to-complete), and `addChildren`
  no-ops on a frozen node.
- Visual identity locked — reuse existing rail-chip tokens and spacing; no new
  palette.
- `SubtaskAiModal` (the AI copy/paste path) stays in the drawer as the
  "I don't know the pieces yet" fallback; unchanged.

## Testing

- Manual: break a coarse rail step into 3 lines → step is replaced by 3 chips →
  each drags onto a day. Blank lines ignored. Esc cancels. ⌘/Ctrl+Enter commits.
- No new pure logic, so no new unit test; run `npx tsc -b` + `npm test` +
  `npm run build` before committing.
