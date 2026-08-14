# Today: one gesture, one dimension — the rule the offer rows never got

## The problem

**Three sections of near-identical rows, and a plain click means three
different things.**

| Section | A plain row click | Books via |
| --- | --- | --- |
| Rest of today | `openItem` | — |
| Carried over | `openItem` | a separate `.quiet-control` verb |
| Free time | **`place(...)` — books a slot into a future day** | the row itself |

`GoalTree` already fixed exactly this, and CLAUDE.md carries the rule it
produced:

> **One gesture, one dimension, on a task row.** […] The row itself no longer
> runs a "primary action" that depended on what the row was — because that
> bound *the one action which moves every number* to the largest click target
> on the page.

The offer rows are the last place that still does it. The codebase knows, and
compensates instead of fixing: the reason `scheduleNode`/`scheduleTask` arm an
undo from this path at all is that *"on Today the row IS the button, so a stray
press must be reversible."* Undo is standing in for an affordance that was
never drawn.

**Two rows have the bug, not one.** `restOffers` in the Free time section is
the obvious one. The other is `primaryOffer` in the **Now** section, and it is
worse: that row already renders a visible `Start session` button in its `meta`,
so it carries one mutation you can see and a second, different one you cannot —
on the same row, at the same moment.

**Nothing on an offer row says which day it books.** The date lives only in the
section heading, so a row four lines down is read against a sentence the eye
has left. `dayLabel(offerInfo.date, today)` is already computed for the row's
`ariaLabel`; a screen reader is told the day and a sighted reader is not.

**One heading is a sentence wearing a label's clothes.** Beside `Next`, `Rest
of today`, `Carried over` and `Also possible`, the free-time heading reads
`No time left today — Aug 17 has 9h free` — a full sentence with an em-dash and
a redirect to another day, set in the same `text-meta font-semibold text-muted`
the one-word labels use.

**`Start with 30m` is the page's only prose duration.** Every other duration on
Today is bare — the offer rows render `fmtMinutes(row.estimateMin)` as `45m`.
Sitting immediately left of a button reading `Start session`, the two share a
verb and read as two controls where there is one.

## What this is not

Not a fix for the void. It measures **0px** on a realistic day — content fills
the viewport exactly — and the 2026-08-09 rule is that *"the void closes
because something occupies it, not because the margins moved."* There is
nothing left to occupy. The sparse-day emptiness that motivated the original
complaint is a property of an empty database, not of the layout.

Not a change to `expectedTimeLabel`. It is the INVITATION, and CLAUDE.md pins
it to work that has not started; the assistant shelf spends it where a bare
`30m` would have no context. Only what **Today** renders changes.

Not a new section, chip, count or card. The 2026-07-30 and 2026-08-09
constraints stand.

## 1. An offer row opens; a verb books

Both offer rows — `primaryOffer` in Now, and every `restOffers` row in Free
time — take the shape `Carried over` already ships one section below:

- `onOpen` becomes `openItem`, the same handler the other three sections pass.
- The booking moves to its own button in `meta`, `relative z-10 quiet-control`
  over the shared `rowBtn`, exactly as the carry-over `Today` verb is built.
  The `z-10` is not decoration: `TaskRow`'s stretched click target covers
  `meta`, so an interactive child there must sit above it.

**The verb names the day it books.** `dayLabel(offerInfo.date, today)` — the
string the `ariaLabel` already carries, now also on screen. `Today` when the
offer is for today, so it lands on the identical word the carry-over verb uses
for the identical act, and the two sections cannot drift.

The `ariaLabel` on the ROW goes with its handler: `Plan “X” Aug 17` was
describing the row's click, and the row no longer plans anything. It is
**omitted**, not reworded — `ariaLabel` is optional on `TaskRow`, and `Rest of
today` and `Carried over` both leave it off so the title names the row. Passing
a hand-written name here would be the offer rows being special again, in the
one place they should now be ordinary. `Plan “X” Aug 17` moves onto the button
that performs it.

This is what removes the stray press. The undo stays — a booking made from a
distance still arms one, per the schedule-undo rule — but it stops being the
only thing standing between a misread row and a silent mutation.

## 2. The heading is a label; the capacity is a line

`Free time`, in the label voice its neighbours use. The capacity sentence keeps
its job and loses its rank: it sits under the heading as `text-meta text-muted`
— context, not an eyebrow.

It is still worth saying. "Why is it offering Monday?" is answered by "there is
no time left today", and dropping the sentence to save a line would leave the
offer looking arbitrary. What it must not do is occupy the one slot on the page
reserved for saying *what a section is*.

`Also possible` is unchanged: when the primary row above already carries the
free-time heading, repeating the capacity sentence would state it twice about
the same hours.

## 3. Durations are bare

Today renders `fmtMinutes(primary.expected)` — `30m` — where it rendered
`expectedTimeLabel(primary.expected)`. The page already prints every other
duration this way, in the same `meta` slot, in the same `tabular-nums`.

`Start session` keeps its name. The button is the verb and the figure beside it
is the readout, which is the split the row already uses everywhere else.

## Testing

`Today.tsx` has no component test file of its own; `Today.freeTime.test.tsx`
and `Today.carryOver.test.tsx` cover the two sections this touches.

- **An offer row opens rather than books.** Clicking the row calls the open
  path and does NOT schedule — asserted on both the Now primary offer and a
  Free time row, because they are two call sites of one mistake.
- **The verb books, and names its day.** The button is present, carries
  `dayLabel`'s string, and scheduling happens only through it.
- **The row's accessible name no longer promises to plan**, and the button's
  does.

`npm test` and `npx tsc -b` before committing, per conventions.
