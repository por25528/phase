# The shelf answers back — loose tasks reach it, and it can take a correction

**Date:** 2026-09-02
**Scope:** `PhaseApp/` only.

Two features, one theme: the Cmd+Space shelf is the surface the user actually
lives in, but it cannot bend the queue. Loose tasks starve out of its pool, and
when it recommends the wrong next thing there is no way to say "no — this
first" without leaving for the Goals tree.

## Part 1 — Loose tasks reach the shelf

### The starvation, named

The advisor's free-time pool is `todayPlan`'s rows: capped at `PROPOSAL_MAX`
(5), ordered by `sortByDue`, and an undated loose task sorts after everything
carrying a date. The shelf then shows primary + `MAX_ALTERNATIVES` (3), with
the last slot already subject to the life-diversity swap. An undated loose
task loses every one of those cuts, so in practice loose tasks never surface
on the shelf. This is a design gap, not a data problem.

### Design

1. **`proposalRows` takes an optional `max`** (default `PROPOSAL_MAX`, so the
   Today page is untouched). The advisor passes a higher ceiling (~12) so
   loose tasks at least enter its candidate pool.
2. **A second last-slot swap rule in `executionAdvisor`**, mirroring the
   existing life-diversity swap: if neither the primary nor any alternative is
   a loose task and the admitted queue holds one, the last alternative slot
   swaps in the first loose task from the remainder of the queue.
   - **Precedence: the loose-task swap wins over life-diversity.** A whole
     bucket absent beats a life under-represented — and a loose task carries
     no `lifeId`, so the two rules cannot both fire coherently on one slot.
   - Like the existing swap: the primary and earlier alternatives never move,
     and no claim is made in copy.
3. **The dials still apply.** A loose task filtered out by the time or focus
   lens stays out; the swap draws only from the admitted queue. No new UI —
   the row renders like any other alternative.

### Known cost

A loose task now occupies one of three alternative slots even on a day when
projects have urgent work. That is the point of the change, and it is bounded:
one slot, only when the queue holds a loose task at all.

## Part 2 — "Do this first"

### What it is

The shelf's primary card grows a quiet control — `Do first…` — that reveals a
one-line title input. Typing a title and pressing Enter:

1. **Primary is a step:** a new step is inserted **before** it among its
   siblings. New tree helper `insertSiblingBefore` beside the existing
   `insertSiblingAfter`, plus a store action. This is durable ordering: the
   project's queue genuinely leads with the new step, so Today, the backlog
   rail and the advisor all agree tomorrow too.
2. **Primary is a loose task:** a new loose task is created — loose tasks
   have no sibling queue to insert into.
3. **Either way the shelf points at the new work immediately** via the
   existing `chosen`/`promoteWork` mechanism — the same lens the Or-band's
   `switch-focus` verb uses. This is required, not a nicety: a fresh
   uncommitted step cannot outrank a scheduled commitment in the advisor's
   data ordering, so the ephemeral choice is what makes it primary *right
   now*, while the tree insert is what keeps the order true later.

### Rules

- New work is **title-only**: unestimated, uncommitted, undated. Capture and
  commitment are different acts — the quick-add rule, unchanged.
- It is a **distance write** (the tree is not visible from the shelf), so the
  store action arms an undo: `Added "X" first`. One `withUndo` write covering
  the insert.
- A new dispatch verb crosses the shelf relay (`insert-before`), validated at
  the renderer seam like every other verb. The embedded 380px panel gets the
  same control, so both presentations stay one surface.
- **Today's Now row** offers the same verb through the same store action — a
  small UI addition, no second code path.
- **Not a sentence parser.** One field, one meaning (a title). The retired
  typed-vocabulary decision ("the shelf starts work; it does not parse
  sentences") stands.

### Error handling

- Primary gone by the time Enter lands (completed or deleted elsewhere): the
  action refuses, and the shelf's notice line says so. A refusal is never
  reported as success.
- Blank or whitespace-only title: no-op.

## Testing

- Lib tests: `insertSiblingBefore`; the advisor's loose-task swap (fires when
  absent, defers to nothing, respects the dials, wins over life-diversity).
- Store test: the `Do first` action's undo restores the insert and nothing
  else; the refusal path when the anchor is gone.
- Surface test: the shelf control dispatches the verb and the promoted row
  becomes primary; the Today Now row variant books through the same action.

## Sequencing

Part 1 ships first — it is pure-lib and independently valuable. Part 2
follows, and its promoted-work behaviour is testable against Part 1's pool
unchanged.
