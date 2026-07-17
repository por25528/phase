# Plan & Pace — Design Spec

**Date:** 2026-07-17
**Status:** Approved by user (brainstorming session)

## Summary

Refocus Phase on its slogan — *build habits, reach goals* — around the kanban board and calendar. Three changes, one round:

1. **Remove Tasks and Study Log from the UI.** Today's action list is derived from goal trees instead of maintained by hand.
2. **Pace tracking everywhere.** Extend the existing behind-pace machinery to a three-state signal (ahead / on-pace / behind) shown on board cards, timeline rows, and the insight bar.
3. **Weekly planning.** A "Plan week" overlay where you pick unchecked leaves from your goals (behind-pace goals first) into the week, optionally pinned to days. Planned leaves drive Today's "Next up" list and the week strip.

## Decisions made

| Question | Decision |
|---|---|
| Existing task/session data | Keep in Dexie and `AppState`; drop UI and actions only. Backup export still includes them. Zero data loss. |
| Next-up source | Planned leaves first, auto-filled with next unchecked leaves from highest-priority goals. Planning helpful, never mandatory. |
| Plan granularity | Week bucket + optional day pin. |
| Planning surface | Full-screen overlay opened from Today; no new nav item. |
| Plan-state storage | On the `GoalNode` itself (approach A) — no separate plan slice, no dangling references. |

## Data model

`GoalNode` (leaves only, same leaf-XOR-container discipline as `done`):

```ts
plannedWeek?: string; // 'YYYY-MM-DD' of the week's Monday — "I'll do this leaf this week"
plannedDay?: string;  // optional pin to a specific day within that week
```

- Adding children to a leaf clears both fields (alongside clearing `done`).
- Scheduling metadata only — **never** affects the pct roll-up in `src/lib/pct.ts`.
- Living on the node means undo, backup export/import, goal import, and subtree deletes need no extra bookkeeping.
- `Task`, `Session` types, Dexie tables, and `AppState.tasks`/`AppState.sessions` remain; only their actions and UI are deleted.

## Pure logic

### `src/lib/plan.ts` (new, with `plan.test.ts`)

- `weekOf(date: string): string` — Monday of that date's week.
- `plannedLeaves(goals, week)` — all planned, unchecked leaves for a week, with goal context; day-pinned first.
- `nextUp(goals, today, limit)` — Today's list, in order:
  1. Leaves pinned to today.
  2. Other leaves planned for this week (unpinned pool, then later-day pins).
  3. Carry-overs: unchecked leaves whose `plannedWeek` is in the past — surfaced, not hidden.
  4. Auto-fill to `limit`: first unchecked leaves in tree order from goals in column order (column 0 = leftmost = first).

### `src/lib/timeline.ts` (extend)

- `paceStatus(pct, start, deadline, today): 'ahead' | 'on-pace' | 'behind'` — reuses `behindPaceBy`; one shared threshold constant, ≥10 pts either side, same round-then-compare order as the existing card/insight-bar logic so surfaces never disagree.

## Store actions (`src/state/store.ts`)

- `planNode(goalId, nodeId, week, day?)` / `unplanNode(goalId, nodeId)` — through `setAndPersist`; unplan is undo-aware.
- Delete task/session actions (`addTask`, `toggleTask`, `deleteTask`, `addSession`, …) and their QuickAdd wiring.
- All other invariants (column-major goals array, single-writer tab lock, hydration gate) unchanged.

## Today view

- **Removed:** `TasksCard`, `StudyLogCard`; QuickAdd `'task'` type (keeps `'habit' | 'goal'`, defaults to `'goal'`).
- **New `NextUpCard`** (left column, below Habits), rendering `nextUp(goals, today, 7)`:
  - Row = existing `TodayCheckbox` + leaf title + muted goal-name `Tag`. Checking calls the existing leaf-toggle action — goal % moves immediately, same undo window as the board.
  - Pinned rows show a day label ("Wed"); planned-unpinned show "this week"; auto-filled rows show nothing — commitment vs. suggestion at a glance.
  - Carry-overs get the existing warn-tint ("last week").
  - Header: **"Plan week"** button + count ("3 planned · 2 suggested").
- **Week strip:** up to three accent dots per day for day-pinned leaves, matching the habit-dot language.
- Empty states: no goals → point to the Goals board; nothing planned → auto-fill list shows with "Plan week" as the nudge.
- Locked palette/typography tokens only; no new colors or fonts.

## Weekly planning overlay

Built on the existing `Modal` at near-full-screen, opened from "Plan week":

- **Left — "What needs attention":** goals sorted behind-first (`paceStatus`), each with pace chip + progress bar, expandable to unchecked leaves (read-only `GoalTree` rendering).
- **Right — "Your week":** "This week" pool + Mon–Sun slots. Click a leaf → `planNode` for the current week; each planned row has seven day chips to pin/unpin and an × to unplan.
- No drag-and-drop this round — click-to-place is keyboard-friendly; DnD is a possible later enhancement.
- Every click persists immediately; closing the overlay is just closing it — no save step.

## Pace surfacing

- **BoardCard:** existing `BehindChip` stays; ≥10 pts ahead gets a matching "ahead" pill (existing accent/tint tokens). On-pace = no chip.
- **Timeline rows:** same chip pair.
- **InsightBar:** ahead-count added next to behind-count, computed in `boardInsights.ts`.

## Testing

- `plan.test.ts`: `weekOf` (year boundary, Sunday edge), `plannedLeaves`, `nextUp` ordering (pinned-today → this-week → carry-over → auto-fill), planning fields cleared when a leaf becomes a container.
- Store tests: `planNode`/`unplanNode` persistence + undo; task/session action removal doesn't break hydration of old data.
- `paceStatus`: threshold-boundary tests mirroring `behindPaceBy` rounding.
- Suite stays green; `npm test` + `npx tsc -b` before every commit.

## Out of scope (later rounds)

- Focus mode for deep subtrees (breadcrumb zoom).
- Habit consistency shown on goal cards.
- Milestones rendered on MiniCalendar/week strip.
- Drag-and-drop in the planner.
- Purging tasks/sessions tables.
