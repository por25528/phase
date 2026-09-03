# Study topics and confidence

2026-09-03 · PhaseApp

## Why

Phase has a `study` goal type, and it is a template and nothing else: it
offers `Review · Practice · Mock exam` on the first visit and is never read
again. A subject then behaves exactly like a software project — a tree of
steps you tick — and that is the wrong shape for an exam. A topic is not
finished the day you first read it; it is finished when you would be happy
to be examined on it, and the thing a student wants to know the night
before is *which topic am I weakest on, for the exam that is nearest*.

This spec gives a study goal that shape. A topic carries a **confidence**
instead of a checkbox, the shelf asks for it the moment a sitting on that
topic ends, and the weakest topic of the nearest exam leads Today, the
shelf and the advisor through the ordering those surfaces already trust.

Scope is exam preparation only. Spaced-repetition scheduling, a rating
history and any decay of an old rating are explicitly not in this spec;
the two fields it adds (`confidence`, `confidenceAt`) are the seed a later
review log would grow from, so nothing here has to be undone to get there.

## Vocabulary

- **Subject** — a `Goal` with `type === 'study'`. Its `deadline` is the
  **exam date**. One goal is one exam; a course with a midterm and a final
  is two subjects.
- **Topics area** — a `GoalNode` carrying `topics: true`. Every LEAF beneath
  it, at any depth, is a **topic**. Everything outside a topics area
  (`Practice`, `Mock exam`, "hand in assignment") stays an ordinary step
  with a checkbox. Where a leaf lives says what it is: drag a row out of the
  area and it is a step again, drag one in and it is a topic.
- **Confidence** — `'shaky' | 'okay' | 'solid'`, stored on a topic leaf with
  the day it was rated. Absent means *not yet studied*, and absent is never
  written as a fourth value, the same rule `status` follows for `'todo'`.
- **Ready** — a topic is ready when `solid`; a subject is ready when every
  topic is. Readiness is what a subject's progress bar draws.

## Data model (`src/db/types.ts`)

```ts
export type Confidence = 'shaky' | 'okay' | 'solid';

interface GoalNode {
  // …
  /** CONTAINERS (or leaves about to become one). Every leaf beneath is a topic. */
  topics?: true;
  /** LEAVES under a topics area only. Both present or both absent. */
  confidence?: Confidence;
  confidenceAt?: string; // 'YYYY-MM-DD' local, the day it was rated
}
```

Rules:

- `confidence` and `confidenceAt` are written together by exactly one
  store action (`rateTopic`) and cleared together when a topic is unrated.
- A topic **never carries `status: 'done'`** and never carries `doneAt`.
  `doing`, `blocked` and `parked` remain allowed — they move attention, not
  the roll-up, exactly as before.
- A leaf that is NOT under a topics area may still hold a stale
  `confidence` after being dragged out. Nothing reads it there; it is inert,
  and it comes back if the row is dragged back in. Not scrubbing it is
  deliberate — a move is undoable and the field is part of what undo
  restores.
- Neither field affects scheduling metadata or `Session` writes, and no
  `Session` field changes. Logged time never moves a number; a rating does.

## The single vocabulary: `src/lib/confidence.ts`

Pure, with a sibling test. Every reader goes through it and never touches
the fields directly, the same discipline `status.ts` holds for `status`.

```ts
export type { Confidence };
export const CONFIDENCES: readonly Confidence[] = ['shaky', 'okay', 'solid'];
export const CONFIDENCE_WORD: Record<Confidence, string>;      // 'shaky' | 'okay' | 'solid'
export const CONFIDENCE_RANK: Record<Confidence, number>;      // 1, 2, 3 — monotone
export const CONFIDENCE_WEIGHT: Record<Confidence, number>;    // 1/3, 2/3, 1
export function isConfidence(raw: unknown): raw is Confidence;

/** The topic leaves of a goal, in tree order, with their nearest topics-area ancestor. */
export function topicIds(g: Goal): Set<string>;
export function isTopic(g: Goal, nodeId: string): boolean;
/** `null` for an unrated topic. Never called on a non-topic (callers gate on `isTopic`). */
export function topicConfidence(n: GoalNode): Confidence | null;
/** Unrated → 0, then by `CONFIDENCE_RANK`. */
export function confidenceRank(n: GoalNode): number;
/**
 * The review order within one subject: unrated first, then shaky, okay,
 * solid; inside a tier the OLDEST `confidenceAt` first (an unrated topic has
 * no date and all of them keep tree order); ties keep tree order. Stable.
 */
export function sortForReview(topics: GoalNode[]): GoalNode[];

export interface Readiness { topics: number; unrated: number; shaky: number; okay: number; solid: number }
export function readiness(g: Goal): Readiness;
/** `3 of 8 topics solid` · `All 8 topics solid` · `8 topics, none rated yet` — `null` when the goal has no topics. */
export function describeReadiness(r: Readiness): string | null;
export function applyConfidence(n: GoalNode, next: Confidence | null, today: string): GoalNode;
```

`sortForReview` is the ONLY ranking this feature adds, and it ranks inside
one subject. Which subject leads is decided by the deadline rule that
already exists (`sortByDue`), fed the exam date — see *Queue* below. A
second cross-project score would be the second opinion `executionAdvisor`
refuses to hold.

## Store (`src/state/store.ts`)

New actions:

- `rateTopic(nodeId, confidence: Confidence | null, today = todayStr()): boolean`
  — refuses (returns `false`) when the goal is frozen (`isActiveNode`), the
  node is a container, or the node is not a topic. Writes through
  `applyConfidence`. **Arms an undo** with label `Rated "Graphs" solid`
  (`Cleared rating on "Graphs"` for `null`), slice `goals`: the rating is
  taken on the shelf, where the row it changes is not in front of you — the
  distance-write rule. Known cost, stated here so nobody "fixes" it: the
  ordinary-edit sweep in `setAndPersist` drops the `Logged 25m on "Graphs"`
  entry the session just armed, so after a rating the toast offers to undo
  the rating and not the minutes. That is the same rule any edit after a
  log already follows.
- `setTopicsArea(nodeId, on: boolean): boolean` — toggles `topics` on a
  node. Refused on a frozen goal. No undo: the row is in front of you and
  the flag is a toggle.

Existing actions learn one refusal each — **a topic cannot be completed**:

- `toggleLeaf` on a topic: no-op (returns without writing).
- `setNodeStatus(id, 'done')` on a topic: returns `false`. Other statuses
  pass through unchanged.
- `finishWork` on a topic ref: `{ outcome: 'refused' }`.
- `agentWrites` `complete_task` and `set_status` with `'done'`: the
  existing error path, with the message `"X" is a topic — rate it instead
  of completing it.` `syncIngest` maps the phone's `complete_task` onto the
  same handler, so a phone tap on a topic is refused at the same seam with
  no new code; `replay.ts`'s `complete_task` branch mirrors the refusal so
  the phone's projection agrees with the Mac.
- `addRootNodes(goalId, titles)` gains an optional third argument
  `flags?: { topics?: true }[]` aligned with `titles`, so the study
  template can create its Topics area flagged in the same write.

`migrateNodeStatus` (load and import) gains one clause: a leaf carrying
`confidence` without `confidenceAt`, or `confidenceAt` without
`confidence`, has both deleted. Half a rating is not a rating.

### The rating moment

`ActiveFocusSession.phase` gains a fourth value, `'rating'`. It is entered
ONLY from the store, only for a draft whose `ref` is a topic, and only
after the session has been LOGGED:

- `completeFocus` → `finish.kind === 'log'` → `logSession` accepted → if the
  ref is a topic, `setFocusDraft({ ...draft, activeSinceMs: null,
  accumulatedMs: <settled>, phase: 'rating' })` instead of `null`; the
  return value stays `'logged'`.
- `confirmFocus(minutes)` with a positive figure → same transition after
  `logSession`. `confirmFocus(null)` ("didn't happen") clears the draft
  without asking: a session that did not happen is not evidence about the
  topic.
- `rateFocus(confidence: Confidence | null): boolean` — new. Refuses unless
  the draft is in `'rating'`. With a confidence, calls `rateTopic` (which
  arms its undo) and clears the draft; with `null` (Skip) clears the draft
  and writes nothing. Either way the draft is spent.
- `finishWork` never reaches `'rating'` because it refuses topics.

`focusSession.ts`:

- `PHASES` admits `'rating'` so a draft in that phase survives a restart.
- `reconcileFocusDraft` treats `'rating'` like `'confirming'`: returned
  untouched unless the work is gone, in which case `null`.
- `finishFocusSession`, `pauseFocusSession`, `resumeFocusSession` are never
  called on a `'rating'` draft; the store's guards (`phase === 'confirming'`
  checks) extend to `'rating'` wherever they appear, and the plan lists
  each site.

`focusStatus.ts` (the snapshot the menu bar, tray, pill and overlay read):
`'rating'` is published exactly as `'confirming'` is — **not running**. The
tray title, the pill and the overlay all hide for it, because the presence
of the pill is the "something is running" signal and nothing is.

## The shelf

### Protocol (`src/lib/assistantProtocol.ts`, `electron/assistantIpc.cjs`)

- `RecommendedWork` and `AssistantFocusView` gain `topic?: true` and
  `confidence?: Confidence`. Both are optional and absent for a step or a
  task; `validWork` / `validFocus` in `assistantIpc.cjs` admit them and
  refuse any other value.
- `AssistantFocusView.phase` admits `'rating'`.
- `AssistantAction` gains `{ type: 'rate-focus'; confidence: Confidence | null }`;
  `assistantIpc.cjs` validates it (`null` or one of the three words).
- `AdviceReason` gains `'review'`; `REASON_WORD['review']` is
  `'Weakest topic first'`.

### Surface (`AssistantSurface.tsx`)

- `FocusPanel` in phase `'rating'`: no ring, no checkbox (the `running`
  condition becomes `phase === 'active' || phase === 'break'`). The `extra`
  line reads `How solid is <title> now?`. The action row is four buttons:
  ghost `Skip`, then `Shaky` / `Okay` / `Solid`, the last one filled
  (`primaryBtn`) because it is the answer the question hopes for — the same
  reasoning `confirming` gives its `Log` button.
- A running session on a topic (phase `active` / `break`) draws NO
  completion checkbox: `checkbox` is `null` when `focus.topic`. The ring
  stays. Its lead shows the topic's current confidence mark instead, so the
  card says what you are trying to move.
- `WorkBand` rows (primary and alternatives) for a topic: the lead is the
  confidence mark rather than the tick, and `complete-work` is never offered
  for it. `park-work` still is.
- `Do first…` (insert-before) is unchanged.

### Host (`AssistantHost.tsx`)

- `case 'rate-focus'`: `actions.rateFocus(action.confidence)`; on a
  confidence, the notice reads the armed undo label
  (`getState().pendingUndo?.label`), the way `park-work` does.
- The snapshot builder stamps `topic` and `confidence` onto the focus view
  and every recommended row from `topicIds`/`topicConfidence`.

### Measurement

`scripts/measure-shelf.cjs` gains the `rating` state. The four-button
action row is the widest row the card has had; the plan must run the
measurement after `npm run build` and update `HEIGHT` in
`electron/assistantWindow.cjs` (and the comment ledger above it) if
`rating` becomes the tallest state at either density. It probably will not
— it has no ring, no elapsed line — but the number is measured, never
guessed.

## Queue and surfaces

### `backlog.ts`

- `BacklogItem` gains `topic?: true` and `confidence?: Confidence`.
- In `backlogGroups`, for a goal whose `topicIds` is non-empty, the items
  are built as: `sortForReview(topics)` first, then the goal's other open
  leaves in tree order, then its tasks; and every topic item's `due` is the
  exam date — `g.deadline`, when `g.datesConfirmed === true`, the same gate
  `projectAttention` applies before it lets a date reorder anything. Then
  `sortByDue` runs as today. Effects, all through existing machinery:
  - Within a subject the weakest topic heads its group.
  - `proposalRows` takes the head of each group, so each subject offers its
    weakest topic, and orders subjects by due — nearest exam first, inside
    `DUE_CHIP_DAYS`, which is the same horizon at which the rail shows a
    chip beside it. An exam three weeks out does not jump a step due
    Friday; it will, once it is within a week.
  - `planNextStepFor` reads `items[0]`, so the board card's "Plan next
    step" on a subject lands on the weakest topic.
- The rail's row (`Backlog.tsx`) draws the confidence mark for a topic
  where it draws `StatusMark` today.

### `executionAdvisor.ts`

The free-time candidates built from `proposalRows` take `reason:
item.topic ? 'review' : 'free-time'`. No other ordering change: the
advisor keeps projecting the queue it is handed. `RecommendedWork` carries
`topic` and `confidence` (see Protocol).

### `dailyWork.ts`, `Today.tsx`

`DailyWorkItem` gains `topic?: true` and `confidence?: Confidence`, set by
`buildDailyWork` for a placed or committed topic. Every Today row that
draws a `TodayCheckbox` draws the confidence mark instead when
`item.topic`; `complete(item)` is not wired for such a row (it would be
refused by `toggleLeaf` anyway, but a control that does nothing is worse
than no control). `Start session` is offered exactly as for a step.

`PlannedLeaf` (the capacity projection) is untouched: booked time is booked
time whatever the topic's confidence.

## Roll-up and effort

### `pct.ts`

`rollup` carries an `inTopics` flag down the tree (set when a node has
`topics: true`, inherited by descendants). A leaf's completion fraction:

- ordinary leaf — `isDone(n) ? 1 : 0`, as today;
- topic — `CONFIDENCE_WEIGHT[confidence]`, `0` when unrated.

Weighting by `estimateMin` is unchanged and applies to topics too. A
subject's percentage is therefore its readiness, and `paceStatus`'s
`behind` — which compares `goalPct` against the calendar between `start`
and the exam — becomes *confidence is behind the calendar*, which is the
right sentence for a subject and needs no new code.

### `plan.ts`

`leafCount` (the `done`/`total` pair `paceStatus` reads) counts a topic in
`total` and never in `done`. A subject therefore never answers
`'complete'` / `'ready-to-complete'`, never falls out of `attentionRank`,
and stays on the rail until the user archives it after the exam. That is
the point: an all-solid subject the night before an exam is not finished
work, it is work to keep warm.

### `effort.ts`

`GoalEffort` gains `readiness: Readiness` (from `confidence.ts`). Topics
are excluded from `remainingMin` and `unestimated` — a topic's estimate is
the length of a sitting, not the effort left to finish it — and from
`total`/`done`. The three describers become readiness-aware:

- `effortCount`: when `readiness.topics > 0` and `total === 0`,
  `describeReadiness(readiness)` (e.g. `3 of 8 topics solid`); when both
  exist, `3 of 8 topics solid · 2 of 4 steps done`; otherwise as today.
- `effortPct`: `goalPct`'s fraction when topics exist (the bar draws the
  same number the count prints, which is the rule `BoardCard` states in
  its comment); otherwise as today.
- `effortCaption`: unchanged; it describes remaining minutes, which a
  subject may well have from its non-topic steps.

`ProjectHeader` and `OverviewTab` print `describeReadiness` beside the
percentage for a goal with topics. `GoalMetaPopover`'s basis line
(`weighted` / `equal`) is unchanged — it is still true.

### `velocity.ts`

Unchanged. A subject with no ticked steps reports no pace, and
`describeVelocity` already returns `null` for that.

## Tree and step surfaces

### `GoalTree.tsx`

- A topic row draws `ConfidenceBox` in place of `LeafStatusBox`: the same
  17px box in the same 24px target, `role="img"`, `aria-label`
  `"Graphs" — solid, rated 3 days ago` / `"Graphs" — not rated yet`.
  Inside the box: three vertical bars of rising height (signal-strength
  glyph). Unrated: `border-check`, no bar lit. Shaky: one bar lit, `warn`.
  Okay: two bars lit, `accent`. Solid: `bg-accent border-accent`, three
  bars in `accent-contrast`. The box **never toggles anything**; rating
  happens on the shelf, and the inspector is the correction surface.
- The `◐` status-cycle control stays (doing / blocked are still meaningful
  on a topic) but `cycleStatus` never lands on `done`, so nothing changes
  there; `Space` on a topic row does nothing instead of ticking.
- `RowActions` on a CONTAINER inside a study goal gains `Treat as topics` /
  `Treat as steps` (calls `setTopicsArea`). A topics-area container's
  title row carries a small `Topics` chip so the fact is visible.
- `containerStatus` is unchanged: a topic is an open `todo` leaf to it, so
  a topics area reads `todo` / `doing` / `blocked` / `parked` as any other
  container.

### `StepPanel.tsx` / `TaskPage.tsx`

For a topic: the status property row is replaced by a **Confidence** row —
a `SegmentedControl` over `Not rated · Shaky · Okay · Solid` calling
`rateTopic`, with `rated <date>` as its caption. This is the one manual
rating surface, and it exists to correct a mis-tap, not as a second ritual.

### `StatusMark.tsx`

A sibling `ConfidenceMark({ confidence })` (13px, for rails and rows that
use `StatusMark` today): the same three-bar glyph at mark size.

## Template and creation

`TEMPLATES.study` becomes `{ label: 'Topics and practice', areas:
['Topics', 'Practice', 'Mock exam'], flags: [{ topics: true }, {}, {}] }`
and `StepsTab`'s "Start with …" button passes the flags through
`addRootNodes`. `TEMPLATES.project` and `.general` gain empty flags.
Nothing else about creation changes: `NewGoalModal` already infers
`'study'` from the title and already takes the exam date as the deadline.

## Agent (`agentReads.ts`, `agentWrites.ts`, `agentProtocol.ts`)

- `get_project` returns the goal object, which now carries the two fields;
  no projection change. `projectSummary` gains `readiness`.
- New write `rate_topic { nodeId, confidence: Confidence | null }` mapped
  onto `rateTopic`; refused with the store's reasons. `AGENT_TOOLS` lists
  it. Per the two-staleness-traps rule the MCP server needs a rebuild and a
  Claude Code restart before the verb is visible — the plan says so.
- `complete_task` / `set_status 'done'` refuse topics (see Store).

The phone (`PhasePhone/`) is **out of scope**: it renders a step's status
through `@app/lib/status` and will show a topic as an ordinary open step
whose completion the Mac refuses. Its `state.json` reader tolerates the
new fields because it copies nodes whole. A companion-side confidence mark
is a follow-up.

## Error handling

Every refusal is a returned value, never a throw: `false`, `'refused'`, an
agent `errorResponse`. The shelf reports a refused `rate-focus` through the
existing warning notice. A rating on a topic whose goal was archived
mid-session is refused by `isActiveNode` and the draft is still cleared —
a question about frozen work has no answer worth keeping.

## Testing

Vitest, beside the code, following the sibling-test rule:

- `confidence.test.ts` — `topicIds` at depth and across a mixed goal,
  `sortForReview` tiers / oldest-first / stability, `readiness`,
  `describeReadiness`, `applyConfidence` writes and clears both fields.
- `pct.test.ts` — topic weights, weighted-by-estimate topics, a mixed
  subject.
- `plan.test.ts` — a subject never reads `'complete'`; `behind` from
  confidence lagging the calendar.
- `effort.test.ts` — readiness counts, topic exclusion from remaining.
- `backlog.test.ts` — topic order inside a group; exam date as due; nearest
  exam leads `proposalRows`; `datesConfirmed` gate.
- `executionAdvisor.test.ts` — `'review'` reason on a topic candidate.
- `focusSession.test.ts` — `'rating'` parses, reconciles, is not running.
- `store.test.ts` — `rateTopic` refusals and undo label; `toggleLeaf` /
  `setNodeStatus('done')` / `finishWork` refuse topics; `completeFocus` and
  `confirmFocus` enter `'rating'` only for a topic and only after a log;
  `rateFocus` both ways; `addRootNodes` flags; migration of half a rating.
- `agentWrites.test.ts` — `rate_topic`, and `complete_task` on a topic.
- `sync/replay.test.ts` — the phone's `complete_task` on a topic mirrors
  the refusal.
- `AssistantSurface.test.tsx` — the rating band's four buttons and copy; no
  checkbox on a topic session or row.
- `AssistantHost.test.tsx` — `rate-focus` dispatch and the notice.
- `GoalTree.status.test.tsx` — a topic row draws `ConfidenceBox`, has no
  checkbox role, and `Space` does not complete it.
- `Today.*.test.tsx` — a topic row has no checkbox.
- `assistantIpc` tests — the new action and fields validate; garbage is
  refused.
- `scripts/measure-shelf.cjs` run recorded in the `HEIGHT` ledger.

`npm test`, `npx tsc -b` and `npm run build` green from `PhaseApp/`.
