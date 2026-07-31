# Busy blocks: who owns them?

Date: 2026-07-31
Status: **decided — do not build local busy-block authoring.** Recommends a
different feature for the need behind it.

## The situation

`BusyBlock` is fully specified (`db/types.ts`), threaded through
`visibleRange`, `weekCapacity`, `freeIntervals`, `resolveSlot`, `clampResize`
and `DayBlocks`, and rendered with an all-day path and lane packing. It has **no
producer**. Every call site passes `[]`.

So today there is no way to tell Phase about a lecture, a lab, or an exam. A
student can only shrink their whole working window, which throws away the hours
either side of the class.

The obvious move is to let people create busy blocks in Phase. That is the move
this memo rejects.

## What the existing design commits to

`docs/superpowers/specs/2026-07-26-google-calendar-capacity-design.md` §2 is
explicit: **read-only, pull-only. Phase never writes to Google.** Blocks are
fetched and normalised in the Electron main process; `src/` only ever sees
`BusyBlock[]`. The cache carries provenance (account, calendars, timezone) and
is **discarded rather than displayed** on any mismatch. It is excluded from
backup export (§3.3) because it is a cache, not data.

## The decision, question by question

**Source of truth.** Google, for anything `BusyBlock` represents. That is the
whole premise: Google already knows where the time went, and Phase's job is to
read it.

**Pull-only vs local creation.** Pull-only. Local creation is rejected — see
"Why not" below.

**Edits.** None. A pulled block is a fact about another system; editing it in
Phase would either be a lie (local edit, overwritten on refresh) or a write to
Google, which §2 rules out.

**Conflicts.** There are none to resolve, precisely because Phase never writes.
Overlap between a block and planned work is not a conflict — it is the signal
the feature exists to surface, and `mergeIntervals` plus `assignLanes` already
handle it.

**Deletion.** Not offered. Blocks leave when they leave Google, or when the
cache is invalidated.

**Offline.** Last known complete cache plus a staleness label (§5.6). Never an
error pane, never a silent zero.

**Ownership.** Google owns the data; Phase owns the *normalisation* and the
capacity arithmetic derived from it.

## Why not local busy blocks

1. **They would be a second entity wearing the same type.** Local blocks are
   user data: editable, deletable, undoable, and required in the backup. Cached
   blocks are none of those and are explicitly excluded from export. Merging
   them into one `BusyBlock[]` means every consumer must know which kind it
   holds, and the UI must make "yours" versus "Google's" obvious or people will
   delete a lecture and watch it return on the next refresh.

2. **Without recurrence they solve almost nothing.** The need is "18.06,
   Monday/Wednesday/Friday 10–11, all term". A one-off block editor makes the
   user create forty of them by hand. Recurrence is a real feature — RRULE
   semantics, term boundaries, exceptions for holidays and cancelled classes —
   and the design deliberately keeps recurrence expansion out of this codebase
   entirely (`singleEvents=true`, §5.4).

3. **It pre-empts the seam before it exists.** None of slice 2 is built —
   there is no `electron/busyBlocks.cjs` and no `calendarCache` table. Shipping
   a local producer first means the union path goes to users having never seen
   real calendar data.

## What to build instead: multiple availability windows per weekday

The recurring half of the need is not an *event* concept at all. It is a
*weekly availability* concept, and it is one step from what already exists.

`AvailabilityWindow` is already `{ dow, startMin, endMin }` and `availability`
is already an array — the shape allows several windows per weekday. Two lines
forbid it: `parseAvailability` rejects duplicate `dow`, and `windowForDate`
returns the first match.

Allowing several turns

> Tuesday 09:00–18:00

into

> Tuesday 09:00–10:00, 11:00–14:00, 15:00–18:00

which carves out a 10:00 lecture and a 14:00 recitation, recurring by
construction, with no new entity, no ownership question, no backup question, no
offline question and no recurrence engine. It composes with everything already
built, because the scheduling core is interval arithmetic throughout.

**Blast radius** — seven non-test call sites:

| File | Change |
| --- | --- |
| `lib/availability.ts` | drop the unique-`dow` rule; validate non-overlap; `windowsForDate` |
| `lib/capacity.ts` | `remainingWindow` → `remainingWindows(): Interval[]`; `freeMinutes` sums |
| `lib/slot.ts` | `freeIntervals` intersects gaps with each window |
| `lib/grid.ts` | `visibleRange` takes earliest start / latest end across windows |
| `lib/migrateSlots.ts` | aim at the first window's start |
| `plan/DayColumn.tsx` | shade the gaps between windows, not one band |
| `plan/AvailabilitySettings.tsx` | add/remove windows per day |

The pure layer is where the risk is and where the test coverage already is
(`capacity.test.ts`, `slot.test.ts`, `grid.test.ts`). It is a real feature, not
a patch, and it should be done as one — the editor included, because a
capability the UI cannot reach is the same dead control as the all-day-events
checkbox that was removed on 2026-07-31 for exactly that reason.

**One-off commitments** (an exam, an interview) are genuinely what `BusyBlock`
is for, and they wait for slice 2. Until then the honest workaround already
exists: put it on the grid as Phase work, where it consumes capacity like
anything else.
