# Plan & Pace — Design Spec

**Date:** 2026-07-17 (rev 2 — incorporates spec review)
**Status:** Revised after review; awaiting re-approval

## Summary

Refocus Phase on its slogan — *build habits, reach goals* — around the kanban board and calendar. Four changes, one round:

1. **Remove Tasks and Study Log from the UI**, with an explicit replacement for every current consumer of task/session data. Today's action list is derived from goal trees instead of maintained by hand.
2. **Schedule-pace signal** (behind / quiet-ahead / define-next-step) extending the existing behind-pace machinery, framed as an attention signal — not a performance score.
3. **Weekly planning**: a "Plan week" overlay — pick unchecked leaves (attention-ranked goals first) into the week, optionally pinned to days. Planned leaves drive Today's "Next up" and the week strip.
4. **Weekly recovery loop**: when a new week starts, the planner opens with a skippable recap — celebrate what got done, triage what didn't (replan / break down / remove) — then plan the new week. Choose → Act → See progress → Recover → Choose again.

## Decisions made

| Question | Decision |
|---|---|
| Existing task/session data | Keep in Dexie and `AppState`; drop UI, actions, and `src/lib/sessions.ts`. Backup export still includes the data. Zero data loss. |
| Next-up source | Planned leaves first, auto-filled with next unchecked leaves from highest-priority goals. Planning helpful, never mandatory. |
| Plan granularity | Week bucket + optional day pin. |
| Planning surface | Full-screen overlay opened from Today; no new nav item. |
| Plan-state storage | On the `GoalNode` itself — no separate plan slice, no dangling references. |
| Week boundary | **Monday–Sunday everywhere.** `weekDates` (currently Sunday-start) changes, and habits/week strip/timeline follow. |
| Pace framing | "Schedule pace" — an attention signal. Behind is surfaced; ahead stays visually quiet; goals with no actionable leaves get "define next step" instead of a pace verdict. |

## Data model

`GoalNode` (leaves only, same leaf-XOR-container discipline as `done`):

```ts
plannedWeek?: string; // 'YYYY-MM-DD' of the week's Monday — "I'll do this leaf this week"
plannedDay?: string;  // optional pin to a specific day within that week
```

- Adding children to a leaf clears both fields (alongside clearing `done`). Breaking down a planned leaf therefore unplans it — the recap flow re-plans the new children explicitly.
- Scheduling metadata only — **never** affects the pct roll-up in `src/lib/pct.ts`.
- Completed leaves keep their `plannedWeek`/`plannedDay`. That is what makes last week's recap ("4 of 6 done") computable with no history model.
- `Task`, `Session` types, Dexie tables, and `AppState.tasks`/`AppState.sessions` remain; their actions, UI, and `src/lib/sessions.ts` are deleted.

## Week boundary standardization (prerequisite)

`weekDates` in `src/lib/dates.ts` becomes Monday-based; a Sunday belongs to the *preceding* Monday's week. Affected consumers, all updated in the same task:

- `HabitsCard` weekly counts ("3/4 this wk") — counts shift to Mon–Sun windows. Accepted behavior change.
- `WeekStrip` — renders Mon–Sun.
- `src/lib/timeline.ts:248` — `major` week markers move from Sunday to Monday.

Required tests: Sunday maps to the preceding Monday; weekly habit counts across the boundary; week strip ordering; year boundaries.

`weekOf(date)` in the new plan lib is defined as `weekDates(date)[0]` so planning and habits can never disagree.

## Pure logic

### `src/lib/plan.ts` (new, with `plan.test.ts`)

- `weekOf(date: string): string` — Monday of that date's week (delegates to `weekDates`).
- `plannedLeaves(goals, week)` — all planned leaves for a week with goal context, completed and not, day-pinned first. Powers the planner, week strip, and recap.
- `nextUp(goals, today, limit)` — Today's list, in order:
  1. Leaves pinned to **today**.
  2. Unpinned commitments for this week.
  3. Auto-suggestions to `limit`: first unchecked leaves in tree order from goals in column order (column 0 first), **excluding** leaves whose own `start` (or their goal's `start`) is in the future.
  - **Future-day pins are hidden until their day.** A Friday pin never appears on Monday — pins mean something.
  - Carry-overs (unchecked leaves with a past `plannedWeek`) are **not** in this list; they return separately (`carryOvers(goals, today)`) and render as their own "Needs a decision" section.
- `paceStatus(goal, today)` — `'behind' | 'quiet-ahead' | 'on-pace' | 'no-next-step'`:
  - Reuses `behindPaceBy` from `src/lib/timeline.ts`; one shared ≥10-pts threshold constant, same round-then-compare order as the existing card/insight-bar logic.
  - A goal with zero unchecked leaves (all containers, or everything done) short-circuits to `'no-next-step'` — it needs definition, not a pace verdict.
- `attentionRank(goals, today)` — planner sort: overdue scheduled leaves → behind pace → due soon → board priority (column, then position).
- `weekRecap(goals, week)` — `{ planned, completed, unfinished[] }` for the recap screen.

## Store actions (`src/state/store.ts`)

- `planNode(goalId, nodeId, week, day?)` / `unplanNode(goalId, nodeId)` — through `setAndPersist`; unplan is undo-aware.
- **`toggleLeaf` becomes undo-aware on completion**: checking a leaf snapshots via the existing `withUndo` seam and shows the standard undo toast — *Completed "Draft introduction" · Undo*. (Currently `toggleLeaf` persists directly with no undo — and a completed Next-up row disappears from the list, so accidental completion would otherwise be confusing.) Unchecking stays direct: it's self-inverse and the row is still visible.
- Delete task/session actions (`addTask`, `toggleTask`, `deleteTask`, `addSession`, …).
- All other invariants (column-major goals array, single-writer tab lock, hydration gate) unchanged.

## Legacy consumer replacements

Every current reader of `tasks`/`sessions` gets an explicit replacement — nothing is left rendering ghost data:

| Consumer | Today | Becomes |
|---|---|---|
| `Hero.tsx` | tasks x/y today + session minutes this week | habits done today + planned steps completed this week ("4/6 this week") |
| `MiniCalendar.tsx` | dot per day with open tasks | dot per day with day-pinned unchecked leaves |
| `DaysLane.tsx` (timeline) | task count per day | day-pinned leaf count per day |
| `GoalsCard.tsx` | "do today" adds a `Task`; dedupes by scanning `tasks` | `planNode(goalId, nodeId, weekOf(today), today)`; "planned" state read from the node itself |
| `GoalDrawer.tsx` | session minutes this week | "N planned · M done this week" for that goal (from `plannedLeaves`) |
| `StudyLogCard.tsx` | whole card | deleted |

## Today view

- **Removed:** `TasksCard`, `StudyLogCard`; QuickAdd `'task'` type (keeps `'habit' | 'goal'`, defaults to `'goal'`).
- **New `NextUpCard`** (left column, below Habits):
  - Row = existing `TodayCheckbox` + leaf title + muted goal-name `Tag`. Checking completes the leaf — goal % moves immediately, undo toast per above.
  - Today-pinned rows show "today"; unpinned commitments show "this week"; auto-suggestions show nothing — commitment vs. suggestion at a glance.
  - **"Needs a decision"** section (only when carry-overs exist): each carried-over leaf offers **Replan** (→ this week), **Break down** (opens its goal to split it), **Remove from plan** (clears planning fields; leaf stays in the goal). No endlessly growing guilt list — every item has an exit.
  - Header: **"Plan week"** button + current-week count ("3 planned · 1 done").
- **Week strip:** up to three accent dots per day for day-pinned leaves, matching the habit-dot language.
- Empty states: no goals → point to the Goals board; nothing planned → auto-suggestions show with "Plan week" as the nudge.
- Locked palette/typography tokens only; no new colors or fonts.

## Weekly planning overlay

Opened from "Plan week". Two steps; step 1 only appears when there's a previous week to close out.

**Step 1 — Recap (skippable):** "Last week: 4 of 6 planned steps done." Completed commitments listed first — celebration, not streak-shaming. Unfinished ones follow with the same Replan / Break down / Remove triage as the Today card. A "Skip" affordance is always visible; planning never becomes a gate.

**Step 2 — Plan:**
- **Left — "What needs attention":** goals sorted by `attentionRank` (overdue scheduled leaves → behind pace → due soon → board priority). Each shows its pace state (behind chip; "define next step" hint for `no-next-step` goals; nothing for on-pace/ahead) and progress bar, expandable to unchecked leaves.
- **Right — "Your week":** "This week" pool + Mon–Sun slots. Click a leaf → `planNode` for the current week; each planned row has seven day chips to pin/unpin and an × to unplan.
- **Soft capacity guidance:** a running count ("5 focus steps planned"); past ~7 it turns to a gentle note ("that's a big week") — never a hard limit.
- No drag-and-drop this round — click-to-place is keyboard-friendly; DnD is a possible later enhancement.
- Every click persists immediately; closing the overlay is just closing it — no save step.

### Component requirements

- **`Modal` size variant:** current `Modal` is hard-coded to `max-w-[480px]`. Add an opt-in large/full variant (existing tokens only) with focus trap, focus restoration on close, and background-scroll lock — required for the planner, harmless for existing modals.
- **Read-only/selectable `GoalTree` mode:** the existing tree is fully interactive (toggle, add-child, inline rename). The planner needs a dedicated selectable mode with **no** rename, reorder, completion, or structural actions — leaf click = plan/unplan, nothing else.

## Pace surfacing

- **BoardCard:** existing `BehindChip` stays. `no-next-step` goals get a muted "define next step" hint. **Ahead gets no chip** — quiet by design; the actionable information is what needs attention.
- **Timeline rows:** same treatment as cards.
- **InsightBar:** behind-count stays; add the current week's planned/completed count ("week: 3/6"). No ahead-count chip parade.

## Testing

- Week boundary: Sunday → preceding Monday; habit weekly counts across the boundary; week strip ordering; year boundaries.
- `plan.test.ts`: `plannedLeaves`, `nextUp` ordering (pinned-today → unpinned-this-week → suggestions; future-day pins hidden; future-`start` leaves excluded from suggestions), `carryOvers`, `weekRecap`, `attentionRank`, planning fields cleared when a leaf becomes a container.
- `paceStatus`: threshold boundaries mirroring `behindPaceBy` rounding; `no-next-step` short-circuit.
- Store tests: `planNode`/`unplanNode` persistence + undo; `toggleLeaf` completion undo (snapshot restores, toast label); hydration of legacy task/session data still succeeds after action removal.
- Suite stays green; `npm test` + `npx tsc -b` before every commit.

## Out of scope (later rounds)

- Focus mode for deep subtrees (breadcrumb zoom).
- Habit consistency shown on goal cards; habit-to-goal contribution analytics.
- Milestones rendered on MiniCalendar/week strip.
- Drag-and-drop in the planner.
- Purging tasks/sessions tables.
- Effort estimates, adaptive recommendations, completion history (would require a planning-history model).
