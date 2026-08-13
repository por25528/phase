# Board card progress meter

**Date:** 2026-08-13
**Surface:** `src/views/goals/BoardCard.tsx` (`CardFace`)

## Problem

A goal card states its completion as bare text — `2/13` — buried in a run-on
line beside `55m left` and `11 unestimated`. Three unrelated quantities share
one sentence, so the card has no focal point and the one number a person scans
for is the hardest to find.

## The bar this card already removed

`BoardCard.tsx:96-107` records that a progress bar was deliberately deleted
from this card:

> The bar in particular claimed to be the card's primary object while
> measuring a figure that silently changes basis.

That objection is correct and stands. `goalPct` (`lib/pct.ts:96`) switches
between an estimate-**weighted** mean and an **equal**-weight mean depending on
whether every sibling set happens to be estimated — `goalPctBasis` exists
precisely so the number can disclose which. Drawing that figure as a bar gives
the card's most confident-looking object the least stable meaning on it.

**This design does not reinstate that bar.** It draws `effort.done /
effort.total`: a flat leaf count, one basis, always — and the identical figure
the `2/13` caption beside it already states. The bar therefore says nothing the
card was not already saying, which is the whole licence for adding it.

## Design

`CardFace`'s effort paragraph (lines 108–126) becomes a metric block:

```
Finish CS:APP (core chapters + labs)     Due · Dec 31
▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░  2/13
55m left · 11 unestimated
Next  DataLab 8-10
```

- **Meter row** — `<ProgressBar>` (`flex-1`) plus the count at its right edge,
  `text-meta tabular-nums text-muted`, `flex-none`.
- **Caption line** — `55m left` and `11 unestimated`, joined by `·`, omitted
  entirely when neither applies. These are caveats about the *estimate*, not
  about progress; they sit below the meter and never inside its row, because
  adjacency is what made the old line read as one quantity.
- **All done** — the count slot reads `Done` against a full bar. Replaces the
  sentence `Every task done`; `Done` is the app's status word (`STATUS_WORD`).
- **No tasks** (`effort.total === 0`) — renders nothing, unchanged.

### Reuse, not new components

`ProgressBar` (`src/components/ProgressBar.tsx`) is used unmodified. It is
already the app's one meter — `OverviewTab` and `AreaPage` draw it — so the
board and the goal page render the same object at the same 6px. No `tone`
prop, no size variant, no new lib module: `goalEffort` already returns `done`
and `total`.

### Accessibility

The bar is left without `role="progressbar"`. Its value is stated verbatim in
the adjacent count, and every existing call site prints its percentage in text
too — announcing it twice is worse than not announcing it.

## Accepted divergence

`OverviewTab.tsx:44` feeds its bar `goalPct` (weighted). A goal's own page can
therefore read ~60% while its board card reads 2/13 ≈ 15%. This is deliberate
for now: Overview prints its basis alongside, which is what `goalPctBasis` is
for, and the board card has no room to. Unifying them is a separate decision to
be taken after both have been seen side by side.

## Out of scope

Full card restructure, new colour tokens, `Column.tsx`, the roll-up itself.

## Tests

Extend `src/views/goals/BoardCard.test.ts` for the four states — no tasks,
partial, fully done, and estimated-vs-unestimated caption assembly — and re-run
`designScale.test.ts`.
