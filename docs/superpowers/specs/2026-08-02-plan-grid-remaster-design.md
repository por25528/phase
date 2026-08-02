# Plan Grid Remaster Design

**Date:** 2026-08-02
**Status:** Approved, ready for planning

## Goal

Rebuild the Plan week grid as a real calendar: constant scale with a scrolling
day, direct manipulation on the canvas, project identity in colour, and the
week's unplaced commitment drawn on the grid rather than reported as a number
beside it.

## Scope

Modified: `src/lib/grid.ts`, `src/views/plan/WeekGrid.tsx`,
`src/views/plan/DayColumn.tsx`, `src/views/plan/DayBlocks.tsx`,
`src/views/plan/EventBlock.tsx`, `src/views/plan/dropTarget.ts`,
`src/views/plan/capacityLabel.ts`, `src/views/plan/PlanSidebar.tsx` (the rail
becomes a droppable), `src/views/Plan.tsx`, `src/state/store.ts` (two new
actions), `src/index.css`, `tailwind.config.js`, and
`src/lib/designScale.test.ts`.

New modules — three pure, three components:

| Module | Holds |
|---|---|
| `src/lib/projectColour.ts` | id → palette index, and the static class-name array (§3.2) |
| `src/lib/weekGutter.ts` | The gutter's membership rule, derived to agree with `backlogMin` (§4.2) |
| `src/lib/canvasCreate.ts` | Pointer-span → snapped `{startMin, durationMin}`, so the geometry is testable without a DOM |
| `src/views/plan/BlockComposer.tsx` | The inline title field and its commit/cancel rules (§2.2) |
| `src/views/plan/WeekGutter.tsx` | The band and its draggable rows |
| `src/views/plan/AllDayLane.tsx` | Checkpoints and deadlines (§4.3) |

Out of scope, deliberately: ghost auto-place, the now-band and its start/stop
control, estimate-vs-actual rendering, multi-select on the grid, a day/3-day
view, mobile-specific layout, Google Calendar pull, and any change to
`Session` — which remains undecided and is not touched here.

## Decisions taken

| Question | Decision |
|---|---|
| Grid scale | Constant `PX_PER_MINUTE`, full 24h day, vertical scroller |
| Density | 1px per minute — identical to today's default, so the visual identity is unchanged |
| `visibleRange` | Demoted to `initialScrollWindow`; its `spans` parameter deleted |
| Snap grain | 5 minutes — the existing `SLOT_GRANULARITY_MIN`, unchanged |
| Drag on empty canvas | Creates a loose `Task`, named in an inline composer |
| Click on empty canvas | Same, at `DEFAULT_SLOT_MIN` |
| Top-edge resize | Yes — one new action, `resizeFromStart` |
| Unschedule by drag | Onto the rail only. Dropping on empty space does nothing |
| Colour | Hybrid: project identity on the 3px rail, state on the fill |
| Colour assignment | Auto, hashed from `goal.id`. No picker |
| Capacity temperature | Column wash, **replacing** the today tint |
| Gutter contents | Exactly `capacity.backlogMin` — committed to this week, not placed |
| All-day lane | Ships with checkpoints and deadlines as its producer |
| Motion | A named duration/easing scale, guarded by `designScale.test.ts` |
| Week change | Cross-fade, not slide |

## Motivating problems

Each is observable in the current build:

- The grid is a fixed `GRID_HEIGHT_PX = 720` and `visibleRange` widens the hour
  range to swallow outliers (`grid.ts:36–66`), so scheduling one 07:00 block
  compresses every other block on the week.
- The canvas is inert. `DayColumn` is a droppable and nothing else; there is no
  way to create work from the calendar.
- `aimMinuteFor` computes the exact minute a drag is targeting
  (`dropTarget.ts:25–35`) and nothing renders it, so every drop is blind.
- Every block is the same white rectangle with the same accent stripe
  (`EventBlock.tsx:106–110`), so a week reads as text to scan rather than shape
  to recognise.
- `weekCapacity` returns a full `DayCapacity` per day and only a 7px mono chip
  consumes it (`capacityLabel.ts:99–103` records this).
- `backlogMin` — the week's committed-but-unplaced work — is rendered as the
  string `2h to place` in a header, adjacent to a visibly empty grid.
- There is no motion system: 37 `transition` usages across the app, no duration
  or easing tokens, and `tailwind.config.js` extends neither.

---

## Part 1 — Geometry

### 1.1 The constant

```ts
export const PX_PER_MINUTE = 1;
export const DAY_START_MIN = 0;
export const DAY_END_MIN = 1440;
export const DAY_HEIGHT_PX = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MINUTE;
```

`GRID_HEIGHT_PX` (`WeekGrid.tsx:17`) is deleted, along with the `gridHeightPx`
prop threaded through `WeekGrid` → `DayBlocks` → `EventBlock`. Block height is
now a property of the block's own duration rather than of the week it sits in,
so `EventBlock`'s compact-layout decision becomes
`durationMin * PX_PER_MINUTE < COMPACT_BLOCK_PX` with no prop involved.

`PX_PER_MINUTE = 1` is chosen so the rendered density is **exactly** today's
default: the current grid is 720px for a 480–1200 range, which is already
1px/minute. Nothing about the visual identity changes; only outlier weeks stop
compressing. A 5-minute snap is 5px, and the existing 40px compact-layout
threshold still means "under 40 minutes", as it does today.

`minuteToPx` is the identity function at this scale. It exists anyway, and must
not be inlined away: it is the single place the scale is applied, and the
constant is the only thing that would change if a zoom control is ever added.

### 1.2 Replacing the percentage functions

`minuteToPct` / `pctToMinute` are deleted in favour of:

```ts
export function minuteToPx(minute: number): number;
export function pxToMinute(px: number): number;
```

Both are total — the degenerate-range precondition documented at `grid.ts:68–80`
disappears with the divisor.

`hourMarks` takes no `Interval` and returns all 25 whole-hour marks for the day.

### 1.3 `visibleRange` becomes `initialScrollWindow`

```ts
export function initialScrollWindow(
  dates: string[],
  windows: AvailabilityWindow[],
): Interval;
```

Same union-of-availability logic, still floored/ceiled to the hour and still
widened to cover `MIN_VISIBLE_START`/`MIN_VISIBLE_END`. Two changes:

- The `blocks` and `spans` parameters are **deleted**. `spans` existed solely so
  a block scheduled outside the range would not render off-grid
  (`grid.ts:24–29`); under a scroller every minute of the day is reachable, so
  the entire justification is gone.
- The return value is no longer geometry. It is only the region to scroll into
  view on mount, and nothing positions against it.

### 1.4 Scrolling and stickiness

The grid becomes a two-axis scroller. Inside it:

- Day headings and the all-day lane are `sticky top-0`, over an opaque
  background.
- The hour axis stays `sticky left-0`, as it already is (`WeekGrid.tsx:211`).
- The corner where they meet is sticky on both axes.

**Z-index is now load-bearing and must be assigned explicitly**, because these
layers did not previously coexist:

| Layer | z |
|---|---|
| hour rules | 0 |
| blocks | 1 |
| revealed block | 2 |
| now-line | 3 |
| hour axis (sticky left) | 4 |
| day headings + all-day lane (sticky top) | 5 |
| sticky corner | 6 |

Note `EventBlock` currently gives a revealed block `z-10`
(`EventBlock.tsx:110`), which under the new stack would float it over the
sticky headings. It must come down to the value above.

### 1.5 Scroll restoration

`WeekGrid` already centres today horizontally once per week and stops touching
scroll once the user has moved it (`WeekGrid.tsx:74–148`). A vertical
counterpart scrolls to `initialScrollWindow().startMin` under the same rules.

The two axes get **separate** `userScrolled` refs. They are independent
concerns: scrolling sideways to see Friday should not forfeit the vertical
scroll-to-working-hours, and vice versa.

### 1.6 The auto-scroll reversal

`Plan.tsx:375–384` sets `autoScroll={false}` and justifies it with "the grid is
a fixed `GRID_HEIGHT_PX` … there is no scrolling a drag has to do", explicitly
warning that re-enabling it requires re-deriving the aim arithmetic first.

A scrolling grid needs auto-scroll — dragging from 09:00 to 18:00 is a basic
operation. So `autoScroll` is turned back on, **and the aim arithmetic is
re-derived in the same change**, not after it.

The problem: today's aim pairs `e.over.rect` (measured at drag start, in
viewport coordinates) with `e.delta`. If the grid scrolls mid-drag, that pairing
drifts by roughly a minute per pixel scrolled. The fix is a coordinate-space
change — `aimMinuteFor` takes **scroller-relative** Y:

```
draggedTopInScroller = draggedTopViewport - scrollerRect.top + scroller.scrollTop
```

which is invariant under scroll. `aimMinuteFor` loses its `range` parameter and
its clamp becomes `[DAY_START_MIN, DAY_END_MIN]`.

The existing warning comment at `Plan.tsx:341–347` about not swapping in a live
rect stays true for the *horizontal* axis and must be preserved, not deleted
along with the vertical fix.

### 1.7 Keyboard placement

`1`–`7` currently aims at `range.startMin` (`Plan.tsx:295–297`). With a 24h grid
that is 00:00, which would place work at midnight. It becomes the day's
availability start; `resolveSlot` then snaps forward to the first fitting gap as
it already does.

A day with no availability window has no start to aim at. `windowForDate`
returns `null` there, the droppable is already disabled for such days
(`DayColumn.tsx:33`), and the keyboard path must refuse for the same reason
rather than aiming at midnight.

### 1.8 What is unaffected

`assignLanes`, the horizontal centring logic and its test
(`WeekGrid.centring.test.tsx`), and `PlanSidebar` — which bounds itself by
absolute positioning with no measurement (`PlanSidebar.tsx:53–67`), so a grid of
any height still sizes the row correctly.

---

## Part 2 — Direct manipulation

### 2.1 Gesture set

| Gesture | Result |
|---|---|
| Drag on empty canvas | Composer at that span, snapped to 5m |
| Click on empty canvas | Composer at `DEFAULT_SLOT_MIN` |
| Click a block | Select it |
| Drag a block onto the rail | Unschedule |
| Drop on empty space outside a column | Nothing |
| `Esc` | Dismiss composer, else deselect |

### 2.2 The composer

An inline title field rendered inside the provisional block. **It is local
component state and writes nothing.** A stray click therefore costs an empty
field that `Esc` or blur dismisses; committing an empty title cancels rather
than creating "Untitled". This is what makes click-to-create safe without a
confirmation step, and it is the reason the gesture is allowed to be this cheap.

The field must `stopPropagation` on `pointerdown`, as the existing block buttons
do (`EventBlock.tsx:141`, `:157`), or typing in it would start a drag.

While a composer is open, the Plan keydown listener at `Plan.tsx:264` must bail
before reading `1`–`7`, or typing a digit into a title places a backlog row.

### 2.3 `createTaskAt` — new action

```ts
createTaskAt(
  title: string,
  date: string,
  startMin: number,
  durationMin: number,
): boolean
```

Validates through `resolveSlot` **before** writing. On refusal it returns
`false` and shows the store's toast, having created nothing.

It must be a single write. Composing `addTask` → `scheduleTask` →
`setTaskEstimate` is wrong twice over:

- Three writes arm three undo entries, and each write's sweep discards the ones
  before it, so the toast would offer to undo only the estimate. This is the
  same failure CLAUDE.md documents for bulk edits.
- `scheduleTask` returns `false` when no gap fits, which would strand an
  undated, unwanted task in the backlog after a gesture that visibly failed.

One `withUndo` entry: `Created "…" · Undo`.

### 2.4 `resizeFromStart` — new action

```ts
resizeFromStart(
  kind: 'step' | 'task',
  id: string,
  newStartMin: number,
  newMinutes: number,
): boolean
```

The existing `ResizeHandle` is bottom-edge only, and `resizeNode`/`resizeTask`
write `estimateMin` alone — so a top-edge drag, which moves the start *and*
changes the duration, has no expression today.

`clampResize` must validate the new **start** as well as the new end. Like the
existing resize actions it uses `NO_PAST_LIMIT`: moving or resizing something
already on the grid is an adjustment, not a new booking.

### 2.5 Selected-block keyboard

A selected block is a first-class object:

| Key | Action |
|---|---|
| `↑` / `↓` | Move by 5m |
| `⇧↑` / `⇧↓` | Resize by 5m |
| `⌫` | Unschedule |
| `Space` | Complete / reopen |
| `⏎` | Open its project |

Registered on the same capture-phase window listener `Plan.tsx:264` uses, for
the reason documented there. Selection is component state in `Plan`, not store
state — it is ephemeral, like `lastViewedWeek`.

`Plan` therefore threads a `selectedKey` down through `WeekGrid`'s `children`
callback → `DayBlocks` → `EventBlock`, alongside the `reveal` prop that already
travels that exact path (`DayBlocks.tsx:66`, `EventBlock.tsx:61`). Selection and
reveal are distinct states and must render distinguishably: reveal is a
transient pointer from the command palette, selection is a persistent user
choice.

### 2.6 Live readouts

A pill on the dragged or resized block reading `11:00 – 12:15 · 1h 15m`, shown
during create, move and resize. The arithmetic already exists in `aimMinuteFor`
and in `ResizeHandle`'s preview (`EventBlock.tsx:84–95`); only the rendering is
new.

### 2.7 Capacity feedback during drag

The aimed column recomputes one `DayCapacity` with the dragged duration added,
and warms accordingly, so the cost of the target day is visible before release.
Memoised on `(draggedDuration, targetDate)`.

### 2.8 Unscheduling

The rail becomes a droppable. Dropping a block on it calls the existing
`unscheduleNode`/`unscheduleTask`, both already undoable and both already
revealing the row in the rail.

Dropping outside any droppable does nothing — deliberately. An unschedule
triggered by a missed drop is a gesture whose failure mode is silently losing a
placement.

---

## Part 3 — Colour and state

### 3.1 The palette lives in the theme

`designScale.test.ts` fails the build on a literal hex inside a Tailwind
arbitrary value or a CSS property in any `src/**/*.tsx?` file. The palette is
therefore six tokens — `--c-proj-0` … `--c-proj-5` — declared in `index.css`
under both `:root` and `.dark`, and exposed as Tailwind colour keys.

None of `proj-0`…`proj-5` may collide with a `fontSize` key. The current
`fontSize` keys are `root, micro, eyebrow, tiny, kbd, badge, meta, compact, ui,
body, lead, title, h3, h2, h1, wordmark`, so these are safe — but the rule is
enforced by that same test and must not be re-derived by hand.

Each entry must clear **3:1 against `panel` in both themes**: the rail is a 3px
non-text element and WCAG 1.4.11 applies, exactly as it does for `--c-check`.

### 3.2 `src/lib/projectColour.ts` — new module

```ts
export function projectColourIndex(goalId: string): number;
export function projectRailClass(goalId: string | null): string;
```

A stable hash of `goal.id` into `0…5`. Because Tailwind cannot scan
`border-l-proj-${i}`, the module exports a **static array of literal class
names** so the content scanner sees each one.

`goalId === null` — a loose task — returns the neutral rail. Inventing a colour
for work that belongs to no project would assert a membership that does not
exist.

### 3.3 State on the fill

The fill carries `warn-tint` when the item is overdue, or when its project is
behind pace. Both predicates already exist and neither is re-derived here:
`dueChip` (`backlog.ts:69`) for the first, and `behindPaceBy`/`expectedPct`
(`timeline.ts:47`, `:72`) for the second — **not** `pace.ts`, which exports only
the two label formatters `BehindChip` renders.

`behindPaceBy` requires a **confirmed start and deadline** (`velocity.ts:9`). A
project without them has no pace, and must therefore fall through to *no tint*.
Defaulting an undated project to "behind" would put warn colour on the majority
of a new user's grid and paint the app's most serious signal onto the least
informed state.

Done blocks keep today's `opacity-55 line-through`.

This resolves, rather than worsens, the accent overload the UX review flagged:
the accent stays the colour of action, `warn` stays the colour of trouble, and
project identity gets its own six-value channel.

---

## Part 4 — Capacity, the gutter, the all-day lane

### 4.1 Temperature replaces the today tint

`DayColumn` already stacks four backgrounds: off-day hatch, availability dim
above and below the window, today tint, and drop-target tint
(`DayColumn.tsx:44–60`). Temperature as a fifth wash would be mud.

So the column wash **replaces** the today tint. Today keeps its accent day
number and its now-line, which are sharper signals than a background wash.

Ratio is `(plannedMin + backlogMin) / freeMin`, from figures `weekCapacity`
already returns: cool below 1, warm above. It agrees with `isOverCommitted` by
construction, since that predicate is the same comparison
(`capacityLabel.ts:129–136`).

### 4.2 The gutter

A band beneath the grid, full width, drawing the week's unplaced commitment as
blocks sized to their estimates and draggable up into the grid.

**Its contents are exactly the items behind `capacity.backlogMin`** — committed
to this week, not on a day and a start minute. It is therefore *not* a second
rendering of the rail:

- **Rail** — everything available to plan, including work not committed to this
  week. Unchanged.
- **Gutter** — the subset already billed to this week's capacity.

Its total equals the header's "to place" figure by construction, which is an
invariant to test rather than a coincidence to maintain.

Unestimated items have no honest width. They render at `DEFAULT_SLOT_MIN` with
the dashed border the grid already uses for guessed durations, so a guess never
reads as a measurement.

**The gutter is a source, not a drop target.** Its rows carry the same
`PlanDragData` contract the rail's rows do, so dragging one onto the grid needs
no new path. But dropping a block *onto* the gutter is not defined, and the rail
remains the only unschedule target — because the two kinds do not land in the
same place. Unscheduling a step clears `plannedDay`/`plannedStartMin` while
leaving `plannedWeek` set, so it stays committed to the week and does appear in
the gutter. Unscheduling a task clears `date` **and** `startMin` together, so it
leaves the week entirely and appears only in the rail. A gutter that accepted
drops would therefore swallow tasks that do not reappear in it.

### 4.3 The all-day lane

A sticky row between the day headings and the grid.

Its producer is **checkpoints and deadlines**, not calendar events. `blocks` is
always `[]` today (`Plan.tsx:484`), so a lane built only for busy events would
ship empty; whereas `checkpoint?: boolean` and `deadline` are all-day facts
already carried on `GoalNode`.

This also replaces the current all-day path, which renders an all-day event as a
block spanning the entire visible range (`DayBlocks.tsx:89–103`) — obliterating
the day rather than sitting above it. That path is unexercised today, so
changing it costs nothing now and avoids shipping the wrong behaviour later.

---

## Part 5 — Motion

`tailwind.config.js` gains a scale, extending `transitionDuration` and
`transitionTimingFunction`:

| Token | Value | Used for |
|---|---|---|
| `fast` | 120ms | hover, selection ring, quiet controls |
| `base` | 180ms | block enter/exit, composer, panels |
| `slow` | 260ms | week cross-fade |
| `standard` | `cubic-bezier(.2, 0, 0, 1)` | all of the above |

`designScale.test.ts` gains a fourth rule rejecting arbitrary `duration-[Nms]`,
for the same reason it rejects arbitrary font sizes: a scale is only a scale if
it is enforced.

Week change is a **cross-fade**. Sliding a two-axis scroller is disproportionate
work for the payoff, and would fight the scroll-restoration logic in §1.5.

`prefers-reduced-motion` is already handled globally (`index.css:257`) and needs
no per-component work.

---

## Part 6 — Testing

| Area | Test |
|---|---|
| `grid.ts` | Rewrite `grid.test.ts` for `minuteToPx`/`pxToMinute`/`hourMarks`; `initialScrollWindow` no longer widens for spans |
| Aim arithmetic | `dropTarget.test.ts` gains non-zero `scrollTop` cases — the highest-risk change in this spec |
| Colour | New `projectColour.test.ts`: determinism, stable distribution, and 3:1 contrast for all six tokens in both themes |
| Gutter | Its total equals `capacity.backlogMin` for a fixture week |
| `createTaskAt` | A refused slot creates nothing and returns `false`; a successful one arms exactly one undo entry |
| `resizeFromStart` | Clamps against the new start; refuses outside a free gap |
| Composer | Commit, `Esc` cancel, blur cancel, empty-title commit cancels |
| Selected-block keys | Move, resize, unschedule; bails while a composer is open |
| Design scale | The new `duration-[Nms]` rule fails on a planted violation |

Component tests must click the child a person actually hits, not the row — the
capture-phase note in CLAUDE.md applies to blocks as much as to tree rows.

---

## Part 7 — Risks

1. **The aim arithmetic under scroll is the single highest-risk change.** It is
   the one place where a silent, hard-to-notice regression (blocks landing a few
   minutes off) is likely. It gets tests before it gets a UI.
2. **Five background layers collapsing to four** relies on removing the today
   tint. If that reads as a loss in review, the temperature wash must be
   weakened rather than the tint restored — do not ship both.
3. **Auto-scroll re-enablement** invalidates a comment block that currently
   argues the opposite. Update the comment; a stale rationale is worse than none.
4. **24h of DOM per column** is 25 hour rules rather than 13. Blocks stay
   absolutely positioned, so this is not a rendering concern, but the initial
   scroll must happen before paint to avoid a visible jump to 00:00.
5. **The gutter risks becoming a second rail** if its membership rule drifts.
   The `backlogMin` equality test is what holds the line.

---

## Explicitly not in this spec

Ghost auto-place (`F-7`), the now-band, estimate-vs-actual rendering (`F-3`),
multi-select on the grid, a day/3-day view, mobile layout, Google Calendar pull
(`F-12`), and the `Session` build-or-delete decision. Each is a spec of its own;
several depend on this one landing first.
