# A verb that decides, and a term that parks

The agent surface has nine verbs that write. Not one of them can move a project
between horizons. `add_task`, `create_project`, `estimate`, `schedule` — every
one of them makes the board bigger; none of them makes a decision about what
belongs on it. So an assistant driving Phase from a terminal can only ever pile
work on, which is precisely the complaint that produced this spec: *"even with
using Claude MCP to help managing my goals and stuff, it feels overwhelming."*

Of course it does. The agent has no triage.

**Scope: two slices.** §1 adds `set_horizon` — one verb, one existing action,
no new store mutation. §2 adds a term, and does it by making the board's
existing "parked" rule date-aware rather than by inventing a second gate. §3
names what is deliberately deferred, and why the deferral is not tidiness.

## The problem, in the owner's data

Read through the MCP on 16 August 2026.

- **Thirteen projects, 428h of remaining work.** Seven of them are midterms
  sitting between 21 and 25 September; they total ~90h, plus 13 unestimated
  rows that will push it to ~100h. The other 338h is Boot.dev, CS:APP, DDIA,
  Beej and Discrete Maths — none of which has a real end.
- **Four of those seven exams are filed under Someday.** `NOW_WIP_LIMIT` is 3,
  which `nowLimit` doubles to 6 on the `All` tab. Seven exams do not fit in six
  slots, so the overflow went to the horizon that means *maybe never*.
- **`plannedMin` is 0 on all seven days of the week, and `hasData` is false on
  every one.** Nothing has ever been scheduled. Six of the seven exam projects
  are at 0%.
- **Priority is stored in task titles.** `[park]`, `[1]`, `[2]` typed into
  `GoalNode.title`, because there is nowhere else to put it.

Every project card nonetheless reads *on-track*. `goalHealth` measures each
project against all the free hours to its own deadline — 351h spare here, 438h
there, 1343h somewhere else — and those are **the same hours, counted thirteen
times**. Nothing in the app ever adds them up. The board says thirteen calm
things while the owner feels one loud thing, and cannot point at the gap.

That aggregate figure is the payoff of §3's model change and is **not** in this
spec. What is here is the two slices that make it reachable, and that are worth
shipping even if it never is.

## §1 — `set_horizon`

### The request

```ts
// src/lib/horizons.ts — beside HORIZON_LABELS, so the words and the columns
// they name cannot drift apart.
export type HorizonWord = 'now' | 'next' | 'later' | 'someday';

// src/lib/agentProtocol.ts
| { tool: 'set_horizon'; goalId: string; horizon: HorizonWord }
```

`horizon` is a WORD — `'now' | 'next' | 'later' | 'someday'` — never a column
index, for the reason `set_life` already gives about a life id: a column number
is invisible from outside the app, there is no read verb that reports one, and
`list_projects` already answers in words via `HORIZON_LABELS[goal.column ?? 0]`.
A verb whose argument cannot be discovered from any read is a verb the model has
to guess at.

The mapping is `HORIZON_LABELS.findIndex` against the lowercased word, so
`horizons.ts` stays the one definition. It deliberately does **not** reuse
`goalImport`'s `horizonFromWord`: that parser carries legacy aliases from the
old priority scheme, where `later` meant column 3 and now means column 2. A word
whose meaning has already changed once is not a word a new verb should inherit.
Round-tripping an export is `create_project`'s problem and stays there.

`validAgentRequest` accepts exactly those four lowercase words and rejects
everything else, including a number. This is the seam's job and it runs in the
renderer, per the standing rule that the Electron modules import nothing from
`src/`.

### The handler

One call into the action the UI already calls:

```ts
case 'set_horizon': {
  const owner = project(state, request.goalId);
  if (failed(owner)) return errorResponse(owner.error);
  const target = HORIZON_LABELS.findIndex(
    (l) => l.toLowerCase() === request.horizon,
  );
  const before = owner.found.column ?? 0;
  actions.moveGoalToColumn(request.goalId, target);
  // Rule 2: `moveGoalToColumn` returns void and refuses silently — on a goal
  // it cannot find, and on a horizon the goal is already in. Re-read rather
  // than mirror its guard.
  const after = getState().goals.find((g) => g.id === request.goalId);
  if ((after?.column ?? 0) !== target) {
    return errorResponse(`"${owner.found.title}" did not move to ${request.horizon}.`);
  }
  return settled({ goalId: request.goalId, horizon: HORIZON_LABELS[target], moved: before !== target });
}
```

Three things this gets for free, and one it has to decide.

**Undo is free.** `moveGoalToColumn` already calls `scheduleUndo` with
`Moved "X" to Later` and a whole-goals snapshot — it was given one when the ⋯
menu route shipped, because below 920px only one horizon renders and a card
simply left the screen. `undo_last` reaches the stack, so a horizon move made
from a terminal is reversible exactly as far as `⌘Z` is.

**Normalisation is free.** `moveGoalToColumn` routes through `setGoalBoard`,
which rebuilds column-major and calls `weaveHidden`, so the array invariant and
every unrelated goal's rank hold without this verb knowing they exist.

**`persistFailed` is checked** through `settled`, like every other mutation:
in-memory state advances even when nothing reached IndexedDB.

**Already-there is `ok`, not an error.** `moveGoalToColumn` returns early when
the goal is in the requested horizon — deliberately, so a no-op cannot arm an
undo that displaces a real one. The postcondition the caller asked for
nevertheless holds, so reporting a refusal would be the honesty rule pointed the
wrong way: rule 1 forbids reporting a *failed write* as success, not reporting
an *already-true state* as true. `moved: false` says which happened.

**The WIP cap is reported, never enforced.** `moveGoalToColumn` does not check
`NOW_WIP_LIMIT` — it builds `cols`, pushes the goal onto the target and hands
the lot to `setGoalBoard`. The cap is a READOUT (`4 of 6 focus slots used`), not
a refusal, and a verb that refused where a drag succeeds would be a second
opinion about one rule. So this verb does not check it either.

It does, however, say what it made:

```ts
return settled({
  goalId: request.goalId,
  horizon: HORIZON_LABELS[target],
  moved: before !== target,
  nowCount: getState().goals.filter((g) => !g.completedAt && (g.column ?? 0) === 0).length,
});
```

`nowCount` costs one filter and is the difference between an agent that fills
Now to eleven in silence and one that can tell its owner it just did. The owner
of this board has seven exams for six slots; that is a sentence worth being
able to say.

### The MCP declaration

```js
set_horizon: [
  'Move a project to now, next, later or someday — the board\'s commitment horizons. Now is what you are actually working on; someday is parked.',
  { goalId: z.string(), horizon: z.enum(['now', 'next', 'later', 'someday']) },
],
```

Added to `WRITES` in `mcp/server.js` and to `AGENT_TOOLS`. No change to
`agentSocket.cjs` or `agentIpc.cjs` — they frame and relay, and neither knows a
verb by name.

### Why this is slice one

It is the smallest change in the plan — a protocol case, a handler branch, a
schema entry — and it is the one that makes the other eight verbs useful. It
also does the specific thing the owner needs this week: `set_horizon` four
exams out of Someday in four calls, from the terminal, without touching the
board.

## §2 — The term

### It is not a scope. It is an automatic horizon.

The tempting shape is a filter beside `lifeScope` — a term tab, a
`goalsInTerm`, a second membership rule. That is the wrong shape, and
`lifeScope`'s own refusal says why: Today, Plan, the rail and every capacity
figure are deliberately **not** life-scoped, because a per-life capacity splits
hours that are not actually split.

A term does not split hours. It says *this project is not for this term*, which
is the sentence `PLANNING_HORIZONS` already exists to express. So the term is
not a new gate; it makes the existing one date-aware:

```ts
// src/lib/term.ts
export function inTerm(goal: Goal, termUntil: string | undefined): boolean {
  if (termUntil === undefined) return true;      // no term ⇒ nothing is parked by one
  return goal.deadline !== undefined && goal.deadline <= termUntil;
}

export function isLive(goal: Goal, termUntil: string | undefined): boolean {
  return isPlanningHorizon(goal.column) && inTerm(goal, termUntil);
}
```

`termUntil?: string` (`'YYYY-MM-DD'`) is a **setting**, not view state. This is
the deliberate opposite of `activeLifeId`, which is in-memory precisely so every
load starts at `All`. A term is a fact about the owner's year — the exams end on
25 September whether or not the app was relaunched — and re-entering it every
morning would be a new chore in a spec whose whole purpose is removing them.
Absent means no term, and every surface behaves exactly as it does today.

Boundary: `deadline <= termUntil` is inclusive. An exam on the last day of term
is in the term.

### What inherits it

Swapping `isPlanningHorizon(goal.column)` for `isLive(goal, termUntil)` at its
call sites — `backlog.ts`, `executionAdvisor.ts`, `cardPrimaryAction` — carries
the behaviour to every surface from one predicate, which is the discipline that
rule already has.

**This is the real cost of the slice, and it is threading, not logic.**
`isPlanningHorizon` takes a bare `column`; `isLive` takes a goal and a term. So
`backlogGroups`, the `ExecutionAdviceInput` and `cardPrimaryAction` each grow a
`termUntil: string | undefined` parameter, and every caller and test fixture
grows an argument. It is mechanical and it is wide. `isPlanningHorizon` itself
stays exported and unchanged — it is still the right predicate for anything
holding a column and no goal, and deleting it would widen the diff for nothing.

What that threading buys:

- **The rail** drops out-of-term projects. This is the change that matters most
  on screen: 20 Boot.dev rows leave a 249px column that currently holds 51.
- **Today's offer** stops proposing them, because `todayPlan` spends
  `backlogGroups` and nothing else.
- **The card** goes quiet — no "Plan next task" for work not in this term.

**The commitment exception survives untouched.** A parked project's step
carrying a `plannedWeek`, or task carrying a `date`, stays listed and stays
billed to `backlogMin`, because `weekCapacity` bills it and `countOpenCarryOver`
offers to move it — a number you plan against must have a row beside it. Term
parking is parking; it inherits that rule rather than restating it.

**Capacity arithmetic does not change.** No figure in `capacity.ts` learns about
terms. `freeMin`, `plannedMin`, `backlogMin` and `isOverCommitted` all mean what
they meant.

### The Someday column folds, and says what it is folding

The request that started this section was *"make tasks in Someday hideable —
seeing a bunch of cards is overwhelming."* Nine cards, of which four were exams
five weeks out. Folding that column on today's model is a trapdoor.

So the column collapses, and **the collapsed header reports the in-term work
inside it**:

```
▸ Someday · 9        ▸ Someday · 9 · 4 in term
```

The count is `goals.filter(g => inTerm(g, termUntil)).length` over the column's
contents, and the second clause renders only when it is non-zero. A fold that
can hide a deadline has to say so; a fold over genuinely undated work says
nothing extra and is simply calm.

This guard is temporary by design. Once §3's model lands, a dated project cannot
be in Someday at all, the count is structurally always zero, and the clause is
deleted rather than maintained.

### Setting the term

One field, in the existing settings surface: a date. No wizard, no term object,
no start date — `todayStr()` is the start, and a term whose start is in the past
is a term you are already in.

## §3 — Deliberately not in this spec

**The `deadline` / `practice` split.** The model this is heading for gives
`Goal` a `kind` and a `weeklyMin`, takes deadline-goals out of the horizon
system entirely, reduces practices to one number a week, and makes `goalHealth`
measure the closed set of deadline work against one shared pool of hours — the
honest aggregate the top of this document describes. That is a real feature. It
is not this one, and it should not be built in the five weeks before seven
midterms, because *improving the planner* is the most sophisticated form of
procrastination available to someone with a Discrete CS exam on 21 September.

**The known misclassification is the argument for it.** §2 classifies by DATE,
and a self-imposed deadline is indistinguishable from an exam date. Beej's
Guide carries 30 August, so a 25 September term keeps it live even though it is
a practice by every other measure; Boot.dev carries 16 October and parks
correctly by luck. Date is a good enough proxy to ship — it separates 12 of 13
projects correctly on the owner's real board — and it is a proxy. `kind` is the
fact.

**No aggregate capacity figure.** It needs the closed set that `kind` provides.
Stating it over a date-derived set would make it wrong for Beej and any other
self-imposed deadline, and a headline number that is quietly wrong is worse than
the thirteen honest-but-partial ones already on the cards.

**No bulk `set_horizon`.** One goal per call. Thirteen projects is four calls of
real triage, not a loop worth an undo entry of its own; and per the bulk rule, a
bulk verb would need its own single-write action underneath it rather than a
loop over this one.

## §4 — Tests

`agentProtocol.test.ts`
- accepts the four lowercase words; rejects `'Now'`, `'archived'`, `3`, and a
  missing `goalId`.

`agentWrites.test.ts`
- moves a project and reports the horizon in words;
- unknown `goalId` errors and calls no action;
- already-in-that-horizon answers `ok` with `moved: false`;
- a store that refuses the move errors rather than reporting success;
- `persistFailed` after a successful move is reported.

`term.test.ts`
- absent `termUntil` puts every goal in term, including an undated one;
- an undated goal is out of term once one is set;
- `deadline === termUntil` is in (inclusive boundary);
- `isLive` is false for an in-term goal parked at Someday — the two conditions
  are AND, and a term does not promote anything.

`backlog.test.ts`
- an out-of-term project leaves the rail;
- its step carrying a `plannedWeek` stays, per the commitment exception.

`Goals` component test
- the collapsed Someday header names in-term work when it holds some, and does
  not when it holds none.

## §5 — Decisions

**Overturned:** none. `PLANNING_HORIZONS` gains a second condition and keeps its
one-rule-for-every-surface discipline; this spec adds no parallel gate.

**Pinned:** `lifeScope`'s refusal to scope capacity per life stands, and §2 is
not a counter-example — a term parks work, it does not divide hours.

**New, and load-bearing:** a term is a SETTING where a life scope is view state,
because a term is a fact about the year and a scope is a way of looking at a
board.
