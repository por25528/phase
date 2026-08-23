# Remove working hours

**Date:** 2026-08-23
**Status:** Approved, ready for planning

## Why

The availability model — `AvailabilityWindow[]`, seven per-day start/end times
— is being removed. The immediate complaint is the 45° hatch the week grid
draws over hours outside the window ("the line grid"), but the decision taken is
the whole model, not the marking.

Since availability stopped being a fence, it had exactly two remaining jobs:
it was the DENOMINATOR behind every capacity figure, and it was the AIM an
automatic placement pointed at. This spec removes the first and replaces the
second with a constant.

## What survives, in one sentence

The app reports what you have taken on. It no longer claims what fits.

## Decisions taken

1. **Working hours go entirely** — the model, the Settings editor, the hatch,
   and every figure derived from them. Not merely the hatch, and not a
   simplified "hours a day" denominator.
2. **The Plan header keeps `Planned` / `To place` / `Unestimated`.** Those come
   from blocks and estimates and never needed a window. It loses `9h left`,
   the seven-cell gauge, the meter bar, and the over-committed warn state.
3. **Today's free-time offer survives, re-based on empty gaps.** "A day with
   room" becomes "a day with an unbooked span long enough", computed from
   calendar events and placed sittings alone. The `no-hours` verdict is deleted;
   `no-room` survives and now means only "booked solid".
4. **`goalHealth` is dropped entirely.** No verdict word on any project surface.
5. **Automatic placement aims at a fixed daytime span in code** — an unexported
   `AUTO_SPAN` of 08:00–20:00 in `lib/slot.ts`, used only by replan, slot
   migration, and from-a-distance bookings. Never drawn, never in Settings,
   never a fence: a manual drag still lands at any minute of any day.

## Non-goals

- `.hatch` itself is NOT removed. It keeps its unrelated jobs on Today's frame
  and margins, and on the Goals board's bays and tails. Only `DayColumn`'s two
  strips go.
- Collision handling is untouched. `freeIntervals`, `resolveSlot`'s slide,
  `assignLanes`/`busyLayout`, `clampResize` and `describeNoRoom` all work from
  events and placed sittings, never from windows, and none of them changes.
- No data migration. No backfill, no cleanup pass, no schema version bump.
- No replacement for the lost over-commitment signal. The app will have none.

## Accepted consequences

Both were raised before approval and accepted:

- Dropping `goalHealth` removes the app's only "you have taken on too much"
  signal anywhere. Nothing warns that a deadline will not be met.
- The Plan header will never turn warn again. `isOverCommitted` is deleted, so
  no surface computes over-commitment.

## Module inventory

### Deleted outright

| Path | Note |
|---|---|
| `src/lib/availability.ts` | the model: `DEFAULT_AVAILABILITY`, `parseAvailability`, `serializeAvailability`, `windowForDate`. `MINUTES_PER_DAY` MOVES to `lib/capacity.ts` — it is a fact about a day, not about availability, and `lib/grid.ts` and `lib/slot.ts` both need it once `timeInput.ts` is gone. |
| `src/lib/health.ts` | `goalHealth`, `Health`, `HEALTH_WORD`, `HEALTH_TONE`, `TIGHT_BUFFER` |
| `src/lib/dayGauge.ts` | draws the window's hull; nothing else consumes it |
| `src/views/today/DayGauge.tsx` | the renderer |
| `src/views/plan/AvailabilityModal.tsx` | the editor dialog |
| `src/views/plan/AvailabilitySettings.tsx` | its body |
| `src/views/plan/timeInput.ts` | parses/formats a window's start and end; no other caller |
| `src/components/SettingsModal.tsx` | `AvailabilitySettings` is its entire body |

`src/views/plan/CapacityMeter.tsx` is stripped rather than deleted: the bar
(`capacityMeter`) and the gauge (`dayGaugeCells`) go, the labelled cells and the
unestimated button stay. It is **renamed `LoadRule.tsx`** — `CapacityMeter`
names the thing being deleted, and leaving the old name on the survivor is how
the next reader goes looking for a bar that is not there.

`src/components/Icons.tsx`'s `IconClock` SURVIVES — `App.tsx` and `TaskPage`
both use it. Only its doc comment ("the availability window everything free is
measured against") is rewritten.

### Re-based

**`src/lib/capacity.ts`**
- `CapacityInput` drops `windows`.
- `DayCapacity` and `WeekCapacity` drop `freeMin`.
- `remainingSpan`, `remainingWindow`, `freeMinutes` and `capacityBefore` delete
  — every one of them exists to price a window.
- **`NO_PAST_LIMIT` SURVIVES.** It looks like part of the free-minutes tense
  rule, and it is, but it is also what every manual placement path passes as
  its clock: `scheduleActions`' resize, `store.ts`'s three `freeIntervals`
  calls, `previewPlacement`, and `migrateSlots`. Deleting it would silently
  turn "resizing something already on the grid is an adjustment" into "you
  cannot resize a block that started an hour ago". It stays in `capacity.ts`
  and stays re-exported from `slot.ts`; only its doc comment loses the window
  framing.
- `MAX_FORECAST_DAYS` deletes with `capacityBefore`, verified as its only
  production caller. Two test files reference it and are amended below.
- Kept whole: `Now`, `Interval`, `mergeIntervals`, `normalizeEstimate`,
  `Workload`, `workloadOf`, `isPlacedLeaf`, `isPlacedTask`, `blockedBy`,
  `plannedMin`, `backlogMin`, `unestimated`, `hasData`.
- Gains `MINUTES_PER_DAY`.

**`src/views/plan/capacityLabel.ts`**
- Deleted: `weekFreeSplit`, `isOverCommitted`, `capacityMeter`, `MeterGeometry`,
  `dayGaugeCells`, `DayGaugeCell`.
- `CapacityFigures` drops `freeMin`.
- `loadParts` drops its leading `Nh free`; it can now return `[]`.
- `weekLoadCells` drops the `Free`/`Left`/`Spent` branch entirely and needs no
  `today` argument. It returns `Planned` and `To place` only. **`head` moves to
  `Planned`** — `head` is spent exactly once per readout and the week is now
  planned against what is on it. On a week with nothing planned and nothing
  committed it returns `[]`, and the header then renders the stamp and the
  range alone; that is correct, not a hole to fill.
- `weekLoadParts` stays a one-line map over `weekLoadCells`.
- `dayLoadLabel` becomes `formatMinutes(plannedMin)` alone — the `x / y` form
  had free as its denominator. Still `null` when nothing is planned and nothing
  is committed.
- `dayLoadHint` drops its `— over-committed` suffix. Callers must pass
  `undefined` for `title` when `capacityParts` comes back empty, rather than
  setting an empty tooltip.
- Kept: `formatMinutes`, `capacityParts`, `unestimatedLabel`, `capacityNote`
  (that one is about calendar cache coverage, not about hours).

**`src/lib/slot.ts`**
- `aimFor(date, windows, now)` → `aimFor(date, now)`, resolved against a new
  unexported `AUTO_SPAN = { startMin: 480, endMin: 1200 }`.
- `WHOLE_DAY` unchanged and still what every manual path passes.
- `freeIntervals`, `resolveSlot`, `durationOf`, `PlacedSpan` unchanged.

**`src/lib/todayPlan.ts`**
- `nextFreeDay` drops `windows` and re-bases: the first date within
  `PLAN_DAY_HORIZON` whose `freeIntervals` over `WHOLE_DAY`, minus events and
  placed sittings, contains a gap at least as long as the item's duration.
- `TodayPlan`'s `no-hours` variant deletes. `no-room` survives, and its sentence
  is rewritten — it used to mostly mean the day was closed and now means only
  that the day is booked solid.
- `FreeDay` drops `freeMin`.
- `PROPOSAL_MAX`, `proposalRows`, `dayLabel`, `dayVerb`, `offerHeading`
  unchanged.

**`src/lib/replan.ts`** — `ReplanInput` drops `windows`; the one placement that
passed `windowForDate(date, windows)` passes `AUTO_SPAN`. The real clock is
still passed; that half of the rule is unchanged.

**`src/lib/migrateSlots.ts`** — same substitution. It keeps its degrade-to-a-week
behaviour for a day with no time.

**`src/lib/grid.ts`** — `initialScrollWindow` drops `windows` and scrolls to the
union of the week's PLACED BLOCKS, falling back to `AUTO_SPAN` when the week is
empty. Imports `MINUTES_PER_DAY` from `capacity.ts`.

**`src/lib/executionAdvisor.ts`** — `ExecutionAdviceInput` drops `availability`;
its `no-hours` verdict deletes. The `seen`-set contract with `Today.tsx` is
unchanged.

**`src/lib/planHint.ts`** — `showPlanHint` drops `hasAvailability`. Two
conditions remain: nothing has ever been placed, and there is something to
place.

**`src/lib/todaySurface.ts`** — `attentionItems` drops `windows`; the
`goalHealth` verdict on each row goes with it. Anything typed as `Health` in its
return shape deletes.

**`src/lib/agentReads.ts`** — stops publishing `availability`; `week` returns the
narrowed `WeekCapacity`. **This changes the MCP payload shape**, so the server
needs a rebuild and Claude Code a restart before the new field set is visible.

**`src/state/store.ts`** — `AppState.availability` and its initial value delete;
hydration stops loading it; `setAvailability` deletes. The `windowForDate` call
in the replan path becomes `AUTO_SPAN`. `describeNoRoom` is untouched.

**`src/db/db.ts`** — `loadAvailability`/`saveAvailability` delete; the
`availability` settings row is no longer read or written. `exportBackup` stops
emitting the key. `importBackup` IGNORES it if an old backup carries one — no
migration, no cleanup; a stale settings row is inert, the same licence a
dangling `Session.nodeId` has.

**`src/db/types.ts`** — `AvailabilityWindow` deletes.

**`src/lib/commands.ts`** — the `settings` verb ("Working hours") deletes.

### View changes

| Path | Change |
|---|---|
| `views/plan/DayColumn.tsx` | both `.hatch` strips and the `availabilityWindow` prop go; the column is plain from top to bottom |
| `views/plan/WeekGrid.tsx` | drops `windows`; day headings lose `isOverCommitted` and the `full`/over tone; `dayLoadLabel` now prints planned minutes alone |
| `views/plan/WeekHeader.tsx` | renders `LoadRule` without the bar or the gauge; `weekLoadCells` loses its `today` argument |
| `views/plan/MonthGutter.tsx` | the per-week bar (`capacityMeter`) goes; the gutter states the row's planned minutes as text |
| `views/plan/MonthCell.tsx` | `over` deletes; the cell keeps its planned figure and its `dayLoadHint` tooltip |
| `views/plan/monthCapacity.ts` | sums the same narrowed rows; drops `windows` |
| `views/plan/PlanNotice.tsx` | `needsHours` and `onOpenSettings` go; it reduces to the placement hint |
| `views/Plan.tsx` | drops `availability` from the store read and from every memo dependency |
| `views/Today.tsx` | the `DayGauge` render goes; `dayGauge` import goes; store read and memo deps drop `availability` |
| `views/project/CalendarTab.tsx` | drops `windows` and `scrollWindow`'s availability argument |
| `views/project/OverviewTab.tsx` | the `goalHealth` verdict and its chip go |
| `views/project/ProjectHeader.tsx` | same — the header states remaining effort and the deadline as plain facts |
| `views/project/ProposalPanel.tsx` | `freeDay` drops `freeMin`; the row names the day, not the hours |
| `views/project/TaskPage.tsx` | `aimFor` loses its windows argument; `nextFreeDay` call re-based |
| `components/SchedulePopover.tsx` | `aimFor` loses its windows argument |
| `components/assistant/AssistantHost.tsx` | drops `availability` from the snapshot input |
| `App.tsx` | `SettingsModal` render and `openSettings`/`closeSettings` wiring go |

## Sequencing

Three commits, each of which compiles and passes `npm test` on its own.

**Commit 1 — drop the verdicts.** Delete `health.ts`, `dayGauge.ts`,
`DayGauge.tsx` and every consumer of them: `OverviewTab`, `ProjectHeader`,
`todaySurface`'s verdict, `Today.tsx`'s gauge. Availability still exists and
still prices `weekCapacity`; nothing else moves.

**Commit 2 — re-base the survivors.** `weekCapacity` and `DayCapacity` drop
`freeMin`; `capacityLabel` loses its free half and `CapacityMeter` becomes
`LoadRule`; `monthCapacity`, `WeekHeader`, `WeekGrid`, `MonthCell`, `MonthGutter`
follow. `todayPlan` re-bases on gaps. `slot.ts` gains `AUTO_SPAN` and `replan`,
`migrateSlots`, `grid` and the store's replan path spend it. After this commit
the only remaining readers of `AvailabilityWindow` are the editor, the store
field, and persistence.

**Commit 3 — delete the model.** `availability.ts`, the type, `AppState.availability`,
`setAvailability`, the db settings row, the backup key, `AvailabilityModal`,
`AvailabilitySettings`, `timeInput.ts`, `SettingsModal`, the `settings` command,
`PlanNotice`'s `needsHours`, `planHint`'s gate, `agentReads`' `availability`.

Stopping after commit 2 leaves a coherent app; stopping after commit 1 does too.

## Testing

**Delete:** `availability.test.ts`, `health.test.ts`, `dayGauge.test.ts`,
`timeInput.test.ts`, `CapacityMeter.test.tsx`'s bar and gauge cases.

**Amend, dropping free-time assertions:** `capacity.test.ts`,
`capacityLabel.test.ts`, `slot.test.ts`, `todayPlan.test.ts`,
`monthCapacity.test.ts`, `DayColumn.test.tsx`, `executionAdvisor.test.ts`,
`todaySurface.test.ts`, `migrateSlots.test.ts`, `WeekHeader.test.tsx`,
`MonthCell.test.tsx`, `planner.test.ts`, `agentReads.test.ts`,
`store.previewPlacement.test.ts`, `scheduleActions.test.ts`,
`Project.progress.test.tsx`.

**New coverage — four claims:**
1. `nextFreeDay` finds a day by its unbooked gaps, with no window concept in the
   input at all, and refuses a day whose gaps are all shorter than the item.
2. `AUTO_SPAN` keeps an automatic replan inside 08:00–20:00 on a clear day.
3. A manual drag still lands at 02:00 — `AUTO_SPAN` is not a fence.
4. `weekLoadCells` returns `[]` on an untouched week and marks `Planned` as
   `head` when there is anything to state.

**Unchanged and worth asserting stay green:** collision, lane assignment,
`clampResize`, `describeNoRoom`'s three callers.

## CLAUDE.md

Four invariants become false and are REWRITTEN, not deleted:

1. The "Availability is a DENOMINATOR and an AIM" bullet — rewritten around
   `AUTO_SPAN` and the fact that nothing is priced against a window any more.
2. The "capacity BAR and the capacity TEXT are one derivation" bullet — the bar
   is gone; what survives is the rule that two compared numbers must cover the
   same days.
3. The "Plan header is an instrument" bullet — four bands become three, and the
   gauge paragraph goes.
4. The "day gauge draws; it does not judge" bullet — deleted, with a line
   recording why, since its `null`-on-no-window discipline is cited elsewhere.

The `no-forecast` / `no-hours` distinction is cited in three further bullets
(`todayPlan`'s offer, `focusLens`, the goal-header effort/health pair) and has
to be unpicked from each rather than left dangling at a deleted concept.

## Verification

`npm test` and `npx tsc -b` green after each of the three commits. Then a manual
pass: Plan week and month, Today with and without work, a project header, a
replan, a drag onto 02:00, and the MCP `week` verb after a rebuild and restart.
