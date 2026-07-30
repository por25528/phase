# Plan Sidebar: Bounded Height, Capped Density, Calm Rail

**Status:** approved, pending implementation
**Amends:** `docs/superpowers/plans/2026-07-30-plan-sidebar-and-flip.md` (commit `a13a48d`), Tasks 1, 6, 7, 8
**Builds on:** `docs/superpowers/specs/2026-07-29-plan-week-calendar-redesign-design.md`
**Superseded in part by:** `docs/superpowers/specs/2026-07-30-today-calm-surfaces-design.md`

> **⚠ Later amendment — 2026-07-30.** The Today spec above deletes Quick add,
> Worth considering and the month calendar, so the rail has **no pinned
> quick-add and two collapsible panels** (Habits, Stats), not four.
>
> Everything this document says about *geometry, density and calm* stands
> unchanged — the bounded rail, the per-project cap, the de-boxed rows. Only
> the rail's **contents** shrink. Concretely: ignore the `quick-add` line in
> the sketch below and the pinned-slot rows in the amendment table, and read
> "4 panel headers" as "2 panel headers". Since nothing is pinned any more,
> the scroller holds the backlog and both panels as one region.

## Problem

The Plan view's backlog rail grows without bound. `Plan.tsx:157-174` — scaffolding, and labelled as such — renders every unplanned leaf of every active project inside an `items-start` grid, so a project with 24 open steps makes the whole page taller than the calendar beside it. Reaching the second project means scrolling the entire document.

Three faults, in the order they hurt:

1. **The rail sets the page height.** It should never do that. The calendar is the content; the rail is chrome.
2. **No shortlist.** "To plan" implies a next-few, but the rail is a complete inventory. The answer to "what do I drag onto the calendar" is never step 19 of 24.
3. **The rail reads as noise.** Every row is `border border-line-2 bg-panel rounded-[6px]` — two dozen outlined boxes whose borders carry no information the line breaks don't already carry.

The plan being amended replaces this scaffolding with a real `PlanSidebar` + `Backlog`, but its sidebar is *also* unbounded and its rows keep the boxes. Fixing it in the spec is cheaper than building it wrong and fixing the component.

## Non-goals

- The grid interior — hour rule weights, weekend hatching, block styling. Judge it once there is work on it, not while it's empty.
- The week header layout.
- Making the grid fluid-height. `GRID_HEIGHT_PX` is the divisor that turns a drop's pixel offset into a minute (`Plan.tsx:135`, `aimMinuteFor`); making it fluid means threading a measured height through the drop math. Out of scope, and unblocked by everything here.
- New colours, fonts or spacing scales. Only tokens already in the codebase.

## Design

### 1. Geometry — the rail matches the calendar

The rail is exactly as tall as the calendar column and scrolls internally.

The mechanism is CSS, not measurement. The two-column grid's row is sized by the calendar; the rail's column stretches to that row and holds an absolutely-positioned scroller:

```
<div class="grid gap-[18px] md:gap-0 md:grid-cols-[272px_1fr]">   row height = calendar's
  <div class="md:relative min-w-0 md:border-r md:border-line">
    <aside class="md:absolute md:inset-y-0 md:left-0 md:right-[18px] overflow-y-auto">
      quick-add            pinned, outside the scroll region
      backlog              scrolls
      4 panel headers      scroll
    </aside>
  </div>
  <div class="min-w-0 md:pl-[18px]"> WeekHeader + WeekGrid </div>
</div>
```

Note `right-[18px]` rather than `inset-0` plus padding on the wrapper. An absolutely-positioned element is laid out against its ancestor's **padding box**, so padding on the wrapper would be ignored by the scroller and the rows would run into the divider. The inset carries the gutter instead, which also keeps the scrollbar 18px clear of the rule.

The `gap` is kept below `md` — there the columns stack and the gap is the vertical space between them — and dropped at `md`, where the border plus insets replace it.

An absolutely-positioned child contributes nothing to its parent's size, so the rail is structurally incapable of making the page taller. That is the bug, closed by construction rather than by a number that could drift.

Rejected: `ref` + `ResizeObserver` pushing a pixel height onto the rail. It works, but adds a measurement pass, a re-render per resize, and a second source of truth for a height CSS already knows. It is retained as the **fallback** if the drag check in §5 fails.

A consequence worth having: the availability warning banner (`Plan.tsx:186-197`) changes the calendar's height when it appears. The rail follows automatically, with no code aware of it.

**Mobile.** Every part of this is `md:`-prefixed. Below `md` the layout is a single column and the rail stays a normal flowing block — a short scrollbox stacked above a calendar on an already-scrolling screen would be worse than the bug.

**The seam.** `border-r border-line` on the stretched wrapper, with the `md` gap replaced by the scroller's right inset and `pl-[18px]` on the calendar. Same total spacing, now with a line in it. The border sits on the wrapper, not the scroller, so it is a continuous full-height rule rather than something that scrolls away.

**Width.** 232px → 272px. The arithmetic, because it is easy to get wrong and easy to "correct" back:

| | column | minus border | minus gutter | minus row `px-[6px]` | minus row border | text |
|---|---|---|---|---|---|---|
| now | 232 | — | — | −12 | −2 | **218px** |
| after | 272 | −1 | −18 | −12 | — | **241px** |

About 23px, or roughly seven characters. Note that de-boxing the rows in §3 recovers only the 2px of border — it does **not** pay for the gutter. The width increase is what buys the text room, and a smaller column would leave truncation roughly where it is today. The calendar gives up 40px of its width in exchange.

### 2. Density — each project capped

Each group shows its first `BACKLOG_CAP` (5) items. If more remain, a final row reads `+N more` and expands that group in place; expanded, it reads `Show less`. Expansion is per-group and independent.

**Which five:** the first five in tree order — what `walkLeaves` already yields, which is the order the steps were written. The closest thing the data has to "next up", and it makes the rail read as the top of each project rather than an arbitrary sample. Loose tasks are capped by the same rule, no special case.

**The total stays true.** With 31 unplanned items and 15 rows shown, "To plan" still reads 31. The cap is a display device and must not shrink the number that says how much is unplanned — that number is the honest signal of over-commitment.

**The logic is pure, in `src/lib/backlog.ts`:**

```ts
export const BACKLOG_CAP = 5;

export interface CappedGroup extends BacklogGroup {
  /** `goalId`, or `'loose'` — the key `expanded` is tested against. */
  key: string;
  /** The first CAP items, or all of them when this group is expanded. */
  shown: BacklogItem[];
  /** `items.length - shown.length`. Zero when expanded, or when short enough. */
  hidden: number;
  /** `items.length > BACKLOG_CAP` — true whether or not it is expanded. */
  expandable: boolean;
}

export function capBacklog(groups: BacklogGroup[], expanded: Set<string>): CappedGroup[];
```

`expandable` exists so the component never re-derives state the selector already knows: it renders `+{hidden} more` when `expandable && hidden > 0`, `Show less` when `expandable && hidden === 0`, and no row at all otherwise. Without it, `hidden === 0` is ambiguous — it means both "expanded" and "nothing to hide", and the component would have to compare against `BACKLOG_CAP` itself to tell them apart. `key` is there for the same reason: `capBacklog` already decides how the loose group is keyed, so it should be the only place that knows.

This placement is not stylistic. `vitest` runs `environment: 'node'` in this repo — there is no DOM, so anything left inside `Backlog.tsx` is untestable by construction. A pure function is the only way "expanding one group leaves its siblings alone" and "the total ignores the cap" get a test that can fail.

**Expansion is not persisted** — `useState<Set<string>>` local to the backlog panel, reset on reload. No settings row, nothing in the store. A shortlist that remembers you expanded everything last week is the long list again.

### 3. Visual treatment — subtraction

The governing rule is calm and minimal. The rail's resting state is text, one hairline, and whitespace; everything else appears on hover.

```
  before                          after

  TO PLAN                         TO PLAN                    31
  Master C programming w…         Master C programming w…    12%
  ┌────────────────────────┐      Complete one small exer…
  │ Complete one small ex… │      Practice one-dimensiona…
  └────────────────────────┘      Implement common string…
  ┌────────────────────────┐      Trace pointer addresses…
  │ Practice one-dimensio… │      Write functions that mo…   90m
  └────────────────────────┘      +19 more
             ⋮
```

**Rows.** No border, no fill, no radius at rest: `px-[6px] py-[3px] text-[.78rem] text-ink-soft truncate cursor-grab`. `hover:bg-hover rounded-[6px]` appears only under the pointer; `opacity-40` while dragging. The estimate, when present, is right-aligned `font-mono text-[.56rem] text-faint tabular-nums`.

**Project headings.** `font-disp text-[.82rem] font-semibold text-ink`, percentage in `font-mono text-[.56rem] text-faint tabular-nums`. Groups separate by space alone — `mt-[14px]` between them, none on the first — with no rule or chip. Display type appears nowhere else in the rail, which is what makes a heading read as a heading without weight or a divider saying so.

**`+N more`** is a bare text button: `px-[6px] py-[3px] text-[.72rem] text-muted hover:text-ink`, no border, no chevron, aligned with the rows above it.

**Empty state** unchanged: `Nothing left to plan.`

**The rail keeps no background.** It stays on `bg`, same as the calendar; the `border-r` is the entire separation. A panel fill plus a divider says the same thing twice.

**Rejected, deliberately:**

- *A grip handle per row.* `GripIcon` exists in `today/`, but it puts a permanent glyph on all 31 rows to advertise what the cursor already signals on hover — and Task 10's `1`–`7` keys give a non-drag route regardless.
- *Sticky group headings.* They would say which project you are scrolling inside, but with the cap at 5 the groups are short and there is rarely enough scroll to fire — buying a stuck-header artifact for nothing.

## Changes to the amended plan

No renumbering; no task is built twice.

| Task | Amendment |
|---|---|
| **1** — `backlog.ts` | Add `BACKLOG_CAP`, `CappedGroup`, `capBacklog` and their tests alongside the 13 already specced. |
| **6** — sidebar shell | `PlanSidebar` becomes the stretched wrapper + `md:absolute md:inset-0` scroller with a pinned slot above it, replacing the specced plain `<aside className="min-w-0 flex flex-col gap-[6px]">`. |
| **7** — backlog panel | Row de-boxing, heading treatment, `capBacklog` wiring with local expansion state, `+N more`, true total on "To plan". |
| **8** — panel relocation | Quick-add mounts into the pinned slot, not merely "above the backlog". |
| — `Plan.tsx` | `232px` → `272px`; `items-start` dropped; `gap-[18px]` becomes `gap-[18px] md:gap-0`, with `border-r border-line` and the scroller's insets carrying the seam at `md`. |

Everything the rail contains still scrolls as one region below the pinned quick-add — the four collapsible panels included. A pinned footer for their counts was considered and rejected: it spends ~120px permanently on sections you *read* in order to protect them from the one section you *drag from*, and the cap already keeps them near the fold.

## Verification

**Tested:** `capBacklog`, in `src/lib/backlog.test.ts`. The amended plan's discrimination rule applies — each test gets a mutation proving it can fail, with real output recorded:

- Drop the `slice` → the cap tests must fail.
- Make expansion global rather than per-group → the independence test must fail.
- Count `shown` instead of `items` for the total → that test must fail.
- Set `expandable` from `hidden > 0` rather than `items.length > BACKLOG_CAP` → the test asserting an *expanded* long group is still `expandable` must fail. This is the `Show less` row disappearing the moment you expand.
- Key the loose group by `null` rather than `'loose'` → the test that an expanded loose group actually expands must fail.

**Not testable:** the components. No DOM under `environment: 'node'`; do not add `jsdom`. Gate is `./node_modules/.bin/tsc -b` clean, the suite still green, and the checks below — **which only a human can run. No implementer may claim to have performed one.**

1. The rail is exactly as tall as the calendar; the Plan page itself no longer scrolls.
2. The rail scrolls internally; the divider runs its full height and does not scroll away.
3. Below `md`, the rail is a normal flowing block — no short scrollbox.
4. **Drag a row from mid-scroll onto a day.** Not clipped by the scroller; lands where the ghost showed.
5. Auto-scroll near the rail's edge during a drag does not fight the drop.
6. `+N more` expands in place; sibling groups untouched; the "To plan" total unchanged by expanding.
7. Quick-add stays pinned while the backlog scrolls under it.
8. The availability banner appearing or disappearing changes the calendar's height, and the rail follows.

## Risk

Check 4 is the only real one. Everything else here is subtraction and CSS, but a `DragOverlay` escaping an `overflow-y-auto` ancestor is the kind of thing that works in every browser until it does not. dnd-kit tracks scrollable ancestors and the overlay is a fixed-position clone while the source row stays put at `opacity-40`, so clipping is not expected — but expected is not checked.

**Fallback if it clips:** the rail keeps a normal `max-height` from a `ResizeObserver` measurement of the calendar column instead of `md:absolute md:inset-0`. No absolutely-positioned layer, no clipping ancestor problem, at the cost of the measurement pass §1 rejected. Everything else in this spec is unaffected.
