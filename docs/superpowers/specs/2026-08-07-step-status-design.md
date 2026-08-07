# Step Status Design

**Date:** 2026-08-07
**Status:** Approved, ready for planning

## Goal

Make a step a real object you can manage, so a project or a learning goal can
answer "where does this stand" without asking about pace.

A step is currently a boolean: `done` or not. That is enough to compute a
percentage and nothing else. It cannot say which step you are part-way through,
and it cannot say which one is stuck — so a course with six chapters open at
once reads as "none of these are ticked", and a project blocked on someone
else's reply reads exactly like a project nobody has started.

This spec replaces the boolean with a four-state status, and threads that status
through the attention machinery that already exists.

## Scope

**Slice 1 (in scope for the implementation plan):** `src/db/types.ts`,
`src/db/db.ts`, `src/state/store.ts` (which is also where `importBackup` lives),
`src/lib/pct.ts`, `src/lib/tree.ts`, `src/lib/board.ts`, `src/lib/plan.ts`
(`focusSummary`, `projectAttention`, `cardPrimaryAction`), `src/lib/backlog.ts`
(`backlogGroups`), `src/components/GoalTree.tsx`, `src/views/project/StepPanel.tsx`,
`src/views/goals/BoardCard.tsx`, `src/views/goals/FocusSummary.tsx`, and a new
`src/lib/status.ts` with a sibling test.

**Slices 2 and 3 are specified here but NOT planned yet** — they exist in this
document so the model decisions can be checked against where they lead. Each
gets its own spec and plan when it is picked up.

**Out of scope entirely:** partial credit in the roll-up, a WIP cap on `doing`,
per-step priority, tags, blocked-by relations between steps, status on
containers as a stored field, and any change to `weekCapacity`.

## Decisions taken

| Question | Decision |
|---|---|
| Shape of the status | `'todo' \| 'doing' \| 'blocked' \| 'done'` |
| Keep `done` alongside `status` | **No.** `done` is removed. One field, one truth |
| Does status affect `pct` | **No.** `pct` counts `'done'` and nothing else |
| Partial credit for `doing` | **No.** Rejected explicitly; see Rejected below |
| Where the status is stored | Leaves only, matching `done` today |
| Default representation | Field absent ⇒ `'todo'`; `'todo'` is never written |
| Why blocked is more than a mood | A `blockedOn` one-liner the UI always asks for |
| Container status | Derived at read time, display only, never stored |
| The row control | The checkbox itself, four visual states |
| What a plain click does | Toggles `done ⟷ todo` — unchanged from today |
| Keyboard | `S` on the focused row opens a status popover |
| Bulk | One `setNodesStatus` write, one undo entry |
| New colour tokens | **None.** `warn` and `accent` already exist |
| Cap on concurrent `doing` | **No.** The 3-slot *Now* cap already does that job |

## Motivating problems

**A learning goal has no shape in Phase today.** Six chapters genuinely in
progress at once render identically to six chapters untouched. The tree's only
vocabulary is "ticked" and "not ticked", so the surface where you manage the
work is the surface least able to describe it.

**Blocked work is indistinguishable from unstarted work, and it poisons the
queue.** `firstOpenLeaf` returns the first leaf that is not done. If that leaf is
waiting on a reply you cannot chase, the board card says "Plan next step", the
backlog rail lists it, and every one of those surfaces is pointing you at the one
thing you cannot do. The rail's job is a queue you can work; today it cannot tell
a workable row from a stuck one.

**A step you have started is not the same as a step you have not.** "Next step"
should mean the thing already in your hands, not the next unstarted item in
document order. Today the two are the same query.

## Model

### The field

In `src/db/types.ts`:

```ts
export type StepStatus = 'todo' | 'doing' | 'blocked' | 'done';
```

On `GoalNode`, `done?: boolean` is **replaced** by:

```ts
status?: StepStatus;   // LEAVES only. Absent ⇒ 'todo'; 'todo' is never written.
blockedOn?: string;    // Present only while status === 'blocked'.
```

`blockedOn` is optional in the type — a legacy row, an import, or a status set
from the bulk bar can lack it — but every UI path that sets `'blocked'` asks for
it, and it is cleared on any transition out of `'blocked'`. A blocked step with
no `blockedOn` renders as blocked with no trailing text; it is not an error
state.

`doneAt` is unchanged: it remains the local `'YYYY-MM-DD'` completion date, set
on the transition into `'done'` and cleared on any transition out of it.

Absent-means-default matches the idiom already in the file (`column?: number`,
"Absent ⇒ 0"). A read helper `stepStatus(node): StepStatus` returns
`node.status ?? 'todo'`; writes normalise `'todo'` back to absent, so a
hand-edited import carrying an explicit `'todo'` reads correctly and is
normalised on its next write.

### Why `done` is removed rather than kept

Two fields encoding the same truth will drift, and the drift is silent: a code
path that sets `status: 'done'` without also setting `done: true` produces a step
that looks finished in the tree and counts as open in the roll-up. The
leaf-XOR-container comment already has to say "adding a child to a leaf deletes
its `done` and `doneAt`" — with one field that stays one deletion instead of
becoming two that can be forgotten independently.

The cost is a mechanical rename across every `.done` read on a `GoalNode`. That
cost is paid once, at the start, and is the reason status is slice 1 rather than
slice 3.

### The roll-up does not change

`src/lib/pct.ts` changes exactly one predicate: `leaf.done` becomes
`stepStatus(leaf) === 'done'`.

**For every existing dataset the percentage is numerically identical**, because
migration maps `done: true` to `'done'` and everything else to absent. `doing`
and `blocked` contribute zero, exactly as an unticked box does today.

This preserves the standing invariant that scheduling and annotation metadata
never move the roll-up. Status is not an exception to that rule — it is on the
same side of it as `estimateMin` and `plannedWeek`.

### Container status is derived

Containers store no status; leaf-XOR-container is untouched. A read-time
`containerStatus(node): StepStatus` exists for display only:

- `'done'` if every descendant leaf is done
- `'blocked'` if there is at least one open descendant leaf and **every** open
  descendant leaf is blocked
- `'doing'` if any descendant leaf is `'doing'`
- `'todo'` otherwise

The `blocked` rule is deliberately strict. A container with one blocked child and
four workable ones is not blocked — you can still work it, and calling it blocked
would hide four available rows behind one stuck one.

## What the status moves

A status that never moves a number is the exact complaint that retired
`Milestone`, and `checkpoint` replaced it specifically by counting in the
roll-up. Status must not repeat that mistake. It does not move `pct` — it moves
**attention**, through seams that already exist.

### 1. `firstOpenLeaf` (`src/lib/tree.ts`)

Prefers a `'doing'` leaf over a `'todo'` one, and skips `'blocked'` entirely.
Returns `null` when every open leaf is blocked.

"Next step" starts meaning *the thing you already started*. The `null` case is
new and every caller must handle it — see the next two seams.

### 2. `cardPrimaryAction` (`src/lib/plan.ts`)

Gains a verdict: when a project's only open work is blocked, the board card's
primary action becomes **"Unblock →"**, targeting that step and surfacing its
`blockedOn` line, instead of "Plan next step" pointing at work that cannot be
planned.

This composes with the existing `PLANNING_HORIZONS` rule rather than competing
with it: a parked project still withholds "Plan next step", and now a blocked
project withholds it too, for a different and stated reason.

### 3. `focusSummary` (`src/lib/plan.ts`, rendered by `src/views/goals/FocusSummary.tsx`)

Gains a fifth signal, `N blocked`, exposing its `goalIds` match set exactly as
the four beside it do — so the board's spotlight filter stays a pure set
membership check and no attention predicate is re-derived in the view.

### 4. `backlogGroups` (`src/lib/backlog.ts`, the Plan rail)

Blocked work is **dropped** from the rail, *unless* it carries a `plannedWeek`
(step) or a `date` (task).

This is verbatim the rule already written for parked projects: commitment is the
exception, because `weekCapacity` bills committed work to "to place" and a number
you plan against must have a row beside it. That the blocked case falls out of
the existing rule with no new machinery is the strongest evidence this design
fits the app.

A dropped blocked row is DROPPED, never demoted to "Loose tasks" — that bucket
means "belongs to no project", and it sits at the bottom of the rail, which is
more prominent than where the row started, not less.

### 5. `weekCapacity` is untouched

Blocked-but-scheduled work is still booked time. It is on your calendar whether
or not it is stuck, and quietly reclaiming that time would make the capacity
header disagree with the grid beside it.

## The tree row

The **checkbox becomes the status control** — one control with four visual
states, not a checkbox plus a separate chip.

| status | box |
|---|---|
| `todo` | empty — pixel-identical to today |
| `doing` | filled centre, `accent` |
| `blocked` | slashed, `warn` |
| `done` | check — pixel-identical to today |

A separate always-visible chip was considered and rejected on two counts: a
blocked step would show an untouched checkbox, which reads as "not started" and
is the confusion this spec exists to remove; and the row is already dense (drag
handle, twirl, checkbox, `◆` checkpoint, title, container %, estimate, logged
time, and four hover controls).

**A plain click and `Space` still toggle `done ⟷ todo`, exactly as today.** The
invariant sentence "ticking the checkbox remains the only thing that moves a
number" survives verbatim and needs no rewrite.

`blockedOn` renders as muted inline text after the title, truncated.

### Setting `doing` and `blocked`

Three paths, no new visual language:

- **`S`** on the focused row opens a four-item popover. Bare keys currently bound
  are `?`, `n`, `p`, `t`, `T`, and `0`–`3`; `s` is free. Digits are **not**
  available — `1`/`2`/`3` are the view switches.
- A **`.quiet-control`** button in the existing hover cluster. Never a
  hand-rolled `opacity-0 group-hover:opacity-100` — `.quiet-control` carries the
  `@media (hover: hover)` gate and the 24px target floor, and it needs a literal
  `group` ancestor.
- An explicit control at the top of `StepPanel`, with the `blockedOn` field
  appearing only when the status is `blocked`.

### Bulk

The selection bar gains "Set status ▾" beside Complete and Delete.

It is **one** `setNodesStatus` write arming **one** undo entry — never a loop
over a single-node action, because each call would arm its own entry and each
write's sweep would discard the ones before it. It returns whether it wrote, and
the caller must not report success on a refusal.

### Colour

**No new tokens.** `warn` and `accent`/`accent-tint` already exist in the theme.
Visual identity stays locked and `designScale.test.ts` stays green — no literal
hex, no arbitrary `text-[Nrem]`, no `fontSize` key colliding with a `colors` key.

### Board card

Gains an `N blocked` chip, and renders **"Unblock →"** when `cardPrimaryAction`
returns that verdict.

## Migration

The migration runs in **two** places:

1. The `src/db/db.ts` load path, for the local database.
2. `importBackup`, because a backup written a year ago can be imported tomorrow.

The mapping is total and lossless in one direction:

- `done: true` → `status: 'done'` (`doneAt` carried across unchanged)
- `done: false` or absent → `status` absent
- `blockedOn` is never produced by migration

Export writes the new shape only. `importBackup` remains a generation boundary
that clears `undoStack` and `pendingUndo` — unchanged by this spec.

## Testing

- **`src/lib/status.ts` + `status.test.ts`** — `stepStatus`, `containerStatus`,
  and the transition rules: entering `'done'` sets `doneAt`, leaving it clears
  `doneAt`, and leaving `'blocked'` clears `blockedOn`.
- **`pct.test.ts` golden identity test** — for every existing fixture, the
  migrated tree produces the same percentage as the boolean tree it came from.
  This is the load-bearing test of the whole slice.
- **`tree.test.ts`** — `firstOpenLeaf` prefers `doing`, skips `blocked`, and
  returns `null` when every open leaf is blocked.
- **Migration test** — legacy `done` shapes through both the load path and
  `importBackup`.
- **`GoalTree` component test** — clicks the child element a person actually
  hits, never the row: the rows are covered by children that stop propagation, so
  a test dispatching at the row element cannot see the `onClickCapture` path.
- **`designScale.test.ts`** — must stay green with no new tokens.

## Rejected

**Partial credit for `doing`.** Counting an in-progress step as half done lets
every step sit at 50% forever, which is precisely the self-deception the
commitment-honesty thesis exists to prevent. A percentage that can rise without
anything finishing is not a percentage.

**A WIP cap on concurrent `doing` steps.** Tempting given the 3-slot *Now* cap,
but that cap already enforces scarcity at the level where scarcity is real. A
second cap is friction without a new insight, and it would fire constantly on a
learning goal, where several chapters genuinely are open at once.

**Keeping `done` as a derived convenience field.** See "Why `done` is removed".

**Blocked-by relations between steps.** A step blocked by another step is a
dependency graph, and a dependency graph wants a scheduler. `blockedOn` is free
text on purpose: most blocks in this app's use cases are external (a reply, a
grade, a part in the post), not internal.

**Status on containers as a stored field.** It would break leaf-XOR-container,
and a container whose status disagreed with its children would be a second
source of truth about the same work.

## Slices

**Slice 1 — Status.** Everything above. Self-contained and independently useful.
This is what the implementation plan covers.

**Slice 2 — Reorganise fast.** Duplicate a step or subtree, paste a multiline
list as steps, move a step to another project, bulk indent and outdent. Motivated
by the CS-student feedback that a pset skeleton gets rebuilt roughly forty times
a term with no duplicate affordance anywhere.

**Slice 3 — Step detail.** A step as a real page rather than a 300px sidecar:
description, sub-steps shown in place, links, reusing the `assets` pipeline that
project Notes already has.

Slices 2 and 3 get their own specs and plans. They are named here so the model
decisions in slice 1 can be checked against where they lead.
