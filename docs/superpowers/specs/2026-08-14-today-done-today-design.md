# Today: the day gets a bottom

## The problem

**The page gets emptier as you succeed.**

Every section on Today is work that is still owed. Tick something and it leaves
the page; tick everything and the page is blank. The one acknowledgement a
finished day gets is a single grey sentence, below the whitespace, at the very
end of the column:

```tsx
{doneCount > 0 && (
  <p className="mt-[24px] text-meta text-muted">
    {doneCount} finished today.
  </p>
)}
```

`buildDailyWork` already computes `completedToday` in full — every task and
every leaf whose `doneAt` is today, with titles, goals and estimates — and
`Today.tsx` reads `.length` off it and discards the rest. The data for the
day's record is built on every render and thrown away.

That inversion is worth naming: a surface whose reward for use is a blanker
screen teaches you that using it accomplishes nothing. The four existing zones
answer "what is owed". None of them answers "what did I do", and the page has
had the answer in hand the whole time.

## What this is not

**Not a fix for the void, and it must not be argued as one.** The 2026-08-14
one-gesture spec measured the empty space at 0px on a realistic day and
concluded that the sparse page is *"a property of an empty database, not of the
layout"*. That position stands. This section renders only when work was
actually finished, so on the sparse day that started the complaint it renders
nothing at all — it is a record, not filler.

**Not a completion timestamp.** `doneAt` is a local `'YYYY-MM-DD'` date
(`types.ts:42` and `:189`), stamped by `applyStatus`. Nothing anywhere records
what o'clock something was finished. Adding one would mean a new field on every
leaf and every task, written on every tick, to decorate one list.

**Not analytics.** No streak, no rate, no comparison against yesterday, no
"you're 20% ahead". The 2026-07-30 and 2026-08-09 constraints stand: a surface
that answers one question stops answering it the moment it also answers nine
others. This answers the same question the page already answers, in the past
tense.

## 1. Placement and heading

Last. Below Attention, at the foot of the column.

The order of the page is the order of what needs you: the one thing now, the
rest of the day, what slipped, what the free time could take, the exceptions —
and then, only after all of it, what is already behind you. Work that is done
cannot outrank work that is not.

The heading is `Done today`, in the label voice its four neighbours use —
`text-meta font-semibold text-muted`, `px-[8px]`, sentence case.

**No count in the heading.** Every other heading on the page names a section
rather than measuring it, and the rows are immediately below to be counted. The
`{doneCount} finished today.` sentence is REPLACED by this section, not kept
above or beside it — two statements of the same fact is the error this page
keeps having to correct.

The empty-Now line is unaffected. `Nothing left today — 3 done.` is a different
sentence on a different surface, said when there is nothing to show; it keeps
its count.

## 2. The row

`TaskRow`, with the `completed` prop it already has — line-through, `text-muted`
— so a finished row reads as finished without a second mechanism.

- **The checkbox is checked, and un-ticking works.** It calls the same
  `toggleTask`/`toggleLeaf` the live rows call. This is the only place in the
  app where a mis-tick can be corrected in the place it happened.
- **No undo toast on un-ticking.** Un-ticking IS the undo, and both actions
  already behave this way: `toggleTask` and `toggleLeaf` (`store.ts:967`) each
  branch on `wasDone` and take a plain `setAndPersist` when un-completing,
  reserving `withUndo` for the completing direction. A toast offering to undo
  an undo is noise. Nothing needs changing in the store for this section — it
  is a new reader of behaviour that already exists.
- **A plain click opens the row** via `openItem`, exactly as `Rest of today`
  and `Carried over` do. One gesture, one dimension: this section gets no
  special row behaviour, which is the whole point of the rule.
- **Minutes logged today**, in `meta`, when non-zero.

### Logged minutes, not a time of day

The honest figure a finished row can carry is what the work COST, which the
schema does record: `Session` has `date`, `nodeId` and `taskId`. That is a
better fact than a timestamp would have been — "45m" says something about the
work, "14:20" says only when you happened to tick a box.

`actuals.ts` gains one function, because the two it has are all-time:

```ts
/**
 * Minutes logged against one commitment ON one day.
 *
 * `nodeId` takes precedence for the same reason `loggedForTask` gives: the two
 * ids are documented as mutually exclusive and `logSession` writes only one,
 * but `importStateFromFile` does not sanitise sessions, so a hand-edited backup
 * carrying both would otherwise have its minutes counted twice.
 */
export function loggedForItemOn(
  sessions: Session[],
  item: { kind: 'task' | 'step'; id: string },
  date: string,
): number
```

Absent on most rows, and that is correct — most work is finished without a
logged session, and a row reading `0m` would report a measurement nobody took.
`meta` is optional on `TaskRow`; nothing is rendered.

## 3. No cap, and why this differs from Carried over

`Carried over` caps at `MAX_CARRY_OVER` because its input is unbounded: months
of stale commitments can accumulate, and a section listing all of them is the
second backlog rail this surface must not become.

`Done today` has no cap. Its input is bounded by one day of one person's work,
and truncating the only section that exists to show what you did — telling
someone who finished eleven things that five of them counted — would undercut
the entire reason for it. The two sections differ here on purpose, and the
reason is the shape of the input, not a style preference.

## 4. The section makes no chronological claim

`doneAt` carries no time, so the rows CANNOT be ordered by when they were
finished. They keep `buildDailyWork`'s existing order: loose tasks first, then
steps in tree order.

This is stated here so that it is not later "fixed". Ordering this list
chronologically requires a completion timestamp, which §"What this is not"
refuses; anyone reaching for one should read that refusal first. The section is
a LIST of what was done, not a log of when.

## 5. One inherited quirk, recorded rather than discovered

`completedToday` walks `allLeaves`, not `activeLeaves` (`dailyWork.ts`), so a
leaf finished inside a goal that was itself completed today still appears. Every
other section filters completed goals out.

That is correct — you did do the work, and a goal being finished is not a reason
to erase the last thing you finished inside it — but it is the one place this
section's membership rule differs from its neighbours, and it should be written
down rather than found later and mistaken for a bug.

## Tests

`actuals.test.ts`

- `loggedForItemOn` sums only sessions on the named date
- a session carrying BOTH `nodeId` and `taskId` counts once, for the node
- a task session with no `nodeId` counts for the task
- no sessions, or none on that date → 0

`Today.doneToday.test.tsx` (new; the harness is the one
`Today.freeTime.test.tsx` and `Today.carryOver.test.tsx` already use)

- a task completed today renders under `Done today`, with the line-through row
- the `{doneCount} finished today.` sentence is GONE — asserted by absence, so
  the section and the sentence can never both ship
- un-ticking a done row un-completes it and the row leaves the section
- un-ticking arms NO undo toast
- minutes logged today appear; a row with no session shows no figure
- nothing finished today → no section, and no heading

`npm test` and `npx tsc -b` before committing, per conventions.
