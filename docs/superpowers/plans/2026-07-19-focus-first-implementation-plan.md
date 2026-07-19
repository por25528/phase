# Focus-First Project System — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-07-18-focus-first-project-system-design.md`
**Date:** 2026-07-19 · **Rev 2** (closes seven release-blocking gaps from review)

## Sequencing principle

Build bottom-up — domain field → pure logic → store → views — so every task
leaves `npx tsc -b` and `npm test` green and ships no confusing half-state.
Phases are dependency-ordered; **commit at each phase checkpoint.**

Two hard constraints:

- **The board rename is atomic** (§8): columns → cards → focus summary →
  completed section → all priority-copy consumers land together (Phase 3).
- **`attentionRank` is refactored, not replaced.** It exists in `plan.ts` with
  its own scoring and the planner consumes it — Task 1 rewrites its body to
  delegate; signature unchanged, but **ordering shifts** (verify planner).

**Conventions.** Each task lists steps as checkboxes, the test file + named
cases, and its gate. Gate per task = `npx tsc -b` clean + `npm test` green.
Phase checkpoint = a commit. New pure logic ships with a sibling `*.test.ts`
(CLAUDE.md).

### Review fixes folded in (Rev 2)

1. **Column-major invariant** — completed goals must keep their stored position
   across an active-goal drag. New rule + `weaveCompleted` helper + round-trip
   test (T3b). `setGoalBoard`'s append-omitted behavior is the bug.
2. **Lifecycle leak into Today/planner** — `plannedLeaves`, `nextUp`,
   `carryOvers` traverse completed goals and feed `NextUpCard`, `Hero`,
   `WeekStrip`, the planner right-pane pool, `boardInsights`, and the drawer.
   Filter at the pure selector seam (T2b).
3. **Freeze set + drawer** — add `indentNode`, `outdentNode`,
   `reorderSiblingNodes` to the guard; give `GoalDrawer` a Complete/Reopen
   action and a read-only `GoalTree` when archived (T3, T7).
4. **Rename covers all consumers** — `goalImport.ts` (`PRIORITY_WORDS`,
   `FORMAT_HINT`, `buildAiPrompt`), `NewGoalModal`, and old "goal"/priority copy
   in `store.ts`/`boardInsights`/`Goals`/`Timeline`. Repo-wide copy audit +
   backward-compatible import (T4b).
5. **`focusSummary` returns match sets**, not bare counts, so the view never
   re-derives predicates (T2). "behind" ≡ `projectAttention === 'behind'`
   (Now/Next only).
6. **Timeline edge cases** — independent "Include completed" toggle,
   deleted/completed single-project → Focus fallback, Fit centering routed
   through `pendingCenter` (the scale layout-effect otherwise clobbers a direct
   scroll), Schedule opens the new phase, warning/overlap actions, deterministic
   overlap rules (T10–T12).
7. **Granularity** — every task is now checkbox steps + named tests + gate +
   commit checkpoints.

---

## Phase 0 — Domain field

### T0. `Goal.completedAt`
- [ ] Add `completedAt?: string` to `Goal` in `src/db/types.ts`. **No Dexie
      version bump** (goals indexed by `id` only — additive).
- [ ] In `parseGoalImport` / backup import, ignore an invalid `completedAt`
      (not `YYYY-MM-DD`) rather than hiding the project (spec §5).
- **Tests** (`goalImport.test.ts` / `db` import test): missing / valid / invalid
  `completedAt` round-trips.
- **Gate:** tsc + test. **Commit:** `feat(types): add Goal.completedAt`.

---

## Phase 1 — Pure attention & lifecycle selectors

### T1. `projectAttention` + shared predicates + refactor `attentionRank`
- [ ] Add shared constants/predicates to `plan.ts` (spec §4.2 / Q7):
      `DUE_SOON_DAYS = 14`, `MILESTONE_SOON_DAYS = 14`,
      `deadlineBefore(date, today)`, `milestoneWithin(goal, days, today)`,
      `hasUnplannedOpenLeafThisWeek(goal, today)` (reuses `weekOf` +
      `plannedLeaves`).
- [ ] `ProjectAttention` type + `projectAttention(goal, today)`: 9-state
      precedence composing `paceStatus`, `goal.completedAt`, overdue-leaf walk
      (reuse `walkLeaves`), and the predicates above.
- [ ] Horizon gating (Q2): read `goal.column`; factual (`completed`,
      `ready-to-complete`, `overdue`) all horizons; active-work on columns 0–1
      only, else `on-track`.
- [ ] Rewrite `attentionRank` body to sort by `projectAttention` precedence,
      excluding `completed` + `ready-to-complete`, stable for ties. Signature
      unchanged.
- **Tests** (`plan.test.ts`): `projectAttention › each precedence boundary`;
  `› horizon gating suppresses active-work on Later/Someday`; `› ready-to-complete
  never needs-breakdown`; `attentionRank › delegates + excludes terminal +
  stable ties`.
- [ ] **Verify** planner (`PlanStep`) list + BehindChip read right on new order.
- **Gate:** tsc + test.

### T2. `focusSummary` returning match sets (fix #5)
- [ ] `focusSummary(goals, today): FocusSummary` where
      `FocusSummary = { slots: {used, limit, goalIds}, needsFirstStep: {count,
      goalIds}, behind: {count, goalIds}, plannedRemaining: {count, goalIds} }`.
- [ ] Matchers (single source of truth, view never re-derives):
      slots → active Now goals; needsFirstStep → Now goals with
      `projectAttention === 'needs-breakdown'`; behind → active goals with
      `projectAttention === 'behind'` (already Now/Next by gating);
      plannedRemaining → `count` = open planned leaves this week across active
      goals, `goalIds` = Now goals owning ≥1 such leaf.
- [ ] Count only active (no `completedAt`); `ready-to-complete` still holds a
      slot.
- **Tests** (`plan.test.ts` or `boardInsights.test.ts`): capacity 0/3/4;
  completed excluded, ready-to-complete counted; over-limit literal; each match
  set contains exactly the expected ids.
- **Gate:** tsc + test.

### T2b. Lifecycle filtering at the planning-selector seam (fix #2)
- [ ] Add `activeGoals(goals)` (drops `completedAt`) to `plan.ts`.
- [ ] Exclude completed inside `plannedLeaves`, `nextUp`, `carryOvers` (a
      completed project contributes no planned/next/carry-over item). This
      centralizes the rule so `NextUpCard`, `Hero`, `WeekStrip`, the planner
      right-pane pool, `boardInsights`, and the drawer all inherit it.
- [ ] Confirm `ensureWeekRollover` (store.ts:179, uses `plannedLeaves(prevWeek)`)
      still behaves: a completed project drops from recap — intended.
- **Tests** (`plan.test.ts`): `plannedLeaves/nextUp/carryOvers › skip completed
  goals`; a Today-selector test asserting a completed project's steps don't
  appear.
- **Gate:** tsc + test. **Commit:** `feat(plan): project attention authority,
  focus summary, lifecycle-aware selectors`.

---

## Phase 2 — Completion lifecycle (store)

### T3. Complete/reopen + `guardActive` (expanded) + accessible move (fix #3)
- [ ] `completeGoal(goalId)` — set `completedAt = todayStr()` via
      `withUndo('Complete project', 'goals', next)` (undo-aware).
- [ ] `reopenGoal(goalId)` — clear `completedAt`, no undo.
- [ ] `guardActive(goalId)` early-return; wrap the **full** frozen set:
      `toggleLeaf`, `addChild`, `addRootNode`, `removeNode`, `planNode`,
      `unplanNode`, **`indentNode`, `outdentNode`, `reorderSiblingNodes`**. For
      `nodeId`-only actions resolve owner via `goalOfNode(goals, nodeId)`
      (`findInAll`). Leave metadata unguarded (`renameGoal`, `setGoalNotes`,
      `setGoalDates`, `setNodeDates`, `clearNodeDates`, milestones, column move).
- [ ] `moveGoalToColumn(goalId, column)` for the accessible menu — must produce
      the same column-major order as drag (reuse the T3b weave).
- **Tests** (`store.test.ts`): complete/reopen round-trip + undo replay;
  `guardActive › refuses each frozen action (incl. indent/outdent/reorder) on a
  completed goal from any caller`; `› allows metadata + column move`;
  `moveGoalToColumn order == drag`.
- **Gate:** tsc + test.

### T3b. Preserve completed positions on board rebuild (fix #1)
- [ ] Add pure `weaveCompleted(fullGoals, activeColumns)`: per column, output the
      new active order, re-inserting each completed goal of that column at the
      within-column index it held before the edit. Never appends globally.
- [ ] Route board drag + `moveGoalToColumn` through it so `setGoalBoard` receives
      complete columns (nothing gets appended/moved).
- **Invariant:** completing a project, reordering active siblings, then reopening
  returns it to its original horizon **and** within-column position; unrelated
  order undisturbed (spec §2.5, §5).
- **Tests** (`board.test.ts` / `store.test.ts`): `weave › complete 2nd of 3 in
  Now, drag actives, reopen → back at index 1`; `› cross-column active drag
  leaves completed pinned`.
- **Gate:** tsc + test. **Commit:** `feat(store): explicit project completion
  lifecycle with position-preserving board`.

---

## Phase 3 — Board redesign (ATOMIC — one commit)

### T4. Horizon columns
- [ ] `Goals.tsx` `COLUMNS` → `Now / Next / Later / Someday`; feed columns from
      **active goals only**; render completed via T6 section.
- [ ] `Column.tsx` header: horizon name + count; Now shows `N / 3` + over-limit
      warning; keep column-0 accent.

### T4b. Repo-wide copy audit + import backward-compat (fix #4)
- [ ] `goalImport.ts`: keep `priorityToColumn` accepting the legacy
      `highest|high|medium|later` **and** add `now|next|later|someday` aliases →
      columns 0–3; update `PRIORITY_WORDS` output, `FORMAT_HINT`, `buildAiPrompt`
      copy to the new horizon words. `columnToPriority` returns the new words.
- [ ] `NewGoalModal.tsx`: horizon picker labels + any "goal"→"project" copy.
- [ ] Sweep remaining priority/"goal" **presentation** copy: `store.ts` default
      labels, `boardInsights.ts`, `Goals.tsx`, `Timeline.tsx` label column
      ("Goal"→"Project"), `GoalDrawer.tsx`, `InsightBar`/`FocusSummary`. Code
      identifiers stay `Goal` (Q9).
- **Tests** (`goalImport.test.ts`): legacy words still map; new words map;
  unknown → column 0.

### T5. Card hierarchy + derivations (Q8)
- [ ] New pure helpers in `plan.ts`/`board.ts`: `nearestMeaningfulDate(goal,
      today)` (returns `{date, kind}`; overdue if all past) and
      `nextOpenAction(goal, today)` (this-week-planned open leaf → `firstOpenLeaf`
      → prompt). Tests: selection + kind; preference order.
- [ ] `BoardCard.tsx`: reorder to title + dated-with-kind → next action →
      week-commitment line (Now only, `plannedLeaves([g], week)` done/total) →
      compact progress → one `projectAttention` badge. **Remove expected %.**
- [ ] Actions row: **Plan next step** (verdict label) + **Open project**;
      overflow menu = Move to Now/Next/Later/Someday (`moveGoalToColumn`) +
      destructive delete.

### T6. Focus summary + completed section
- [ ] Replace `InsightBar` with `FocusSummary` (consumes T2 match sets; buttons
      emphasize `goalIds`, dim the rest, Clear resets). Drop board-shape counts +
      aggregate due-soon.
- [ ] Collapsed **Completed** section, newest-`completedAt` first, each **Reopen**;
      Now capacity excludes completed.

### T7. Drawer completion UX (fix #3)
- [ ] `GoalDrawer`/`DrawerBody`: when `goal.completedAt`, render `GoalTree`
      read-only (no toggle/add/indent/reorder), hide the "+ add sub-goal" input,
      and show **Reopen**; when active + `paceStatus === 'complete'`, show
      **Complete project**. Metadata (dates/milestones/notes) stays editable.
- **Gate (phase):** tsc + `npm test` + manual board pass (drag, move menu,
  complete, reopen at position, highlight, drawer read-only). **Commit:**
  `feat(goals): commitment-horizon board, focus summary, completion UI`.

---

## Phase 4 — Planner & drawer focus

### T8. Drawer node focus (Q10)
- [ ] Store: add `drawerFocusNodeId` to UI state; `openDrawer(goalId, nodeId?)`
      sets it, `closeDrawer` clears. Drawer expands-to + highlights the node;
      missing/deleted → project root.
- **Tests/manual:** open with and without node.

### T9. Planner focus (Q3)
- [ ] `PlanWeekOverlay`/`PlanGoalTree` accept `focusGoalId`/`focusNodeId`.
      Per-card **Plan next step** forces `step = 'plan'` (bypass recap **without**
      `markWeekReviewed`), scroll/expand/highlight the target with its next open
      leaf ready; never filters or auto-plans; missing target → ranked list.
- **Tests/manual:** recap bypass leaves `planReview` unreviewed; deleted-target
  fallback.
- **Gate:** tsc + test. **Commit:** `feat(plan): focused planner + node-focused
  drawer`.

---

## Phase 5 — Timeline roadmap

### T10. Pure roadmap logic (Q5/Q6/Q7)
- [ ] New `src/lib/roadmap.ts` (+ `roadmap.test.ts`):
- [ ] `roadmapWarnings(goal, today)` — five per-project warnings composing the
      shared predicates + `spanOutside`. No `nowGoals`.
- [ ] `focusOverlap(nowGoals)` — sweep-line, **inclusive** day counting;
      `>3` spans overlapping `≥7` consecutive days. **Determinism rule:** among
      qualifying windows return the earliest by start, tie-break by longest;
      merge touching windows. Returns `{ window:{start,end}, goalIds } | null`.
- [ ] `fitRoadmapRange(goals, plotWidth)` — `clamp(plotWidth / paddedRangeDays,
      MIN_PX_PER_DAY, MAX_PX_PER_DAY)`; 5% + 7-day/side padding; wide → min zoom
      centered (never narrows); single-day collapse → Week preset; returns
      `{ scale, scrollToCenterDate } | null`.
- **Tests:** each warning boundary; overlap 7-day/>3 boundary, single window,
  multi-window determinism; fit clamp/collapse/plot-width/empty.
- **Gate:** tsc + test.

### T11. Scope, grouping & framing (fix #6)
- [ ] Scope base control (Focus = Now+Next / All active / One project) **plus an
      independent `Include completed` toggle**; all view-local, unpersisted.
- [ ] Group rows by horizon over `byPriority`; omit empty groups; filter by scope
      + completed toggle.
- [ ] Deleted/completed single-project selection → fall back to Focus (spec §5).
- [ ] **Fit** button: compute via `fitRoadmapRange`, then `setScale(scale)` **and
      stash `pendingCenter.current = scrollToCenterDate`** so effect #3 positions
      it after the scale layout-effect settles — do **not** set `scrollLeft`
      directly (it gets clobbered). Disabled with empty selection.
- **Tests/manual:** scope combinations incl. completed toggle; single-project
  fallback; Fit lands centered and is not overwritten by the rescale.
- **Gate:** tsc + test.

### T12. Rows, warnings, overlap banner, drawer nav
- [ ] GoalRow/NodeLane consume `roadmapWarnings` (warn styling on affected
      bars), attention state, milestone-unplanned markers.
- [ ] Replace unscheduled chip tray with **`Unscheduled phases (N)`** row;
      **Schedule** = `defaultNodeSpan` + `setNodeDates` **then opens the new phase
      for adjustment** (via `openDrawer(goalId, nodeId)`); plus Open.
- [ ] Remove habit dots + per-day planned counts from `DaysLane` (spec §3.3).
- [ ] Render `focus-overlap` as a Timeline-level banner/band with a **"move a
      project out of Now"** action (opens the participating projects; uses
      `moveGoalToColumn` to Next). Warnings are text + colour, never colour alone.
- [ ] Clicking a project/phase → `openDrawer(goalId, nodeId)`.
- **Gate (phase):** tsc + `npm test` + manual Timeline pass (Fit, all scopes +
  completed toggle, zoom, drag/resize, warnings, overlap banner + move flow,
  Schedule-opens-phase, drawer nav, keyboard, reduced-motion, light/dark).
  **Commit:** `feat(timeline): project roadmap — scope, fit, warnings, overlap`.

---

## Phase 6 — Responsive & final

### T13. Narrow board + accessibility + final gates
- [ ] Narrow board horizon switcher (one horizon at a time — §2.1/§6);
      accessibility labels/focus states on horizon controls, focus-summary
      signals, scope, completion actions, Timeline handles.
- [ ] Full manual matrix (spec §7); confirm existing data loads without moving
      columns or auto-archiving.
- **Gate:** `npm test` + `npm run build`. **Commit:** `feat(a11y): narrow board
  switcher + focus-first polish`.

---

## Decision → task map

| Decision | Tasks | Decision | Tasks |
|---|---|---|---|
| 1 attention authority | T1 | 6 focus-overlap portfolio | T10, T12 |
| 2 horizon gating | T1 | 7 shared predicates | T1, T10 |
| 3 planner focus | T9 (+T8) | 8 card derivations | T5 |
| 4 completion guard/undo | T3, T3b | 9 naming | T4, T4b |
| 5 Fit best-effort | T10, T11 | 10 focus summary / drawer node / Schedule | T2/T6, T8, T12 |

## Risks & call-outs

- **`attentionRank` refactor (T1)** is the one behind-the-scenes change that's
  user-visible — it reorders the planner. Eyeball after.
- **`guardActive` from `nodeId`-only actions (T3)** — resolve the owning goal or
  the freeze leaks (Today's leaf toggle especially).
- **Board weave (T3b)** is load-bearing for "same horizon and position" — do it
  before Phase 3 renders active-only columns.
- **Board atomicity (Phase 3)** — T4–T7 ship in one commit.
- **Fit vs. scale layout-effect (T11)** — route the center through
  `pendingCenter`, never a direct `scrollLeft`.
- **`fitRoadmapRange` plot width** — viewport − active label width, not raw
  viewport.
