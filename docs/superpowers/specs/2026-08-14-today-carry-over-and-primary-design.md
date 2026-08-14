# Today: the work it names, and the answer it leads with

## The problem

Today reads as unfinished, and two specific things make it so.

**It names work it then refuses to show.** `attentionItems` emits
`N tasks slipped from an earlier day` from `sections.carryOvers`
(`todaySurface.ts`), and no carry-over is ever rendered: `rest` is built from
`sections.commitments` alone. The row it emits is also the only `AttentionItem`
with no `goalId`, so clicking it falls through to `setView('plan')` — the
page's answer to "something slipped" is *leave this page*.

The Replan strip does not cover the gap, because it is about a different
population. `slippedWork` walks `blocksOf` and keeps sittings whose `date` is
past; a carry-over is a *commitment* whose day or week has passed
(`task.date < today`, or `plannedWeek < currentWeek`) and which may never have
been placed at all. So a day can carry the count and be offered no fix.

**Nothing on the page has more weight than anything else.** The Now row and a
Rest-of-today row differ only by `text-lead` versus `text-ui`. The page's most
important action — Start session — renders as `text-meta font-semibold
text-muted`: eleven-pixel grey text, stranded at the right edge roughly 450px
from the title it belongs to, beside a second muted string. The one action the
surface exists to offer is the quietest object on it.

The consequence of both is the void below the fold. The 2026-08-09 free-time
spec already stated the rule for that: *"the void closes because something
occupies it, not because the margins moved."* The thing meant to occupy it here
is work that already exists and is already computed.

## What this is not

No KPI cards, no rings, no portfolio counts, no second backlog rail. The
constraints from 2026-07-30 and 2026-08-09 stand unchanged. This adds one
section of work the page was already describing, and gives the existing primary
row the weight it was always meant to have.

## 1. Carried over

### Placement

Below *Rest of today*, above *Attention*.

The Replan strip sits above Now, and earns it by being one line — a
notification, not content. A list of rows above Now would push the page's
answer below a list of things you already failed to do. Today's actual plan
outranks yesterday's leftovers; the exceptions stay last.

### Membership and order

`sections.carryOvers`, unchanged — `buildDailyWork` already computes exactly
this set and `deferOpenWork` already triages exactly this set, so a third
definition here is how the three start disagreeing.

Sorted oldest-first, on `scheduledDate` for a task and `plannedWeek` for a
step. Both are `YYYY-MM-DD`, so one `localeCompare` orders the mixed list. The
reason is `slippedWork`'s: the thing that slipped furthest has waited longest.

Capped at `MAX_CARRY_OVER` (5), with a `+N more` line below when the set is
larger. A section that lists everything overdue is the second backlog rail this
surface must not become.

The overflow line is **static text, not a link**. Sending it to Plan would
reintroduce the exact dead end this section retires — the whole complaint about
the Attention row was that its answer to "something slipped" was *go somewhere
else*. Five rows have already been shown by the time it appears; the line states
a count and nothing more.

### The row

`TaskRow`, as every other list on this page uses:

- checkbox, which completes, exactly as a commitment row's does
- title, and the goal as subtitle
- `carriedFrom(item, today)` in the meta slot — how long ago it slipped
- the `Today` verb (below), as a `.quiet-control`

`TaskRow`'s doc calls `meta` non-interactive, but its overlay makes that a
matter of stacking rather than a prohibition: the row's stretched click target
covers `meta`, so an interactive child there must carry `relative z-10` to sit
above it. `startSessionButton` already does exactly this, and the `Today` verb
follows it. `.quiet-control` needs a literal `group` ancestor, which the row
element provides.

No `surfaceReason` chip. The section heading *is* the reason, and the existing
rule already says a chip restating a fact on screen is a word for nothing. The
heading word is **Carried over**, which is the string `surfaceReason` already
returns for `source: 'carry-over'` — the label and the code stay one vocabulary.

`carriedFrom` is new, pure, in `todaySurface.ts`. It is the one fact justifying
the row's presence, and the row has nothing else to say about time: a carry-over
has no `startMin`, because if it had a sitting today it would be a commitment.

It takes the item's own date — `scheduledDate` for a task, `plannedWeek` for a
step — and returns days for anything inside a week (`Yesterday`, `3d ago`) and
weeks beyond it (`Last week`, `3w ago`). The boundary is 7 days, and it is a
boundary rather than a taper because a step's date is a *week* commitment: it is
only ever accurate to the week, and reporting `9d ago` about it would be a
precision the stored value does not have.

### The verb reuses `place()`

The row's action calls `place(row, today, true)` — the function `Today.tsx`
already has for offer rows — aimed at `nowMinute`.

This was not the first design. The alternative was a new store action setting
the commitment alone (`task.date = today`, `plannedWeek = currentWeek`). It was
rejected because `ScheduleMenu` already spends the word **Today** to mean
*place a block today*. A second "Today" that only re-committed would give one
word two meanings on one page — the labelling rule this whole review is being
run against.

Routing through `place()` costs nothing and buys three things:

- **No new store action.** `scheduleTask`/`scheduleNode` already arm undo,
  because a carry-over row carries no `blockId` and is therefore a booking made
  from a distance, per the invariant.
- **The stale block is vacated.** Default mode replaces a task's placement, so
  the past sitting goes without a separate `clearBlocks` — and the item leaves
  `slippedWork`'s population too, so the Replan strip and this section can
  never both be offering to fix the same row.
- **One meaning of "put this on today"** across the carry-over section and the
  free-time offer directly above it, which are now structurally the same row.

**The accepted cost.** At 19:00 with the availability window shut, `resolveSlot`
returns null and the verb toasts `describeNoRoom` instead of moving anything.
That is the identical failure mode the offer row above it already has, and the
free-time spec accepted it in terms that apply unchanged here: *refusal is not
new work, and the toast is the handle, not the announcement.* Inventing a
fallback that commits without placing would put two behaviours behind one label,
which is worse than a refusal that says so.

### What retires

The `carry-over` branch of `attentionItems`. With it goes the `setView('plan')`
fallback in Today's Attention click handler, which existed only to serve the one
`AttentionItem` that had no goal.

Attention's three slots then hold only `at-risk` and `blocked` — exceptions that
cannot be shown as rows because they are verdicts about a whole goal. That is
what `MAX_ATTENTION` was for.

## 2. The primary row

### `rowBtn`

A new shared style in `dialogStyles.ts`: outlined, row-height, `text-meta
font-semibold text-ink`, `rounded-field border border-line-2 bg-panel
hover:bg-hover`.

`primaryBtn` is 33px, sized for a dialog footer; a filled button of that height
inside a 30px row would break the row rhythm and would reverse the earlier
decision that made the label the emphasis and put Now on the same axis as every
other row. An outlined, row-sized button reads as an action rather than as
metadata without reopening that.

The `Replan` button in the slipped strip currently hand-rolls its own outlined
button. It adopts `rowBtn` and loses 2px of height. Two outlined buttons on one
page drifting apart is the thing a shared style exists to stop.

### The right edge becomes one cluster

`expectedTimeLabel` and the button sit together at the right, rather than as two
muted strings with the button last.

The estimate deliberately does **not** move into the subtitle. `expectedTimeLabel`
returns whole phrases — `Start with 30m`, `Planned 30m`, `Usually 45–60m` — and
CLAUDE.md pins it as the invitation copy belonging to work that has not started.
`Usually 45–60m` has no honest one-number form, so compressing it to `30m` to
fit a subtitle would flatten the distinction between an estimate, a starter and
real history. The stranded right edge is fixed by grouping, not by flattening a
considered label.

### Section labels

All three headings — the Now/Next label, `Rest of today`, `Attention` — plus the
new `Carried over`, take `px-[8px]` and `text-meta font-semibold text-muted`.

Today the Now/Next label is the only one aligned with its rows' checkboxes; the
other two sit 8px left of theirs. And `text-meta font-semibold text-muted` is
what CLAUDE.md specifies for a section label, which the Now label's
`text-ink-soft` is not. It can afford to drop, because the row below it now
carries a button.

## Tests

`todaySurface.test.ts`

- the carry-over case is removed; a set with carry-overs and no verdicts yields
  no attention items
- `carriedFrom` — a task a few days old, a step a week old, and the boundary at
  which the phrasing changes

`dailyWork.test.ts` — unchanged. The carry-over set is not being redefined.

`Today.test.tsx`

- carry-over rows render, oldest first
- the Attention region no longer states a count for work the page is showing
- clicking `Today` on a carry-over row places it, and the row leaves the section
- the section caps at `MAX_CARRY_OVER` and shows `+N more` beyond it
- Start session renders as a button, and the Now label sits on its rows' axis

`designScale.test.ts` — unchanged, and must stay passing: `rowBtn` is built from
theme tokens, with no literal hex and no arbitrary `text-[Nrem]`.
