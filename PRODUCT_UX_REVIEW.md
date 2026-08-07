# Product UX Review

**Reviewer persona:** MIT CS student (course 6), power user of Notion, Todoist, Google Calendar, Linear, Obsidian. Evaluating Phase as a candidate replacement for parts of that stack.

**Build reviewed:** `main` @ `a13a48d`, Vite dev server, Chromium, 2026‑07‑30.
**Method:** loaded a realistic dataset through the app's own JSON import path — 12 projects across all four horizons (incl. one archived, one 180‑char title), ~45 leaf steps, 3 levels of nesting, 4 habits with real check‑in history, 8 tasks (3 overdue), milestones, notes, and a Mon–Sat availability profile. Then ran end‑to‑end workflows at 375 / 768 / 1440 px in both themes, measuring geometry and contrast in the live DOM rather than eyeballing screenshots.

**Confidence labels used throughout:** **[Confirmed]** = reproduced in the running app and/or measured in the DOM. **[Hypothesis]** = reasoned from code, not directly observed.

**Not tested — do not read silence here as approval:**
- Week rollover / "returning after several days" (needs clock manipulation; `ensureWeekRollover` and `PlanReview` were read in code but never exercised).
- Google Calendar sync (the Plan header permanently reads "calendar not connected"; no integration exists yet).
- The Electron shell (`npm run app:dev`) — browser only.
- **Real pointer drag‑and‑drop.** I drove clicks programmatically; dnd‑kit pointer drags and the keyboard drag path were read in code and confirmed *configured*, but never completed end‑to‑end. Every DnD claim below is scoped accordingly.
- Screen‑reader passes (VoiceOver/NVDA). A11y findings are from DOM/ARIA inspection and computed‑style measurement.
- Scale beyond ~50 leaves. "Hundreds of tasks" is untested; no virtualization exists in any list.

---

## Executive Summary

Phase is a **well‑built, opinionated, half‑finished product**. The data model is unusually principled for an app at this stage — leaves are XOR containers, progress only moves when you tick a real action, and scheduling metadata is rigorously prevented from contaminating the completion roll‑up. That discipline shows: tick one checkbox in the project drawer and the percentage, the pace deficit, the week counter, the parent container, the board card, and the Today rail all update correctly and instantly. Most planners cannot do this.

**Strongest qualities.** The Now/Next/Later/Someday board with a hard cap of three "Now" projects is a real idea, honestly executed — it is the only surface in my current stack that would stop me from committing to nine things at once. The project drawer's pace line (`35 pts behind pace · expected 77% by today · 1/3 planned this week · Next: …`) is the single best piece of information design in the app: it explains *why* a project is behind instead of just asserting it. Deletes use undo‑instead‑of‑confirm, the Linear/Gmail pattern, correctly. And the visual identity — Fraunces display over Inter, warm paper/ink palette, both themes properly built — is distinctive and deliberate, not templated.

**Largest usability problem.** Not one bug: a **coherence failure between the app's own surfaces.** The flagship feature — the Plan calendar grid, where you assign real clock times to work — does not reach the default view. `DailyWorkItem` in `src/lib/dailyWork.ts` has no time field at all, so Today's Work lists a 9:00am standup *below* an 11:00am meeting and shows no times. The same "behind pace" number renders as `Behind 44%` on Goals and `44 pts behind` on Today and Timeline. Two competing weekly planners ship simultaneously, one of them literally labelled **"Old planner"** in the production nav. Number keys 1–5 map to nav tabs in the order 1, 3, 4, 5, 2. Every undo toast reads `Deleted "X" · Undo` *next to* an Undo button. Individually each is small; together they make a technically sound app feel unfinished and untrustworthy at exactly the moments you are deciding what to work on.

**Would I adopt it today? No.** Three hard blockers, in order:

1. **No search of any kind.** No text filter, no command palette, no quick‑switcher. With 12 projects and ~45 steps I already could not find "the CUTLASS regression thing" without scanning four views by eye. This is disqualifying for anyone who came from Linear's `⌘K` or Obsidian's quick switcher, and it is the cheapest high‑impact thing on this list.
2. **Mobile is broken, not merely cramped.** 484px of horizontal overflow at 375px viewport (`scrollWidth` 859 vs `clientWidth` 375) because the header never collapses. It still overflows by 162px at 768px. My planner has to work on a phone between classes.
3. **The primary action of the whole app is invisible.** The unchecked step checkbox has a **1.55:1** contrast border in dark mode and **1.31:1** in light — WCAG 1.4.11 requires 3:1. I genuinely could not see where to click to complete a step and had to read the source to confirm the control existed.

**What must improve before production‑ready:** delete the "Old planner" and merge its unique capability into Plan; make Today's Work time‑aware; ship search; fix the header's responsive collapse; raise checkbox/target contrast and size; unify the "behind" vocabulary; and fix the doubled "Undo" copy across 14 call sites.

---

## Product Positioning

**Who it appears to be for.** A single, self‑directed person carrying 4–8 medium‑horizon commitments that each decompose into a few dozen concrete actions, who is chronically over‑committed and needs to be *told* so. The seeded example is literally "Finish Pset 7", the domain vocabulary is projects/steps/habits, and the focus cap is 3. This is aimed squarely at me.

**The problem it solves.** Not capture (Todoist wins), not knowledge (Obsidian wins), not team execution (Linear wins). Phase's actual thesis is **commitment honesty**: making the gap between what you have promised yourself and what fits in your week visible and uncomfortable. Three mechanisms carry it: the 3‑slot Now cap, the pace deficit ("expected 77% by today"), and the availability‑aware weekly capacity ("24h 6m free · 9h 35m planned"). No tool in my stack does all three.

**Is the value proposition differentiated?** Yes, but it is currently *buried*. The differentiator lives in the Goals board's focus cap and the drawer's pace line. The default landing view is Today, which looks like a slightly weaker Todoist. A first‑time user meets the least differentiated surface first.

**Where it sits relative to the incumbents:**

| Tool | What it does better | What Phase does better |
|---|---|---|
| **Todoist** | Capture speed (NLP: "email Kaashoek tomorrow 3pm p1"), search, filters, mobile | Forces a WIP limit; ties every task to an outcome; shows pace vs. deadline |
| **Linear** | `⌘K`, interaction speed, bulk edit, ruthless component consistency | Personal (not team) horizon model; habits; capacity‑aware week |
| **Google Calendar** | Time visualization, real events, sync, mobile | Backlog rail adjacent to the grid — plan *from* your work, not into a void |
| **Notion** | Arbitrary structure, databases, views | Opinionated: one right way to decompose; enforced leaf/container invariant |
| **Obsidian** | Frictionless capture + linking, plugins, local files | Actually schedules and tracks; progress is computed, not written by hand |

**Focused, or doing too much?** It is trying to do too much *simultaneously* and not enough *completely*. Four top‑level views plus a fifth modal planner, and two of them (Plan, Old planner) overlap heavily. Timeline is a Gantt chart that nothing else in the app depends on. The product would be stronger as: **Today (execute) → Plan (schedule the week) → Goals (commit and decompose)**, with Timeline demoted to a mode inside Goals.

---

## What Works Well

Only genuinely effective things are listed. Ordinary functionality is excluded.

### 1. The three‑slot focus cap on the Now column
`Goals` shows `3 of 3 focus slots used` and the column header reads `3 / 3`. The cap is a real constraint tied to a real concept (commitment horizon), not decoration. **Why it works:** it converts prioritization from a sorting problem (which every tool has) into a scarcity problem (which almost none impose). **Behavior supported:** it makes "I'll also start the thesis proposal" cost something, which is the actual failure mode of an over‑committed student.

### 2. The drawer's pace explanation
`35 pts behind pace · expected 77% by today · 1/3 planned this week · Next: Pass TestBackup2B` **[Confirmed]** — four independent facts, each actionable, on one line. **Why it works:** every other surface asserts "behind"; only this one shows the arithmetic. **Behavior supported:** deciding whether "behind" means *panic* or *fine, the last three steps are quick*. This line is the app's best asset and it is currently hidden two clicks deep.

### 3. Cross‑surface state propagation
Ticking one leaf updated, in a single frame: project 33%→42%, pace 44→35 pts, week counter 0/3→1/3, "Next:" advanced, container 2B 33%→67%, header 4/9→5/9, and the board card behind the drawer. **[Confirmed]** **Why it works:** a single store with one write path (`setAndPersist`) and pure derivation. **Behavior supported:** trusting the numbers enough to act on them — the precondition for everything else the app claims.

### 4. "Needs a decision" inline triage
Overdue tasks get a dedicated Today block with inline `Today · Tomorrow · Pick day · Delete` plus `Push all to next week →`. **[Confirmed]** **Why it works:** the decision and the controls are in the same place; zero navigation, zero modals. This is better than Todoist's overdue handling, which makes you open each task or drag it. **Behavior supported:** the Monday‑morning debt clearing that otherwise gets skipped.

### 5. Undo instead of confirmation dialogs
Deleting a project deletes it immediately and offers Undo. **[Confirmed]** **Why it works:** confirmations are clicked through reflexively and protect nobody; undo protects everybody. Correct pattern. (Its parameters are wrong — see C‑7 — but the choice is right.)

### 6. Keyboard sensors wired into all three drag contexts
`KeyboardSensor` is registered in `Goals.tsx`, `Plan.tsx`, and `PlanWeekOverlay.tsx`, with `sortableKeyboardCoordinates` on the board **[Confirmed in code, not exercised end‑to‑end]**. Timeline bars carry genuinely excellent labels: *"6.5840 …: 33% complete, Jul 20–Aug 2. Arrow keys move by day, Shift for weeks, Alt…"*. Most apps ship drag‑only. That this was considered at all is above the bar.

### 7. The `Modal` component
Focus trap, focus restore to the opener, body scroll lock, Escape, scrim click, and a `modalRegistry` so stacked dialogs don't fight over Escape. **[Confirmed in code]** This is a properly built primitive — which makes the `GoalDrawer` not using it (A‑1) all the more conspicuous.

### 8. Local‑first architecture and honest failure states
IndexedDB via Dexie, a Web Lock rejecting a second writer tab, export/import gated on `hydration === 'ready'`, and a hydration‑error screen that explicitly reassures the user *"nothing has been deleted"* and names the likely causes. **[Confirmed in code]** That error copy is better than most funded products ship.

### 9. Visual identity
Fraunces for display, Inter for text, a warm paper/ink palette, and a light theme that is genuinely designed rather than an inverted dark theme. Both themes were checked. This does not read as AI‑generated or templated; it reads as someone's taste. **Preserve this.**

---

## Critical Issues

Ordered by damage.

---

### C‑1. The Plan grid's clock times do not exist anywhere else in the app

**Severity:** Critical
**Area:** Workflow / Information architecture
**Location:** `src/lib/dailyWork.ts` (`DailyWorkItem`, `buildDailyWork`); rendered by `src/views/today/TodayWorkCard.tsx`

**Problem.** `GoalNode.plannedStartMin` and `Task.startMin` are the foundation of the Plan calendar grid. `DailyWorkItem` has **no time field at all**, and `commitments` is never sorted — items are appended in fixed bucket order (`due` → `task-today` → `pinned-today` → `this-week`) and then by array order. **[Confirmed]** The only `.sort()` calls in the file are on *suggestions* (l.267, l.278) and *carry‑overs* (l.312).

**User impact.** I scheduled a 9:00 standup, an 11:00 office‑hours booking, a 13:00 debugging block and a 15:00 kernel task. Today's Work rendered them in the order **Email (no time) → 11:00 → 9:00 → 15:00 → this‑week**, with no times shown at all. **[Confirmed]** The view I land on by default actively misrepresents my day. I planned my week in Plan, then had to go *back to Plan* to find out what was next — which makes Today decorative. This is the single largest reason I would not adopt.

**Evidence.** Screenshot of Today's Work with "Standup notes for SuperPosition" (09:00) listed after "Book the 6.5840 office-hours slot" (11:00); DOM/code inspection confirming no time field and no sort.

**Recommendation.**
1. Add `startMin?: number` to `DailyWorkItem`, populated from `task.startMin` / `node.plannedStartMin`.
2. Sort `commitments` by `startMin ?? Infinity`, then by the existing bucket order for untimed items.
3. Render a right‑aligned `9:00` / `11:00` column in `TodayWorkCard`; untimed items show `—` and sink below timed ones under an "Anytime today" subheading.
4. Draw a divider at the current time so "what's next" is a glance, not a scan.

**Reference.** Google Calendar's *Schedule* view and Todoist's *Today* both sort timed items chronologically above untimed ones. Apple Reminders' Today does the same. This is the universal convention and Phase is the outlier.

**Acceptance criteria.**
- Given four items on today at 09:00, 11:00, 13:00, 15:00 plus one untimed, Today's Work lists them 09:00, 11:00, 13:00, 15:00, then the untimed one.
- Each timed row displays its start time in the user's locale format.
- Rescheduling an item in the Plan grid reorders Today's Work without a reload.
- A "now" divider appears between the last past item and the first future item.

---

### C‑2. Two weekly planners ship at once, one labelled "Old planner"

**Severity:** Critical
**Area:** Navigation / Product coherence
**Location:** `src/App.tsx:164–174` (nav button, `title="Old planner (4)"`); `src/views/Plan.tsx` vs `src/views/plan/PlanWeekOverlay.tsx`

**Problem.** The production top nav contains five destinations: Today, Plan, Goals, Timeline, and a bordered button reading **"Old planner"**. Both Plan and Old planner are weekly planners that drag steps from the same backlog rail onto days; they differ only in presentation (time grid vs. day columns) and in *which* affordances they expose (Old planner has the "Break into day‑sized tasks" action and an inline Availability link; Plan has real clock times and resize handles). **[Confirmed]**

**User impact.** Every session begins with "which planner am I supposed to use?" A nav item named "Old planner" tells the user the product is mid‑refactor and that their data may be in the wrong place — the strongest possible anti‑trust signal, sitting in permanent chrome. It also doubles the surface area of every future change. When I planned my week I did it twice, in both, because neither clearly superseded the other.

**Evidence.** Nav screenshot showing `Today | Plan | Goals | Timeline | Old planner`; the overlay's own title is "Plan your week", identical in intent to the Plan view.

**Recommendation.**
1. Port the two capabilities Plan lacks — *Break a step into day‑sized tasks*, and the Availability editor entry point — into the Plan view.
2. Delete the `Old planner` nav button and the `4` shortcut; keep `PlanWeekOverlay` only if the Monday recap flow (`planReview`) still needs it, and if so retitle it "Week review" and surface it *only* when `planReview.reviewed === false`.
3. Reassign shortcuts (see C‑5).

**Reference.** Linear ships exactly one place to schedule an issue. When it replaced its cycle planner it removed the old one in the same release rather than shipping both.

**Acceptance criteria.**
- The top nav contains at most four destinations.
- No user‑visible string contains the word "old".
- Every action available in the old planner is reachable from Plan.
- The week recap appears only when there is an unreviewed recap.

---

### C‑3. No search, filter, or command palette anywhere

**Severity:** Critical
**Area:** Navigation / Workflow efficiency
**Location:** Global — no such surface exists

**Problem.** There is no text search input, no fuzzy finder, and no command palette in the entire application. **[Confirmed — no `type="search"`, no "Search" placeholder, no `⌘K` handler anywhere in `src/`.]** The only filtering that exists is the Timeline's single‑project `Focus` dropdown and the Goals stat chips.

**User impact.** With 12 projects and ~45 leaves — a *small* semester — locating "the step about the CUTLASS pipeline bisect" required opening the Goals board, opening a drawer, closing it, and repeating. There is no way to answer "what do I have open for 6.5840?" or "where did that note about late days go?" without manual scanning across four views. Every incumbent solves this: Linear `⌘K`, Todoist quick‑find, Obsidian `⌘O`, Notion `⌘P`. For a power user this alone blocks adoption, and it gets monotonically worse every week of the semester.

**Recommendation.** Ship a `⌘K` palette. Scoped MVP, in priority order:
1. Fuzzy search over project titles, leaf titles, task titles, and habit titles; grouped results with the parent project as context.
2. Enter on a result opens the drawer focused on that node (`drawerFocusNodeId` already exists and does exactly this).
3. Verbs on the same index: *Plan for today*, *Mark done*, *Go to Plan/Goals/Today/Timeline*.
4. Recents when the query is empty.

The store already holds everything in memory as a single snapshot; this is a client‑side filter over `goals`/`tasks`/`habits`, not an indexing project.

**Reference.** Linear's `⌘K`. Note the pattern worth copying is *one input that both finds and acts*, not a separate search page.

**Acceptance criteria.**
- `⌘K` / `Ctrl+K` opens a palette from any view, including with a drawer open.
- Typing `cutlass` surfaces the matching leaf with its project name within 2 keystrokes of settling.
- Enter navigates to and highlights that node.
- Escape closes and restores focus to the opener.
- The palette is reachable and operable by keyboard alone.

---

### C‑4. The app is unusable below ~930px; mobile overflows by 484px

**Severity:** Critical
**Area:** Responsiveness
**Location:** `src/App.tsx:136–222` (`<header>`)

**Problem.** The header is a single non‑wrapping flex row containing the wordmark, five nav buttons, the Task button, and four utility controls (`?`, theme, EXPORT, IMPORT). It has no collapse behaviour at any breakpoint — the only responsive rule is `px-[16px] sm:px-[36px]` and hiding the theme *word*. Measured **[Confirmed]**:

| Viewport | `scrollWidth` | Horizontal overflow |
|---|---|---|
| 375 px (mobile) | 859 px | **+484 px** |
| 768 px (tablet) | 930 px | **+162 px** |
| 1440 px | 1440 px | 0 |

Widest offenders: `nav` (368px, never wraps), the utility cluster `? ↓ EXPORT ↑ IMPORT` (178px), the Task button (101px).

**User impact.** On a phone the entire application side‑scrolls; the content column is laid out against the 859px overflowed width, so the Goals subtitle collapsed into a ~65px‑wide, 10‑line ribbon. On an iPad in portrait, or any laptop with a browser side‑panel open, the header still runs off. A planner I cannot open on my phone between classes is not my planner. Notably, the *content* below the header does adapt well — the Goals board correctly becomes a horizon tab switcher (`Now · 3 | Next · 3 | Later · 2 | Someday · 3`) and even reveals a `COMPLETED 1` disclosure not shown on desktop. **The responsive work was done for the body and skipped for the chrome.**

**Recommendation.**
1. Below `lg`: collapse EXPORT / IMPORT / theme / `?` into a single overflow `⋯` menu.
2. Below `md`: move primary navigation to a bottom tab bar (thumb reach) or a hamburger; reduce the Task button to a `＋` icon.
3. Add `min-w-0` + `overflow-hidden` on the header's flex children so nothing can force the document wider than the viewport.
4. Add a regression test asserting `document.documentElement.scrollWidth <= clientWidth` at 375/768/1024/1440.

**Acceptance criteria.**
- At 375, 414, 768, 1024 and 1440px, `scrollWidth === clientWidth` on every view.
- All primary navigation is reachable at 375px without horizontal scrolling.
- No interactive control is clipped at any tested width.

---

### C‑5. Number shortcuts do not match the visible tab order

**Severity:** High
**Area:** Interaction / Navigation
**Location:** `src/lib/appKeyboard.ts:44–49`

**Problem.** **[Confirmed — pressing `3` from the Plan view landed on Timeline, the 4th tab.]**

| Key | Goes to | Position in nav |
|---|---|---|
| `1` | Today | 1st |
| `2` | Goals | **3rd** |
| `3` | Timeline | **4th** |
| `4` | Old planner | **5th** |
| `5` | Plan | **2nd** |

The mapping is `1, 3, 4, 5, 2`. Plan — arguably the flagship view and the second tab — is on `5`.

**User impact.** The universal convention (browsers, Slack, Linear, editors) is that `⌘1..n` selects the nth *visible* tab. Anyone who learns this positionally lands on the wrong view, repeatedly, and the error is silent. This is clearly historical: the numbers predate Plan being inserted at position 2. The cheat sheet (`?`) documents the real mapping correctly, so it is discoverable — but a shortcut you must look up is a shortcut that failed.

**Evidence.** `resolveAppKeyCommand` source; live confirmation that `3` → Timeline.

**Recommendation.** Renumber to match visual order: `1` Today, `2` Plan, `3` Goals, `4` Timeline. Free `5`. If C‑2 is done first this falls out for free. Additionally, move the shortcut hint from the single `title` on `<nav>` (which currently shows the entire cheat string on hover of any tab) onto each button individually.

**Acceptance criteria.**
- Pressing `n` activates the nth button in the nav, for every n.
- Hovering an individual tab shows only that tab's own shortcut.
- The cheat sheet lists shortcuts in nav order.

---

### C‑6. The primary action of the app is effectively invisible

**Severity:** High
**Area:** Accessibility / Visual design
**Location:** `src/components/GoalTree.tsx:52–76` (leaf checkbox); habit strip in `src/views/today/HabitDots.tsx`

**Problem.** Measured in the live DOM **[Confirmed]**:

| Control | Size | Border colour | Background | Contrast | WCAG 1.4.11 min |
|---|---|---|---|---|---|
| Unchecked step checkbox (dark) | 17×17 | `rgb(46,46,49)` | `rgb(0,0,0)` | **1.55 : 1** | 3 : 1 |
| Unchecked step checkbox (light) | 22×22 | `rgb(222,219,211)` | `rgb(250,249,247)` | **1.31 : 1** | 3 : 1 |
| Checked step checkbox | 17×17 | accent fill | — | 5.97 : 1 ✓ | 3 : 1 |

**User impact.** Opening the Raft project drawer, I could see checked items (orange, struck through) but **could not locate the control to complete an open step.** I had to read `GoalTree.tsx` to confirm the checkbox was rendered at all. Ticking a leaf is the single action that moves every number in this product; making it the least visible element on the screen inverts the visual hierarchy. It also fails WCAG 2.1 AA 1.4.11 (Non‑text Contrast) in *both* themes, and 17×17 fails WCAG 2.2 AA 2.5.8 (Target Size, 24×24 minimum).

**Recommendation.**
1. Raise the unchecked border to ≥3:1 against panel background in both themes (dark: ~`rgb(90,90,95)`; light: ~`rgb(160,156,148)`).
2. Increase the hit target to 24×24 (the visual box can stay 17–18px inside a larger padded button).
3. Keep the existing hover darkening as reinforcement, not as the primary signal.

**Reference.** Todoist's open circle sits around 4.5:1 against its row and is the most prominent element in it — deliberately, because ticking is the point.

**Acceptance criteria.**
- Unchecked checkbox border ≥3:1 against its background in light and dark.
- Hit target ≥24×24 CSS px.
- A first‑time user can identify the completion control in a screenshot with no hover.

---

### C‑7. Destructive deletes have a 5‑second, single‑slot, silently‑clobbered undo

**Severity:** High
**Area:** Interaction / Data safety
**Location:** `src/state/store.ts:212–220` (`scheduleUndo`), `:226–230` (`withUndo`)

**Problem.** **[Confirmed in code and in use.]** Deleting a project takes two clicks (`⋯` → `Delete project`) with **no confirmation**, and the only recovery is a **5000 ms** toast. `scheduleUndo` holds exactly one `restoreFn`; any subsequent undoable action within that window calls `clearTimeout` and **overwrites it**. There is no trash, no archive‑before‑delete, and no history.

**User impact.** Deleting my 6.5840 project — 9 leaf steps across 3 containers, 2 milestones, notes, and a full week of scheduling — is two clicks and unrecoverable after five seconds. Worse: delete a project, then tick any checkbox within those five seconds, and the project is gone permanently with no warning that you just consumed your undo. Five seconds is below the time it takes to *notice* a misclick, let alone move the mouse to the toast. The `completedAt` archive concept already exists in the type — the safety net is half built.

**Recommendation.**
1. Raise the undo window to 10–15s for deletes (keep 5s for cheap toggles).
2. Do not let a new undo silently discard a pending *delete* — either keep a small stack, or flush the pending delete's toast with a distinct "Deleted permanently" state.
3. For projects with more than N leaves, make `Delete project` a two‑step inline confirm (`Delete project` → `Delete 9 steps?`), or route it to Archive with delete available from an archived list.
4. Show what was lost: `Deleted "6.5840 …" and its 9 steps`.

**Reference.** Gmail's undo window is user‑configurable up to 30s. Linear soft‑deletes to a recoverable trash.

**Acceptance criteria.**
- Undo for a project delete remains available ≥10s.
- Performing another undoable action does not silently discard a pending project delete.
- The toast names the number of child steps removed.
- A deleted project is recoverable through some path after the toast expires.

---

### C‑8. Every undo toast prints the word "Undo" twice

**Severity:** Medium
**Area:** Content
**Location:** `src/state/store.ts` — 14 call sites (lines 316, 412, 498, 508, 559, 601, 621, 713, 733, 749, 762, 836, 853, 952)

**Problem.** Labels are constructed as `` `Deleted "${title}" · Undo` `` and then rendered next to a real Undo button in `App.tsx:288–295`. The result reads: **`Deleted "Conflict-term fast backup" · Undo    Undo`**. **[Confirmed — observed on delete and on complete.]**

**User impact.** Small in isolation, corrosive in aggregate — this appears on *every* destructive action, so it is the most‑seen string in the app. It reads as a copy bug that nobody checked, which is precisely the impression a product asking to hold your semester cannot afford.

**Recommendation.** Strip `· Undo` from all 14 label strings; the button already provides the affordance. Add a unit test asserting no `pendingUndo.label` ends with `Undo`.

**Acceptance criteria.** No toast contains the word "Undo" more than once.

---

### C‑9. A closed modal dialog stays in the accessibility tree and the tab order

**Severity:** High
**Area:** Accessibility
**Location:** `src/components/GoalDrawer.tsx` (contrast with the correct `src/components/Modal.tsx`)

**Problem.** With no project open, the DOM still contains **[Confirmed by measurement]**:

```
role="dialog"  aria-label="Project"  aria-modal="true"
visibility: visible   opacity: 0   pointer-events: none
inert: false          aria-hidden: null
```

Its "Close goal drawer" button has `tabIndex 0` and **successfully receives focus** when the drawer is closed. This was visible in the very first accessibility snapshot of the empty app, before any data existed.

**User impact.** Two distinct failures. (1) Keyboard users tab into an invisible control that does nothing visible — a dead stop with no feedback. (2) `aria-modal="true"` instructs assistive technology to treat everything *outside* the dialog as inert. A permanently‑present `aria-modal` dialog can therefore hide the entire application from a screen reader. `opacity: 0` does **not** remove an element from the a11y tree or the tab order; only `display:none`, `visibility:hidden`, `inert`, or unmounting do.

**Recommendation.** Unmount `GoalDrawer` when `goal === null`, exactly as `Modal` already does (`Modal` renders nothing when `!open` and is otherwise correct). If the slide‑in transition requires the node to persist, add `inert` + `aria-hidden="true"` + `visibility: hidden` while closed, and adopt `Modal`'s focus trap and focus restore.

**Acceptance criteria.**
- With no project open, `document.querySelector('[role="dialog"]')` returns `null` (or the node is `inert` and `aria-hidden`).
- Tabbing through the closed app never focuses a hidden control.
- Opening the drawer moves focus into it; closing restores focus to the opener.

---

### C‑10. Habit history is edited through 7×7px targets, silently and irreversibly

**Severity:** High
**Area:** Accessibility / Interaction / Data safety
**Location:** `src/views/today/HabitDots.tsx`; `src/state/store.ts:531–544` (`toggleHabitOn`)

**Problem.** **[Confirmed by measurement.]** Every dot in the 14‑day habit strip is an individually clickable button — `Mark "Run 5k" on Jul 16`, `Clear "Run 5k" on Jul 19` — measuring **7×7 CSS px**, roughly 4px apart. The today toggle is 22×22 and sits at the *far right end of the strip*, visually indistinguishable from the 15th history dot. `toggleHabitOn` writes via plain `setAndPersist` — **no `withUndo`, no toast**.

**User impact.** Three compounding problems:
- **Discoverability:** checking off today's habit means clicking the last dot in a row of dots, at the opposite end of the row from the habit's name. Nothing indicates this is the "today" control. I did not find it by looking; I found it by measuring the DOM.
- **Target size:** 7×7px is a third of the WCAG 2.2 AA 24×24 minimum and unusable on touch. Mis‑clicking an adjacent day is the expected outcome, not the edge case.
- **Silence:** a mis‑click rewrites your recorded history — the thing streaks are computed from — with no toast, no undo, no trace. The backfill *intent* is good and well‑documented in the source; the *interaction* is unsafe.

**Recommendation.**
1. Give today's toggle a distinct affordance separated from the history strip — a 24×24 checkbox adjacent to the habit title, matching the step checkbox.
2. Make the history strip read‑only by default. Move backfill behind an explicit affordance (click the row → a day picker, or an "edit history" toggle) with ≥24px targets.
3. Route `toggleHabitOn` through `withUndo` and show `Marked "Run 5k" on Jul 19 · Undo` whenever the edited date is not today.

**Acceptance criteria.**
- Today's habit toggle is ≥24×24 and adjacent to the habit title.
- History dots are not directly clickable in the default state.
- Any backfill/clear of a non‑today date produces an undoable toast.

---

### C‑11. 15‑minute blocks in the Plan grid collapse to an unreadable 13px sliver

**Severity:** Medium
**Area:** Visual design / Workflow
**Location:** `src/views/plan/EventBlock.tsx:92–101`

**Problem.** Block height is `Math.max(height, 1.6)%` of the grid. Measured against a 719px grid spanning 08:00–22:00 **[Confirmed]**:

| Duration | Rendered height | Content needed |
|---|---|---|
| 15 min | **13 px** | 26 px (title 13px + time 13px) |
| 90 min | 77 px | ✓ |
| 120 min | 103 px | ✓ |

The block renders two stacked lines inside `overflow: hidden`, so at 13px the **start‑time line is entirely clipped** and the block has no visible body — it reads as a hairline with text floating over the gridline. The 1.6% floor works out to ~11.5px, which does not help.

**User impact.** My two 15‑minute commitments (a standup and an office‑hours booking) looked like rendering artifacts rather than scheduled work. Short blocks are exactly what a student's day is full of. The block is also below any reasonable drag/resize target.

**Recommendation.**
1. Set a hard `min-height` of ~34px (two lines + padding) — accept the small overlap for very short blocks, as every calendar does.
2. Below ~40px, switch to a single‑line layout: `9:00  Standup notes` on one row, dropping the second line.
3. Suppress the `×` and the resize grip below the single‑line threshold; expose them on hover only.

**Reference.** Google Calendar enforces a ~22px minimum chip and switches to inline `time — title` for sub‑30‑minute events.

**Acceptance criteria.**
- No grid block renders shorter than 30px.
- A 15‑minute block legibly shows both its title and start time.
- Overlapping short blocks remain individually clickable.

---

### C‑12. The same metric is called "Behind 44%" in one view and "44 pts behind" in another

**Severity:** Medium
**Area:** Content / Consistency
**Location:** `src/lib/plan.ts:366–370` vs `src/components/BehindChip.tsx`

**Problem.** `behindPaceBy()` returns **percentage points** below the linear‑pace expectation. It is rendered two different ways **[Confirmed]**:
- Goals board (`attentionBadge`): `` `Behind ${pts}%` `` → **"Behind 44%"**
- Today rail and Timeline (`BehindChip`): `` `${pts} pts behind` `` → **"44 pts behind"**

A dedicated, correctly‑worded component exists; the board bypasses it and builds its own string.

**User impact.** "Behind 44%" reads as "44% behind schedule"; the true meaning is "44 percentage points below where linear pace says you should be" — 33% actual vs 77% expected. Moving between Goals and Today, the same project shows two different‑looking numbers for the same fact, so I stopped trusting both. The board also has three visually identical chips carrying three incompatible units — `Behind 44%`, `Due in 11d`, `Overdue` — with no legend.

**Recommendation.**
1. Use `BehindChip` on the board; delete the ad‑hoc string in `attentionBadge`.
2. Standardise on **"44 pts behind pace"** everywhere — it is unambiguous and matches the drawer's already‑excellent line.
3. Add a tooltip on every chip: *"33% done, 77% expected by today"*.

**Acceptance criteria.**
- No surface renders `Behind N%`.
- The same project shows an identical chip string on Goals, Today and Timeline.
- Hovering the chip explains the arithmetic.

---

### C‑13. Timeline's default zoom renders every project as a 1–2px sliver

**Severity:** Medium
**Area:** Visual design / Workflow
**Location:** `src/views/Timeline.tsx`, `src/lib/timeline.ts` (`pxPerDay` default)

**Problem.** On load, the Timeline spans roughly mid‑May to early‑October (~5 months) while all 12 projects live inside a ~3‑week band around today. **[Confirmed]** Project bars render as near‑vertical slivers; ~85% of the plot is empty. Clicking **Fit** immediately produces a readable, well‑proportioned chart — the correct default is one click away and not taken.

Two secondary defects in the same view **[Confirmed]**:
- The percentage pill is not clipped to its bar. On a short bar it overflows; at default zoom the 6.1810 project rendered its label as **"20"** with the `%` cut off — a wrong number, not just a cramped one.
- Expanding a project row (chevron) **resets the horizontal framing** and scrolls away from today — the header jumped from `JULY 2026` to `JUNE 2026` and the Fit framing was lost. An unrelated action destroys the user's viewport.

**User impact.** The view's entire purpose is comparing project spans against deadlines; at default zoom that is impossible. The expand‑resets‑scroll bug punishes the exact interaction the view invites.

**Recommendation.**
1. Run the `Fit` computation on mount (and on project‑set change), clamped to a sane minimum span (~4 weeks).
2. Preserve scroll offset and scale across row expand/collapse.
3. Clip or relocate the % label when the bar is narrower than the label; below a threshold, place it outside the bar's right edge instead of truncating.

**Acceptance criteria.**
- On first load with data, all active project bars are within the viewport and ≥20px wide.
- Expanding/collapsing a row leaves `scrollLeft` and zoom unchanged.
- The % label is never rendered with its `%` sign cut off.

---

### C‑14. Project titles are truncated at exactly the disambiguating characters

**Severity:** Medium
**Area:** Visual design / Content
**Location:** `src/views/goals/BoardCard.tsx:65` (`line-clamp-2`); `src/views/today/GoalsCard.tsx`; Plan backlog rail

**Problem.** Course projects are named `<course> — <assignment>`; the identifying part is at the end. Observed truncations **[Confirmed]**:

| Surface | Rendered |
|---|---|
| Goals card | `6.5840 Distributed Systems — Lab 2:…` |
| Goals card | `18.404 Theory of Computation — Pse…` |
| Today rail | `6.5840 Distributed…` / `6.1810 OS En…` / `SuperPosition — …` / `18.404 Theory of C…` |
| Plan backlog | `6.1810 OS Engineering — Lab: co…` |

Six of eight titles in the Today rail were cut. Meanwhile the *habit* row rendered the full untruncated `UROP — sparse attention kernels (NeurIPS rebuttal)`, and the Timeline's left column wraps titles fully — so three different policies coexist.

**User impact.** `18.404 Theory of Computation — Pse…` does not tell me whether it is Pset 5 or Pset 6. In a semester with three psets per course, the truncated portion is the *only* distinguishing information. In the Today rail the chips (`44 pts behind`, `AUG 2 · 3D`) are given priority over the title itself — secondary information dominating primary.

**Recommendation.**
1. In the Today rail, move the pace chip and date to a second line and give the title the full width.
2. Prefer middle‑ellipsis (`6.5840 Distributed…Lab 2: Raft`) over tail‑truncation where one line is unavoidable — it preserves both ends.
3. Add `title={goal.title}` to every truncated title so hover reveals the full string (currently absent on cards).
4. Allow 2 lines in the Plan backlog rail; there is ample vertical room.

**Acceptance criteria.**
- Two projects differing only in a trailing assignment number are visually distinguishable on Goals, Today and Plan without hovering.
- Every truncated title exposes its full text via `title`.

---

### C‑15. Native date inputs contradict the app's own date format

**Severity:** Medium
**Area:** Visual design / Content / Correctness risk
**Location:** `src/components/GoalDrawer.tsx` (start/deadline/milestone `<input type="date">`)

**Problem.** The drawer uses unstyled native date inputs rendering **`20/07/2026 → 02/08/2026`** (DD/MM/YYYY, from browser locale) while every other surface renders `Jul 20`, `Aug 2`, `JUL 29 · 1D OVER`. **[Confirmed]**

**User impact.** Two costs. Cosmetically, the native control's typography and dropdown break an otherwise carefully controlled visual system — the most template‑looking element in the app. More seriously, `02/08/2026` is genuinely ambiguous: in a US academic context a reader parses it as **February 8**, while the field means **August 2**. The app displays that same date as "Aug 2" one line above, which invites a misread on the one field where a mistake shifts a deadline.

**Recommendation.** Replace with a text input that accepts and displays the app's own format (`Aug 2`, `2026-08-02`), backed by a small custom picker; or at minimum force `en-CA`/ISO display so the format is unambiguous. Reuse the parsing already present in `src/lib/schedule.ts` (`isValidLocalDate`).

**Acceptance criteria.**
- Dates render identically in the drawer and on cards.
- No date is displayed in an ambiguous DD/MM vs MM/DD format.

---

### C‑16. "Save dates" is a manual save button in an otherwise autosaving app

**Severity:** Medium
**Area:** Interaction / Feedback
**Location:** `src/components/GoalDrawer.tsx` (`Save dates` / `Clear dates`)

**Problem.** Every other edit in Phase persists immediately — titles, checkboxes, notes, horizon moves. The drawer's date range alone requires clicking **Save dates**, sitting next to an unguarded **Clear dates**. **[Confirmed]**

**User impact.** This is the "did the app save my change?" moment the product should never produce. Having changed a deadline, closed the drawer, and seen the card unchanged, I could not tell whether I had forgotten to click Save or whether the edit had failed. And `Clear dates` — which wipes both start and deadline — sits one button away with no confirmation and (unlike the delete paths) sits beside a control users are actively clicking.

**Recommendation.** Autosave on blur/change with the same undo toast used elsewhere (`updateGoalDates` already routes through `withUndo`). Remove `Save dates`. Keep `Clear dates` but make it undoable and move it away from the primary controls.

**Acceptance criteria.**
- Editing a date persists without an explicit save action.
- The change is reflected on the board card immediately.
- Clearing dates is undoable.

---

### C‑17. "Break a step into daily tasks with AI" is a clipboard round‑trip that demands hand‑written JSON

**Severity:** Medium
**Area:** Content / Workflow
**Location:** `src/components/SubtaskAiModal.tsx`; `src/lib/goalImport.ts:275–300` (`parseSubtasks`)

**Problem.** The drawer's entry point reads **"✦ Break a step into daily tasks with AI"**. There is no AI: the modal copies a prompt to the clipboard for you to paste into an external LLM, and asks you to paste the reply back. **[Confirmed]** The modal's own body text explains this honestly ("copy the prompt, and ask any AI…"), so only the *entry label* over‑promises.

The larger problem is the return path: `parseSubtasks` accepts **strict JSON only**. A reply wrapped in ```` ```json ```` fences — the single most common LLM output shape — fails with *"That's not valid JSON."* So do smart quotes, a trailing comma, or a numbered list.

**User impact.** The label sets an expectation of in‑app generation that the feature cannot meet, so it reads as vapour. Then the feature that *does* exist fails on the most likely input, and the error tells the user their AI is wrong rather than that the parser is strict. For a local‑first app the clipboard design is a legitimate, even admirable choice — it just needs honest framing and a forgiving parser.

**Recommendation.**
1. Relabel the entry point: **"Break a step into subtasks…"** with a `✦` hinting at the AI assist inside.
2. Make `parseSubtasks` tolerant, in this order: strip ```` ``` ```` fences → try JSON → fall back to newline‑separated lines, stripping leading `-`, `*`, and `1.` numbering. Normalise curly quotes.
3. Preview the parsed titles before committing, so a bad parse is visible rather than fatal.

**Acceptance criteria.**
- Pasting a fenced JSON array succeeds.
- Pasting a plain newline‑separated or bulleted list succeeds.
- The user sees the parsed subtask list before it is added.

---

### C‑18. The board's card menu opens upward over the neighbouring card

**Severity:** Low
**Area:** Interaction
**Location:** `src/views/goals/BoardCard.tsx:304` (`absolute right-0 bottom-[34px] z-20`)

**Problem.** The `⋯` menu is unconditionally anchored *above* its trigger. Opening it on the second card in a column placed the menu directly beneath the *first* card's action row, overlapping and obscuring its own card. **[Confirmed]** There is no collision detection or flip logic, and `z-20` is scoped inside the card.

**User impact.** Momentary ambiguity about which project you are about to delete — on a menu whose last item is `Delete project`. Low frequency, but the consequence of misreading ownership here is destructive.

**Recommendation.** Flip based on available space (open downward when there is room below), and render in a portal so stacking cannot be clipped by the column. Add a visible connection to the trigger (small caret) so ownership is unambiguous.

**Acceptance criteria.**
- The menu opens downward when there is room, upward only near the viewport bottom.
- The menu never overlaps a different card's content.

---

### C‑19. Cards have four different anatomies across four columns

**Severity:** Low
**Area:** Visual design / Consistency
**Location:** `src/views/goals/BoardCard.tsx` (`CardFace`)

**Problem.** **[Confirmed]** Column membership silently changes card structure:

| Element | Now | Next | Later | Someday |
|---|---|---|---|---|
| "N of M planned steps done" | ✓ | ✗ | ✗ | ✗ |
| Attention chip | ✓ | ✓ | ✗ | ✗ |
| Primary action | Plan next step | Plan next step | Plan next step | ✗ |
| Progress value | `33%` | `0%` | `20%` | `—` (when no leaves) |

Column *headers* are equally asymmetric: Later and Someday carry italic explanatory captions, Now and Next carry none — which vertically staggers the four "Drop a project here" targets so they do not align.

**User impact.** Comparing across columns requires re‑learning the card each time; the eye cannot lock onto a fixed position for "how far along is this?". The staggered drop targets read as a layout accident rather than a decision. Most of this is *intentional* (schedule pressure is deliberately suppressed off Now/Next, per the column captions) — the intent is sound, the execution just isn't legible as intent.

**Recommendation.** Keep the semantic differences but stabilise the layout: reserve the slot and render a muted em‑dash rather than collapsing the row, so every card has identical height and identical field positions. Give all four columns a caption (or none). Align drop targets on a shared baseline.

**Acceptance criteria.**
- All cards in all columns expose the same field slots in the same order.
- The four empty drop targets share a top edge.

---

### C‑20. Two of four board stat chips are usually zero, and act as dead buttons

**Severity:** Low
**Area:** Visual design / Content
**Location:** `src/views/goals/FocusSummary.tsx`

**Problem.** Four equally‑weighted chips sit above the board: `FOCUS 3 of 3`, `NEXT STEP 0`, `SCHEDULE 4`, `THIS WEEK 6`. Zero‑valued chips render greyed but keep full size and remain focusable buttons **[Confirmed — `Next step: 0 Now projects need a first step, show these projects`]**, filtering to an empty set.

**User impact.** Persistent chrome that carries no information most of the time, competing visually with the board itself. A button that announces itself as a filter and returns nothing is worse than an absent button.

**Recommendation.** Hide zero‑valued chips entirely, or collapse them into a single muted line. Keep `FOCUS n of 3` always visible — it is the board's thesis and deserves more weight, not equal weight.

**Acceptance criteria.**
- A stat chip with a zero count is not rendered as an interactive filter.
- The focus‑slot chip is visually dominant among the summary chips.

---

### C‑21. Old planner day columns truncate almost every label to ~8 characters

**Severity:** Low (scoped — resolves if C‑2 is done)
**Area:** Visual design
**Location:** `src/views/plan/PlanWeekOverlay.tsx`

**Problem.** Seven day columns inside a centred modal yield ~78px each. Observed content **[Confirmed]**: `6.5840 Di…`, `SUPERPOSI…`, `6.1810 OS…`, `√ Pa…`, `√ Co…`, plus bare `est` chips for unestimated items.

**User impact.** The surface cannot be read, only recognised by position. Unestimated items show a cryptic `est` with no explanation of what to do about it.

**Recommendation.** Resolved by deleting this view (C‑2). If it survives, make it full‑bleed rather than modal‑width and show project colour/initial rather than truncated text; relabel `est` to `Set estimate`.

---

## Workflow Reviews

### W‑1. Create a project and break it into actionable steps

**User goal:** turn "I have to do the Raft lab" into checkable actions.

**Current steps:** Goals → `+ New project` (modal) → title, dates → Save → card appears with `Needs a first step` → `Define first step` or `Open project` → drawer → `+ add step…` → type → Enter → repeat → for sub‑steps, `+ add item…` under a container.

**Friction points.**
- Two entry points with different results: Quick Add's **Goal** mode creates a bare project with no dates and no steps; `+ New project` opens a full modal. Neither is obviously the "right" one, and Quick Add's third mode is labelled *Goal* while everything it creates is called a *project*.
- Inline `+ add step…` in the drawer is good and fast. But there is no way to **reorder** steps, no way to promote a leaf to a container explicitly (it happens implicitly when you add a child), and no drag handle visible in the drawer.
- No estimate field on a leaf in the drawer — yet estimates drive the entire Plan grid and the "1 unestimated" warning. You must decompose in one view and estimate in another.

**Unnecessary decisions.** Choosing between Quick Add/Goal and `+ New project`. Choosing a horizon at creation before you know how big the project is.

**Missing feedback.** After `+ New project`, no toast and no scroll‑to/highlight of the new card — with three Now cards already present it is not obvious where it landed.

**Recommended improved flow.** One creation path. Create → drawer opens immediately focused on the first empty step field → type steps, one per Enter → optional inline `~90m` estimate parsed from the same line (`Write the recurrence ~90m`). Set dates last, from the drawer, autosaved (C‑16). Delete Quick Add's Goal mode, or rename it and have it open the same drawer.

---

### W‑2. Plan the week

**User goal:** commit realistically to what actually fits before Monday.

**Current steps:** Plan (`5`, not `2`) → read `24h 6m free · 9h 35m planned · 1 unestimated` → drag from the To‑Plan rail onto a day/time → resize.

**Friction points.**
- **Which planner?** Plan or Old planner (C‑2). Unresolvable from the UI.
- The capacity header is the best number in the app and is set in 11px mono at low contrast, above the fold but visually subordinate to the empty grid.
- Backlog rail titles truncate (C‑14); grouping is by project, so long course names dominate.
- No bulk operation: assigning six steps to Thursday means six separate drags. No multi‑select, no "auto‑fill my free time", no "spread this project across the week".
- Unestimated items are counted in the header but there is no way to jump to them — no "1 unestimated" click‑through.

**Missing feedback.** Dropping onto a full day produces a refusal toast (correct — `scheduleNode` returns a boolean and callers respect it, which is careful work) but the grid gives no *pre*‑drop signal that a day is over capacity. Google Calendar dims and shows conflicts during the drag.

**Recommended improved flow.** Make the capacity header the visual anchor of the view. Make "1 unestimated" a button that focuses the first unestimated item. Support shift‑click multi‑select in the rail and a single drag for the group. During drag, tint the target day green/amber/red against remaining capacity — this is the app's thesis rendered as direct manipulation, and it is currently missing at the exact moment it would matter.

---

### W‑3. Decide what to work on right now

**User goal:** open the app at 14:00 and know the next action.

**Current steps:** Today → scan Today's Work → pick.

**Friction points.** This is the app's weakest workflow relative to its own ambitions.
- **No times, wrong order** (C‑1). The list cannot answer "what's next"; only "what's outstanding".
- No indication of which item is *in progress* or which I already started.
- "Worth considering" (suggestions) is a genuinely good idea — each carries a reason (`Milestone soon`, `In its window`, `Next open step`) — but it sits *below* the fold under the commitments list and reads as an afterthought.
- The Today rail's `→ today` control on a project is the fastest path to scheduling the next step, and it is a 9px mono link — the highest‑value control on the page styled as the lowest.

**Missing feedback.** No sense of "you have 3h left today and 4h of work planned" — the capacity intelligence that exists in Plan never appears on Today.

**Recommended improved flow.** Top of Today: one **Now** card — the single next action by clock time, with its project, estimate, and a Start control. Below it, the rest of the day in time order with a now‑divider. Move today's remaining capacity vs. planned load into the hero line, replacing or joining `0/4 habits · 2/6 planned this week · 21% habit hits` (three metrics whose windows are undefined; `21% habit hits` in particular has no stated period).

---

### W‑4. Review overdue and blocked work

**User goal:** Monday morning debt clearing.

**Current steps:** Today → scroll to **Needs a decision** → per row: `Today | Tomorrow | Pick day | Delete`, or `Push all to next week →`.

**What works.** This is the best workflow in the app. Decision and controls co‑located, no modals, bulk escape hatch present, and the bulk action is undoable (`Pushed N items to next week · Undo`). Better than Todoist's equivalent.

**Friction points.**
- "Blocked" does not exist as a concept anywhere in the data model — only overdue. There is no way to mark "waiting on Priya's design pass". For research and startup work this is a real gap.
- The section sits below Today's Work, so on a busy day it is below the fold — overdue work is *less* visible than today's work.

**Recommended improved flow.** Keep the interaction exactly as is. Move the section above Today's Work when non‑empty (debt before new commitments), and collapse it to a single summary row when empty. Consider a `blocked` flag on tasks/leaves with a "waiting on" note, excluded from pace calculations.

---

### W‑5. Recover from a mistake

**User goal:** undo a bad delete or a mis‑click.

**Current steps:** act → 5s toast → click Undo.

**Friction points.** Covered in C‑7 (5s window, single slot, silently clobbered, no trash) and C‑10 (habit history edits produce no undo at all). Additionally there is no global undo shortcut — `⌘Z` is not bound, so recovery requires reaching the mouse to a toast that is about to vanish.

**Recommended improved flow.** Bind `⌘Z` to `undoLastDelete`. Extend the window for structural deletes. Show what was lost in the toast.

---

### W‑6. Return after several days away

**[Not directly tested — clock manipulation required. Assessment from code and surfaces.]**

The machinery exists and is thoughtfully designed: `ensureWeekRollover` snapshots the previous week's commitments into an immutable `PlanReview`, `weekRecap` joins it against live nodes to compute what got done, and the nav flags `Old planner · review` when a recap is unreviewed. Storing titles in the snapshot so deleted nodes still appear in the recap is a nice touch.

The concern is **placement**: the recap surfaces behind the button labelled "Old planner", which C‑2 recommends deleting. Whatever happens to that view, the returning‑user recap is one of the higher‑value moments in a weekly planner and it should not live behind a control named after a deprecated feature. It belongs on Today, as the first thing shown when `planReview.reviewed === false`.

---

### W‑7. Use the app with many projects and tasks

**Tested at 12 projects / ~45 leaves / 8 tasks / 4 habits — a light semester.** No performance problems at this scale; interactions were immediate.

**Scaling concerns [Hypothesis — untested above ~50 items]:**
- No virtualization in any list. The Plan backlog rail, the Timeline rows, and the drawer tree all render every item.
- The Timeline renders one row per project with no grouping beyond horizon; at 40 projects it becomes a scroll.
- The Goals board's Someday column has no cap and no collapse — it will become an unbounded dumping ground, which undermines the focus thesis. Notion and Todoist both suffer this; Phase has the horizon model to solve it and currently doesn't (e.g. no "you have 30 Someday projects, review them?" prompt).
- Without search (C‑3), every scaling problem compounds.

---

## Visual Design Review

**Overall.** Above average and clearly authored — this does not look AI‑generated or templated. The failures are consistency and hierarchy failures, not taste failures. **Do not redesign.** The identity is an asset.

**Typography.** Fraunces (display) over Inter (text) with a mono for metadata is a strong, distinctive pairing, and the light theme's warm paper tone is well‑judged. Two problems: (1) the mono metadata tier is used for too many different things at too small a size — `AUG 2 · 3D`, `0 of 3 planned steps done`, `JUL 27 — AUG 2 24h 6m free`, `ENTER ↵`, `SYSTEM` — several at 10–11px and low contrast, including the capacity number that is the app's best insight. (2) Font sizes are specified as arbitrary rem values throughout (`.98rem`, `.86rem`, `.84rem`, `.82rem`, `.8rem`, `.78rem`, `.76rem`, `.74rem`, `.72rem`, `.66rem`, `.62rem`, `.6rem`) — twelve+ steps with no discernible scale. Collapse to 6.

**Spacing.** Same issue: `gap-[30px]`, `px-[16px]`, `py-[13px]`, `gap-[10px]`, `px-[14px]`, `py-[6px]`, `p-[13px]`, `gap-[8px]`, `mt-[9px]`, `pt-[26px]`, `pb-[18px]`, `px-[30px]`. The values are individually reasonable and collectively arbitrary — 13px and 14px and 16px all appear as horizontal padding on sibling components. Adopt a 4px scale.

**Visual hierarchy — the main structural problem.** Secondary information consistently outranks primary:
- On Today's rail, pace chips and date codes take horizontal priority over project titles (C‑14).
- The `→ today` scheduling control — the fastest action on the page — is rendered as 9px mono text.
- The Plan capacity header — the app's differentiating insight — is 11px mono above a large empty grid.
- The step checkbox, the app's core action, is the lowest‑contrast element on screen (C‑6).
- Conversely, four equal‑weight stat chips occupy prime real estate above the Goals board while two are usually zero (C‑20).

**Color.** Restrained and effective; the single accent (`rgb(225,97,59)`) is used for the now‑line, progress fill, primary actions and warnings. That last overlap is a problem: the accent means both "this is the primary action" and "this is behind schedule" (`Behind 44%` uses `warn-tint`, `Overdue` uses solid `warn`). Introduce a distinct warning hue, or reserve the accent strictly for action.

**Components.** Mostly consistent; two exceptions stand out — native `<input type="date">` in the drawer (C‑15), which is the only unstyled control in the app, and the four divergent card anatomies (C‑19).

**States.** Hover and disabled are handled well and consistently (`disabled:opacity-40 disabled:pointer-events-none` throughout). `focus-visible:ring-2 ring-accent` is present on cards. Empty states are genuinely good — the Goals empty state teaches the model in one paragraph and offers `Load example`. Two gaps: (1) the *focus ring* on a nav tab is an accent pill outline that closely mimics the *selected* tab's filled pill, so after clicking Plan and pressing `3`, both Plan and Timeline read as selected; (2) no loading state anywhere — `hydration === 'loading'` renders `null`, so a slow IndexedDB open shows a blank page under a populated header.

**Responsiveness.** Body content adapts thoughtfully (the Goals board's mobile horizon‑tab switcher is a genuinely good adaptation, and it even surfaces a `COMPLETED 1` disclosure that desktop hides). The chrome does not adapt at all (C‑4). Fixing the header would recover most of the mobile experience, because the work below it is already done.

**Perceived quality.** High on first impression, degrading on use. The things that erode it are cheap to fix and mostly textual: `Old planner` in the nav, `Undo · Undo`, `Behind 44%` vs `44 pts behind`, `20` with a missing `%`, DD/MM dates beside `Aug 2`, and shortcuts that don't match the tabs. None require design work.

---

## Missing Quality-of-Life Features

Only features that address friction actually observed above.

### Essential

1. **`⌘K` command palette / search** (C‑3) — the app is unnavigable at semester scale without it.
2. **Times on Today's Work, chronologically ordered** (C‑1) — makes the default view functional.
3. **Responsive header** (C‑4) — makes the app usable on a phone.
4. **`⌘Z` global undo** — recovery currently depends on reaching a 5s toast with the mouse.
5. **Estimate entry at the point of decomposition** — a leaf's estimate is required by Plan but can only be set in Plan; capture it in the drawer (and ideally inline, `~90m`).

### Valuable

6. **A `blocked` / "waiting on" state** — research and startup work stalls on other people, and neither "overdue" nor "not planned" describes that. Should be excluded from pace calculations so blocked work doesn't read as personal failure.
7. **Multi-select + bulk schedule in the Plan rail** — six drags for six steps is the most repetitive action in the app.
8. **Capacity feedback during drag** — tint the target day against remaining free time. The data already exists; only the visual feedback is missing, and it is the clearest expression of the product's thesis.
9. **Recurring tasks** — psets are weekly. Today habits cover daily rituals but there is no weekly recurring *task*, so "submit 18.404 pset" is re-created 12 times a semester.
10. **Archive / trash for projects** (C‑7) — `completedAt` already exists; expose recovery.
11. **Week recap on Today, not behind "Old planner"** (W‑6).

### Optional

12. **Per-project colour or initial** — would make the truncated titles and the narrow Plan blocks identifiable by glance rather than by reading.
13. **iCal subscription (read-only)** — the Plan header already says "calendar not connected"; even one-way export would let Google Calendar be the phone client while mobile is unfixed.
14. **Session/time tracking UI** — `Session` exists in the type system and is exported in backups but has no UI at all. Either build it or remove it from the model.

**Deliberately not recommended:** tags/labels (the project hierarchy already provides context and tags would compete with it); sub-projects (the leaf-XOR-container invariant is the app's best idea — don't dilute it); collaboration (contradicts local-first); a task-level priority field (the horizon board *is* the prioritization mechanism — adding P1–P4 would undermine the focus cap, which is the differentiator).

---

## Simplification Opportunities

**Remove outright**
- **The "Old planner" view and nav entry** (C‑2) — the single highest-leverage deletion in the product.
- **Quick Add's "Goal" mode** — it creates a dateless, stepless project that immediately nags `Needs a first step`. Creating a project deserves the real flow; Quick Add should be for tasks (and habits, which it does well).
- **`Save dates`** (C‑16) — autosave like everything else.
- **Zero-valued stat chips** (C‑20).
- **`Session` from the data model** — or build its UI. Dead weight in the schema and in every backup.

**Combine**
- **Timeline into Goals** as a view toggle (Board / Timeline). Timeline is a *presentation* of the same project set, not a separate destination, and its only unique control (`Focus`) duplicates board filtering. This takes the nav to three items and makes the `1/2/3` shortcut problem disappear.
- **The two capture surfaces** — Quick Add (Today) and the ⌘N modal — into one, with the modal as the canonical path.

**Hide until needed**
- **EXPORT / IMPORT** — permanent header chrome for a once-a-month action. Move to an overflow menu.
- **Habit history dots** — read-only by default; reveal backfill on demand (C‑10).
- **The `×` and resize grip on grid blocks** — hover only, which also frees space in short blocks (C‑11).

**Rename**
- **"Goals" → "Projects".** The nav says Goals; the page heading says Goals; every other string on that page says *project* (`+ New project`, `Import project`, `Drag a project…`, `No projects yet`, `Delete project`, `Open project`). Today's card says `GOALS & PROJECTS`, implying two kinds of thing when there is one. Pick `Projects` and apply it everywhere — the type name `Goal` can stay internal.
- **"Behind 44%" → "44 pts behind pace"** (C‑12).
- **"Break a step into daily tasks with AI" → "Break a step into subtasks…"** (C‑17).
- **`est` chip → `Set estimate`** (C‑21).

**Shorten**
- Project creation: one path, drawer opens focused on the first step field (W‑1).
- Scheduling from Today: promote `→ today` from a 9px mono link to a real button.

**Don't show by default**
- The `Later` and `Someday` column captions are useful once and noise thereafter; they also stagger the drop targets (C‑19).
- `calendar not connected` in the Plan header — a permanent notice about a feature that doesn't exist yet.

---

## Prioritized Improvement Plan

### P0 — Blocking adoption

| # | Change | Impact | Effort | Confidence |
|---|---|---|---|---|
| 1 | Time-aware, chronologically ordered Today's Work (C‑1) | High | Medium | High |
| 2 | Delete "Old planner"; merge its two unique actions into Plan (C‑2) | High | Medium | High |
| 3 | `⌘K` search / command palette (C‑3) | High | Medium | High |
| 4 | Responsive header collapse; zero horizontal overflow at 375/768 (C‑4) | High | Medium | High |
| 5 | Checkbox contrast ≥3:1 and ≥24px targets, both themes (C‑6) | High | Low | High |
| 6 | Undo: longer window for deletes, no silent clobber, name what was lost (C‑7) | High | Low | High |

### P1 — Major usability improvements

| # | Change | Impact | Effort | Confidence |
|---|---|---|---|---|
| 7 | Renumber view shortcuts to match nav order (C‑5) | Medium | Low | High |
| 8 | Unmount / `inert` the closed goal drawer (C‑9) | Medium | Low | High |
| 9 | Habit today-toggle beside the title; history read-only; undoable backfill (C‑10) | Medium | Medium | High |
| 10 | Unify "behind pace" wording via `BehindChip` + explanatory tooltip (C‑12) | Medium | Low | High |
| 11 | Min-height + single-line layout for short Plan blocks (C‑11) | Medium | Low | High |
| 12 | `Fit` as Timeline default; preserve scroll on row expand; clip % label (C‑13) | Medium | Low | High |
| 13 | Autosave drawer dates; remove `Save dates` (C‑16) | Medium | Low | High |
| 14 | Title truncation: full-width titles, `title` attr, middle-ellipsis (C‑14) | Medium | Low | High |
| 15 | Estimate entry in the drawer at decomposition time | Medium | Low | Medium |
| 16 | `⌘Z` bound to undo | Medium | Low | High |
| 17 | Rename Goals → Projects throughout | Medium | Low | High |

### P2 — Polish and quality of life

| # | Change | Impact | Effort | Confidence |
|---|---|---|---|---|
| 18 | Fix doubled "Undo" across 14 sites (C‑8) | Low | Low | High |
| 19 | Replace native date inputs with app-formatted picker (C‑15) | Medium | Medium | High |
| 20 | Tolerant subtask parser + preview; relabel the AI entry point (C‑17) | Low | Low | High |
| 21 | Card menu flip + portal (C‑18) | Low | Low | High |
| 22 | Stabilise card anatomy; align drop targets (C‑19) | Low | Low | High |
| 23 | Hide zero-valued stat chips (C‑20) | Low | Low | High |
| 24 | Collapse the type scale to ~6 steps; adopt a 4px spacing scale | Medium | Medium | Medium |
| 25 | Distinguish the nav focus ring from the selected pill | Low | Low | High |
| 26 | Loading state for `hydration === 'loading'` | Low | Low | High |
| 27 | Move EXPORT/IMPORT into an overflow menu | Low | Low | High |
| 28 | Promote week recap onto Today (W‑6) | Medium | Medium | Medium |

### P3 — Future opportunities

| # | Change | Impact | Effort | Confidence |
|---|---|---|---|---|
| 29 | Capacity tinting during drag in Plan | High | Medium | Medium |
| 30 | Multi-select + bulk schedule in the Plan rail | Medium | Medium | Medium |
| 31 | `blocked` / "waiting on" state excluded from pace | Medium | Medium | Medium |
| 32 | Recurring tasks | Medium | High | Medium |
| 33 | Merge Timeline into Goals as a view toggle | Medium | Medium | Low |
| 34 | Read-only iCal export | Medium | High | Low |
| 35 | Virtualize long lists (Timeline rows, Plan rail) | Low | Medium | Low |
| 36 | Build or delete `Session` | Low | Medium | Medium |

---

## Top 10 Recommended Changes

1. **Give Today's Work clock times and sort it chronologically.** Add `startMin` to `DailyWorkItem`, sort by it, render the time, and draw a now-divider. Without this, the app's default view contradicts its flagship feature. *(C‑1)*
2. **Delete the "Old planner."** Port *Break into day-sized tasks* and the Availability entry into Plan, then remove the nav button and the `4` shortcut. Nothing else you ship signals "unfinished" this loudly. *(C‑2)*
3. **Ship a `⌘K` palette** over project, step, task and habit titles, with Enter opening the drawer focused on the match. Pure client-side filter over the existing in-memory store. *(C‑3)*
4. **Make the header responsive.** Collapse utilities into `⋯` below `lg`, nav into a bottom bar or hamburger below `md`, and assert `scrollWidth === clientWidth` at 375/768/1024/1440 in a test. *(C‑4)*
5. **Make the step checkbox visible.** Raise the unchecked border to ≥3:1 in both themes and grow the hit target to 24×24. One CSS change; it fixes the app's most important interaction. *(C‑6)*
6. **Harden undo.** 10–15s for structural deletes, never silently discard a pending delete, and name the cost: `Deleted "6.5840 …" and its 9 steps · Undo`. Bind `⌘Z`. *(C‑7, W‑5)*
7. **Renumber the view shortcuts to match the visible tabs** — `1` Today, `2` Plan, `3` Goals, `4` Timeline. *(C‑5)*
8. **Say "44 pts behind pace" everywhere**, via the existing `BehindChip`, with a tooltip showing `33% done, 77% expected by today`. Delete the ad-hoc string in `attentionBadge`. *(C‑12)*
9. **Fix the habit strip.** A 24×24 today-toggle next to the habit title; the 7px history dots read-only by default; any backfill undoable. *(C‑10)*
10. **Unmount the goal drawer when closed**, or mark it `inert` + `aria-hidden`. A permanently-present `aria-modal="true"` dialog can hide the whole app from a screen reader. *(C‑9)*

---

## Final Verdict

**Would I use this app today?** No — but closer than that sounds. I would use it *next month* if items 1–6 land, and I would be enthusiastic about it, which is not something I say about most planners.

**What stops me.** Three things, concretely. I cannot find anything (no search). I cannot use it on my phone (484px of overflow at 375px). And the view I would open twenty times a day — Today — does not know what time my work is scheduled for, even though I scheduled it in this same app an hour earlier. Underneath those sit the coherence problems — a nav item called "Old planner," `Undo · Undo`, shortcuts that don't match the tabs — which individually are trivial and collectively tell me the product is not finished enough to hold a semester. That last judgement is the one that actually decides adoption, and it is the cheapest to reverse: most of it is text and routing, not architecture.

**What would make me switch from my current tools.** The focus cap plus pace honesty, if they were pushed to the front instead of buried. Todoist will happily let me carry 60 open tasks across 9 projects and never once tell me that's more than a semester holds. Phase already computes exactly that — `3 of 3 focus slots used`, `expected 77% by today`, `24h 6m free · 9h 35m planned` — and then renders it in 11px grey mono above an empty grid. Nothing in my stack does this at all. **Surface the honesty and you have a product no incumbent competes with.** Bury it and you have a slower Todoist with a Gantt chart.

**The single improvement with the largest effect on product quality.** Not any one bug: **make the four views agree with each other.** Today should show the times Plan assigned. Goals should use the same words for "behind" that Today and Timeline use. The nav numbers should match the nav. There should be one planner, not two. Every individual fix here is a few hours of work; together they convert Phase from "a promising build" into "a product I would trust with my semester." The engineering underneath — the store, the invariants, the pure `lib/` layer with its sibling tests, the undo seam, the honest error states — is already better than the surface suggests. The surface is what needs the next release.
