# Plan page UI — hierarchy, density, and a load readout that covers both modes

**Date:** 2026-08-16
**Status:** approved, ready for planning

## The problem

The Plan view is the app's primary working surface — every drag onto the
calendar starts in its rail — and it currently reads as unfinished in five
specific ways. None of these is a taste complaint; each is a rule the app
states somewhere and then breaks here.

1. **The page has no focal point.** The heading (`WeekHeader.tsx:67`) renders
   as `sectionLabel` — 11px mono uppercase muted, the app's *smallest* type
   role. It is tied for last place with `TO PLAN` and `HABITS`. Nothing on the
   page is first.

2. **The header is two clusters at opposite extremes with nothing between
   them.** At 1960px that is ~1500px of dead centre.

3. **Month mode reports no capacity at all.** `WeekHeader` guards every figure
   behind `!isMonth`, so half the view answers nothing. The guard's comment is
   correct about *why* (`"A month's capacity is a different computation"`) but
   the outcome is that the question a planner exists to answer goes unanswered
   for half its modes.

4. **Month cells are ~117px of air holding one 14px chip.** `GRID_VIEWPORT_PX`
   is 720 over 6 rows; `MONTH_CHIP_CAP` is 3 and typical usage shows 1.

5. **The only solid-black button on the page is `+ Habit`**
   (`Habits.tsx:361`), spent on the least important action on the surface —
   while `App.tsx:475` documents its own `+ New task` as *"The one filled
   control in the header, and the only one that writes anything."* The page
   violates an invariant the codebase states in a comment.

## Decisions taken before design

- **The warm editorial identity stays.** No token changes, no palette shift.
  "Feels like a strong SaaS product" is read as *finished and dense*, not
  *neutral grey*. `designScale.test.ts` and `paletteContrast.test.ts` stay
  green with no edits.
- **Month's job is a load overview that routes into Week.** Planning happens
  in Week, where the time axis is. Month answers "which weeks am I
  underwater?" and gets you there.

## 1. Header — `WeekHeader.tsx`

Three zones replace two: **title · meter · controls**.

**Title.** `text-h1` (19.6px) semibold, `font-ui`. Explicitly *not* `font-disp`
— `designScale.test.ts` permits the serif in exactly three places (wordmark,
`TaskPage` title, note headings) and this is not one of them. Explicitly not
`text-page` either; that role belongs to a document's own title.

**Meter.** A 6px stacked bar sitting over the three figures it summarises.
Segments are `plannedMin` and `backlogMin`; the track is `freeMin`. The
`unestimated` count stays a control (dotted underline, opens
`UnestimatedPanel`) exactly as today.

The load-bearing rule: **the bar and the text are one function.** A new
`capacityMeter(c)` in `capacityLabel.ts` returns segment fractions plus an
`over` flag, and the component renders only what it returns.

```ts
export interface CapacityMeter {
  plannedFrac: number;  // 0–1 of the bar's width
  backlogFrac: number;  // 0–1 of the bar's width
  /**
   * Where free time runs out, as a fraction of the bar. Rendered as a hairline
   * tick, and ONLY when `over` — on a healthy week it would sit at 1.0, which
   * is the bar's own right edge and therefore says nothing.
   */
  capacityMarkFrac: number;
  over: boolean;        // === isOverCommitted(c), asserted in tests
}
export function capacityMeter(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'>,
): CapacityMeter
```

**The bar spans `D = max(freeMin, plannedMin + backlogMin)`, not `freeMin`.**
That one choice makes every case well-defined without overlapping segments:

- *Healthy* — `D` is `freeMin`, the two segments fill part of the track, the
  remainder is visibly the free time left. `capacityMarkFrac` is 1.0 and is not
  drawn.
- *Over* — `D` is the committed total, so the segments fill the whole bar and
  turn `bg-warn`. `capacityMarkFrac` is `freeMin / D`, drawn as a hairline tick
  showing exactly how far past capacity the week runs.

Segments never overlap and never exceed the bar, so there is no clamping and no
undefined case. `freeMin === 0` with nothing committed gives `D === 0`, which
returns all-zero fractions and `over: false` — the empty-availability state,
where the notice slot (§5) is already saying the real thing.

`over` is derived from `isOverCommitted(c)` rather than recomputed, and a test
asserts the identity across a table of inputs. This is what stops the bar
reading full while the text reads healthy — the same "two numbers you plan
against cannot disagree" failure the planned/to-place split already exists to
prevent.

The tense split is preserved: the text stays `weekLoadParts(capacity, today)`,
which already renders `19h left · 12h spent` on a part-elapsed week and
collapses to a bare `19h free` on a future one. The meter's denominator is
`freeMin` — the *same* figure `isOverCommitted` compares against — so the bar
and the verdict cover the same days. Using `leftMin` as the denominator would
be more intuitive and would make the bar disagree with its own warn state on
any day but Monday; it is deliberately not done.

**Colour.** The bar is `bg-accent` (planned) and `bg-faint-2` (to place) over a
`bg-track` rail. `bg-warn` appears **only** when `over`. That is the single
place colour carries meaning in this header.

**Controls.** `SegmentedSwitch` unchanged. The `‹ today ›` glyph run becomes a
joined bordered nav group: `IconChevronLeft`, `Today`, `IconChevronRight`.
`IconChevronLeft` does not exist yet and is added to `Icons.tsx` beside
`IconChevronRight`, stroke-matched to the existing set. `today` is capitalised
— it is a control, and the rest of the app's buttons are.

## 2. Month capacity — the scoping invariant

`WeekHeader` hides month figures today, and its reasoning is sound: a week
straddling two months has no unambiguous owner for its week-committed work,
because `plannedLeaves` bills a leaf to `plannedWeek` and a week is not inside
one month.

**The month meter is the sum of the week rows the grid draws.** Not the
calendar month.

Consequences, all of them the point:

- The gutter rows (§3) sum *exactly* to the header meter. They cannot disagree,
  structurally, because they are the same numbers added up.
- Week-committed work is billed to its own week — the only place it has a real
  claim.
- **`capacity.ts` is untouched.** It is `weekCapacity` called once per grid row
  (5–6 calls of existing, tested code), memoised on `[goals, tasks, ym,
  availability, allDayBlocks]` exactly as `Plan.tsx` already memoises
  `scheduledByDay`. The aggregation lives in a new
  `src/views/plan/monthCapacity.ts` — the plan view's own folder, beside
  `capacityLabel.ts`, for the same reason: it is a *presentation* of capacity
  for one surface, not a new fact about time. It returns the per-row
  `WeekCapacity[]` and their sum, so the gutter and the header read the same
  array.
- The meter names its span (`Jul 27 – Sep 6`) in a mono caption, so it can
  never be misread as "August". The title says August because that is what you
  are navigating; the meter says what it covers. Two units, both labelled.

**Rejected alternative:** refactoring `weekCapacity` into a
`daysCapacity(dates, …)` primitive so the meter could cover Aug 1–31 exactly.
Cleaner in the abstract, but it forces a ruling on which month owns a
straddling week's commitments, and *any* ruling makes the gutter stop summing
to the header — trading a labelling problem for an arithmetic one.

## 3. Month grid — `MonthGrid.tsx`, `MonthCell.tsx`

**Cell.** Height drops from ~117px to ~86px. The date number moves from centred
to left-cornered (calendars align dates to a corner). Today becomes a filled
`bg-ink` pill rather than accent-coloured text — consistent with the app
spending solid ink on exactly one mark per surface.

**Per-day load.** A mono figure opposite the date: `formatMinutes(day.plannedMin)`,
`text-warn font-semibold` when `isOverCommitted(day)`, with `dayLoadHint(day)`
as the `title`. Deliberately *not* `dayLoadLabel`, which returns `1h 30m / 6h`
— too wide for an 86px cell. Null when the day has nothing planned and is not
over-committed, matching `dayLoadLabel`'s existing silence rule so an empty day
stays empty.

`MONTH_CHIP_CAP` stays 3, and the `+N more` row is unchanged.

**Week gutter.** A new 44px left column, one cell per grid row:

- `W32` in mono micro,
- the week's total planned time,
- a 26px load bar, warn when that week is over-committed.

Hovering tints the whole row; clicking sets `planMode: 'week'` and `weekStart`
— the identical pair `onOpenDay` already performs. The gutter is a second
caller of an existing behaviour, not a new one. This also gives Month a second,
closer route into Week than the top-right switch.

The gutter is a `<button>` per row with an accessible name naming the week and
its load, so the route is reachable without a pointer.

## 4. The rail — `Backlog.tsx`, `PlanSidebar.tsx`, `Habits.tsx`

**Section header** carries count *and* total time (`4 · 3h 20m`), the time
derived from the same `weekCapacity` the header meter uses — not re-summed
locally, or the rail and the header would drift.

**Project spine.** Each group gets a 2px left border in its own hue via a new
`projectSpineClass(goalId)` in `projectColour.ts`, beside the existing
`projectBlockClass`. Same hash, same six `proj-*` tokens, no new palette — so
`projectColour.test.ts`'s contrast assertions cover it unchanged. The rail and
the calendar become visibly one system: you can see which project a row will
become before you drag it.

**The permanent grip is deleted.** `Backlog.tsx`'s current comment argues for it
at length — that `cursor-grab` "only says it once the pointer is already on the
row". That reasoning holds, but the spine now carries the same signal
statically *and* groups the rows, and the first-run hint (`showPlanHint`) still
states both routes in a sentence. Removing `IconGrip` reclaims ~18px of a 249px
row, which is the difference between one line and two for most titles. The
`Backlog.tsx` doc comment is rewritten to record this reversal and its reason.

**Row `⋯` menu.** Delete moves off the row into a menu, per the de-cluttering
rule. This is a **new** `lib/backlogRowActions.ts` + `BacklogRowMenu` on the
existing `Popover`/`PopoverItem` primitives — **not** a reuse of
`RowActions.tsx`, which takes a `GoalNode` and offers indent/outdent/breakdown.
Those are tree verbs and the rail holds two kinds of item. The split mirrors
`rowActions.ts`/`RowActions.tsx` (pure verb list, tested without mounting;
component binds to the store), which is the same split `commands.ts`/`App.tsx`
uses.

Three verbs, so that **every row's menu holds two** — a menu with one item in it
is worse than the `×` it replaced, which is the trap this section exists to
avoid:

| Verb | Applies to | Action |
|---|---|---|
| Schedule… | both kinds | opens the existing `ScheduleMenu` (`SchedulePopover.tsx`) |
| Open in project | goal leaves (`goalId` present) | `openProject(goalId, id)` |
| Delete | loose tasks only (`kind === 'task'`) | `removeTask(id)` |

`Schedule…` is the verb that makes the menu worth having, and it needs **no new
store action**: `ScheduleMenu` already resolves to `scheduleTask`/`scheduleNode`,
which already arm undo for a distance booking and already refuse via
`describeNoRoom`. It is also the rail's first *visible* route onto the
calendar — today the only ways are dragging and the undiscoverable `1`–`7`,
which is precisely why `showPlanHint` has to exist to explain them in a
sentence.

`Delete` staying loose-task-only preserves the existing rule that a goal's task
is deleted in the Goals view, where its tree is visible. `Open in project` is
new capability, not a move: a rail row currently has no route at all to the
thing it belongs to.

No verb here needs a new undoable mutation — the `CLAUDE.md` test for whether a
menu change is secretly a feature. `Schedule…` and `Delete` reuse actions that
already arm their own undo; `Open in project` writes nothing.

The checkbox **stays on the row**. Ticking is the app's single gesture for
completion and the row keeps controls that are also readouts — the estimate,
the due chip, and the checkbox.

**`+ Habit` → ghost button** (`border-line-2`, `bg-panel`, `text-ink-soft`),
labelled `New habit` with an `IconPlus`. This restores `App.tsx:475`'s stated
invariant that the app header's `+ New task` is the one filled control. Same
change applies to the other two `bg-ink` buttons in `Habits.tsx` (lines 97,
204) — they are inside the same rail and compete for the same reason.

**Empty states.** The italic prose (`No habits yet. Add one to start a
streak.`) becomes a plain `text-muted` sentence. Not `text-faint`: it fails AA
and `CLAUDE.md` reserves it for decorative marks. Copy states what the thing is
rather than that it is absent, since the button beside it already offers the
action.

## 5. Smaller corrections

**Skeleton.** `Plan.tsx:527`'s `Loading…` becomes a rail + grid skeleton
following the `AssistantSurface.Skeleton` pattern — `bg-fill` surfaces,
`role="status"`, an `aria-label` naming what is loading. The recent shelf
commit established the rule this follows: *a skeleton is a surface, not three
bars of ink*, so it mirrors the real layout's two columns rather than stacking
generic bars.

**Notice slot.** The availability banner and the plan hint are currently two
identically-styled bordered boxes that can render stacked, pushing the grid
down. They collapse into one slot showing at most one notice, availability
taking precedence — it describes a state that makes the hint's advice
impossible to follow.

**Destructive friction: deliberately not added.** The brief asks for two-step
typed confirmation on destructive actions, scoped to "deleting a
project/database". The only destructive action on this page is deleting one
loose task, and the app's answer is the 5-second undo that `CLAUDE.md` treats
as a load-bearing invariant across every destructive edit. A typed modal for
one task would be worse than what exists, and would make this page disagree
with every other surface.

## Invariants this introduces

Candidates for `CLAUDE.md` once shipped:

1. **The capacity bar and the capacity text are one function.** `capacityMeter`
   derives `over` from `isOverCommitted` rather than recomputing it, and the
   meter's denominator is `freeMin` — the same figure the verdict compares
   against — never `leftMin`.
2. **Month's meter is the sum of the week rows drawn, and says so.** The gutter
   sums to the header by construction. The title names the month; the meter
   names its span. `capacity.ts` gains nothing.
3. **The rail's `⋯` is not the tree's `⋯`.** `backlogRowActions` is its own
   verb list because the rail holds two kinds of item and none of the tree's
   structural verbs apply to a flat list. Its verb set is sized so every row
   shows at least two — a one-item menu is a worse `×`.
4. **One filled control per screen, and it lives in the app header.** Restated
   from `App.tsx:475`, now actually true on Plan.

## Testing

- `capacityLabel.test.ts` — `capacityMeter`: segments never exceed the bar,
  `over` matches `isOverCommitted` over a table, `capacityMarkFrac` is 1.0
  exactly when not over, and the `freeMin === 0` / nothing-committed case
  returns zeros rather than `NaN`.
- New `src/views/plan/monthCapacity.test.ts` — the per-row figures sum to the
  returned total (the §2 invariant, asserted directly); a week straddling two
  months is counted once and in its own row; a 5-row month and a 6-row month
  both aggregate correctly.
- `MonthCell.test.tsx` — load figure present/absent per the silence rule, warn
  state, left-cornered date, today pill.
- `MonthGrid.test.tsx` — gutter renders one row per week, click routes to Week
  with the right `weekStart`, accessible name names the week.
- New `backlogRowActions.test.ts` — Delete offered for loose tasks only; Open
  in project offered for goal leaves only.
- `WeekHeader` — figures render in **both** modes; meter and text agree.
- `designScale.test.ts`, `paletteContrast.test.ts`, `projectColour.test.ts`
  must stay green untouched. If any needs editing, the change is wrong.

## Delivery — four commits, each green on its own

1. `capacityMeter` + header rebuild (title, meter, nav group,
   `IconChevronLeft`).
2. Month capacity per week row + gutter + cell density and load figure.
3. Rail: project spine, grip removal, `backlogRowActions` + `⋯`, button
   demotion, empty-state copy.
4. Skeleton + single notice slot.

## Out of scope

- Week grid internals (`WeekGrid`, `DayColumn`, `EventBlock`, `DayBlocks`) —
  they inherit the header and nothing else.
- `RecapPanel`.
- Any change to `capacity.ts`, the token scale, or the palette.
- Rail width. It is 249px and `CLAUDE.md` documents downstream code measuring
  it; widening it is a separate change with its own blast radius.
