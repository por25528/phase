# Parked status + rail head row — design

Date: 2026-08-23

## Problem

1. The backlog rail's rows are all the same compact size; the one you most want
   to drag — the head of each project's queue — is no easier to grab than the rest.
2. There is no way to set a task aside. The user has been typing `[park]` into
   titles. A project parks via horizon (Later/Someday); a single leaf cannot.

## Part 1 — `'parked'`, a fifth leaf status

`StepStatus = 'todo' | 'doing' | 'blocked' | 'parked' | 'done'`. Leaves only
(`Task` has no status and is out of scope).

Meaning: "not now, and not waiting on anything." Distinct from `blocked`
("waiting on something", carries `blockedOn`). Parked never carries a reason;
`applyStatus` clears `blockedOn` on entry like every non-blocked state.

### Attention, never numbers

- `pct.ts` untouched.
- `firstOpenLeaf`/`nextOpenAction` skip parked like blocked. `plan.ts`'s
  all-blocked sentence reads "All open tasks are blocked or parked" when any
  open leaf is parked; "All open tasks are blocked" when none is.
- `backlogGroups` drops a parked leaf unless `plannedWeek` is set (blocked's
  committed-work exception). `executionAdvisor`'s filter does the same.
  `todayPlan` inherits.
- `containerStatus`: `blocked` rule first (every open leaf blocked); then
  `parked` when every open leaf is parked; mixed → `'todo'`.
- Blocked counts stay blocked-only: `blockedLeafCount`, `firstBlockedLeaf`,
  `overview.countBlocked`, `FocusSummary` blocked chip, `hiddenProjectCounts`,
  `fullyBlocked`. Parked is not a problem to surface.
- `cycleStatus` unchanged. `doneFold` unchanged.

### Surfaces

- `STATUS_WORD.parked = 'parked'`; `STATUS_BOX.parked = 'border-faint'`;
  `StatusMark` → faint `IconCircle`.
- `rowActions`: leaf-only `park` verb, label `Park` / `Unpark` (by
  `ctx.isParked`), hint `P`, group 1 after `demand`. `GoalTree` binds `P`.
- `TaskPage` `STATUS_ORDER` and bulk `<select>`: `parked` between `blocked`
  and `done`.
- `BOARD_COLUMNS`: `{ status: 'parked', title: 'Parked', hint: 'Set aside, not now' }`
  between Blocked and Done.
- Backlog rail row (steps only): a `.quiet-control` button, `aria-label`
  `Park "<title>"`, calling `actions.setNodeStatus(id, 'parked')` — existing
  undo applies.
- Agent `set_status` accepts `'parked'`; `blockedOn` with any non-blocked
  status still refused. `AGENT_TOOLS` description updated.
- No migration.

## Part 2 — the head row of each rail group

`BacklogRow` takes `head: boolean` (true for `group.shown[0]`). A head row:
`py-[8px]`, `text-body`, title `line-clamp-3` instead of 2, and
`bg-panel border border-line-2 rounded-[6px]`, plus `data-backlog-head`.
Same draggable, same controls. Revealed/dragging styling unchanged.

## Testing

- `status.test.ts`: containerStatus parked/mixed; applyStatus clears blockedOn.
- `tree.test.ts`: firstOpenLeaf skips parked; null when all blocked/parked.
- `backlog.test.ts`: parked dropped; kept with plannedWeek.
- `executionAdvisor.test.ts`: parked excluded.
- `plan.test.ts`: sentence variants.
- `rowActions.test.ts`: park/unpark leaf-only.
- `goalBoard.test.ts`: five columns.
- `agentProtocol.test.ts`: parked valid; parked+blockedOn refused.
- `Backlog.test.tsx`: one `data-backlog-head` per group; Park button on step
  rows only.
