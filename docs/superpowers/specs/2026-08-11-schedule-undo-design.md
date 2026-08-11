# A booking made from a distance can be taken back

**Date:** 2026-08-11
**Status:** approved

## The problem

On Today, the free-time offer makes the whole row the button. That is the
right shape — a proposal you accept with one press — but it means there is no
way to touch that zone without booking something. A stray press schedules
"Watch roblox" onto the afternoon, and getting it back off costs a trip to
Plan, finding the block, and clearing it.

Every other write on Today can be taken back. Completing a step arms an undo
(`store.ts:909`), applying a replan arms one across both slices
(`store.ts:2313`), and *un*scheduling arms one (`store.ts:2336`, `2377`).
`scheduleNode` and `scheduleTask` are the only ones that write straight
through `setAndPersist`.

This is not only Today's problem. `Backlog.tsx:83` already reasons about a
focus ring by observing that a stray `1`–`7` keypress schedules onto a weekday
"and `scheduleNode` has no undo" — a second surface that had to work around
the same hole.

## The rule

Direct manipulation of a bar you can see is silent and self-reversing. A
booking made from a distance gets an undo.

The app already keeps the first half: `resizeNode` and `resizeTask`
(`store.ts:2390`, `2416`) persist without arming anything, because you dragged
an edge and can drag it back. This spec adds the second half.

`opts.blockId` is where the line falls. It names WHICH sitting is being moved,
so its presence means a drag of one existing bar. Its absence means "put this
here" — the Today proposal, the backlog weekday keypress, the schedule
popover's Today/Tomorrow, TaskPage's add-a-sitting. The store already splits on
nearly this same line at `store.ts:2086`, where a move is an ADJUSTMENT rather
than a fresh booking against the clock.

## The change

The `setAndPersist` that ends each of the two functions becomes conditional:

```ts
if (opts.blockId) setAndPersist({ goals });          // moving one visible bar
else withUndo(`Scheduled "${sourceNode.title}"`, 'goals', goals);
```

`scheduleTask` takes the twin — `withUndo(`Scheduled "${task.title}"`, 'tasks',
tasks)`, against the `tasks` slice.

Nothing in the undo machinery changes. `withUndo` snapshots the current slice,
persists the next, and arms a 5-second non-surgical entry that the next
ordinary edit sweeps — the same lifecycle as `toggleLeaf` and the
`unschedule*` pair, and `⌘Z` reaches it through `undoLastDelete` unaided.

**The whole-slice snapshot is the load-bearing choice.** A single write sets
both the block and the `plannedWeek` commitment beside it (`store.ts:2108`); a
surgical undo would have to remember both, and would drift the first time the
write learned to touch a third field. The snapshot reverses whatever happened.

**The refusal path needs no work.** `scheduleNode` returns at `store.ts:2102`,
before the clone, so a `describeNoRoom` toast arms nothing. That is already
true and only needs pinning — an Undo button over a write that never happened
is exactly the failure CLAUDE.md names when it says a visible Undo that does
nothing is worse than no button.

**Label:** `Scheduled "Watch roblox"`, pairing with the existing
`Unscheduled "X"`. It collides with `setNodeDates`'s label at `store.ts:2019`,
which is deliberate and harmless: that is the date-span editor in `StepPanel`,
a different surface that cannot raise its toast in the same breath. The pairing
is worth more than the uniqueness.

## What this makes false

- `Backlog.tsx:83` says "and `scheduleNode` has no undo". The focus-ring
  conclusion it supports still stands — an invisible mode must be visible for
  as long as it is active — but the sentence stops being true and changes with
  the code.
- `2026-08-09-today-free-time-design.md:75` says "Success needs no toast." It
  gains an amendment: a toast now appears, as the undo handle rather than an
  announcement. The movement up the page is still the feedback that the
  booking landed; the toast is the way back.

## Tests

`store.test.ts`:

- `scheduleNode` with no `blockId` arms `Scheduled "X"`; undo returns the node
  to unplaced AND uncommitted — no blocks, no `plannedWeek`
- `scheduleNode` with a `blockId` arms nothing (a drag stays silent)
- a refusal — no room on the day — returns `false` and arms nothing
- `mode: 'add'` arms one entry, and undoing it removes only the added sitting
- the `scheduleTask` twin of each

`Today.test.tsx`:

- clicking a proposal row raises the undo toast
- pressing Undo returns the row to the offer list — free, because
  `backlogGroups` re-includes anything unplaced

## Out of scope

No new store action, no new component, no change to `resolveSlot`, to
`weekCapacity`, or to the offer's membership rules. Plan-grid drag and resize
stay silent.
