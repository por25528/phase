# Bulk park, and making the selection visible

**Date:** 2026-08-26
**Surface:** `PhaseApp` — the goal tree (`src/components/GoalTree.tsx`), reached
from a project's Tasks tab and from `AreaPage`.

## The problem

Multi-selection already ships. `⌘`-click, `⇧`-click, `Space`, `⌘A` and
`⇧↑/↓` all build a `Set<string>` in `GoalTree`, and a `SelectionBar` above the
tree offers Complete, Set status… (which includes **Parked**), Set focus
needed…, Delete and Clear. `actions.setNodesStatus` writes the whole selection
in one pass with one undo entry.

The user asked for the feature anyway, having parked a dozen tasks one at a
time. So the defect is not capability — it is that **nothing on screen says a
selection is possible**, and that the one verb they wanted takes two clicks
through a dropdown while its sibling verbs (Complete, Delete) are buttons.

A second, smaller defect fell out of the audit: `P` is the only row key that
ignores a selection. `X` completes the selection, `⌫` deletes it, `P` parks the
focused row alone.

## What changes

Three changes, all in the tree. No new store actions.

### 1. `P` respects the selection

`GoalTree.tsx`'s row `handleKeyDown` currently ends its `P` branch with
`actions.toggleParked(n.id)`. It gains the same shape `X` and `⌫` already have:

```
if (selected.size > 0) onBulk('park');
else if (!hasKids) actions.toggleParked(n.id);
```

The `hasKids` early-return moves inside the else. With a selection, containers
are legal — `setNodesStatus` expands them via `allLeavesUnder`, exactly as the
existing bar dropdown already does.

### 2. A Park button in the `SelectionBar`

Sits immediately after Complete, in the same `text-accent-deep` weight. Park
stays in the Set status… dropdown too; the button is a shortcut to one of the
five, not a replacement, so the dropdown keeps holding the whole vocabulary.

**It toggles**, matching `toggleParked`'s single-row semantics. The direction is
decided by the same population `setNodesStatus` will write to: every ACTIVE
(non-done) leaf under the selection. If all of them are `'parked'` the button
reads **Unpark** and writes `'todo'`; otherwise it reads **Park** and writes
`'parked'`. A mixed selection parks — the majority reading would make the label
unpredictable, and "park what isn't parked" is the intent behind a mixed pick.

A new pure helper, `src/lib/selection.ts` → `allParked(nodes, selected):
boolean`, computes it, so the label is unit-testable without mounting a tree.
It shares `allLeavesUnder`'s expansion so the button can never describe a
different population than the write.

**Known cost:** unparking routes through `setNodesStatus(ids, 'todo')`, whose
undo toast is `STATUS_LABEL.todo` → `Reset 3 tasks`, not `Unparked 3 tasks`.
That is honest (the leaves do go to `todo`) but flat. Accepted rather than
branching `STATUS_LABEL` on caller intent, which would make one label depend on
who asked for a write — the thing that registry exists to prevent.

### 3. The affordance — a menu verb AND a hover pick

Both routes, because they teach different users. The menu is where someone who
opens menus finds it; the hover circle is where someone who never opens a menu
finds it.

**3a. `Select` in the row's `⋯` menu.** `lib/rowActions.ts` gains
`{ id: 'select', label: 'Select', hint: 'Space', group: 0 }`, offered on leaves
AND containers (the selection takes both). It is placed in group 0 beside
Rename, not down with the destructive verbs — picking a row is navigation, not
mutation. `RowActions` currently takes only row-local callbacks (`onRename`,
`onEstimate`, `onSchedule`); it gains an `onSelect: () => void` in the same
shape, wired by `Row` to `onSelect(n.id, 'toggle')`. The registry's existing
`hint` mechanism does the teaching for free — this is why `⌘]` is discoverable
without the shortcuts overlay, and it is the same trade.

**3b. A pick circle in the row's leading gutter.** A 24×24 button holding a
13px **circle**, placed BEFORE the drag handle, carrying `quiet-control` so it
is invisible at rest on a fine pointer and always shown on a coarse one — the
same gate the drag handle uses.

The shape is the whole design. The leaf's existing `LeafStatusBox` is a 17px
`rounded-[6px]` square whose fill states (`✓`, dot, `╱`, bar) are the app's
vocabulary for what the WORK is doing. A second square 9px away would put two
readings of "state" in one cluster and undo the thing `STATUS_BOX` exists to
say. A circle is categorically a PICK — the radio/avatar reading — and the drag
handle physically separates it from the status box.

States: empty circle (`border-check`) at rest; filled `bg-accent` with a white
tick when selected. **Once any row is selected the circles stop being quiet** —
every row in the tree shows its circle, selected or not, so the extent of the
selection is legible without hovering each row. That is a `selected.size > 0`
class swap on the button, not new state.

`tabIndex={-1}` and `stopPropagation` on click, like every other row control;
the row stays the focusable unit and `Space` stays the keyboard route.

Containers get the circle too, in `RuleHeader`'s `lead` slot before the drag
handle.

### 4. The bar's live label teaches extension

`3 tasks selected` becomes `3 tasks selected · ⌘-click to add · ⇧-click for a
range`. The hint is a separate `<span aria-hidden="true">` after the count, so
the `aria-live` region still announces only the count — a live region that
re-reads a static instruction on every pick is noise. Costs nothing when the
bar is collapsed.

## What does not change

- No new store actions. `setNodesStatus` and `toggleParked` are untouched.
- No change to `pct.ts`, `effort.ts`, or anything that reads status. Parking N
  leaves is N applications of a write that already exists.
- The `SelectionBar`'s always-mounted / height-collapsed structure stays: the
  live region must exist before its first message.
- `ShortcutsOverlay` already documents `⌘`-click, `Space`, `⇧↑↓`, `⌘A` and `⌫`.
  It gains one line for `P`, since that key's meaning now widens.

## Testing

- `src/lib/selection.test.ts` — `allParked` over: all parked → true; one `todo`
  among them → false; a container whose every leaf is parked → true; a done
  leaf among parked ones ignored (not active) → true; empty selection → false.
- `src/lib/rowActions.test.ts` — `Select` present on both a leaf and a
  container, in group 0, carrying the `Space` hint.
- `src/components/GoalTree.selection.test.tsx` — `P` with a selection parks all
  of it (one `setNodesStatus` call, not N `toggleParked` calls); `P` with no
  selection still toggles the focused row; the bar's Park button reads
  **Unpark** and writes `'todo'` when every selected leaf is parked; clicking a
  row's pick circle toggles it into the selection without completing it; the
  circles become visible on every row once one is picked.

## Verification

`npx tsc -b && npm test` from `PhaseApp/`.
