# Multiple work sessions per task — BUILT

This was written as a plan for the one slice of the remaster
(`ideas/PRODUCT_REMASTER.md`, change 11) that had not been attempted. It has
since been built, and the notes below turned out to be the shape it took —
kept as the record of why, with the two places reality differed marked
inline.

## What was missing

A leaf carried `plannedWeek`, `plannedDay`, `plannedStartMin` — **one** block.
So a four-hour task could not be two two-hour sittings. The only ways to express
that were to split the task in two, which duplicates it in every count and
roll-up, or to schedule it once and lie about the duration.

The spec's requirement is precise and worth quoting:

> Scheduling a 4-hour task as two 2-hour sessions must not duplicate the task or
> mark it done after the first block.

## Why it was not a small change

`plannedDay`/`plannedStartMin` were read in **37 production files** and asserted
in **703 tests across 19 files**. They were load-bearing for the capacity engine,
the slot resolver, the backlog rail's planned/committed partition, the week
recap, the carry-over count, the replan proposal and the migration that put them
there in the first place (`migrateSlots.ts`).

## The shape it took

A `WorkBlock` list, not more fields on the node. Two representations of "when
this happens" is the failure the Board slice was careful to avoid, so the
existing fields must **move**, not gain a sibling.

```ts
export interface WorkBlock {
  id: string;
  /** The commitment this time is for. Mutually exclusive, like `Session`. */
  nodeId?: string;
  taskId?: string;
  date: string;      // 'YYYY-MM-DD'
  startMin: number;  // minutes from local midnight
  minutes: number;   // this block's length, NOT the task's estimate
}
```

`minutes` is per-block on purpose: the spec's rule that "resize changes session
duration, not the Task estimate" only has somewhere to live if a block owns its
own length, and the discrepancy indicator ("planned sessions exceed the
estimate") is then a comparison between two real numbers rather than a guess.

**Where it lives — decided differently.** The plan leaned toward
`AppState.blocks` as a fifth slice and worried that hanging blocks off the node
"makes every calendar read a full tree walk". Reading `scheduledOn` settled it:
that walk ALREADY happens, once per calendar read, so the table bought nothing —
and it would have introduced a dangling-reference class that `Session` is only
allowed to have because a stray session is inert. A stray block would draw
itself on a Tuesday. Blocks live inside the node or task.

## The order it has to happen in

1. **`WorkBlock` + a migration.** Every leaf with a `plannedDay` AND a
   `plannedStartMin` becomes exactly one block of `durationOf(estimateMin)` —
   the height it was already being drawn at; `plannedWeek` stays on the node,
   because week-commitment is not a block and the rail's planned/committed
   partition depends on the difference.

   **No snapshot and no done-flag — decided differently.** The plan assumed
   `migrateSlots`' pattern. `migrateWorkBlocks` computes nothing and is
   idempotent by construction (a row with `blocks` is left alone), so it runs
   read-time on every launch exactly like `migrateNodeStatus`, and there is
   nothing to roll back to. It must run AFTER `migrateSlots`, which repairs old
   data by writing the very pair it consumes.
2. **Readers, one at a time, each green before the next.** `scheduled.ts` first
   (everything visual goes through it), then `capacity.ts`, then `slot.ts`'s
   callers, then `backlog.ts`, `dailyWork.ts`, `replan.ts`, `rowSchedule.ts`.
3. **Store actions.** `scheduleNode` gains a block rather than overwriting one;
   `unscheduleNode` needs to mean "remove which block?"; `resizeNode` writes
   `minutes` and stops warning about the estimate.
4. **UI last.** The task inspector lists every sitting, each removable on its
   own, with `planVsEstimate` stating the discrepancy beneath them and a "Sit
   again today" that adds one. A calendar bar's remove and resize act on the
   sitting they are drawn for.

   Option-drag to duplicate a sitting is the one item here NOT built: the
   `mode: 'add'` intent exists and is tested, but no pointer gesture is bound to
   it yet — the inspector button is the route.

## The Calendar tab depended on this

It shipped in the same pass, and reused Plan's `WeekGrid`, `DayBlocks` and
`aimMinuteFor` rather than growing a second copy — which was the actual risk,
not the tab itself. Its rail places by button rather than by drag for the same
reason: duplicating the pointer maths is how two calendars start disagreeing
about a Tuesday.

## What NOT to do

Do not add `extraBlocks?: []` beside the existing fields. It is faster and it is
the two-sources-of-truth bug the remaster spends §7 warning about — every reader
would then have to remember to check both, and the one that forgets is a silent
wrong number rather than a crash.
