# The goal page: metadata under its task, and one object in the header

**Date:** 2026-08-16
**Surface:** `src/views/Project.tsx` and the Tasks tab — `StepsTab.tsx`, `ProjectHeader.tsx`, `GoalMetaPopover.tsx`, `components/GoalTree.tsx`

## The complaint

On a goal with five tasks, the Tasks tab reads as unfinished. Four things cause it,
and a fifth thing that looks like a cause is not one.

1. **The gutter.** The row is one flex line: the title takes `flex-1`, and the WHEN
   and estimate cells are pinned right at `w-[92px]` and `w-[56px]`
   (`GoalTree.tsx:908–954`). A short title therefore leaves ~700px of nothing
   between a task and its own metadata. `2h25` sits at the far right edge with no
   column header naming it, and the container's `pct` lands in a third position
   that aligns with neither.
2. **The header is a four-fact chain at one weight.** `Tight · Due Jan 15 · 2h 25m
   left · 0%` (`ProjectHeader.tsx:114–143`). There is no focal point, and the whole
   run is a popover trigger, which is not evident.
3. **`Focus` is a label wearing a value's clothes.** Unset, the demand trigger
   renders the literal word `Focus` (`ProjectHeader.tsx:170`) — indistinguishable
   from a verb, and ambiguous with focus *mode*.
4. **A ghost input per expanded container.** `AddChildInput` renders unconditionally
   inside every open container (`GoalTree.tsx:1027–1031`), wedged between that
   container's children and its next sibling. It also says `+ add item…` where the
   root input says `+ add task…` and the `⋯` menu says `Add task`
   (`rowActions.ts:79`) — one act, three spellings.

**Not a cause: the orange.** `rowSchedule.ts:77–99` sets `tone: 'warn'` only where
the row is genuinely late. Three orange dates on a page means three late tasks. The
colour is correct and is left alone.

## What changes

### 1. The row is two lines, but only when it has something to say

The metadata group — demand chip, WHEN cell, estimate, blocked reason — leaves the
right edge and sits on a second line, left-aligned to the **title's own left edge**:

```
[grip][twirl][☐][◆]  Define the Roblox topics to learn        [◐][⋯]
                     Aug 13 11:20am · 2h25
```

The gutter is not narrowed. It is deleted, because nothing spans it any more. This
is why the design takes no column headers: an unlabelled `2h25` 700px from its task
needs a caption, and an `Aug 13 11:20am · 2h25` directly beneath its own title does
not.

**Placement is a function of content, and there are exactly two placements.**

| Leaf has | Placement | Visibility |
| --- | --- | --- |
| any of: schedule text, estimate, demand, blocked reason | line 2, under the title | always |
| none of them | inline, at the end of line 1 | `quiet-control` (hover/focus) |

The second case is the load-bearing one. Three of the five rows in the reported
screenshot are bare, and a bare row still needs its scheduling affordance — today a
faint `plan` trigger in the WHEN cell (`GoalTree.tsx:919–931`). If that affordance
appeared as a *second line* on hover, every row you passed would grow taller and
shove the rest of the list down. Rendering it inline on the line that already exists
means **a row never changes height on hover.** This is a hard requirement, not a
preference, and it gets a test.

Unchanged: the WHEN cell stays the `Popover` trigger over `ScheduleMenu`; the
estimate stays `EstimateControl`. They change position, not behaviour, and every
keyboard route into them (`⇧S`, `E`) still lands on the same ref.

Line 2 aligns to the title by sharing the title's left offset, derived from the same
leading cells (grip, twirl/spacer, checkbox) rather than restated as a literal. A
hard-coded indent would drift the first time one of those cells changes width.

Containers are untouched on this point — `pct`, the derived `blocked` word, and a
container's own demand chip all stay on line 1, and a container has no line 2. A
container carries no estimate and no schedule by design (`setNodeEstimate` refuses
one; a group is scheduled through its tasks), and its read-only WHEN readout is
already narrow, so there is nothing worth moving. `metaPlacement` is therefore never
called for a container, and the demand chip is the one item in the metadata group
that renders in both places depending on row type.

**Accepted cost.** The estimate stops being a column. You can no longer run your eye
down the right edge to compare durations across tasks. `w-[56px]` existed to make
that scan possible, and this removes it. The trade is taken deliberately: the scan
was already unreadable at 700px of separation, and per-task legibility is worth more
on a page whose job is decomposition. Cross-task duration comparison remains
available on the Board and Calendar tabs, which are built for it.

### 2. The header gets one object instead of a chain

Health becomes a discrete pill — `rounded-[4px]`, `text-meta`, `font-semibold`, on a
`bg-hover` ground. Everything after it (`Due Jan 15 · 2h 25m left · 0%`) stays
`text-muted`, as it already is.

**`HEALTH_TONE` is not touched.** It maps `tight` and `on-track` to `text-ink-soft`
and only `at-risk`/`blocked` to `text-warn` (`health.ts:38–44`). That restraint is
already correct — colour arrives only when something is wrong. So the pill earns
focus through **weight and ground, never hue**: on a healthy goal the header stays
entirely neutral, and the pill turns warn-toned only when the verdict does.

No progress bar and no ring. `ProjectHeader.tsx:138–142` retired a 40px numeral over
a page-wide bar, and that decision stands.

### 3. Focus moves into `GoalMetaPopover`, as an inline control

The demand trigger leaves the header line and becomes a labelled row inside the
status popover, above the `dl`:

```
Focus needed    [ Light | Moderate | Deep | Not set ]
```

**It is an inline segmented control, not a nested `Popover`.** This is forced, not
stylistic. `GoalMetaPopover` is a hand-rolled `role="dialog"` that registers its own
capture-phase Escape listener on `window` (lines 63–72). A `Popover` opened inside it
registers a second capture listener on the same node, and capture listeners on one
node fire in registration order — the meta popover always registers first, because it
opened first. One Escape would close both. This is precisely the failure CLAUDE.md
documents for `Modal`, and the `data-popover-open` mechanism that solves it lives in
`Modal`, not here. Three values plus "Not set" do not need a disclosure, so the
cheapest correct answer is to have no second popover at all.

**A frozen goal withholds it.** The header gated this control on `!isCompleted`
(`ProjectHeader.tsx:163`), matching the rule that every editor writing to a completed
goal is withheld. `GoalMetaPopover` renders regardless of completion, so the Focus
row carries that gate itself. Losing it in the move would let a completed goal be
edited through a surface that shows no other editor.

The reversal is deliberate and narrow. `ProjectHeader.tsx:158–162` argues demand
belongs in the header's control group *rather than the overflow menu*, because that
menu holds irreversible lifecycle verbs and a property editor among them would read
as one. `GoalMetaPopover` is not that menu — it is where the goal's other properties
already live. The original reasoning is satisfied, not overturned.

### 4. Copy and clutter

- Both ghost inputs become **`+ Add task`**, matching `rowActions.ts:79`. One verb
  across the row menu, the nested input and the root input.
- `AddChildInput` renders only when its container's subtree is hovered **or contains
  focus**. Focus is not optional: hover alone would make it keyboard-unreachable.
- The root `+ Add task` under the tree stays permanent — it is the page's one
  standing invitation, and a goal with no tasks has no subtree to hover.
- Titles get `truncate` plus a `title` attribute. They currently wrap unbounded.

### 5. Explicitly out of scope

- **No summary footer.** It would restate the header's `2h 25m left · 0%` one screen
  lower and create a second place those figures could disagree.
- **No column headers and no eyebrow.** `StepsTab.tsx:37–41` stands.
- **No typed-confirmation on destructive actions.** Phase guarantees reversibility
  through `scheduleUndo`, not through friction. A typing gate would be a second
  mechanism for one guarantee, and the weaker of the two would carry the ceremony.
- **No change to `rowSchedule` tones, `HEALTH_TONE`, or any colour token.**

## Structure

The placement decision is the only real logic here, and it is a pure function of a
node, so it goes in `src/lib` with a sibling test per the repo convention:

```ts
// src/lib/rowMeta.ts
export type MetaPlacement = 'below' | 'inline';
export function metaPlacement(n: GoalNode, today: string): MetaPlacement;
```

`'below'` when the leaf has any of schedule text (via `scheduleCell`), an
`estimateMin`, a `demand`, or a blocked reason; `'inline'` otherwise. Containers are
not passed to it.

`GoalTree.tsx` gains one small component, `LeafMeta`, taking that placement and
rendering the same children either way. It is one component and not two so the two
placements cannot drift in what they contain — the whole point is that hovering a
bare row reveals the *same* controls a populated row shows.

## Tests

**`src/lib/rowMeta.test.ts`** — placement for each triggering field, and `'inline'`
for a leaf carrying none of them.

**`src/components/GoalTree.*.test.tsx`**

- A row with a schedule renders its WHEN cell below the title, not in a right-edge cell.
- **A bare row does not change height on hover.** The reflow guarantee, asserted directly.
- A bare row's revealed controls are the same accessible names a populated row shows.
- The nested add input is reachable by keyboard focus, not hover alone.
- Both add inputs and the `⋯` menu item carry the accessible name `Add task`.

**`src/views/project/ProjectHeader.test.tsx`**

- The header no longer renders a demand control.
- A healthy goal's header contains no `text-warn` element.

**`src/views/project/GoalMetaPopover.test.tsx`** (new)

- The Focus control sets demand, and offers `Not set`.
- **Escape inside the Focus control does not close the popover** — the regression
  the inline control exists to prevent.
- A completed goal renders no Focus control.

## Risks

- **Row height and drag.** Two-line rows change the sortable item's box. dnd-kit
  measures at drag start, so this should be transparent, but reordering a mixed list
  of one- and two-line rows is worth checking by hand before merge.
- **Hover-reveal on touch.** `.quiet-control` carries the `@media (hover: hover)`
  gate and a 24px floor, so bare-row controls stay visible on touch. Using a
  hand-rolled `opacity-0 group-hover:` here would strand them; the class is required.
- **`group` nesting.** The row already declares `group` (`ROW_CLS`), and the subtree
  reveal needs a second scope at the container level. Tailwind's bare `group` does
  not nest, and CLAUDE.md notes `group/name` does not match `.quiet-control`. The
  subtree reveal therefore uses its own named group with its own utilities, and must
  not be routed through `.quiet-control`.
