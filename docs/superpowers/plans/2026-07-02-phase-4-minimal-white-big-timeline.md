# Phase 4 — Minimal White Refresh + Big Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Phase from the warm-cream identity to a quieter near-white one, strip decoration and tighten density everywhere ("compact, minimal, actually useful"), and turn the Timeline into the app's flagship planning surface: full-width, taller, with expandable goal rows where **sub-goals become draggable time blocks** the user can schedule by dragging, exactly like goal bars today.

**Architecture:** Three layers of change, strictly ordered:

1. **Theme (Task 1–2):** token-only palette swap in `tailwind.config.js` + a decoration-diet pass. No component structure changes.
2. **Timeline expansion (Task 3–7):** one new data field pair (`GoalNode.start`/`deadline`), two new store actions, an extracted reusable `SpanBar` drag component, window navigation, and expandable sub-goal lanes. All drag math reuses the existing tested `src/lib/timeline.ts` helpers.
3. **QoL bundle (Task 8):** small high-leverage bridges between views (plan-next-action-as-task, behind-pace chips, InlineEdit dedup).

**Tech Stack:** unchanged — Vite + React 19 + TypeScript, Tailwind 3.4, Dexie, Vitest. No new dependencies.

## Design rationale (read before coding)

- **"Less yellow, more white":** the current neutrals (`bg #F2EDE2`, `panel #FBF7EE`, `line #E4DAC7`) all sit on a yellow axis. The v3 palette moves every neutral to warm-gray/white and concentrates ALL warmth in the terracotta accent, which pops harder on white. Ink, dot, and the whole accent family are untouched → minimal call-site churn (it's almost entirely a `tailwind.config.js` edit).
- **"Minimal":** minimal = fewer competing elements, not smaller text. The diet removes explainer paragraphs, shrinks the hero, merges footer stats into one line, and trims paddings ~15%. It does NOT remove functionality (drag handles, undo, shortcuts, a11y all stay).
- **"Timeline bigger, sub-tasks as blocks":** goals already drag/resize on the Timeline (`src/views/Timeline.tsx` + `src/lib/timeline.ts`). Sub-goals (first-level `GoalNode`s) get the same treatment: expand a goal row → each first-level node is a lane; unscheduled nodes sit in a tray; click a tray chip to place a default one-week block, then drag to move / drag edges to resize. Scheduling is **dates-only metadata** — it never touches `done` or the pct roll-up.

## Decisions already made (do not re-open)

These were settled deliberately; implement as written:

1. **Near-white, not pure white.** `bg` is `#FAF9F7` (warm near-white); panels are pure `#FFFFFF`. Pure-white page + pure-white cards would lose the card layering.
2. **Only FIRST-LEVEL nodes get timeline lanes.** Deeper descendants are managed in the drawer tree as today. Lanes stay readable; the node's own fill already reflects its subtree via `nodePct`.
3. **Click-to-schedule, then drag.** Clicking an unscheduled chip places a default block (max(today, goal.start) → +6 days, clamped into the goal span). Drag-from-tray ghost previews are a future nicety, not part of this plan.
4. **No hard clamp to the parent span.** A node block dragged outside its goal's start–deadline keeps working but renders with a `warn`-tinted border and a tooltip note. Clamping mid-drag fights the user.
5. **Node scheduling is symmetric:** `start` and `deadline` are both set or both absent (mirrors the leaf-XOR-container invariant style).
6. **Zoom window gets an anchor + prev/next navigation.** Today the window is locked to the current year/quarter/month — you cannot look at next quarter. This is the single biggest Timeline QoL gap and the sub-goal feature is pointless without it.

## Global Constraints

- **Palette v3 (exact — replaces the v2 cream values token-for-token):**

  | token | v2 (cream) | v3 (near-white) |
  |---|---|---|
  | bg | #F2EDE2 | **#FAF9F7** |
  | panel | #FBF7EE | **#FFFFFF** |
  | panel-bright | #FFFDF6 | **#FFFFFF** |
  | field | #FFFEF9 | **#FFFFFF** |
  | ink | #211E19 | #211E19 (keep) |
  | ink-hover | #3A352C | #3A352C (keep) |
  | ink-soft | #4A463C | #4A463C (keep) |
  | muted | #8B8375 | **#85817A** |
  | faint | #B3AB9B | **#B0ACA4** |
  | faint-2 | #C7BEAC | **#C9C5BD** |
  | line | #E4DAC7 | **#EAE8E3** |
  | line-2 | #DDD2BC | **#DEDBD3** |
  | line-soft | #EDE4D0 | **#F0EEE9** |
  | hover | #F3EDDD | **#F4F3EF** |
  | hover-deep | #E9E1D0 | **#EBE9E3** |
  | fill | #211E19 | #211E19 (keep) |
  | dot | #3B362B | #3B362B (keep) |
  | dot-off | #E6DCC5 | **#E8E6DF** |
  | track | #E7DDC8 | **#EFEDE7** |
  | accent | #C8512F | #C8512F (keep) |
  | accent-deep | #B34526 | #B34526 (keep) |
  | accent-soft | #D89A7E | #D89A7E (keep) |
  | accent-contrast | #FFF6EE | #FFF6EE (keep) |
  | accent-tint | #F0DCCF | **#F5E3DA** |
  | paper | #F7F2E7 | **#FAF9F7** |
  | chip | #EEE6D3 | **#F1EFEA** |
  | chip-ink | #6B6455 | **#6E6A61** |
  | warn | #A05A2C | #A05A2C (keep) |
  | warn-tint | #F3E3D2 | **#F6EADF** |

- **Shadows (lighter, neutral):** card `0 1px 2px rgba(30,28,22,.05)` · today `0 2px 6px rgba(30,28,22,.07)`. Nothing heavier.
- **Type & radii unchanged:** Fraunces + Inter, cards 14px, fields 9px. Minimal ≠ new fonts.
- **Data invariants (unchanged and sacred):** pct roll-up = average of DIRECT children, leaf 0/100 (`src/lib/pct.ts` — do not touch). Habits/tasks/sessions tag goals for context only, NEVER move a %. Milestones never enter roll-up. **New:** node `start`/`deadline` are scheduling metadata only — they never affect `done` or pct.
- **A11y invariants:** every draggable bar stays a keyboard-operable `<button>` with a descriptive `aria-label`; arrow-key move/resize parity for node blocks; `prefers-reduced-motion` respected; icon-only buttons keep `aria-label`s.
- **Backup compatibility:** export/import must round-trip nodes with and without dates. Old backups (nodes without dates) import unchanged — the fields are optional, no Dexie migration needed (goals are stored as whole objects).
- **Verification commands:** `npm test` · `npm run build` · `npm run dev` (http://localhost:5173).
- Work on a branch (`phase-4-minimal-timeline`), commit after every task, never commit red.

## File Structure

```
Modify:  tailwind.config.js               — palette v3 + shadows        (Task 1)
Modify:  src/index.css                    — HabitDots today-ring hexes  (Task 1)
Modify:  src/views/today/HabitDots.tsx    — hardcoded ring hexes        (Task 1)
Modify:  src/views/today/*.tsx, App.tsx, Goals.tsx, Calendar.tsx — decoration diet (Task 2)
Delete:  src/views/today/FooterStats.tsx  — merged into Hero            (Task 2)
Modify:  src/db/types.ts                  — GoalNode.start?/deadline?   (Task 3)
Modify:  src/state/store.ts               — setNodeDates/clearNodeDates (Task 3)
Modify:  src/lib/timeline.ts + test       — anchored window, shiftAnchor, defaultNodeSpan (Task 4)
Create:  src/views/timeline/SpanBar.tsx   — shared draggable span bar   (Task 5)
Create:  src/views/timeline/GoalRow.tsx   — goal lane + expansion       (Task 6)
Create:  src/views/timeline/NodeLane.tsx  — sub-goal lane + tray        (Task 6)
Rewrite: src/views/Timeline.tsx           — thin composition + window nav (Task 5–7)
Modify:  src/App.tsx                      — Timeline gets wide container (Task 7)
Modify:  src/views/today/GoalsCard.tsx    — behind-pace chip, plan-next-action (Task 8)
Create:  src/components/InlineEdit.tsx    — dedup the 3 copies          (Task 8)
```

Store interfaces relied on throughout (pre-existing): `useAppStore()`, `actions.setGoalDates`, `actions.openDrawer`, `actions.addTask`, `goalPct`, `nodePct`, and everything in `src/lib/timeline.ts` / `src/lib/dates.ts`.

---

### Task 1: Palette v3 — whiter, quieter

**Files:** `tailwind.config.js`, `src/views/today/HabitDots.tsx`, `src/index.css`

- [ ] **Step 1:** Replace the changed color values in `tailwind.config.js` per the v3 table above (bold entries change; "keep" entries stay). Replace `boxShadow` with `card: '0 1px 2px rgba(30,28,22,.05)'`, `today: '0 2px 6px rgba(30,28,22,.07)'`.
- [ ] **Step 2:** Sweep for hardcoded v2 hexes outside the config: `grep -rn "F2EDE2\|FBF7EE\|FFFDF6\|FFFEF9\|E4DAC7\|F7F2E5\|CBBEA2\|E7DDC8" src/ index.html`. Known hits: `HabitDots.tsx` uses `bg-[#F7F2E5]` and inset ring `#CBBEA2` for today's unchecked dot — replace with `bg-[#F5F4F0]` and ring `#C9C5BD`. Fix anything else the grep finds (including a possible `<meta name="theme-color">` in `index.html`).
- [ ] **Step 3:** Verify: `npm test && npm run build` green. `npm run dev`: page is near-white (#FAF9F7) with pure-white cards; terracotta reads stronger; no leftover cream patches on any of the 4 views or the drawer.
- [ ] **Step 4:** Commit: `feat(theme): palette v3 — near-white neutrals, warmth concentrated in accent`

---

### Task 2: Decoration diet + compact density

**Files:** `src/views/today/Hero.tsx`, `FooterStats.tsx` (delete), `WeekStrip.tsx`, `HabitsCard.tsx`, `TasksCard.tsx`, `StudyLogCard.tsx`, `GoalsCard.tsx`, `src/views/Today.tsx`, `src/views/Timeline.tsx`, `src/views/Goals.tsx`, `src/views/Calendar.tsx`, `src/components/CardSection.tsx`

Minimal = remove competing elements; keep every feature. Concrete cuts:

- [ ] **Step 1 — Hero absorbs FooterStats:** shrink the greeting from `text-[2.5rem]` to `text-[1.7rem]`; keep the mono date kicker. Move the footer's stats into the hero's single summary line (habits done · tasks done · focus minutes today · habit hit % — whichever FooterStats currently shows; days-left-in-year stays only if it fits on one line). Delete `FooterStats.tsx` and its mount + any now-unused helpers/imports. The keyboard-hint line moves to a `title` attribute on the top-bar nav (or is dropped — hints also live in aria-labels).
- [ ] **Step 2 — Card density:** in `CardSection.tsx` reduce padding `px-[18px] py-[15px]` → `px-[16px] py-[12px]`. Row paddings in Habits/Tasks cards `py-[8px]` → `py-[6px]`. WeekStrip `min-h-[72px]` → `min-h-[60px]`, day-card padding `py-[10px]` → `py-[8px]`.
- [ ] **Step 3 — Copy diet:** delete the Timeline intro paragraph ("Your year as production phases…") and the footer caption ("The line marks today…") — the tooltips and aria-labels carry that information. Delete any equivalent explainer sentence in Goals/Calendar headers (keep the `h1`s). Empty-state one-liners stay (they guide first use).
- [ ] **Step 4 — Chrome diet:** view `h1`s `text-[1.74rem]` → `text-[1.4rem]` with `mb-[16px]`. Top-bar tagline (`2026 · plan & ship`) is dropped; wordmark stays.
- [ ] **Step 5:** Verify: build green; `npm run dev` — Today fits noticeably more above the fold, nothing lost except the deleted captions; all four views + drawer look consistent.
- [ ] **Step 6:** Commit: `feat(ui): decoration diet — compact hero, denser cards, copy trim`

---

### Task 3: Data — schedulable sub-goals

**Files:** `src/db/types.ts`, `src/state/store.ts`, `src/db/db.ts` (only if export/import validates shapes)

- [ ] **Step 1:** In `GoalNode`, add:

```ts
  start?: string;    // 'YYYY-MM-DD' — scheduling metadata only, never affects pct
  deadline?: string; // both present or both absent
```

- [ ] **Step 2:** Store actions (mirror the style of `setGoalDates`):
  - `setNodeDates(goalId: string, nodeId: string, start: string, deadline: string)` — finds the node via `findNode` (`src/lib/tree.ts`), writes both dates ordered via `clampSpan` from `src/lib/timeline.ts`, persists.
  - `clearNodeDates(goalId: string, nodeId: string)` — deletes both fields, persists.
- [ ] **Step 3:** Confirm export/import round-trips the new optional fields (goals persist as whole objects — expected: zero changes needed; verify by export → import in dev).
- [ ] **Step 4:** Verify `npm test && npm run build`; commit: `feat(data): optional start/deadline on goal nodes + store actions`

---

### Task 4: Timeline lib — anchored windows + node-span helpers (TDD)

**Files:** `src/lib/timeline.ts`, `src/lib/timeline.test.ts`

- [ ] **Step 1 — failing tests first** for:
  - `zoomWindow(zoom, anchor)` — already anchor-shaped (takes a date and derives its year/quarter/month); add cases proving a non-today anchor works (e.g. `zoomWindow('quarter', '2026-11-15')` → Oct 1–Dec 31).
  - `shiftAnchor(zoom: ZoomLevel, anchor: string, n: number): string` — NEW: returns the anchor moved n windows (year → same day ±n years, quarter → ±3n months, month → ±n months; clamp day into the target month so Jan 31 → Feb 28 doesn't overflow).
  - `defaultNodeSpan(goal: {start: string; deadline: string}, today: string): {start: string; deadline: string}` — NEW: start = max(today, goal.start) but never past goal.deadline; deadline = start + 6 days, capped at goal.deadline; if the goal span is shorter than 7 days, span = whatever fits (min 0-day span, start === deadline).
  - `spanOutside(span, goal): boolean` — NEW: true when span.start < goal.start || span.deadline > goal.deadline (drives the warn styling).
- [ ] **Step 2:** Implement; all tests green.
- [ ] **Step 3:** Commit: `feat(lib): anchored zoom windows, shiftAnchor, defaultNodeSpan (TDD)`

---

### Task 5: Extract `SpanBar` — one draggable bar to rule them all

**Files:** Create `src/views/timeline/SpanBar.tsx`; modify `src/views/Timeline.tsx`

The move/resize/snap/keyboard logic currently inlined on the goal bar (`Timeline.tsx:153-211`) is exactly what node blocks need. Extract it once.

- [ ] **Step 1:** Create `SpanBar` with props:

```ts
{
  span: { start: string; deadline: string };
  win: DateWindow;                    // current zoom window
  pct: number;                        // fill 0–100
  label: string;                      // text inside the bar (title or pct)
  ariaLabel: string;
  height: number;                     // 22 goal · 18 node
  warn?: boolean;                     // warn-tinted border (outside parent span)
  onCommit(next: { start: string; deadline: string }): void;
  onOpen?(): void;                    // click without drag
}
```

  Internals move verbatim from Timeline.tsx: pointer-capture drag with `move`/`start`/`end` zones (8px edges), `snapDelta` (Shift = week), live preview via local state, `suppressClick` ref, ArrowLeft/Right ±1d (Shift ±7d, Alt resizes end), the out-of-window `‹ earlier / later ›` marker, and the shared tooltip trigger callbacks (lift tooltip state up via `onHover?(tip)` prop or keep tooltips inside SpanBar — implementer's choice, but ONE mechanism for both bar kinds).
- [ ] **Step 2:** Re-implement the existing goal bars through `SpanBar` (goal rows keep pct fill + `%` label + `openDrawer` on click). Behavior must be pixel-for-pixel and key-for-key identical.
- [ ] **Step 3:** Verify: build green; manual drag/resize/keyboard/tooltip check on goal bars at all 3 zooms.
- [ ] **Step 4:** Commit: `refactor(timeline): extract SpanBar shared drag component`

---

### Task 6: Expandable goal rows with sub-goal lanes

**Files:** Create `src/views/timeline/GoalRow.tsx`, `src/views/timeline/NodeLane.tsx`; modify `src/views/Timeline.tsx`

- [ ] **Step 1 — GoalRow:** each goal row grows a chevron in the lane-label column (`aria-expanded`, rotates 90° when open; local `Set<string>` state in Timeline for expanded ids). Row min-height goes 46px → **52px** (bigger, per the brief). When expanded, first-level nodes render beneath as lanes.
- [ ] **Step 2 — NodeLane (scheduled nodes):** for each first-level node WITH dates: a 34px lane — label column shows the node title indented (`pl-[28px]`, `.78rem`); plot area reuses the month grid + today line and renders a `SpanBar` with `height 18`, fill = `nodePct(node)` (leaf: 0/100), label = title when the bar is wide enough (>90px) else empty (tooltip carries it), `warn = spanOutside(span, goal)`, `onCommit` → `actions.setNodeDates`. An `✕`-style "unschedule" affordance in the lane label (hover-visible, `aria-label="Unschedule <title>"`) calls `clearNodeDates`.
- [ ] **Step 3 — Tray (unscheduled nodes):** below the lanes, one 30px row listing nodes WITHOUT dates as chips (`bg-chip text-chip-ink rounded-full`, `+ <title>`); clicking a chip calls `setNodeDates(goal.id, node.id, ...defaultNodeSpan(goal, todayStr()))` — the block appears and is immediately draggable. Kicker label `UNSCHEDULED` in mono. Tray hidden when every node is scheduled; expanded goal with zero nodes shows one faint line: "No sub-goals yet — add them in the drawer."
- [ ] **Step 4 — a11y:** node bars get aria-labels like `"<node>: 40% complete, Jul 6–Jul 12, sub-goal of <goal>. Arrow keys move by day…"`. Chevron and chips are real buttons.
- [ ] **Step 5:** Verify: expand → tray chips → click chip → block appears with a sensible default span → drag/resize/keyboard all work → dates persist across reload → dragging outside the goal span shows warn border, not a block → pct fill of node bars matches the drawer tree → `npm test && npm run build` green.
- [ ] **Step 6:** Commit: `feat(timeline): expandable goal rows with draggable sub-goal blocks + unscheduled tray`

---

### Task 7: Timeline goes big — wide container + window navigation

**Files:** `src/App.tsx`, `src/views/Timeline.tsx`

- [ ] **Step 1:** In `App.tsx`, move `timeline` out of the 880px column into a wide container like Today's (`max-w-[1280px] mx-auto px-[36px] py-[32px]`). Goals/Calendar keep 880px.
- [ ] **Step 2:** Lane-label column 160px → **200px** (room for chevron + indented node titles).
- [ ] **Step 3 — window navigation:** Timeline keeps local `anchor` state (init `todayStr()`). Header row gains, left of the zoom toggle: `←` / `→` buttons (`shiftAnchor(zoom, anchor, ∓1)`), a "Today" reset (disabled when the window already contains today), and a mono window label (`2026` / `Q3 2026` / `JULY 2026`). Zoom changes keep the current anchor. The today line/caret renders only when today is inside the window (`windowFrac` in 0–100).
- [ ] **Step 4:** Keyboard: `[` / `]` shift the window while the Timeline view is active (register in the existing shortcut effect in `App.tsx`, ignored when an input has focus — follow the existing pattern).
- [ ] **Step 5:** Verify: Timeline fills the wide column; next-quarter planning works (navigate → drag a block → navigate back — dates stick); out-of-window goals show `‹ earlier / later ›`; build + tests green.
- [ ] **Step 6:** Commit: `feat(timeline): full-width layout + prev/next window navigation`

---

### Task 8: QoL bundle

**Files:** `src/views/today/GoalsCard.tsx`, `src/components/InlineEdit.tsx` (new), `src/App.tsx`, `src/components/GoalTree.tsx`, `src/views/Goals.tsx`

- [ ] **Step 1 — Plan next action as a task:** in `GoalsCard`, each goal row already surfaces `firstOpenLeaf`. Add a hover-visible "→ today" button beside it: `actions.addTask(leaf.title, todayStr(), goal.id)`, then the existing toast confirms. Guard: disabled (with title tooltip "already planned") when an open task with the same title+goalId exists today. This bridges the goal tree to the daily list — the single most "actually useful" glue in the plan.
- [ ] **Step 2 — Behind-pace chip:** in `GoalsCard` rows, when `behindPaceBy(goalPct(g), g.start, g.deadline, today) >= 10`, render a `warn`/`warn-tint` chip `N pts behind`. On pace renders nothing (minimal — absence is the good state).
- [ ] **Step 3 — InlineEdit dedup:** extract the three near-identical inline-edit implementations (`App.tsx`, `GoalTree.tsx`, `Goals.tsx`) into `src/components/InlineEdit.tsx`; all three call sites consume it. Pure refactor, no behavior change.
- [ ] **Step 4:** Verify: `npm test && npm run build`; manual pass over drawer editing, goal renaming, tree node renaming.
- [ ] **Step 5:** Commit: `feat(qol): plan-next-action, behind-pace chips, InlineEdit dedup`

---

## Final verification (whole plan)

- [ ] `npm test` — all suites green (including new timeline lib tests).
- [ ] `npm run build` — exits 0.
- [ ] Visual sweep at 1440px and ~1000px: Today, Goals, Timeline (all 3 zooms, expanded + collapsed, prev/next windows), Calendar, drawer.
- [ ] Export a backup, wipe IndexedDB (devtools), import — node schedules survive the round-trip.
- [ ] `prefers-reduced-motion`: chevron rotation and bar transitions disabled.
- [ ] Merge `phase-4-minimal-timeline` → `main`.

## Explicitly out of scope (future candidates, do not build now)

- Drag-from-tray ghost previews (click-to-place ships first).
- Scheduling nodes deeper than first level.
- Draggable milestones on the Timeline.
- Habit-level detail popovers / month heatmaps (removed deliberately in Phase 3).
- Dark mode.
