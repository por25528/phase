# Today: the free-time offer

**Date:** 2026-08-09
**Status:** approved

## The problem

Today's three zones — Now, Rest of today, Attention — are each conditional on
something carrying today's date. A user with real goals, real open steps and
real deadlines, who has simply not committed anything to this week, gets one
grey sentence in a 720px column and a thousand pixels of nothing.

That is the wrong moment to opt out. An empty day is precisely when the
question "what should I do now" needs an answer, and Today's answer is
currently "go and use Plan". The remaster promised a surface with enough
authority to end the morning assembly; it delivered one that only speaks after
the assembly is already done.

## What changes

Today gains a third answer, after "what's now" and "what's left": **the day is
unbooked, and here is how to book it.**

One new zone — `Free time` — shown whenever the target day has unbooked time
and there are candidates to offer. A full day is unchanged; this adds nothing
to a page that is already working.

## The module

`src/lib/todayPlan.ts`, pure, with a sibling test.

```ts
export const PLAN_DAY_HORIZON = 7;
export const PROPOSAL_MAX = 5;

export type TodayPlan =
  | { kind: 'no-hours' }
  | { kind: 'none' }
  | { kind: 'offer'; date: string; today: boolean; freeMin: number; rows: ProposalRow[] };
```

- `nextFreeDay(...)` — the first date in `[today, today + PLAN_DAY_HORIZON)`
  with `freeMinutes > 0`. `remainingWindow` already returns null for a window
  that has closed, so 19:00 on a Sunday rolls to Monday without a special case.
- `proposalRows(goals, tasks, week, today)` — `backlogGroups(...)`, the FIRST
  item of each group, sorted by `sortByDue`, capped at `PROPOSAL_MAX`.
- `todayPlan(...)` composes them.

Reusing `backlogGroups` is the load-bearing choice. The `PLANNING_HORIZONS`
gate, the parked-project commitment exception, the loose-tasks bucket and the
due ordering all already live there. The proposal cannot disagree with the Plan
rail because it is the rail's own selector.

`no-hours` is a distinct verdict, not a zero. "Phase does not know when you
work" and "you are out of time today" are different sentences and the surface
says which one it means — the same distinction `goalHealth` draws with
`no-forecast`.

## The view

A `Free time` section, between "Rest of today" and "Attention".

- Header: `3h 20m free today`, or `No time left today · Monday, 6h free`.
- Rows carry title, goal, estimate and at most one reason chip (the due chip,
  under the existing `DUE_CHIP_DAYS` rule — anything that jumps the queue says
  why).
- The row is the button. It calls `actions.scheduleNode(goalId, id, date, aim)`
  or `actions.scheduleTask(id, date, aim)`, where `aim` is the current minute
  when the target day is today and the day's window start otherwise.
- **Refusal is not new work.** Both actions resolve the slot themselves and
  toast `describeNoRoom` when an item will not fit contiguously — a 90-minute
  step against three 30-minute gaps already says so, in words the app already
  owns. There is no optimistic UI to roll back.
- Success needs no toast. The item leaves the proposal (it is placed, so
  `backlogGroups` drops it) and reappears above in Now or Rest of today. The
  movement up the page is the feedback.
- `no-hours` renders one line and a route into the existing availability
  settings.
- When today is empty AND an offer exists, the Now zone renders nothing. The
  grey "Nothing committed to today…" line survives only for `kind: 'none'`.
  Two messages both saying "nothing" is how the page became apologetic.

The 720px column is unchanged. The void closes because something occupies it,
not because the margins moved.

## What this must not become

No health verdicts, no portfolio counts, no progress rings, no second backlog
rail. One row per project, five at most, one reason each. A surface that
answers one question stops answering it the moment it also answers nine others.

## Tests

`todayPlan.test.ts`:

- availability never set → `no-hours`, whatever else is true
- today's window already closed → offer targets the next open day, `today: false`
- today still open → offer targets today, `today: true`, `freeMin` from `freeMinutes`
- no free day inside the horizon → `none` (a week booked solid is not an empty page)
- no candidates → `none`
- one row per project, capped at `PROPOSAL_MAX`, ordered by nearest due
- a parked project's untouched work is absent; its committed work is present
  (inherited from `backlogGroups`, asserted here so the inheritance is pinned)

`Today.test.tsx`: clicking a row places it and the row leaves the list; the
`no-hours` line offers the availability route; the offer suppresses the empty
Now line, and `none` does not.
