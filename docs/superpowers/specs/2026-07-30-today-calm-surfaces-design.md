# Today — Calm Surfaces Design

**Date:** 2026-07-30
**Status:** Approved, ready for planning

## Goal

Today is the app's home view and it carries too much. Cut three surfaces, then
restyle what remains so the page reads as one calm document rather than six
competing panels.

## Scope

In scope: `src/views/Today.tsx` and `src/views/today/*`, the shared
`CardSection` component, `src/lib/dailyWork.ts`, `src/lib/calendar.ts`,
`pinnedDayCounts` in `src/lib/plan.ts`, `shiftDay` in `src/state/store.ts`, and
`src/index.css`.

No other **view** is modified. `src/App.tsx` and
`src/views/timeline/DaysLane.tsx` are both left untouched — the `t` shortcut
and the Timeline's day buttons behave exactly as they do now. See "Known wart"
in Part 1.4 for why.

Out of scope: the Plan-view flip described in
`docs/superpowers/plans/2026-07-30-plan-sidebar-and-flip.md`. That plan makes
Plan the home view and deletes `Today` entirely. This design deliberately does
not depend on it or block it — see "Relationship to the Plan flip" below.

## Decisions taken

| Question | Decision |
|---|---|
| Which surface | `Today`, stripped now, independent of the Plan flip |
| What "Notion-inspired" means | Calm surfaces (no card chrome) and quiet, hover-revealed controls. Not single-column, not collapsible sections. |
| Trim depth | Remove Worth considering, Quick add, and the month calendar |
| Layout | Two columns, per mockup option A |
| Week strip | Flattened to a hairline row |
| Suggestion engine | Deleted, recoverable from git |
| `DaysLane` / `selDate` | Left alone. `selDate` becomes write-only; recorded as a known wart rather than fixed here. |

## Visual identity exception

`CLAUDE.md` states: *"Visual identity is locked — don't restyle unless
explicitly asked."* This change is that explicit ask, and it is bounded:

- No new colours, fonts, radii or shadows. Every class uses a token already in
  `tailwind.config.js`.
- The change is subtractive. It removes `bg-panel`, `border-line`,
  `rounded-card` and `shadow-card` from three sections; it introduces nothing.
- Blast radius is provably contained: `CardSection` has exactly four consumers,
  all under `src/views/today/`. Goals, Timeline and Plan do not use it.

## Architecture

Three independent units of work, in this order:

1. **Deletion** — remove three components and the logic that becomes
   unreachable. TypeScript proves completeness (see Verification).
2. **`CardSection` restyle** — one shared component, which flattens all three
   remaining sections at once.
3. **Layout and control polish** — `Today.tsx`, `WeekStrip.tsx`, `index.css`,
   and the button demotions.

Each is separately revertible. Step 1 leaves a working page in the old style;
step 2 leaves a working page with the old layout.

---

## Part 1 — Deletions

### 1.1 `WorthConsideringCard`

Delete `src/views/today/WorthConsideringCard.tsx`.

This is the only consumer of the suggestion engine, so the engine goes with it.
In `src/lib/dailyWork.ts` remove:

- the `suggestions` field on `DailyWorkSections`
- the `SuggestionQueue` interface
- `suggestionTier` and `suggestionReason`
- the two-round round-robin loop that populates `suggestions`
- `'suggested'` from the `DailyWorkSource` union
- `DailyWorkItem.reason` — the suggestion engine is its only writer and
  `WorthConsideringCard` its only reader

In `src/views/today/workActions.ts` remove `scheduleSuggestionForToday` and its
`SuggestionActions` interface.

Delete the corresponding cases from `src/lib/dailyWork.test.ts` and
`src/views/today/workActions.test.ts`.

### 1.2 `QuickAdd`

Delete `src/views/today/QuickAdd.tsx` and `src/views/today/QuickAdd.test.ts`.

From `src/views/today/workActions.ts` remove `dispatchQuickAdd`, the
`QuickAddType` type and the `QuickAddActions` interface, plus their tests.

From `Today.tsx` remove the `quickRef`, `quickType` state and `focusQuick`
helper.

**No capability is lost.** Every QuickAdd path already had a richer sibling,
and QuickAdd was the impoverished duplicate in all three cases:

| QuickAdd path | Existing richer home | What QuickAdd gave up |
|---|---|---|
| Habit | `AddHabitForm` inside `HabitsCard` | hardcoded `daily, 4` — no cadence or target choice |
| Goal | `NewGoalModal` + JSON import in `Goals.tsx` | bare title only |
| Task | `TaskCaptureModal` on ⌘N | forced to today, no project |

### 1.3 `MiniCalendar`

Delete `src/views/today/MiniCalendar.tsx`.

It is the only consumer of two modules, both of which become unreachable:

- `src/lib/calendar.ts` (`ymOf`, `shiftYm`, `ymLabel`, `monthGrid`) — delete the
  module and `src/lib/calendar.test.ts`
- `pinnedDayCounts` in `src/lib/plan.ts:457` — delete the export and its tests.
  `plan.ts` itself stays; only this one function is orphaned.

### 1.4 `WeekStrip` becomes presentational

`selDate` has no readers. `store.ts` exposes `setSelDate`, `shiftDay` and
`goToToday`, but the only components that read the value back are `WeekStrip`
and `MiniCalendar`, each to draw its own selection ring. Picking a day changes
nothing else on the page. Once `MiniCalendar` is deleted, `WeekStrip` is seven
buttons whose entire effect is moving their own highlight.

So `WeekStrip`'s day cells become `<div>`s rather than `<button>`s. It keeps
every piece of information it displays — weekday, date, the per-day step and
habit summary, the today marker — and drops a control that only pretended to
act.

`WeekStrip` therefore stops calling `actions.setSelDate` and stops reading
`selDate` at all.

`ShortcutsOverlay` needs no change: its `T` entry reads "Jump to today", which
stays accurate — `t` still navigates to the Today view.

#### What stays, and why

`selDate` itself is **not** deleted, and neither are `setSelDate` or
`goToToday`. `src/views/timeline/DaysLane.tsx:33` still calls `setSelDate`, and
the decision for this change is to leave the Timeline untouched.

Delete only `shiftDay` from `src/state/store.ts` — it has zero callers anywhere
in the codebase and is unambiguously dead.

#### Known wart, accepted deliberately

After this change `selDate` is **write-only**: `DaysLane` and the `t` shortcut
write it, and nothing reads it. That is worth recording plainly rather than
leaving for someone to rediscover.

It is also a pre-existing bug with a visible symptom. `DaysLane` renders its
day buttons with `aria-label={`Open ${fmtD(s.start)}`}` and, on click, does
`setSelDate(day)` then `setView('today')`. The intent is "click a day in the
Timeline, see that day's work" — but since nothing reads `selDate`, it lands
you on Today showing *today*, and the chosen date is silently discarded. The
label promises something the app has never done.

Two ways to resolve it, both out of scope here:

1. Make `DaysLane` honest — drop the dead `setSelDate` call and relabel the
   button. Small, but it edits the Timeline view.
2. Wire `selDate` through `buildDailyWork` so Today can render an arbitrary
   day. This is the feature the code was reaching for, but it is a feature, not
   a cleanup — and the Plan view now covers viewing another day's work, which
   weakens the case for building it.

Neither is part of this change. Leaving `selDate` in place keeps the diff
inside Today and keeps option 2 open.

---

## Part 2 — Calm surfaces

### 2.1 `CardSection`

`src/components/CardSection.tsx` is the single lever. After Part 1 its
consumers are `HabitsCard`, `TodayWorkCard` and `GoalsCard`; all three flatten
together.

```
- <section className={`bg-panel border border-line rounded-card shadow-card px-[16px] py-[12px] ${className ?? ''}`}>
+ <section className={`group ${className ?? ''}`}>
-   <div className="flex items-center gap-[12px] mb-[6px]">
+   <div className="flex items-center gap-[12px] pb-[7px] mb-[4px] border-b border-line">
-     <span className="font-mono text-[.72rem] tracking-[.12em] uppercase text-muted font-semibold">
+     <span className="font-mono text-[.66rem] tracking-[.13em] uppercase text-faint">
```

The `group` class on the root is what lets Part 3's quiet `+` controls, passed
in through the `right` prop, reveal on section hover.

The label demotes from `text-muted font-semibold` to plain `text-faint`, and
the hairline moves from around the card to under the label. Row separators
(`border-b border-line-soft`) are unchanged — they already are the calm idiom,
and they carry the page's structure once the boxes are gone.

The `className` prop stays, but `GoalsCard`'s `pb-[6px]` becomes meaningless
once the section has no padding; drop it at the call site.

### 2.2 Layout

`src/index.css`:

- Delete the `.today-hero` rule (line 136) and remove `.today-hero` from the
  `@media (max-width: 1160px)` rule (line 149). With QuickAdd gone, Hero shares
  its row with nothing.
- `.today-main`: right column narrows `372px → 300px`. It holds Goals alone now.

`src/views/Today.tsx`:

- Hero becomes a plain full-width block with `mb-[18px]`; the wrapping
  `today-hero` grid is removed.
- `.today-main` column gap `20px → 26px`; each column's internal
  `gap-[14px] → gap-[26px]`. Flat sections need whitespace where card borders
  used to supply separation.
- Left column: `HabitsCard`, `TodayWorkCard`. Right column: `GoalsCard`.

### 2.3 `WeekStrip`

Seven `rounded-[11px] border bg-panel` buttons become one hairline row:

- container: `grid grid-cols-7 border-y border-line` (replacing `gap-[8px]`)
- cells: `border-r border-line-soft`, `last:border-r-0`
- today keeps `bg-panel-bright` and the accent weekday label, so it still reads
  as the current day
- `shadow-today` is dropped along with the other shadows

Net result: the page goes from six bordered, shadowed rectangles to zero. The
only filled surface left is today's cell in the week strip.

---

## Part 3 — Quiet controls

### 3.1 Button hierarchy

Today currently renders three identical `bg-ink text-paper` solid buttons:
`+ Habit` (`HabitsCard.tsx:315`), `Plan week` (`TodayWorkCard.tsx:84`) and
`+ Goal` (`GoalsCard.tsx:24`). Three primaries means no primary, and on a page
with no boxes they would be the only heavy shapes on screen.

- **`Plan week` stays solid.** It is the page's one genuine call to action and
  it carries the review badge.
- **`+ Habit` and `+ Goal` demote** to a quiet `+` glyph in the section-label
  row: `text-muted`, revealed on section hover through the `group` on the
  `CardSection` root (Part 2.1) and the `quiet-control` class (Part 3.4).

### 3.2 `+ Goal` needs a destination

`GoalsCard`'s `onAddGoal` prop today does nothing but focus QuickAdd, which is
being deleted. Replace it with `actions.setView('goals')`. The Goals view
already owns goal creation through `NewGoalModal` and JSON import
(`Goals.tsx:365`). This costs one extra click and adds no store state, and it
stops Today from duplicating a richer flow with a worse one.

`Today.tsx` drops the `onAddGoal` prop threading; `GoalsCard` calls the action
itself.

### 3.3 Row controls

The habit row's edit and remove controls and `DailyWorkRow`'s `action` slot
become quiet, following the intent of `GoalsCard.tsx:110` but through the
shared mechanism below rather than by copying its utility string.

### 3.4 One shared mechanism, not a copied utility string

Hover-reveal invites two specific regressions, and Tailwind's `hover:` variant
does not guard against either by default. Rather than repeat a fragile utility
string at each call site, add one class in `src/index.css`:

```css
/* Quiet controls: present and reachable always, visible on hover or focus.
   Gated on `@media (hover: hover)` because a coarse pointer has no hover
   state — on touch these must stay visible or they become unreachable.
   Uses opacity, never `display:none`, so the control keeps its place in the
   tab order. */
.quiet-control { opacity: 1; transition: opacity .12s; }
@media (hover: hover) {
  .group:not(:hover) .quiet-control:not(:focus-visible) { opacity: 0; }
}
```

Apply `quiet-control` to `+ Habit`, `+ Goal`, the habit row's edit/remove
controls and `DailyWorkRow`'s `action` slot. Row-level controls need their own
`group` on the row element, since `CardSection`'s `group` is section-scoped and
nested `group`s resolve to the nearest ancestor.

Migrate `GoalsCard.tsx:110`'s existing "→ today" button to `quiet-control` too.
It currently uses `focus:opacity-100`, which fires on mouse click as well as
keyboard focus; `:focus-visible` is the correct selector and this consolidates
on it.

---

## Verification

`vitest` runs `environment: 'node'` — there is no DOM. React components cannot
be unit-tested here, and this design does not pretend otherwise. Do not add
`jsdom`.

**Automated:**

- `npm test` — the substantive assertion is that `dailyWork.test.ts` still
  passes with the suggestion cases removed and no other behaviour changed.
  Record the before and after test counts.
- `npx tsc -b` — this is the real safety net. `noUnusedLocals` and
  `noUnusedParameters` are on, so every import orphaned by Part 1 is a hard
  compile error. That makes the compiler an accurate dead-code detector for
  exactly this kind of change; a clean build is meaningful evidence the
  deletions are complete.

**Manual smoke checklist:**

- [ ] Light and dark theme — no section reads as a floating box in either
- [ ] Viewport above and below the 1160px breakpoint
- [ ] Tab through Habits, Today's work and Goals; every `quiet-control`
      becomes visible when focused, and none is skipped in the tab order
- [ ] Clicking a day in the Timeline still lands on Today, unchanged
- [ ] `+ Goal` navigates to the Goals view
- [ ] `+ Habit` still opens `AddHabitForm` inline
- [ ] `Plan week` still opens the planner, review badge intact
- [ ] ⌘N still opens task capture
- [ ] `t` still navigates to Today
- [ ] Habit drag-reorder still works with the flattened section

`npm` works in this shell (v11.17.0). The "npm is broken" warning in
`docs/superpowers/plans/2026-07-30-plan-sidebar-and-flip.md` was specific to
that session.

## Constraints carried from CLAUDE.md

- Never stage, modify or commit `src/components/GoalTree.tsx` — it holds
  unrelated uncommitted user work. Never `git add -A` or `git add .`; stage
  every file explicitly by path.
- Views stay thin and delegate to `actions`; views never touch `db`.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`. This change adds
  no new logic — it only removes it.

## Relationship to the Plan flip

`docs/superpowers/plans/2026-07-30-plan-sidebar-and-flip.md` plans to make Plan
the home view, relocate Today's cards into a Plan sidebar accordion, and delete
`Today`. That plan's sidebar includes a quick-add and a Suggestions panel.

This design removes both from Today, along with the month calendar the flip
plan wanted to relocate as its `Month` panel.

**That plan has been amended to match.** It now carries a dated amendment
notice and edits to Tasks 2, 6, 8 and 11: the sidebar has two collapsible
panels (Habits, Stats) rather than four, `SidebarPanel` narrows to
`'habits' | 'stats'`, and `PlanSidebar` loses the `pinned` prop that existed
only to hold quick-add. The two documents are consistent, and either can land
first.

The deleted suggestion engine and `calendar.ts` remain in git history and can
be restored if a future surface wants them.
