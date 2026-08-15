# Focus is what fits your head, and the work says how much it wants

**Date:** 2026-08-15
**Status:** approved design, not yet planned
**Base:** `174fc9c` (main), branch `feat/focus-demand`
**Supersedes:** §2 of `2026-08-15-assistant-shelf-two-dials-design.md` — deliberately, and see "What this overturns" below.

## What is wrong today

The shelf ships with two dials. One of them is honest and one of them is a
stand-in.

The time dial (`timeLens.ts`) asks how long you have and answers in minutes —
`30m / 1h / Any` against `TIME_CAP` (`timeLens.ts:35`). It says what it does.

The dial beside it is labelled **Focus** and does not measure focus. It is
`shelfDetail.ts`, and it caps how many alternatives get drawn:
`ALTERNATIVE_CAP = { low: 0, medium: 1, high: 2 }`. Its own docstring is candid
about why:

> A task in Phase carries a title, an estimate, a status, dates and blocks —
> nothing says how HARD it is — so this cannot mean "give me easy work" without
> inventing a field somebody has to fill in by hand, forever, for every task.
> What it can honestly mean is how many choices you are handed.

And the spec that shipped it says of `ALTERNATIVE_CAP`'s middle value:

> the weakest thing in this spec … this is the first thing to revisit after
> living with it.

So the shelf asks you how much focus you have and then filters on **duration
twice** — once by the time dial, and once by the time dial again, since the
Focus dial touches neither membership nor ranking. A person who is fried and
has two hours has no way to say so. The gap the whole two-dial split was
reaching for is still open: **nothing in Phase measures how much of you a piece
of work wants.**

The reason it stayed open was tagging cost, and that reason is answerable.

## What it becomes

```
┌──────────────────────────────────────────────────────────────┐
│ I’ve got [30m][1h][Any]        Focus [Low][Med][High]        │
│            └─ fits your gap             └─ fits your head    │
├──────────────────────────────────────────────────────────────┤
│ Carried over                          │  Or                  │
│ Finish A Youtube video  [Start session]│  Pitch deck         │
│ Suggested 30m                         │  Launch · 25m        │
└──────────────────────────────────────────────────────────────┘
```

Two dials, two genuinely different axes, and the word **Focus** meaning one
thing again.

## The rule the whole thing hangs off

> **The dial says what you have. The work says what it wants. Neither guesses
> at the other.**

Duration is not difficulty. A twenty-minute expense claim and a twenty-minute
"decide the data model" are the same size and are not the same ask, and today
Phase cannot tell them apart because the only thing it knows about either is how
many minutes it expects them to take.

## What this overturns

This reverses `shelfDetail.ts`'s stated refusal, and the reversal has to earn
itself rather than be waved through.

The refusal was **"a field somebody has to fill in by hand, forever, for every
task."** That is a correct objection to a per-leaf tag, and this design does not
propose one. `demand` **inherits down the tree**: tagging one goal `deep` tags
every step under it, and a leaf only carries its own value when it disagrees
with its parent. The cost is one gesture per project, not one per task, and a
project whose work is uniformly demanding — which is most of them — is tagged
once and never touched again.

What survives from that refusal is its instinct about invented fields: **an
untagged database must behave exactly as it does today.** §3 below is written to
that constraint.

## Decisions

### 1. `demand` — one optional field, three words

```ts
export type Demand = 'light' | 'moderate' | 'deep';
```

Added as `demand?: Demand` to three types:

| type | line | inherits? |
|---|---|---|
| `Goal` | `types.ts:123` | — it is the root |
| `GoalNode` | `types.ts:30` | yes, from its nearest tagged ancestor, then the goal |
| `Task` | `types.ts:169` | **no** — see below |

**A `Task` does not inherit.** `Task.goalId` is documented `// tag FOR CONTEXT
ONLY`, the same phrase `Habit.goalId` and `Session.goalId` carry. It is not a
parent link and never has been, so reading demand through it would invent a
containment relationship the model deliberately refuses. A loose task carries
its own tag or none.

**The words are not the dial's words.** The dial reads `Low / Medium / High`
(capability); the tag reads `Light / Moderate / Deep` (requirement). They are
opposite poles of one scale, and a chip reading `Low` on a row could be read
either way. `expectedTimeLabel` already sets this precedent — it prefixes
`Usually / Planned / Suggested` precisely because a bare figure throws away what
kind of claim it is making.

**Absent is not a value.** It is the absence of a claim, exactly as a missing
`estimateMin` is not zero minutes.

### 2. Resolution inherits down the tree and is derived at read time

New module `src/lib/demand.ts`, with a sibling test:

```ts
export type Demand = 'light' | 'moderate' | 'deep'
export const DEMAND_WORD: Record<Demand, string>
export const DEMAND_RANK: Record<Demand, number>      // light 1, moderate 2, deep 3
export function isDemand(raw: unknown): raw is Demand

export interface ResolvedDemand { level: Demand; source: 'own' | 'inherited' }
export function demandIndex(goals: Goal[]): Map<string, ResolvedDemand>
```

**Nothing is stored twice.** `demandIndex` walks each goal once, carrying the
nearest ancestor's value downward, and returns a map from node id to the
resolved value plus where it came from. A node indented under a `deep` container
re-resolves on the next paint, the same way `isLeafNode`/`isContainerNode` are
computed at render rather than written down.

**It must be one pass.** `findNodePath` exists and returns an ancestor chain,
but it is O(n) per call — spending it per candidate would make the shelf O(n²)
in the size of a goal. `walkLeaves` cannot be reused either: it visits leaves
only and hands the visitor no ancestor context. `demandIndex` is a new walker
for that reason, and it indexes containers as well as leaves because a container
is a taggable thing whose value the inspector has to show.

`source` is required, not a convenience. It is what lets a row draw a chip only
where a value was *set* and a page state where an inherited one came *from*.

### 3. The Focus dial reads demand, and admits whatever makes no claim

`src/lib/focusLens.ts` returns — the name is free again, and it is the right one:

```ts
export type FocusLevel = 'low' | 'medium' | 'high'
export const FOCUS_WORD  = { low: 'Low', medium: 'Medium', high: 'High' }
export const FOCUS_ADMITS: Record<FocusLevel, number> = { low: 1, medium: 2, high: 3 }
export function admitsDemand(level: FocusLevel, demand: ResolvedDemand | undefined): boolean
```

| dial | admits |
|---|---|
| Low | `light` |
| Medium | `light`, `moderate` |
| High | everything |

**An untagged item is admitted at every level, and that is the load-bearing
decision in this spec.**

The temptation is to mirror `fitsWindow`, which refuses a `starter` at the
narrowest setting "as a RULE and not as arithmetic". That rule is right for
duration and wrong here, and the difference is where the fallback evidence
comes from. Duration always has some: history, then an estimate, then a
30-minute starter. Demand has none — there is no history that reveals how hard
something was and no default worth inventing. So:

- Treating untagged as `moderate` would hide most of a real backlog the first
  time somebody set the dial to Low, on the strength of a value nobody entered.
- Falling back to the duration cap — which an earlier draft of this design
  proposed — would make the Focus dial a **second time dial**, filtering on
  minutes the dial beside it already filtered on. That was defensible when there
  was one dial. With two it is a bug.

So the Focus dial only ever removes work that has positively claimed to be
heavier than the level allows. On an untagged database it does nothing at all,
which is precisely the "behaves exactly as today" constraint inherited from the
refusal this design overturns. It becomes useful in one gesture and is never
wrong before then.

**Commitments are still never filtered.** `isCommitment` (`timeLens.ts:133`)
runs first and unchanged: `scheduled-now`, `scheduled-next`, `due` and
`committed-today` survive both dials. Your 2pm block is true whether you are
sharp or wrecked.

**An emptied lens answers, it does not re-sort.** The existing `beyondWindow`
pattern is matched by `beyondFocus`, and the copy distinguishes the two axes:
the time dial's `Nothing that short left` against the focus dial's
`Nothing light left — this is next when you're ready.` Neither reorders; both
offer the unfiltered head.

**Storage needs a new key, and the obvious one is taken.** `FOCUS_LEVEL_KEY =
'focusLevel'` (`db.ts:220`) currently stores the **time** level — the two-dials
plan froze storage names deliberately while renaming types. The focus dial takes
a new key (`'focusCapability'`) and must not touch the old one. This is the
single easiest thing to get wrong in the implementation and the plan states it
as a global constraint.

The dial persists with a daily reset to `medium`, computed at hydrate from the
stored date exactly as `timeLevelFor` does. Nothing runs at midnight.

**This contradicts a comment the retired dial leaves behind, and does so
knowingly.** `store.ts:224` documents `detailLevel` as "never persisted, so
every load starts at the default — *a mood is not a setting*". That is right
about `detailLevel`, which is a presentation preference, and it is not the
precedent here. The precedent is the dial this one replaces: the original
`focusLevel` was a capability dial and *was* persisted per-day, under "nobody
has to remember to put the dial back", and `timeLevel` persists the same way
today (`store.ts:1985`, `saveStoredTimeLevel`). A person who says they are
fried at 09:00 is still fried at 09:20, and making them re-state it every time
the shelf opens is how a dial gets left at its default forever. The daily reset
is what stops it becoming a setting.

### 4. `shelfDetail` is retired, and two modules get a better argument

`src/lib/shelfDetail.ts` and its test are deleted. `ALTERNATIVE_CAP` goes with
them and the alternatives return to a fixed `MAX_ALTERNATIVES` (2), which was
always the ceiling.

The blast radius is six files, all confirmed at `174fc9c`: `store.ts` (`:71`,
`:224`, `:277`, `:1992`), `AssistantSurface.tsx` (`:9`, `:91`, `:114`, `:371`,
`:481`), `assistantProtocol.ts` (`:3`, `:43`, `:50`, `:110`),
`sessionRing.ts` (`:2`, `:46`), `AssistantHost.tsx` (`:40`, `:82`, `:99`), and
`shelfDetail.test.ts`. `electron/assistantIpc.cjs` imports nothing from `src/`
but validates the field by name (`validSnapshot`, and `set-detail-level` in
`validAction`) and is updated in the same step.

Only **one** line actually caps anything: `AssistantSurface.tsx:371`,
`advice.alternatives.slice(0, ALTERNATIVE_CAP[detail])`. It becomes
`slice(0, MAX_ALTERNATIVES)`. `FocusPanel`'s own `OtherOptions` list already
hardcodes `.slice(0, 2)` and is untouched — the running-session state never read
the dial.

The action union loses `set-detail-level` and gains `set-focus-level`, which is
the name the retired dial used before the two-dial split. It is free again.

Two of those are **not** deletions but re-pointings, and both read better
afterwards:

- `elapsedAgainstExpected` (`assistantProtocol.ts:107`) takes the level as its
  third argument and drops the comparison at `low`, under the comment "the
  pressure in a running session was never the elapsed figure — it is the figure
  it is being measured against". That is a statement about *capability*, not
  about how many options you asked for. It now takes `FocusLevel`.
- `sessionRing` (`sessionRing.ts:46`) turns rather than fills at `low` for the
  same reason. Same change, same improvement.

`store.ts` loses `detailLevel` (`:224`), its default (`:277`) and
`setDetailLevel` (`:1992`), and gains the focus equivalents. `detailLevel` was
in-memory only, so **no migration is written for the retirement.**

### 5. Where you set it, and where it shows

Four editors, each mirroring a control that already exists:

| surface | shape | mirrors |
|---|---|---|
| `TaskPage` | `PropertyLine` "Focus" over `PropertyOption` | the Status line |
| `StepPanel` | `PropertyRow` "Focus" — the one-gesture project tag | the Dates row |
| row `⋯` menu | new `demand` verb in `rowActions.ts` | `estimate` / `schedule` |
| bulk bar | `<select aria-label="Set focus">` | `Set status` |

The `⋯` verb is the first that applies to **both** leaf and container —
`schedule` and `estimate` are leaf-only, `open` is container-only. That is a new
row in `RowActionContext`'s truth table, not a new shape of thing.

The bulk write is **one undoable action** (`setNodesDemand`), never a loop over
the single-node action, per the standing bulk-edit invariant.

**The goal-level editor is the one location this spec does not site.** It needs
the project header, which this design has not surveyed; the plan resolves it
before Task 1 and the answer is a placement, not a mechanism.

**The row draws a chip only where the value is set** — never where it is
inherited. A `deep` goal painting `Deep` onto all thirty of its leaves is a
column that says one word thirty times, which is the failure `TaskPage`'s
retired chip row already demonstrated ("a row of negations louder than the note
they introduced"). What a chip marks is a *change* in demand. `TaskPage` and
`StepPanel` always state the resolved value in full with its provenance
(`Deep · from Thesis`), because a page has room to say where a value came from
and a row does not.

## Out of scope, deliberately

- **`Session.focus` is untouched.** It stores the TIME level, is written only at
  the narrowest setting, and is read only by `expectedTime`'s evidence gatherer.
  Recording the focus level on a session as well is arguable — a session run
  while fried is also poor evidence — but it is a storage change against
  existing rows for no behaviour in this slice.
- **A `!deep` token in `quickAdd`.** The machinery is there (`#` goal, `@` date,
  `~` estimate) and a fourth sigil is cheap, but it should be added once tagging
  is a habit rather than guessed at now.
- **Today, Plan, the rail and every capacity figure.** None of them read either
  dial. `agentReads.ts` continues to refuse to pass a shelf setting outward, and
  `Today.tsx` continues to call `executionAdvice` without one. A mood set in a
  café must not rewrite the plan you check on the train home — and note that
  `demand` itself is *not* a mood: it is a property of the work, so it travels
  everywhere quite safely. It is the DIAL that stays in the shelf.
- **Any change to how sessions are logged.**

## Invariants this must not break

- The advisor holds no ranking. Both dials change membership; neither reorders.
  `demand` is a lens, exactly as `lifeScope` is on the board.
- A FACT about today is never filtered by either dial.
- `MAX_ALTERNATIVES` stays 2.
- The overlay gains no new snapshot data beyond the renamed dial field.
  `entryBoundary.test.ts` must still prove it cannot reach the store, Dexie, the
  tab lock or a clock. `electron/assistantIpc.cjs` validates the dial fields and
  is updated in step.
- **No migration.** Absent `demand` is untagged is today's behaviour, on every
  existing row. `detailLevel` was never persisted.
- **`HEIGHT` in `electron/assistantWindow.cjs` must be RE-MEASURED, and this
  change is why.** It is a measured budget against the tallest state, the card
  hugs its content on macOS, and the window **clips rather than scrolls** — so
  anything past that line is invisible, not merely awkward. Retiring
  `ALTERNATIVE_CAP` takes the default alternative count from 1 to 2, which makes
  the common state taller than the one the current number was measured against.
  Measure at 620px wide in a real Electron `BrowserWindow`; jsdom cannot see
  clipping, so a passing component test proves nothing here.
- Storage keys never change: `'focusLevel'` keeps meaning the TIME level.
- Type scale and colour tokens only; `designScale.test.ts` fails on a literal
  hex or an arbitrary `text-[Nrem]`.

## Testing

- `demand.test.ts` — a leaf takes its own tag over an ancestor's; the nearest
  ancestor wins over a farther one; a goal's tag reaches an untagged
  great-grandchild; `source` is `'own'` vs `'inherited'` correctly; a task never
  inherits from its `goalId`; an untagged tree yields an empty index; one pass
  over a wide tree does not call `findNodePath`.
- `focusLens.test.ts` — the caps are monotone; a commitment survives Low
  whatever its tag; an untagged item is admitted at every level; `beyondFocus`
  is raised rather than the queue re-sorted.
- `executionAdvisor.test.ts` — both dials compose; neither changes order; an
  untagged database produces byte-identical **advisor output** to today. Note
  this is not the same as an identical shelf: retiring `ALTERNATIVE_CAP` takes
  the default from `medium: 1` to a fixed 2, so an untagged user sees one more
  alternative than before. That is a deliberate consequence of the retirement,
  not a regression — but it is a rendering change on day one for everybody, and
  it is what forces the re-measurement below.
- `AssistantSurface.test.tsx` — the Focus dial drives membership; alternatives
  are fixed at 2; the ring turns and the comparison drops at focus Low.
- `GoalTree` — a chip renders where set and not where inherited; the bulk select
  writes once and arms one undo.
- `TaskPage` / `StepPanel` — the resolved value and its provenance are stated;
  the accessible name matches between page and panel.
