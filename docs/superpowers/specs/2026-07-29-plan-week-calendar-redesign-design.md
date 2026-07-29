# Plan week → calendar home

**Date:** 2026-07-29
**Status:** approved, ready for implementation planning

## Problem

Plan week is a modal. It opens over the app, holds a 232px project rail plus eight
columns squeezed to `minmax(66px, 1fr)`, and closes again — so the thing the app is
*for* is a temporary interruption to the thing you actually look at. Meanwhile Today
carries eight independent cards, Goals carries a four-column board, and Timeline
carries a canvas. Three feedback documents and a usability audit in `docs/` each
independently reach the same conclusion: there is too much on screen and no single
place that answers "what am I doing this week".

The user's framing: *"plan week should be its own big plan and a kanban board. Take
inspiration from normal calendar UI with the side containing to-do. Make it easier to
use and less cluttered. App feels overwhelming."*

## Decisions (from the user)

Six choices, made in order, each shown as mockups before it was taken:

1. **Plan becomes the home screen and absorbs Today.** Nav becomes `Plan · Goals ·
   Timeline`. This removes a surface rather than adding one.
2. **A day column is a true calendar hour grid**, not a stack of cards. Steps get a
   real clock time.
3. **A dropped step snaps to the nearest gap that fits** — you aim roughly, Phase
   places it precisely.
4. **Everything from Today keeps a home in the sidebar.** Nothing is deleted for
   being surplus.
5. **The sidebar is an accordion with the backlog pinned open** and the other panels
   folded to one-line headers carrying their counts.
6. **There is no untimed work.** On the grid ⇒ it has a time. No time ⇒ it is in the
   sidebar. One rule.

Delivery: **parallel build, then flip.** Plan is added as a fourth nav item and built
alongside a fully working Today; the final task flips Plan to home and deletes Today
in one reversible commit.

## Why an hour grid, given the cost

Decision 2 is the expensive one — it requires a new field and a data migration. It
earns that because the calendar-capacity work merged in `3b4b620` already produces
`BusyBlock`s carrying real `startMin`/`endMin`, and `AvailabilityWindow`s carrying
real per-weekday hours. On a stack of cards those clock times are decoration. On an
hour grid they are load-bearing: a lecture sits at 10:00 because it *is* at 10:00,
and the free gaps around it become directly visible instead of being summarised as a
number. The grid is the layout that pays off work already done.

## Data model

### New fields

```ts
GoalNode.plannedStartMin?: number  // minutes from local midnight, 0..1440
Task.date?: string                 // CHANGED: now optional. absent = unscheduled
Task.startMin?: number
```

`Task.date` becoming optional is required by decision 6, not incidental: a ⌘N-captured
task you do not want to schedule needs somewhere to live, and under rule 6 the only
such place is the sidebar.

### The scheduling invariant

> An **open** item is scheduled if and only if it has both a day and a `startMin`.

Half-states are illegal. A `GoalNode` must never carry `plannedDay` without
`plannedStartMin`, and a `Task` must never carry `date` without `startMin`. Anything
not scheduled lives in the sidebar.

**Done items are exempt.** They are history, not commitments. Legacy completed work
without a slot does not render on the grid; it continues to appear in the weekly
recap exactly as it does today.

### Duration

Every block needs a height, but `estimateMin` is optional and stays optional.

- `durationMin = estimateMin ?? DEFAULT_SLOT_MIN`, where `DEFAULT_SLOT_MIN = 60`, a
  named exported constant in `slot.ts` — never an inline literal.
- A block using the fallback renders with a **dashed border**, so a guessed hour is
  never mistaken for a real estimate.
- **Resizing a block writes `estimateMin`.** Dragging the bottom edge to 90 minutes
  *is* estimating the step at 90 minutes.

That last point is deliberate. `docs/feedback/` records that estimates feel like a
chore; this makes them a by-product of planning rather than a separate ritual.

### `plannedWeek` is kept, deliberately

With every scheduled step carrying a day, `plannedWeek` is fully derivable as
`weekOf(plannedDay)` and is therefore redundant state. Removing it is the cleaner
design and was rejected on scope: it has 31 non-test references across 8 files
(`store.ts`, `plan.ts`, `capacity.ts`, `tree.ts`, `dailyWork.ts`, `deferWork.ts`,
`sampleProject.ts`, plus two Today components), and the rollover and recap machinery
is built on it.

Containment instead of removal:

- Every write goes through one helper, `setPlannedSlot(node, day, startMin)`, which
  sets `plannedWeek`, `plannedDay` and `plannedStartMin` together.
- A test asserts `plannedWeek === weekOf(plannedDay)` holds for every node after
  every scheduling action.

If `plannedWeek` is ever removed, it should be its own change with its own review.

### Migration (one-shot at hydration)

> **Revised while planning.** This section originally said "Dexie v5". No version
> bump is needed: `plannedStartMin`, `Task.startMin` and optional `Task.date` add
> no store and no index, and Dexie only versions schema changes. A ceremonial bump
> would imply a schema change that is not happening. The migration is instead a
> one-shot guarded by a `slotMigrationDone` row in the existing `settings` table,
> which also keeps `migrateSlots` a pure, fully testable function.

| Existing data | Becomes |
|---|---|
| Step with `plannedDay`, open | Snapped into the earliest gap on that day that fits |
| Step with `plannedWeek` only (the old "Any day" bucket) | Returned to the sidebar, `plannedWeek` cleared |
| Task with `date`, open | Snapped into a slot on that date |
| Anything that will not fit its day | Sidebar, badged "didn't fit" |
| Done items (steps or tasks) | Untouched |

The migration calls `resolveSlot` with the **start of that day's availability window**
as the aimed-at minute, which makes "earliest gap that fits" fall out of the normal
algorithm rather than being a second code path.

Because items on the same day compete for the same gaps, placement order is
significant and must be **deterministic**: steps before tasks; within steps, existing
column-major goal order then depth-first node order; within tasks, existing array
order. The migration must produce identical output for identical input, which is what
the idempotence test checks.

Two further requirements on the migration:

- **A snapshot of `goals` and `tasks` is written before it runs.** This rewrites
  scheduling across every goal the user has, and "export first" is not something a
  user should have to think to do. **Revised while planning:** the snapshot goes to a
  `preSlotMigrationSnapshot` row in the `settings` table rather than a downloaded
  file. `exportState` opens a save dialog, and firing one unprompted on the first
  launch after an update is startling; the risk actually being guarded against is
  this migration mangling scheduling, which a same-database snapshot fully covers.
- **Ordering is load-bearing:** snapshot → migrate → persist → mark done. If the
  persist fails the flag is never set, so the next launch retries cleanly instead of
  stranding half-rewritten data behind a "done" marker.
- **A toast afterwards reports what moved**, including the count returned to the
  sidebar, so a silently-dropped commitment is impossible.

The "didn't fit → sidebar" row is the only path where the migration can visibly lose
a commitment the user made. It is preferred over silent overflow because an item
sitting in the sidebar is recoverable and visible; an item overlapping a lecture is
neither.

## Architecture

### New pure logic — `src/lib`, each with a sibling `*.test.ts`

| Module | Responsibility |
|---|---|
| `slot.ts` | Given a day, desired start, duration, availability window, busy blocks and placed items → resolved `startMin`, or `null` if nothing fits. Every drop, keypress and migration step calls this. |
| `grid.ts` | Minute↔pixel mapping, visible-hour-range derivation, lane assignment for overlapping blocks. |
| `migrateSlots.ts` | Pure `(goals, tasks, availability) → { goals, tasks, report }`. Testable without Dexie; `db.ts` calls it. |

`capacity.ts`, `availability.ts`, `plan.ts`, `dates.ts`, `dailyWork.ts` are reused
unchanged. The grid is a new renderer for data these modules already produce.

### Components

```
src/views/Plan.tsx              orchestrator, thin
src/views/plan/
  WeekHeader.tsx                date range · capacity · ‹ today ›
  WeekGrid.tsx                  time axis, day columns, now-line
  DayColumn.tsx                 one day: droppable, availability shading
  EventBlock.tsx                a placed step or task — drag, resize
  BusyBlock.tsx                 a calendar event
  RecapPanel.tsx                last week's recap, inline
  PlanSidebar.tsx               accordion shell
  sidebar/Backlog.tsx           pinned open — projects → unplanned steps
  sidebar/Habits.tsx
  sidebar/Suggestions.tsx
  sidebar/Stats.tsx
  sidebar/Month.tsx
```

`PlanWeekOverlay.tsx` (922 lines) is deleted at the flip. `planner.ts`,
`EstimateField.tsx`, `AvailabilitySettings.tsx` and `capacityLabel.ts` stay where they
are and are reused.

### Where Today's pieces land

| Today card | Destination |
|---|---|
| `QuickAdd` | Sidebar, above the backlog |
| `HabitsCard` | Sidebar panel `Habits` |
| `WorthConsideringCard` | Sidebar panel `Suggestions` |
| `Hero` stats | Sidebar panel `Stats` |
| `MiniCalendar` | Sidebar panel `Month` |
| `WeekStrip` | **Deleted** — the grid is the week |
| `TodayWorkCard` | **Deleted** — the grid is today's work |
| `GoalsCard` | **Folded** — goal % moves onto the backlog's project headers |

`GoalsCard` is the one walk-back from "nothing lost", accepted by the user: the
backlog is already grouped by project, so putting the percentage on those headers does
its job without a seventh sidebar section.

### Store

New actions: `scheduleNode(goalId, nodeId, day, startMin)`, `scheduleTask(taskId,
date, startMin)`, `unscheduleNode`, `unscheduleTask`, `resizeNode`. All route through
`setPlannedSlot`. Existing `planNode`/`unplanNode` are replaced.

Views never call `db` directly and all mutations go through `actions` calling
`setAndPersist`, per the existing layer rules. Sidebar accordion open/closed state is
a **device preference**, not app data: it uses `set()` plus its own settings-table
save, exactly as `availability` and `allDayBlocks` do — never `setAndPersist`, and it
is not part of `AppState`.

## Behaviour

### `resolveSlot`

1. If the day has no availability window → refuse. Off days are hatched and
   non-droppable.
2. Build free intervals: the day's window, minus busy blocks, minus already-placed
   items. When `allDayBlocks` is on, an all-day event consumes the whole day.
3. If the day is today, the window starts at the current minute — hours that have
   passed are not schedulable. This reuses `capacity.ts`'s existing `Now` concept
   rather than reinventing it.
4. Discard intervals shorter than `durationMin`.
5. For each surviving interval, the candidate start is the aimed-at minute clamped to
   `[intervalStart, intervalEnd - durationMin]`. Choose the interval whose candidate
   is closest to the aimed-at minute. Ties break toward the earlier start.
6. **Revised while planning.** The aimed-at minute is rounded to the nearest
   multiple of 5 **before** the search, not after. Rounding the winner and then
   re-clamping is unsound: rounding up can push a block past the end of the very
   gap that accepted it, and a window starting at an off-grid minute can have no
   valid multiple-of-5 start at all. A result clamped to a gap edge may therefore
   be off-grid — deliberately, since a step butting against a meeting that ends at
   10:47 should start at 10:47 rather than waste three minutes.
7. If nothing fits → return `null`. The drop is refused, the block returns to the
   sidebar, and a toast explains why, with the number:
   *"No 1h 30m gap left on Wed — 45m free."*

An ⌥-drag escape hatch for forcing an exact, overlapping placement was considered and
cut. Snapping was chosen over precision, and busy blocks come from a calendar the user
cannot work through anyway. It remains addable later if snapping proves imprisoning.

Lane-splitting in `grid.ts` is still required regardless, because two Google calendar
events can genuinely overlap each other.

### The grid

- **Visible range** = the union of the week's availability windows and busy blocks,
  expanded outward to whole hours, then expanded again if necessary so that it always
  includes at least 08:00–20:00. It therefore never collapses to a sliver, and it
  grows — with scrolling — to cover a 07:00 lecture or a 22:00 window.
- **Now-line** — an accent rule across today's column, updated each minute.
- **Availability shading** — hours outside the window dimmed; off days hatched.
- **Capacity** is now exact rather than estimated, since every planned item has a real
  duration and position. Each day header carries its own remaining free time.
- **Past weeks** are viewable but not droppable, with a "back to this week"
  affordance.
- **Recap** is a dismissible panel at the top of the page, not a gate. It no longer
  blocks planning.

### Keyboard

`docs/feedback/2026-07-24-usability-experience-cs-student.md` records that the planner
is "a keyboard dead zone — and it's the app's whole point". As a real view:

- Focus a backlog item, press `1`–`7` → scheduled on that weekday, snapped, identical
  to a drop.
- `[` / `]` → previous / next week.
- `T` → back to today.

These preserve the current modal shortcut semantics without the modal. `4` opens Plan
during the parallel-build phase; after the flip Plan is the default view.

## Failure modes

| Situation | Behaviour |
|---|---|
| `hydration !== 'ready'` | Skeleton grid, dragging disabled |
| Every weekday set to off | Empty grid, "No working hours set" prompt linking to Availability |
| Google Calendar unavailable | Busy blocks empty, grid fully functional; the existing `hasData: false` honesty note already covers the capacity figure |
| Migration throws | Old data left intact, error surfaced; the pre-migration backup is already on disk |
| Second tab | Existing Web Lock banner, unchanged |
| Drop finds no fitting gap | Refused with a toast naming the free time available |

## Testing

`vitest` runs with `environment: 'node'` — there is no DOM — so coverage concentrates
in `src/lib`:

- **`slot.test.ts`** carries the weight: no-fit; exact-fit; aiming before, inside and
  after a busy block; today's already-passed hours; off days; `allDayBlocks` on and
  off; 5-minute rounding; tie-breaking.
- **`grid.test.ts`** — range derivation, minute↔pixel round-trips, overlap lanes.
- **`migrateSlots.test.ts`** — one case per migration table row, the "didn't fit"
  path, and idempotence: running the migration twice changes nothing.
- **Invariant test** — `plannedWeek === weekOf(plannedDay)` after every scheduling
  action.
- Components stay thin enough to be covered by `tsc -b` plus a manual smoke pass, as
  the rest of the app already is.

## Non-goals

- **No auto-fill / "plan my week for me" button.** Considered and declined: it makes
  the scheduling decisions for the user, and for a goals app the deciding is the
  point.
- **No recurring steps.** Raised in feedback, out of scope here.
- **No mobile/narrow layout.** Phase ships as a desktop Electron app.
- **No removal of `plannedWeek`.** See above — its own change, its own review.
- **No visual restyle.** Per `CLAUDE.md`, visual identity is locked; this is a layout
  and structure change within the existing palette and type scale.

## Constraints carried from CLAUDE.md

- New pure logic goes in `src/lib` with a sibling test file.
- Views stay thin and delegate to `actions`; views never touch `db`.
- `src/db/db.ts` remains the only module touching IndexedDB.
- Destructive edits stay undo-aware via `scheduleUndo`.
- `npm test` and `npx tsc -b` pass before every commit.
- `src/components/GoalTree.tsx` holds unrelated uncommitted work and must never be
  staged or modified.
