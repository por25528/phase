# The calendar block as an instrument

**Date:** 2026-08-23
**Surfaces:** `src/views/plan/EventBlock.tsx`, `src/views/plan/BlockComposer.tsx`,
`src/views/plan/DayColumn.tsx`, `src/views/Plan.tsx`, `src/state/store.ts`, `src/index.css`

---

## The complaint

Three things, in the order a person meets them.

A **block** is a coloured card. Its 3px project edge is a border and nothing more, its
times are set in the UI face at 12px, and it states its start and end but never its
length — so a bar on the grid cannot be checked against the estimate that priced it
without arithmetic. On a surface whose whole argument is that it is a measured object,
the object that carries the measurement is the one thing that does not look measured.

A **drag** is a 220px text pill. It says what you picked up and nothing about where it
is going. The aim is resolved once, at `handleDragEnd`, so the app's answer to "where
will this land" arrives strictly after the moment the user could act on it — and when
`resolveSlot` slides the bar past occupied work, the first the user hears of it is the
bar appearing somewhere they did not aim.

A **composer** — the field you get after drawing a block — is a 14px title over a hundred
and thirty pixels of nothing, with the span jammed underneath, no statement of how to
commit, and a body that silently destroys your typing if you click it.

---

## 1. The block is a dimension line

`EventBlock.tsx`.

### The spine

The `border-l-[3px]` project accent becomes a drawn element: a 3px column at `left-0`,
full height, in the project hue, **capped** with an 8px hairline tick in the same hue at
the top and bottom edge. That is the whole aesthetic move. A coloured border says "this
belongs to project X"; a capped spine says "this span runs from here to here, and it
belongs to project X" — the second fact is the one a calendar exists to state, and it is
the reading a dimension line on a technical drawing gives.

The caps are `pointer-events-none` and inside the block's own `overflow-hidden`, so they
take the corner radius without restating it. The spine keeps its `z` above the tint and
below the controls.

### The type

Every time on a block moves to `font-mono`. This is not a new voice: mono is already the
app's face for measured figures — the hour gutter, the day-load figures, `stampLabel`,
every `sectionLabel`. A block's start and end are measured figures and were the
conspicuous exception.

`tabular-nums` stays. `text-micro` (11px) rather than `text-meta` (12px), because a mono
face at the same nominal size reads a step larger than the UI face beside it, and the
title must stay the loudest thing in the block.

### Three heights, and a footer rule

| Height | Layout |
| --- | --- |
| `≥ FOOTER_BLOCK_PX` (56) | Title (`line-clamp-3`), then a `border-t border-line-soft` **footer rule** with two cells: `09:00 – 10:30` mono on the left, `1h 30m` (`fmtMinutes`) `text-muted` on the reading edge |
| 40–56 | Title + mono span. No rule, no duration |
| `< COMPACT_BLOCK_PX` (40) | One line: `09:00 · Title`, mono time |

The footer is the `RuleHeader` grammar restated inside a block — a hairline with a fact
at each end — and it is what makes room for the duration, which is stated nowhere on a
block today. It renders only where there is height for it: a cell that has to sit on the
title is worse than no cell.

The footer's negative margins pull the rule out to the block's own edges, so it reads as
a division of the block rather than a line drawn inside its padding.

### What does not change

The tint layer, the opaque `bg-panel` ground, `projectAccentClass`/`projectTintClass`,
the dashed border for `estimated: false`, the `done` treatment, the ✓ and ✕ controls and
their `.quiet-control` rules, the `revealed` ring, `assignLanes` geometry, every
`aria-label` and the `title` tooltip. This is a drawing change.

---

## 2. The drag says where it will land

### The ghost

`DragOverlay` renders `BlockGhost` (new, `src/views/plan/BlockGhost.tsx`) — the block's
own chrome at its true height (`durationMin * PX_PER_MINUTE`), with `shadow-today`,
`border-accent`, and no tilt. Its time line is **live**: it reads the resolved start,
not the title alone.

A row dragged from the backlog rail has no block to replicate, so it gets the same ghost
built from its `PlanDragData` — `title` and `durationMin` are both already on the drag
payload for exactly this kind of use.

### The landing outline

`LandingOutline` (new, `src/views/plan/LandingOutline.tsx`) draws in the hovered column
at the resolved slot: `border border-dashed border-accent bg-accent/10`, the same
vocabulary `DayCanvas`'s draw-preview already uses, with the span in mono accent at its
top-left.

It shows the **resolved** slot, not the raw aim. A preview that showed the aim would
disagree with the write the moment the day has anything on it, and "the preview and the
write agree about where things land" is already this codebase's rule for `proposeReplan`.

### `previewPlacement` — a dry run in the store

`store.ts` carries the comment *"Views never call resolveSlot"*, and that rule stays. The
preview is a **read** exported beside the actions:

```ts
previewPlacement(
  kind: 'step' | 'task',
  id: string,
  date: string,
  aimMin: number,
  opts?: { blockId?: string },
): { startMin: number; durationMin: number } | null
```

It resolves exactly as `scheduleNode`/`scheduleTask` do — `WHOLE_DAY`, `NO_PAST_LIMIT`,
`spansOn(..., vacating(...))` — and writes nothing, raises no toast. `null` means the day
is booked solid, which is the same condition `describeNoRoom` reports after a drop; the
outline simply does not render, and the day heading's existing `full` chip is already
saying it.

This is not a new code path so much as a factoring: the resolution is lifted into a
private helper that both the preview and the two schedule actions call, so a preview that
disagreed with its own write would be a compile error rather than a bug.

### Live aim

`Plan.tsx` gains `onDragMove`. The coordinate maths is the existing `aimMinuteFor`,
extracted into one `aimFromDragEvent(e, scrollerRef, gridRef)` helper that both
`onDragMove` and `onDragEnd` call — the two must not be able to disagree about where the
pointer is. The scroller-bounds guard moves into that helper with it.

`spansOn` runs per move, so the resolution is memoised per `(date, durationMin, aimMin)`
for the length of the drag.

---

## 3. The composer is the block it is about to become

`BlockComposer.tsx`.

### The size bug

`src/index.css:198` sets `input, select { font-size: 14px }` in `@layer base`. The
composer's wrapper carries `text-badge` (12px); the input inherits nothing, so the base
rule wins on specificity. The title you are typing is 14px and the block it turns into is
12px.

Fix: `text-badge` on the **input**, not a change to the base rule — that rule is right for
every dialog field in the app and this is the one place a field has to match a
non-field beside it.

### The shape

The composer takes the block's own anatomy: the capped spine (in `accent`, because it has
no project yet and the spine is where the project hue will land), the same padding, the
same 12px title, and the span moved down onto a **footer rule** — where the block will
keep it.

The footer's reading edge carries `↵ add · esc`, in mono `text-micro text-muted`. This is
the move `dialogRuleHint` already makes: the affordance becomes a sentence. Today the
composer documents neither of its two exits.

Below `FOOTER_BLOCK_PX` the composer collapses to one row — field and span side by side,
no rule, no hint — the same threshold the block uses.

### The click-to-cancel bug

The wrapper's `onPointerDown` calls `stopPropagation` but not `preventDefault`, so a press
anywhere on the composer's body moves focus off the input, `onBlur` fires, and
`finish(false)` discards everything typed. `preventDefault` when the target is not the
input itself keeps focus where it is.

`onBlur` still cancels — that is correct, and is what makes the create gesture a single
click with no confirmation step. What is being fixed is that the composer's own surface
counted as "somewhere else".

`variant: 'bar'` (the month grid, which has no time axis) keeps its current inline shape
and gains only the input's size fix.

---

## 4. Motion

Five moments, all under the existing `prefers-reduced-motion` block in `index.css`, which
already kills every transition and animation.

| Moment | Treatment | Why |
| --- | --- | --- |
| **Press** | The bar takes `shadow-card` and `scale(.994)` over 110ms, on `pointerdown`, before dnd-kit's 5px threshold | A surface that does nothing for the first five pixels reads as slow even when it is not |
| **Lift** | The ghost scales to `1.018` and its shadow deepens over 130ms; the source bar leaves a dashed hole rather than a 40%-opacity copy | A bar in the air is not a bar that vanished. The hole holds its place until it is spent |
| **Track** | The ghost is pinned 1:1 to the cursor — dnd-kit's own transform, no easing added | Lag on the thing under your finger is the one place motion always reads as slow |
| **Resolve** | The landing outline eases `top`/`height` over 110ms | It steps aside past occupied work; a jump reads as a glitch, a slide reads as a decision |
| **Land** | `DragOverlay`'s `dropAnimation` flies the ghost to the outline's rect over 170ms, un-scaling as it goes | A ghost that blinks out and a bar that blinks in are two events; one flight is one event |

The flight is implementable precisely because the landing outline is ours: its rect is
known at the moment of release, so `dropAnimation.keyframes` gets a real `final`
transform instead of dnd-kit's default, which animates back to the *old* position.

The drop-target column's `bg-accent/5` gains a 120ms transition and an accent hairline on
its leading edge (`inset 2px 0 0`), so the target reads as chosen rather than faintly
washed.

**No enter animation for blocks**, and no hover scale. A week's worth of bars fading in on
every navigation is a texture, not information.

---

## 5. Resize

The preview snaps to `SLOT_GRANULARITY_MIN` (5) — the grain `resolveSlot` already rounds
every start to — so the block stops jittering a pixel at a time. `EventBlock` keeps
owning the preview locally; only the rounding changes.

A badge pinned at the block's bottom-right states `→ 10:45 · 1h 30m` while the grip is
held. That is what makes the clamp at the next bar visible *before* the release rather
than as a toast afterwards; `clampResize` and `describeResizeRefused` are unchanged.

The grip's decoration becomes a 22×2px flat rule rather than a 20×3px pill, matching the
instrument voice. It stays `pointer-events-none` under a live 8px strip — the exemption
`designScale.test.ts` carries in words.

---

## Testing

| File | Pins |
| --- | --- |
| `EventBlock.test.tsx` (new) | The three heights; the footer rule appears only at `≥ FOOTER_BLOCK_PX`; the duration cell states `fmtMinutes`; mono on every time; the spine renders with the project hue; `aria-label` and tooltip unchanged |
| `BlockComposer.test.tsx` (existing) | Add: the input carries the block's size class; the hint renders at full height and not below the threshold; a pointerdown on the body does **not** cancel; blur still does |
| `store.previewPlacement.test.ts` (new) | The preview returns the same start the subsequent write produces, including the slide past occupied work; `null` on a booked-solid day; writes nothing and raises no toast |
| `dropTarget.test.ts` (existing) | Add: `aimFromDragEvent` returns the same minute for the same geometry that `aimMinuteFor` does — the extraction is behaviour-preserving |
| `designScale.test.ts` (existing) | Unchanged, and must stay green: no literal hex, no arbitrary `text-[Nrem]`, radii within the permitted set |

`npm test` and `npx tsc -b` before committing, per the repo's conventions.

---

## Deliberately not doing

- **No enter/exit animation on blocks.** See Motion.
- **No second segment on a container's progress bar** — unrelated, but the same rule
  applies to a block: it states facts the app computes, and nothing it does not.
- **No change to `capacity.ts`, `slot.ts`'s semantics, `assignLanes`, or the availability
  rules.** `WHOLE_DAY` for every manual placement stays exactly as it is; the preview
  spends the same region the write spends, which is the entire point of factoring the
  resolution rather than reimplementing it.
- **No landing outline in month mode.** A month cell has no time axis, so there is no slot
  to outline — the drop aims at `aimFor(date, ...)` and `resolveSlot` chooses the hour.
  The column tint is the whole feedback there, as now.
