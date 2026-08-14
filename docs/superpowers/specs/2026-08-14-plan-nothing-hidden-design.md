# Plan: the day it hides, and the titles it clips

## The problem

**A day disappears from the week, and the control that looks like it would
bring it back goes somewhere else.**

The week grid is `min-w-[780px]` inside a scroller. When the window is narrower
than that, `WeekGrid`'s layout effect scrolls today into view — by CENTRING it:

```ts
const targetLeft = Math.max(
  0,
  AXIS_WIDTH_PX + index * colWidth - (node.clientWidth - AXIS_WIDTH_PX - colWidth) / 2,
);
```

Measured on a 1061px window: `scrollWidth` 780, `clientWidth` 699, so the whole
overflow is 81px — barely three-quarters of one column. Friday is index 4, and
at `scrollLeft: 0` it already spans content 466–571, entirely inside the 699px
viewport. It needs no scrolling at all. Centring asks for 198, the browser
clamps to the 81px maximum, and **Monday leaves the screen** while the header
above it still reads `Aug 10 – Aug 16`.

Nothing says a day is missing. There is no persistent scrollbar (macOS hides
overlay scrollbars at rest), no edge treatment, and no count. And the one
affordance a person would reach for — the `‹` beside `today` — pages to the
PREVIOUS WEEK. The gesture that looks like "show me what is off to the left"
silently answers a different question.

At half-screen width, which is a normal way to use a planner, this hides three
or four days.

**Titles clip with no way to read them.** The rail is pinned at 249px, so a
long title must truncate — that part is settled and correct. What is not is
that the full text is then unrecoverable. Measured: `Book the group room` gets
86px against a chip-less row's 130px, and renders `Book the gr…`, which names
nothing. Sixteen truncating spans across Plan, and **not one carries a `title`
attribute**, while the Goals board card has set that precedent since it shipped
(`<h3 title={goal.title}>`).

`EventBlock` makes the asymmetry explicit: its button already carries
`aria-label="Re-run the ablation, 10am–12pm"`, so a screen reader is told the
whole title and a sighted reader sees `Email the …` with no way to get the
rest. That is the same defect the Today offer rows had, where `dayLabel` was in
the accessible name and nowhere on screen.

## What this is not

Not a change to column sizing. `min-w-[780px]` and the 249px rail were settled
by the 2026-08-02 grid remaster and the 2026-07-30 sidebar density pass; a
column narrower than ~105px cannot hold a block title, so compressing seven
days into any width is not on offer here.

Not a change to WHEN the grid moves itself. `WeekGrid.centring.test.tsx` pins
that as timing — re-centring on every render destroyed a manual scroll within
the minute, and narrowing the dependency then left a resized window pinned at
Monday. Those rules are untouched. Only the TARGET changes.

Not a second pair of arrows. Adding scroll chevrons beside the header's
week-paging `‹ ›` would put two visually identical controls next to each other
answering different questions, which is the confusion this spec exists to
remove, not to double.

## 1. Scroll the minimum, do not centre

The horizontal target becomes the least scrolling that brings today fully into
view, and zero when it is already there:

```ts
const targetLeft = Math.max(0, AXIS_WIDTH_PX + (index + 1) * colWidth - node.clientWidth);
```

The axis is `sticky left-0`, so it always covers the leftmost `AXIS_WIDTH_PX` of
the viewport; a column is fully visible when its right edge sits at or before
`scrollLeft + clientWidth`. Solving for that edge is the whole formula, and it
falls out to 0 whenever today already fits — which is the common case, because
the overflow is usually a fraction of one column.

Centring was never the requirement. The requirement is "today is on screen",
and centring is one way to achieve it that costs up to half a viewport of other
days for nothing.

**This keeps every existing assertion.** The centring tests stub
`scrollWidth: 780, clientWidth: 420` with Thursday (index 3) as today. Thursday
spans 361–466 there, the viewport ends at 420, so it is genuinely cut and the
minimum scroll is 46 — still `toBeGreaterThan(0)`. The `toBe(0)` case is "the
whole week fits", which is unchanged, and every other assertion is about
latching and re-arming rather than position.

The `describe` is renamed from *centring on today* to *bringing today into
view*, because the block will no longer be testing what its name claims.

## 2. Clipped text says what it is

Every truncating span that holds USER-AUTHORED, identifying text carries the
full value in a `title`:

| file | what clips |
| --- | --- |
| `sidebar/Backlog.tsx:102` | a backlog item's title |
| `sidebar/Backlog.tsx:292` | the project heading a group sits under |
| `sidebar/Habits.tsx:251` | a habit's name |
| `EventBlock.tsx` | a placed block's title |
| `RecapPanel.tsx:76,90` | a logged leaf's title |
| `UnestimatedPanel.tsx:74` | an unestimated item's title |

`MonthCell` is deliberately absent: it already carries
`title={`${it.title} · ${clockLabel(it.startMin)}`}`, which the first survey of
this missed because the attribute sits on a different line from the `truncate`
class. It was listed here in error and needed no change.

Deliberately NOT every `truncate` in the view. `AvailabilitySettings`'s day
label, `BlockComposer`'s clock and the goal-title subtitles beside a leaf are
either short by construction or repeat something already on screen, and a
tooltip that restates the visible string is noise.

A `title` is the cheapest possible fix and costs no layout, which is the point:
the rail's width is settled, so the answer is not to fight for pixels but to
stop the clipped text being unrecoverable.

## Testing

- **`WeekGrid.centring.test.tsx`** gains a case for the defect: a grid whose
  overflow is smaller than one column, with today already visible, must not
  scroll at all. That is the exact shape that lost Monday, and no existing
  assertion covers it.
- The existing timing assertions must pass unchanged — they are the reason this
  spec touches the target and not the schedule.
- **`Backlog`** asserts a clipped item title carries its full text, so the
  tooltip cannot be dropped by a later refactor.

`npm test` and `npx tsc -b` before committing.
