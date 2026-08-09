# A task gets its own page

**Date:** 2026-08-09
**Status:** approved, not yet implemented

## The problem

A task's note already exists — `GoalNode.notes`, edited with the same rich TipTap
editor (headings, task lists, pasted images backed by `assets`) that the goal's
Notes tab uses. What it does not have is room. It renders at the bottom of a
340px `StepPanel` docked to the right of the tree, below four property rows and,
on a container, a task list. Writing more than two sentences there is unpleasant,
and reading a note with a screenshot in it is worse.

The reference is a Linear issue page: a title, a row of property chips, and then
the body at full measure with its images inline.

## What this changes

**A leaf's destination is a page. A container keeps the inspector.**

| `openStepId` points at | Renders |
| --- | --- |
| a container | `StepPanel`, docked right — unchanged |
| a leaf | `TaskPage`, in place of the tab body |

The goal's Notes tab is untouched: goal-wide notes are a real, separate thing.

### The invariant this overturns

CLAUDE.md currently says:

> **A milestone is a lens on the open goal, not a destination.** `openArea` …
> refuses a leaf — a task's whole content is its inspector, so a page for one
> would be the inspector again with more chrome.

That rule names a real failure mode, and the design has to answer it rather than
ignore it. The answer is that the page's job is the *note*, and the properties
above it are chips — the same `Popover` controls the panel used, laid out
horizontally as readouts — not a second property list. The page is the note with
its context above it, not the inspector with more chrome.

The half of the sentence that survives is the first half: a page for a leaf is
still a **lens** on the open goal, by exactly the mechanism `openArea` uses.

## Design

### The model — `openStepId` does not change

`openStepId` already means "the node this goal page has open"; today every reader
renders it as a side panel. Only the **renderer** learns to branch on leaf-ness.
Everything built on the state keeps working unedited:

- **Escape.** `shouldCloseStepPanel` fires, `closeStep()` nulls `openStepId`, you
  are back on the tree. On a page that reads as Back; on a panel it reads as
  Close. The two-step Escape precedence (leave task → leave goal) survives.
- **Delete.** `removeNode`/`removeNodes` already null `openStepId` when the open
  node is inside the deleted subtree, so deleting the task you are looking at
  returns you to the tree for free.
- **⌘K on a task.** `openProject(goalId, nodeId)` already sets
  `openStepId: nodeId`; it now lands on the page instead of the panel.
- **Import.** `applyImportedBackup` already clears it.

All four `openStep` callers — the tree row click, the Board card, a container
panel's task list, and `AreaPage`'s overview — keep calling `openStep`
unchanged. None of them learns anything new.

### Where it renders

`Project.tsx` already branches to `AreaPage` when `openAreaId` is set. `TaskPage`
becomes the second branch by the same rule, with `openGoalId` still set behind
it. Inside a milestone, `AreaPage` branches the same way, giving a two-level
breadcrumb (`‹ Fitness / Chapter 2`).

Because the branch sits **above** the tabs, it fixes an existing dead click:
`BoardTab` passes `onOpen={actions.openStep}`, `openStep` does not switch tab,
and `StepPanel` is not rendered on the Board — so clicking a Board card today
sets state and shows nothing.

`openStep` still does not touch `projectTab`, so the tab you left is the tab you
return to: open a card from the Board, press Escape, and you are back on the
Board with nothing else moved.

**`StepPanel` becomes container-only.** Its `isLeaf` branches are removed, not
merely unreachable — after this change no call site can pass it a leaf, and a
dead branch that claims otherwise is a lie about what the component is for.

### The page

One 720px content column, matching the Notes tab's measure, because the note is
the point of the page.

```
‹ Fitness                                          ⋯

Run 5k                                        ← InlineEdit, ↵ or double-click

[◐ Doing]  [Dec 31]  [Fri 14:00 · 45m]  [45m]  [◇ Milestone]
Blocked on: front desk hasn't replied         ← only while blocked

───────────────────────────────────────────────────

Felt heavy on the second lap. Shoes are worn —
replace before next week.

[screenshot.png]

More cadence work?

───────────────────────────────────────────────────
Time · 1h 20m logged                    [⏱ Log time]
  Aug 7  40m  intervals
  Aug 4  40m
```

The chips are the existing controls re-skinned. Status, Dates, When and Milestone
are `PropertyRow`/`PropertyToggle` over the same `Popover`, laid out horizontally
instead of stacked, so the page and the panel cannot drift about what scheduling
offers. `EstimateControl` and `LogTimeControl` keep their own inline badge→field
swap rather than moving behind a popover — putting either behind one would nest a
disclosure inside a disclosure.

Three rules held deliberately:

1. **The blocked reason stays out of the status popover**, on its own line under
   the chips. It is what makes a blocked task actionable; hiding it behind the
   control that set the status would let the page say "Blocked" without ever
   saying what by.
2. **Done is reached through the status chip, routed via `toggleLeaf`** — as the
   panel already does — so completing from the page arms the same "Completed X"
   undo the tree checkbox does. No separate checkbox: one gesture for the one
   thing that moves a number.
3. **The `⋯` menu is a subset of `rowActions`: Rename, Indent, Outdent, Delete.**
   Schedule, Estimate and Milestone are omitted because they are chips two inches
   above. **Add task is omitted**: it converts the leaf into a container, which
   would eject you from the page you are reading. Converting a task into a group
   stays a tree operation.

Note saving is already correct for this. Departure flushes — `blur`, navigation
and unmount all save regardless of a live `pendingUndo`; only the debounce timer
is held. Escaping mid-sentence back to the tree keeps the typing.

### The breakdown proposal moves with the leaf

`StepsTab` gates "Break *X* into subtasks" on `openNode && !openNode.children?.length` —
it is **leaf-only**. If leaves stop opening in `StepsTab`, the feature becomes
unreachable, so `ProposalPanel` and its trigger move onto `TaskPage`. That is
where `ProposalPanel`'s own docstring already says it belongs: "attached to the
task it belongs to… the control for it belongs beside the subject."

Accepting a proposal gives the leaf children, so the render-time branch flips to
the container inspector on the very next paint. That is the conversion rule
working, not an edge case needing code.

### Edges

- **Leaf ⇄ container conversion needs no special case.** The branch is computed
  at render. Indent a sibling under the open task and it gains children — next
  render it is a container and the tab body shows tree + panel again. Delete a
  container's last child while its panel is open and it renders as a page.
- **⌘K to a leaf nested in a milestone** shows `‹ Fitness`, not the full ancestor
  chain, because `openAreaId` is null. Back lands on the goal tree with the node
  focused and expanded, which `openProject` already arranges.
- **Mobile.** The page is full-width and needs no media query. The
  `wide ? side : below` split stays in `StepsTab`/`AreaPage` but now only ever
  wraps a container.

## Files

| File | Change |
| --- | --- |
| `src/components/useNoteDraft.ts` + test | new — the note draft, debounce and departure flush, extracted from `NotesTab` and `StepPanel` before a third copy is written. The rule it holds (a timer never spends an undo; a departure always saves) is an invariant, and three copies would be three chances to break it. |
| `src/views/project/TaskPage.tsx` | new |
| `src/views/project/TaskPage.test.tsx` | new — chips, Done arms undo, blocked reason outside the popover, estimate, scheduling, `⋯` verbs, breakdown offer |
| `src/views/project/TaskPage.routing.test.tsx` | new — the leaf/container branch: page for a leaf, docked panel for a container, `closeStep` returns to the tree, milestone named in the breadcrumb |
| `src/views/project/StepPanel.tsx` | sheds the leaf-only half (~250 lines), keeps the container half |
| `src/views/project/StepPanel.test.tsx` | leaf cases move to `TaskPage.test.tsx`; container cases stay |
| `src/views/Project.tsx` | second branch, beside `AreaPage` |
| `src/views/project/AreaPage.tsx` | same branch; leaf panel arm removed |
| `src/views/project/StepsTab.tsx` | panel arm becomes container-only |
| `src/components/PropertyRow.tsx` | `PropertyChip` — same `Popover`, horizontal skin |
| `src/lib/rowActions.ts` + test | the page's verb subset, as a sibling of `rowActions` |
| `CLAUDE.md` | rewrite the "refuses a leaf" invariant; fix the stale `'done'` sentence |

`src/components/GoalTree.stepPanel.test.tsx` needs **no** change: it asserts a
plain row click calls `openStep`, which is still exactly true.

## Documentation bug found on the way

CLAUDE.md says the StepPanel's status popover "cannot reach `'done'` by design".
`StepPanel.tsx:280` routes Done through `toggleLeaf` and has for a while. The
code is right and the invariant text is stale; the sentence gets fixed, not the
code.

## Out of scope

- The goal Notes tab — untouched.
- `Today` and `Plan` — untouched; neither ever opened the inspector.
- No new store state, no store action signature change.
- No schema change: `GoalNode.notes` already holds the body and `assets` already
  holds pasted images.

## What we accept

Every leaf edit becomes a navigation. You can no longer adjust a task's estimate
while looking at the tree — the estimate and WHEN cells on the row itself remain
the only in-tree editors, which is what they were designed to be.
