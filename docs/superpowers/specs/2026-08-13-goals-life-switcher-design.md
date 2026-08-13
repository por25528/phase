# Goals — the life switcher and the adaptive board

**Date:** 2026-08-13
**Status:** approved, ready for a plan
**Supersedes:** `ideas/vision.md` D-7's refusal of a board switcher (see §9)

---

## The problem

Two problems arrived together, and only one of them is about lives.

**The board does not know which life you are in.** Lives slice 1 shipped the
model — up to three named lives, a goal assigned to one, a chip on the card, an
editor in Settings — and then stopped. Nothing anywhere filters, groups or
counts by life. A person running a degree and a company sees one undivided pile
and a Now column capped at three, which is the complaint that started D-7:
*"right now the app forces me to choose only a few when there is more than 3
task for me to go through."*

**The board wastes three quarters of its width.** `grid-cols-4` gives every
horizon an equal share whether it holds five cards or none. In the state that
prompted this work — five goals, all in Someday — three columns render
`Nothing here` across 75% of a 1280px board while the fourth stacks five cards
in a single narrow file. The dead zone is structural, not cosmetic, and it is
the same geometry that sank slice 2a: *"each life got 93px of a 307px cell
while three empty horizons kept 307px each."*

## What this is not

Not the week budget. `WeekRecord`, per-life shares, `capacityMin` and the
budget line stay on the unmerged `lives-slice-2` branch. `weekCapacity`,
`isOverCommitted`, `plannedMin` and `backlogMin` are untouched. **Per-life
capacity remains refused** (D-7): you get one week and your lives share it.

Not a global mode. Today, Plan, the backlog rail and the Timeline's capacity
readouts show every life at once. One planning flow, one Today, one
over-commitment verdict. That half of D-7 survives intact and is not up for
negotiation in this slice.

Not a change to `Goal.type`. A template is not an organising dimension.

---

## 1 · Scope of the switch

The switcher scopes **the Goals page and nothing else**. Within that page it
scopes both view modes — Board and Timeline are two representations of the same
goals, and a Timeline that ignored the active life would disagree with the
board one click away.

Everything it scopes is on-page and derived:

| Surface | Scoped? | Why |
|---|---|---|
| Board columns | yes | the point |
| Timeline spans | yes | same goals, same page |
| `focusSummary` row | yes | it is a readout of the board beneath it |
| Unconfirmed-dates banner | yes | otherwise it counts goals you cannot see and `Review` walks to one that is not rendered |
| Completed section | yes | same |
| Today / Plan / backlog / capacity | **no** | one week, one Today |

## 2 · State

```ts
type LifeScope = 'all' | 'unassigned' | string; // string = a Life.id
```

`activeLifeId: LifeScope` joins `activeHorizon` and `goalsMode` in the store as
view state. It is **not** part of `AppState` and never rides in `persist()` —
which life you are looking at is not user content, exactly as `PlanMode` and
`GoalsMode` are not.

It persists across restarts through the `db.settings` table, mirroring
`GOALS_MODE_KEY` exactly: `loadGoalScope()` / `saveGoalScope()`, a total parse
with `'all'` as the default, and the write wrapped in `ifOwner` like every
other settings write.

**The stored id may dangle.** Delete the active life and the setting names
something that no longer exists. Every reader resolves that to `'all'` at read
time — the same licence `Goal.lifeId` and `Session.nodeId` already hold, and
what keeps `removeLife` a two-slice edit that rewrites no goal and needs no
change here.

## 3 · The pure logic

Two new modules in `src/lib`, each with a sibling test, per the house rule.

### `lifeScope.ts`

```ts
export type LifeScope = 'all' | 'unassigned' | string;
export interface LifeTab { scope: LifeScope; label: string }

resolveScope(stored: string | undefined, lives: Life[]): LifeScope
lifeTabs(lives: Life[], goals: Goal[]): LifeTab[]
goalsInScope(goals: Goal[], scope: LifeScope, lives: Life[]): Goal[]
nowLimit(scope: LifeScope, tabs: LifeTab[]): number
```

**`lifeTabs`** returns `All`, then each life in `sortedLives` order, then
`Unassigned` **only when at least one active goal is unassigned**. That is not a
new rule — it is precisely the semantics slice 1 wrote down for the
`groupByLife` it deliberately did not build: *a named life kept even when empty
(you made it), the unassigned group omitted when empty (it is not a life).*

**`goalsInScope`** resolves membership through `lifeOf`, so a goal pointing at a
deleted life is unassigned rather than invisible. `'all'` returns the input
untouched.

**`nowLimit`** is `NOW_WIP_LIMIT` (3) for any single tab. For `'all'` it is
**the sum of the caps of the tabs beside it**:

```ts
Math.max(NOW_WIP_LIMIT, NOW_WIP_LIMIT * (tabs.length - 1))
```

Two lives reads `2 / 6`; two lives plus loose goals reads `2 / 9`. The `max` is
load-bearing, not defensive: with no lives defined `lifeTabs` returns an **empty
array** (§6 — no tab bar renders at all), and the bare product would be `3 × -1`.
Clamped, the no-lives board reads `2 / 3`, byte-identical to today.

The rule is stated that way on purpose: the number on the `All` tab is always
the arithmetic of the tabs you can see, so it can be checked by eye rather than
believed. It does move when you add a life or empty the unassigned group. That
is honest — the groups on the board changed — and it is the cost of the summed
cap over showing no ratio at all.

### `boardTracks.ts`

```ts
columnTracks(counts: number[], opts: { dragging: boolean }): string
```

Returns a `grid-template-columns` value.

- **Dragging → four equal tracks.** Non-negotiable, see §4.
- **Otherwise** an empty column takes a fixed **88px** track; a populated column
  takes `minmax(200px, Nfr)` weighted by its card count.

Both numbers are pinned by test rather than by eye. **200px** is the largest
floor at which four populated columns still fit the 920px breakpoint where the
wide board begins: `4 × 200 + 3 × 14` gap `= 842`, leaving room for the page
gutter. The floor is what protects a one-card column from being crushed beside a
five-card one; the `fr` weights distribute only what is left over. **88px** is
the smallest track on which `Someday` — the longest horizon label — sets on one
line at `text-ui` beside its count.

`NOW_WIP_LIMIT` moves from a direct import in `Column.tsx` to a prop, and
`focusSummary` gains an optional third parameter defaulting to `NOW_WIP_LIMIT`,
so `slots.limit` can carry the scoped figure. Neither is a behaviour change at
the default.

## 4 · Drag, and why widths freeze

Proportional widths and drag-and-drop are in direct conflict: `handleDragOver`
already moves ids between columns live so cards part to show the drop target,
so a width that tracks card count would reflow continuously under the cursor —
and an empty Now, the single most important drop target on the board, would be
the narrowest thing on screen at the exact moment you need to hit it.

**On drag start every column expands to equal width; on drop they settle back.**
One transition at each end, not continuous reflow. The target you are aiming at
does not move while you aim at it, and the slim empty column becomes a
full-size target the moment something is in the air.

The transition is on `grid-template-columns` (animatable in Chromium, which is
what Electron ships) and is suppressed under `prefers-reduced-motion`, which the
view already reads.

Cards inside a wide column flow `repeat(auto-fill, minmax(…, 1fr))` — the
pattern `CompletedSection` already uses — so a 1000px Someday holding five
goals lays them out four across instead of in one long file. That means the
sortable strategy changes from `verticalListSortingStrategy` to
`rectSortingStrategy`, which handles a list and a grid alike. One strategy, no
branch on column width.

No `border-dashed` anywhere in this. It is the drop-preview signal and the
guessed-hour calendar block, and an empty column is empty.

## 5 · Two ordering bugs the scope introduces

Both paths that write board order were checked against a scoped board.

**`setGoalBoard` is already correct, and its helper is misnamed.** When the
board renders one life, `setGoalBoard` receives only that life's ids. It routes
them through `weaveCompleted`, which re-inserts *any* goal absent from the
incoming layout at the within-column index it held — not just completed ones.
Reordering University cards therefore preserves every Startup rank exactly.
Worked through: goals `[S1, U1, S2, U2, U3]` in one column, University
reordered to `[U3, U1, U2]`, yields `[S1, U3, S2, U1, U2]` — `S1` and `S2` back
at indices 0 and 2, the positions they held.

The function is renamed **`weaveHidden`** with its comment updated. It grew a
second reason to hide a goal today and "completed" now describes one of them;
a name that names the wrong half is how the next person writes the bug this
paragraph exists to say does not happen.

**`moveGoalRank` is wrong under scope.** It builds its neighbour list from every
active goal, so `Alt+↑` on a University card swaps it with whatever sits above
it in the full array — possibly a Startup card that is not on screen. The card
visibly does not move, and the toast says it did.

Fix: a pure `rankMoveTarget(list, visibleIds, goalId, delta): number | null` in
`board.ts`. It finds the goal's index among the **visible** ids, steps by
`delta`, and returns the index in the full list of the visible neighbour
landed on — so the card moves exactly one visible slot and every hidden goal
keeps its relative place. `null` at either end, which the store already
translates into `false`, which the view already reads as "do not ring the
card". The existing guard against announcing a move that did not happen keeps
working unchanged.

## 6 · The header

Today the page stacks a title, an explanatory paragraph, a segmented
Board/Timeline control, `Import goal` and `+ New goal` — and then a focus row,
and on narrow screens a horizon switcher — before the first card. Adding a
third segmented control to that is how a header becomes chrome soup.

**Title row.** `Goals` on the left. On the right, Board/Timeline becomes a quiet
icon toggle, plus a `⋯` menu.

The toggle stays a `SegmentedSwitch` at `sm` — the same component, the same
`aria-pressed` semantics, the same dense-toolbar size the Plan header and the
Timeline ruler already use — with its two text labels replaced by icons.
`Icons.tsx` has neither, so it gains **`IconColumns`** and **`IconTimeline`**,
Lucide-derived like the rest of the file and built through the shared `Icon`
wrapper so they inherit its `viewBox="0 0 24 24"`, `strokeWidth={1.8}` and round
caps without restating them.

Icons never carry the name — the file says so and enforces it with
`aria-hidden`. So each segment keeps a `title` for the pointer and the switch
keeps its `aria-label="Goals view"`, with each button labelled `Board` and
`Timeline` for the accessibility tree. An icon-only control that loses its
name is the failure mode this is worth guarding against, not a hypothetical:
these two are the only route between the page's two modes.

**`+ New goal` leaves the page header.** The top command shelf already carries
it with `⌘N`. Two identical primary buttons a hundred pixels apart is the
one-focal-point rule broken by duplication rather than by decoration.

**`Import goal` moves into the `⋯`**, beside a new **Manage lives…** that opens
the existing `LivesSettings` section in Settings. No second life editor: one
editor, reached from where the lives are now visible.

**Life tabs sit directly under the title**, as the page's primary axis. They
reuse the underline tablist `AreaPage.tsx` already implements —
`role="tablist"`, roving `tabIndex`, Arrow/Home/End, `border-accent` on the
selected tab. That markup is extracted into a shared `Tabs` component rather
than hand-rolled a third time; `SegmentedControl`'s own header records what
happened the last time four of these grew independently.

**With no lives defined, no tab bar renders.** A lone `All` tab is chrome that
explains nothing to a person who has never made a life. The `⋯` is the route
in.

**The two column hints go.** *"Quiet by design — schedule pressure is hidden off
Now / Next."* and *"Ideas — no 'define a task' nag until you commit them."* are
first-run explanation rendered on every visit forever. The header paragraph
above them already follows a `goals.length <= 1` rule for exactly this reason;
these never got it. The behaviour they describe is unchanged and still correct
— it simply stops narrating itself.

Below 920px the horizon switcher stays as it is, with the life tabs above it:
the primary axis on top, the horizon it is showing beneath.

## 7 · Edge cases

**Scoped-empty is not empty.** University holding nothing while Startup holds
five must not offer *"No goals yet… Load example"* — that onboarding state fires
on `goals.length === 0` across every life and stays that way. A scoped-empty
board says *"No goals in University yet"* with a `+ New goal`.

**Creating while scoped assigns.** `+ New goal` on the Startup board sets
`lifeId` to Startup. A goal created on one board that lands on another is a
lie, and the composer is already the place that knows.

**Long titles.** Cards already `line-clamp-3` with a `title` tooltip. Tab labels
truncate so a life named "Undergraduate Research Assistantship" cannot blow out
the strip; `MAX_LIVES` is 3, so the strip is at most five tabs wide.

**Deleting the active life** falls back to `All` through `resolveScope`, and the
15-second undo restores both the life and the scope's meaning, because no goal
was rewritten.

## 8 · Testing

Pure, in `src/lib`:

- `lifeScope.test.ts` — dangling id resolves to `all`; `Unassigned` appears only
  when populated and disappears when emptied; a named life survives being empty;
  `goalsInScope` treats a dangling `lifeId` as unassigned; `nowLimit` is 3 per
  tab, `3 × (tabs - 1)` for `all`, and 3 when no lives exist.
- `boardTracks.test.ts` — an empty column takes the slim track; weights follow
  counts; the floors of four populated columns fit 920px; `dragging` yields four
  equal tracks regardless of counts.
- `board.test.ts` — `rankMoveTarget` skips hidden goals, returns `null` at both
  ends of the visible list, and is unchanged when everything is visible;
  `weaveHidden` keeps its existing coverage under the new name.

Component:

- Tabs absent at zero lives; present and ordered otherwise.
- Scoped board renders only in-scope cards; Timeline likewise.
- **Reordering within one life leaves the other life's order untouched** — the
  regression that matters most, because it is silent.
- `Alt+↑`/`Alt+↓` step over off-screen cards and go quiet at the visible ends.
- Scoped-empty renders the scoped message, not the onboarding one.
- A new goal created under a scope carries that `lifeId`.

`designScale.test.ts` guards the styling as it already does. `npm test` and
`npx tsc -b` before every commit.

## 9 · The decision this overturns

`ideas/vision.md` D-7 refuses a global board switcher: *"A switcher is a device
for not seeing the collision, and the collision is the point."* The designed
alternative, D-16's budget line, was built as slice 2a and **failed when
rendered** — open question 3 records it: `BoardCard` needs 197–238px, every card
clipped, and the floor that makes small cards readable is the floor that makes
proportional height meaningless.

The switcher is adopted deliberately, with the reasoning recorded rather than
the refusal quietly deleted. `vision.md` is amended in the same change:

- **D-7** keeps *"boards split; the week never does"* and keeps per-life capacity
  refused. The no-switcher clause is struck, annotated with this spec and with
  the slice-2a result that removed the alternative.
- **Still refused** loses *"A global board switcher"* and keeps *"Per-life
  capacity"*, which this slice does not touch.
- **D-8** — the Now cap becoming hours — is deferred rather than delivered. Three
  per life is a rule you can feel, which is what D-8 said the hours had to
  replace and what the budget line failed to provide.

Leaving the doc claiming Phase refuses a switcher while Phase ships one is the
drift this codebase does not tolerate.

## 10 · Files

**New:** `src/lib/lifeScope.ts` + test, `src/lib/boardTracks.ts` + test,
`src/components/Tabs.tsx`, `src/views/goals/LifeTabs.tsx` + test.

**Modified:** `src/views/Goals.tsx`, `src/views/goals/Column.tsx`,
`src/components/Icons.tsx` (`IconColumns`, `IconTimeline`),
`src/lib/board.ts` (`weaveHidden`, `rankMoveTarget`), `src/lib/plan.ts`
(`focusSummary` limit param), `src/state/store.ts` (`activeLifeId`,
`setGoalScope`, `moveGoalRank`), `src/db/db.ts` (scope persistence),
`ideas/vision.md`, `CLAUDE.md`.

**Untouched:** every capacity, schedule and block module.
