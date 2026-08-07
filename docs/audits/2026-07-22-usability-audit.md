# Phase — Product Usability Audit

**Date:** 22 July 2026 · **Method:** hands-on simulated use in the running app (fresh database), cross-checked against source where behavior needed confirmation. **Persona:** MIT CS student building a startup — Linear/Things/Sunsama-grade expectations, zero tolerance for friction, needs the tool to *reduce* cognitive load.

Everything below was observed by actually driving the app: four projects created (two courses, a startup launch, personal finance), steps and milestones added, habits tracked, steps completed, horizons moved, a project backdated to trigger pacing, deletes undone, and every view exercised. Where a finding rests on code rather than interaction (e.g. dead domain types), that's stated.

---

## 1. Executive assessment

**Who it's best for today.** Someone with 2–4 long-horizon personal goals who wants a calm, opinionated progress tracker — "am I moving on the right few things?" — and who plans in weekly strokes. For that person, Phase is already unusually good: the Now-cap of 3, next-step propagation, and pace tracking form a coherent, honest core.

**Strongest part of the experience.** The commitment model. `Now / Next / Later / Someday` with a soft cap ("4 of 3 focus slots used — focus is spread across 4 projects"), every project reduced to a single visible **Next** step, "Define first step" nagging only on Now-projects, and a linear pace line ("49 pts behind pace · expected 49% by today") that makes drift visible without charts. This is a real point of view, and it's the right one. No mainstream tool makes over-commitment this legible.

**Largest obstacle to regular use.** Phase has no place to put small real work. The quick-add creates only *goals* or *habits*. "Email TA about pset extension" became a **project** with an auto-assigned Dec 31 deadline, a focus-slot claim, and a "Define the first step" nag. A `Task` type exists in `src/db/types.ts` but has no UI anywhere. Daily life is 60% small dated obligations, and every one of them either pollutes the goal board or leaves the app — and once your real to-dos live elsewhere, the daily-planning half of Phase dies, and with it the habit of opening it.

**Would I adopt it as my primary planner?** As a progress layer over my semester and startup goals: yes, genuinely — the weekly commit + pace feedback is something Things and Todoist don't give me. As my *primary* planner: no, not yet. I can't capture a task in two keystrokes, can't search anything, and the day-level plan can't hold non-goal work.

**What would make me quit after one week.** Monday: I plan my week in the planner — nice. Tuesday: a professor moves a deadline, two errands appear, an investor asks for a deck. None of that fits quick-add without becoming fake projects. By Thursday my real list is in Apple Reminders again and Phase has become a weekly dashboard I check on Sundays — then not at all.

---

## 2. Real-user journey report

Severity scale: **Critical** = blocks an important workflow · **High** = repeated friction or wrong plans · **Medium** = noticeable drag · **Low** = polish.

### W1 · Create a semester goal with milestones and steps
- **Objective:** "6.046 — finish with an A", psets + exam-prep steps, exam milestones.
- **Expected path:** Quick-add → open → add steps → add dated milestones. That is exactly the path, and step entry keeps focus for rapid consecutive adds; the New-project modal even takes first steps at creation. Good.
- **Friction:** (a) Deadline silently defaulted to Dec 31 ("162 days left") — I never chose it. (b) Start silently defaulted to *today*; for a course that starts in September this immediately builds false "behind pace" pressure (verified: backdating start to Mar 1 showed "49 pts behind pace" at 0% — the same math will punish any goal created before its real start). (c) Steps cannot carry a due date in the drawer, but psets *have* hard due dates; the only dating mechanism is the Timeline's "Schedule", which silently assigns a 7-day span. (d) Clicking a step row does nothing — the done-checkbox and drag handle are opacity-0 until hover, so the drawer initially reads as a static list.
- **Emotional response:** Setup felt fast and pleasant; discovering the app had quietly decided my dates felt presumptuous.
- **Severity:** **High** (silent dates mislead pacing — the feature Phase stakes its identity on).
- **Improvement:** Make start/deadline explicit-but-skippable at creation ("No deadline yet" as a first-class state), and show pace only when both dates were user-confirmed.

### W2 · Startup goal with parallel workstreams
- **Objective:** StudyLoop launch: product, interviews, eng, metrics, fundraise.
- **Actual:** One project with five prefixed steps ("Product: …", "Fundraise: …") works, and `+ sub` nesting means workstreams *can* be containers. But nothing groups or visualizes workstreams; the card shows a single "Next" step, so four of five streams are invisible outside the drawer. Modeling streams as separate projects instead burns the whole Now cap on one venture.
- **Severity:** **Medium.** The structure exists (nested containers); the presentation doesn't use it.
- **Improvement:** When a Now-project's top-level nodes are containers, show one next step *per container* on the card and in Next Up (capped at 3), not one for the whole project.

### W3 · Decide what to work on today
- **Objective:** Open Phase in the morning, get a credible short list.
- **Actual:** "Next Up" showed **all six** 6.046 steps — including "Final exam review plan," five months early — one StudyLoop step, and nothing from 6.033 (`0 planned · 7 suggested`). Suggestions flood from the top-ranked project in stored order, ignoring deadlines, milestones and project fairness. Also, a suggested row offers only a *complete* checkbox — you cannot pull it into today from the list; planning requires the per-project "→ today" button or the week planner.
- **Emotional response:** Distrust — a list that leads with December work in July has no authority over my morning.
- **Severity:** **High.**
- **Improvement:** see Problem #2 below.

### W4 · Reschedule after a blown day
- **Actual (code-verified + UI):** Within the same week, a day-pinned step just stays visible; when the week rolls over, uncompleted commitments appear under **"Needs a decision"** with `Replan / Break down / Remove` per item — a genuinely good, decision-forcing pattern. But it's one-at-a-time (no "replan all"), and mid-week there is no "move to tomorrow" affordance anywhere — the pinned day can only be changed by re-dragging in the planner.
- **Severity:** **Medium** (weekly case handled well; the daily case — the common one — isn't).
- **Improvement:** Row-level "→ tomorrow / pick day" on planned items in Today, and a bulk action on the triage list.

### W5 · End-of-week review
- **Actual:** A `PlanReview` snapshot exists; the Plan-week button gains a "· review" suffix at week rollover. Counters ("1/2 this week") exist. But completed items *disappear* from Next Up the moment they're checked; there is no "done this week" list, no planned-vs-done recap view, and Sessions (time) are dead in the UI.
- **Severity:** **High** for a tool whose promise is progress awareness.
- **Improvement:** see §7.

### W6 · Identify goals falling behind
- **Actual:** Excellent. Board chip ("1 project behind schedule"), card badge ("Behind 49%"), drawer line ("49 pts behind pace · expected 49% by today"), amber chip on Today's rail. One number, one meaning, four surfaces.
- **Severity:** — (works). Only caveat: it's only as trustworthy as the silently-defaulted dates feeding it (W1).

### W7 · Distinguish the concepts
- **Actual:** The same object is a **Goal** (nav), a **project** (board, "Now project needs a first step"), its children are **steps** (drawer), **phases** (Timeline: "⚠ 6 unscheduled phases"), **day-sized tasks** (planner Break), and **actions** ("planned actions left"). Meanwhile `Task` and `Session` exist in the schema/export but nowhere in the UI. Milestones are pure markers (never affect % — by design) but nothing tells the user that.
- **Severity:** **High** — five names for two concepts is a tax on every screen.
- **Improvement:** One glossary decision (see §5) and a rename sweep.

### W8 · Quick capture without breaking focus
- **Actual:** Quick-add is fast but can only mint goals/habits. "Email TA about pset 2 extension" became a project: `DEC 31 · 162D · Next: Define the first step · 0%`. No global shortcut, no inbox, no way to capture *into* a project from the Today screen.
- **Severity:** **Critical** — this is the retention killer.
- **Improvement:** see Problem #1.

### W9 · Find something created weeks ago
- **Actual:** There is **no search** anywhere, no command palette (⌘K does nothing), no filters. Finding an old step means opening project drawers one by one; a "few-week-old item" in Someday is effectively lost.
- **Severity:** **Critical at scale**, High today (4 projects).
- **Improvement:** see Problem #3.

### W10 · A day mixing university deadlines and startup priorities
- **Actual:** The pieces exist (planned steps from any project interleave in Next Up once planned; week strip shows step counts). But nothing distinguishes *due* from *chosen* — a pset due tomorrow and an investor-deck step I picked look identical; deadline pressure never surfaces at the day level (deadlines live on projects, not steps).
- **Severity:** **High.**
- **Improvement:** Step-level due dates (already representable via `node.deadline`!) surfaced as `due` chips in Next Up, sorted above chosen work.

### W11 · Recover from an accidental delete
- **Actual:** Deletes are instant, no confirmation, with a 5-second undo toast — including *entire projects* with all steps/milestones/notes. No ⌘Z (verified), no trash, no undo after the toast dies. Undo itself works when clicked.
- **Severity:** **Medium-High** (rare event, catastrophic outcome, hair-trigger surface: the ✕ sits beside "+ sub" on every hover).
- **Improvement:** Keep toast-undo but back it with a 30-day soft-delete (`deletedAt`), an Edit-menu/⌘Z undo for the last mutation, and a typed-confirm only for projects with >10 nodes.

### W12 · Return after several days away
- **Actual:** Better than most: the greeting, habit-due counts, "Needs a decision" triage, behind-pace chips and the review-pending button all convene on Today. What's missing is *what happened*: nothing says "while you were gone, nothing moved on StudyLoop for 6 days."
- **Severity:** **Low-Medium.**
- **Improvement:** A one-line staleness note on project cards ("no activity in 6d") — data already exists in checkin/done timestamps… except node completion has no timestamp (see §7 prerequisite).

---

## 3. Top usability problems (ranked)

**1. No lightweight task capture — everything is a goal, a habit, or homeless.**
*Evidence:* W8 — a two-minute errand became a Dec-31-deadlined project occupying board space and emitting nags. `Task {title, date, done, goalId}` exists in `types.ts`, is persisted and exported, and has zero UI.
*Why it matters:* Daily planning collapses without a home for small dated work; users keep a second app, and the second app wins.
*Frequency:* many times per day. *Severity:* Critical.
*Root cause:* IA decision to make the goal board the only container; the Task entity was built and never wired.
*Fix (smallest viable):* Add "Task" as a third quick-add toggle (Habit · Goal · **Task**), default date = today, optional `goalId` tag; render a "Tasks — today" group in the Today view and in the week planner's day columns; done-tasks roll into the daily/weekly recap. No new views.
*Acceptance criteria:* From app focus, ⌘N + typing + Enter captures a task in <3 s without leaving the current view; a task never appears on the Goals board; unfinished tasks surface in next-day triage alongside steps.

**2. Next Up suggestions are a backlog dump, not a recommendation.**
*Evidence:* W3 — all 6 steps of the #1 project (stored order), 1 of the #2, 0 of the #3; "Final exam review plan" suggested 5 months early; suggested rows can't even be planned from the list.
*Why it matters:* This is the first list on the first screen; if its top item is ignorable, users learn to ignore the product.
*Frequency:* every open. *Severity:* High.
*Root cause:* `nextUp(goals, today, 7)` fills remaining slots per project rank without interleaving or date-awareness.
*Fix:* Round-robin across Now-projects (max 2/project); rank scheduled-phase and near-milestone work above undated steps; add a "+ plan" affordance on suggested rows (pin to today / this week).
*Acceptance criteria:* With 3 Now-projects each holding ≥2 open steps, Next Up shows work from ≥2 projects; no suggestion whose phase/milestone window starts >30 days out while dated nearer work exists; a suggested row can be committed to today in one click.

**3. No search, no command palette, no filters — retrieval is O(open every drawer).**
*Evidence:* W9; the only inputs in the whole app are quick-add and a hidden file-import; ⌘K is dead.
*Why it matters:* Trust in a capture tool = certainty of retrieval. Also blocks power-user navigation (jump to project).
*Frequency:* several times/week, rising with data size. *Severity:* Critical at scale.
*Root cause:* All state is one in-memory store (`useSyncExternalStore`) — trivially searchable; simply never built.
*Fix:* ⌘K palette over titles of goals/nodes/habits/milestones (+tasks) with fuzzy match; Enter = open its container (drawer scrolled to node), ⌘Enter = plan today. ~1 component + 1 selector over existing state.
*Acceptance criteria:* Any titled item ≤2 keystrokes + Enter away; palette results open the right drawer with the node highlighted; works from all three views.

**4. Step scheduling is split across two disconnected systems with three vocabularies.**
*Evidence:* W1/W10 — drawer steps have no date UI; Timeline calls the same steps "phases," warns "⚠ unscheduled," and its *Schedule* action silently stamps a 7-day span then opens… the drawer, where those dates are invisible and uneditable. Separately, the planner assigns `plannedWeek/plannedDay`. Span ≠ plan is never explained anywhere.
*Why it matters:* Users can't predict where a date "lives," so they stop dating things — which silences the Timeline and weakens pacing.
*Frequency:* every scheduling act. *Severity:* High.
*Root cause:* Two features grown separately (Gantt spans vs weekly commitment) without a shared surface.
*Fix:* Show span dates on step rows in the drawer (small `Sep 12–18` chip, click to edit, "+ date" on hover for undated); rename "phases" → "steps" on the Timeline; exclude `done` steps from the unscheduled warning (verified: completed pset 1 still counted).
*Acceptance criteria:* A step's dates are visible and editable in the drawer; Timeline warning count excludes done steps; the word "phase" no longer appears in the UI.

**5. Committing work to days is drag-only, on 76-px targets, with fragile keyboard fallback.**
*Evidence:* Planner day columns ≈76 px wide; no click-to-assign; dnd-kit's Space/arrows works but is undocumented on screen; **Escape during a keyboard drag closed the entire planner** (dialog and drag both handle Esc), losing context.
*Frequency:* every planning session. *Severity:* Medium-High.
*Fix:* On each To-plan chip: a day-picker popover (`M T W T F S S · Any day`) on click; stop dialog-close on Esc while a drag is active; hint line "Space picks up · arrows move".
*Acceptance criteria:* A step can be committed to Thursday mouse-only in 2 clicks with no drag; Esc mid-drag cancels the drag and keeps the planner open.

**6. Completed work vanishes — no daily/weekly "done" record in the UI.**
*Evidence:* W5 — checking a step removes it from every Today surface; only counters remain. `done` is a bare boolean (no `doneAt`), so history is *unrecoverable by design*.
*Severity:* High (blocks review, streak-of-work feeling, and the staleness features in W12).
*Fix:* Store `doneAt` on leaf completion (one field, backward-compatible); render a collapsed "Done today (3)" group at the bottom of Next Up.
*Acceptance criteria:* After checking two steps and a task, "Done today" lists them with their projects; weekly recap shows planned-vs-done using real timestamps.

**7. Silent defaults put false authority behind the pace math.**
*Evidence:* Deadline := Dec 31, start := creation day, Schedule := 7-day span — none announced. Combined with #4 this produces confident-looking "behind pace" numbers derived from dates the user never chose (W1).
*Severity:* High (it corrupts Phase's single most differentiated signal).
*Fix:* Undated is a first-class display state ("no deadline"); pace line renders only when dates are explicit; Schedule opens with the span pre-selected for adjustment rather than silently applied.
*Acceptance criteria:* A goal created without dates shows no pace line and no behind-badge; creating one never displays "Dec 31" unless typed.

**8. Terminology fragmentation (goal/project, step/phase/task/action).**
*Evidence:* W7. *Severity:* High as a multiplier on every other confusion. *Fix:* see §5. *Acceptance:* one term per concept across nav, board, drawer, planner, timeline, and stat chips.

**9. Project deletion is instant, unconfirmed, and recoverable for only 5 seconds.**
*Evidence:* W11. *Severity:* Medium-High. *Fix:* soft-delete + ⌘Z + size-gated confirm (above). *Acceptance:* a project deleted 10 minutes ago is recoverable; ⌘Z reverses the last destructive action while its toast is gone.

**10. Opaque metrics: "2% habit hits", "0 planned actions left".**
*Evidence:* After completing 1 of 3 habits on day one, header read "2% habit hits" — meaningless without its (invisible) window; "planned actions left" uses a fourth noun and reads as zero on a freshly planned week.
*Severity:* Low-Medium. *Fix:* "This week: 4 of 6 habit check-ins · 3 of 5 planned steps done" — plain nouns, visible denominators. *Acceptance:* every headline stat names its window and denominator.

---

## 4. Productivity analysis

**What Phase is today:** a **goal-commitment tracker with a young weekly planner**. Concretely: a goal database (board + drawer + timeline) with a strong progress/pace layer, plus a planning loop (week planner, day pins, carry-over triage) that structurally works but is underpowered at the day grain — and a habit tracker beside it.

**What it wants to be** (per its own copy — "what you're actively pushing on," "capped to keep focus honest," "no nag until you commit"): a **personal execution system** — the place where long-horizon intent turns into honest daily behavior.

**The gap, precisely:** Phase handles *committed, goal-shaped* work well and everything else not at all. A personal OS needs the full inbound stream (capture), a credible daily contract (today = due + chosen + habits, sized to a real day), and a memory (what happened, findable later). Missing: task capture (#1), trustworthy suggestions (#2), retrieval (#3), done-history (#6).

**What closes it fastest:** the four numbered fixes above, in that order. Notably *not* needed: time tracking, integrations, analytics dashboards, or AI. The skeleton (horizons, pace, triage, weekly snapshot) is already the differentiated part; the gap is mundane table stakes done in Phase's opinionated voice.

---

## 5. Mental-model audit

| Concept | New user assumes | Actually appears to mean | Confusion risk | Recommended clarification |
|---|---|---|---|---|
| Goal | An outcome ("get an A") | A *project*: dated container of steps/milestones on a horizon column | Board says "project", nav says "Goals" | Pick **Project** everywhere; keep "Goals" only as view title, or commit to Goal everywhere |
| Goal node / subgoal | Sub-goal hierarchy | A checklist tree: leaves are checkable **steps**, containers group them; equal-weighted in % | Same object is step/phase/task/action per view | One word: **Step** (containers: **group**) |
| Task | Any to-do | Dead schema type; UI "day-sized tasks" are actually steps created by Break | "Task" visible in copy but uncreatable | Revive as quick-capture item (#1) or purge the word |
| Habit | Recurring routine | Daily/weekly check-in with streak + hit-rate; optional goal *tag* only | Whether habits affect goal % (they don't) | Caption in habit UI: "tracks consistency — never moves a goal %" |
| Milestone | A gate that drives progress | Pure dated marker: ◆ on timeline, date chip on card; never affects % or pacing | Users expect hitting it to "count" | Label as **Marker** in drawer, or make pacing piecewise vs next milestone (bigger, better fix) |
| Session | A focused work block | Dead schema type; no UI at all | None until users find it in exports | Delete from schema/export, or build deliberately later |
| Start date | "When I'll begin" | Pace-line anchor; **defaults to creation day** silently | False "behind pace" for future-start goals | Ask at creation; allow "starts later"; suppress pace until real |
| Deadline | Hard due date | Defaulted (Dec 31) countdown + pace denominator | Fake deadlines → fake urgency everywhere | First-class "no deadline" state |
| Today item | "My list for today" | Union of: day-pinned steps, week commitments, *suggestions*, habits — visually flat | Users can't tell chosen vs suggested vs due | Distinct sections/chips: **Due · Planned · Suggested · Habits** |

Consolidation recommended only where confusion is genuine: merge the *vocabulary* of step/phase/task/action (one concept, one word), and either revive or delete `Task`/`Session`. Do **not** merge Habits into steps or Milestones into steps — the separations are sound; they need labeling, not surgery.

---

## 6. Daily planning redesign (within the current visual identity)

The pieces already exist: `plannedDay` pins, carry-over triage, the Break tool, `→ today`. The redesign is sequencing them into a two-minute morning contract and a thirty-second close, adding only: tasks (#1), due-surfacing (W10), a capacity line, and `doneAt` (#6).

**Morning (target < 2 min).** Opening Phase before ~10 am with nothing planned today, the Next Up card leads with a **Plan today** strip, pre-populated in this order: (1) overdue/`due` items — steps whose span-deadline or task-date is today/past, marked `due`; (2) yesterday's unfinished, each with `today / pick day / drop`; (3) suggestions — round-robin next steps, max 2 per Now-project. Each row: one-tap accept ✓ or dismiss. Accepting builds today's list; the strip collapses to the plan.

**Capacity.** A single quiet line under the list: "**5 items today** — heavier than your usual 3," from a trailing average of completed-per-day (needs `doneAt`, nothing else). No hour-estimation system: Phase's grain is the *day-sized* item — the Break tool already enforces sizing at the right moment, which is subtler and better than per-task minute fields. Keep it that way.

**Quick capture.** ⌘N anywhere → one-line input: text + optional `#project` token + optional day token ("fri"). Defaults: task, today, untagged. It lands in today's list without navigation; Enter returns focus to whatever was underway.

**Blocked work.** No status machinery: a `blocked` flag on a planned item, set from the row, which moves it to a dim "Waiting" group at the bottom of Next Up and excludes it from carry-over nagging until unblocked. (Smallest thing that stops blocked items from being re-triaged daily.)

**Overdue.** `due` chips (red-amber) sort above everything and *cannot be suggested-away* — they can only be done, rescheduled, or explicitly dropped. Dropping asks nothing but records it for the weekly recap ("dropped 2 due items").

**During the day.** Checking an item moves it to "Done today (n)" (collapsed). The week-strip day cell shows `2/5` live, so progress is felt without opening anything.

**Evening close (optional, 30 s).** After 6 pm with open items, the card's footer offers **Close the day**: each remaining item gets `tomorrow / pick day / back to backlog`; habits still due are listed for check-off. Closing writes the day's record. Skipping it is fine — items simply reappear in tomorrow's morning strip (same triage, softer moment).

**Week boundary** stays exactly as built (snapshot → "Plan week · review") — it's the right mechanism; it just gains real data (done items, dropped-due count) to review.

---

## 7. Weekly review workflow

Principle: every panel ends in a decision, not a chart. One overlay ("Review week" replacing the current bare `· review` suffix), five steps:

1. **What got done.** Done steps/tasks grouped by project, with habit hit-rates beside them ("Gym 4/5"). *Decision:* none — this is the payoff screen; it exists so the review is worth opening. (Requires `doneAt`.)
2. **Planned vs. delivered.** The existing `PlanReview` snapshot vs. reality: "Committed 9 · finished 5 · dropped 2 due items." A persistent miss-rate over the last 3 weeks ("you finish ~60% of what you commit") turns into a *suggested cap*: "commit 6 next week?" *Decision:* accept the cap or not — this is the single highest-leverage number in the app.
3. **Which goals moved.** Per Now-project: Δ% this week + pace state ("6.033: +0%, 49 pts behind"). Stale flag for any Now-project with zero completions in 14 days. *Decision per flagged project:* `break down the next step / move to Next / archive`. This is where "identify neglected goals" becomes an action, not a feeling.
4. **What's ahead.** Next 14 days of milestones and step/task due dates. *Decision:* pull items into next week's plan (this *is* the week planner, pre-filtered).
5. **Stop-doing.** Any step replanned ≥3 weeks running is surfaced by name: "『Metrics: weekly KPI dashboard』 has rolled over 3 times." *Decision:* `commit it Monday / move to Someday / delete`. Chronic carry-over is the productivity-theater detector.

No other analytics. Time-spent, velocity charts, and completion heatmaps all fail the "leads to a decision" test at this product's scale.

---

## 8. Quality-of-life improvements

Ranked by leverage. Value/complexity: ▲ high · ► mid · ▽ low. Frequency: /d = daily, /w = weekly.

| # | Improvement | Value | Complexity | Freq |
|---|---|---|---|---|
| 1 | ⌘K palette: fuzzy-find any item, Enter opens, ⌘Enter plans today | ▲ | ► | /d |
| 2 | ⌘N quick capture with `#project` + day tokens (see §6) | ▲ | ► | /d |
| 3 | Click-to-assign day picker on planner chips (kill drag-only) | ▲ | ▽ | /d |
| 4 | "→ tomorrow" + day picker on planned rows in Today | ▲ | ▽ | /d |
| 5 | Visible step checkboxes (persistent, not hover-opacity) + click-row-to-toggle in drawer | ▲ | ▽ | /d |
| 6 | Inline title editing everywhere (`InlineEdit` exists — wire it to step/project/habit titles) | ▲ | ▽ | /d |
| 7 | Step date chips in drawer (surface `node.start/deadline`, editable) | ▲ | ► | /w |
| 8 | ⌘Z for last destructive action + 30-day soft delete | ▲ | ► | /w |
| 9 | Bulk triage: "replan all to this week" / multi-select in Needs-a-decision | ► | ▽ | /w |
| 10 | Keyboard-shortcut cheat-sheet (`?`) — dnd-kit keys already work, invisibly | ► | ▽ | /w |
| 11 | Project templates ("Course": pset steps + exam milestones; "Launch": workstream groups) applied at creation | ► | ► | /mo |
| 12 | Smart default fix-pack: no fake Dec-31 deadline, no auto-start, Schedule previews span | ▲ | ▽ | /d (passively) |
| 13 | Empty states that teach the loop ("Steps become suggestions → plan them into your week → check them off today") | ► | ▽ | first-run |
| 14 | Recurring *steps* are an anti-goal — habits already cover recurrence; resist duplicating it (see §9) | — | — | — |
| 15 | Milestone → "in 12 days" relative chips on cards (already computed for deadlines) | ▽ | ▽ | /w |

---

## 9. Feature restraint

**Don't build yet.** Calendar/LMS/GitHub integrations (huge surface, kills local-first simplicity before the core loop retains anyone); natural-language date parsing beyond simple day tokens; mobile/sync (a real strategic question — but sequenced after the loop works on one machine); collaborative anything.

**Complexity without value (at this scale).** Time tracking & estimates — the day-sized-item grain plus the Break tool is Phase's genuinely elegant substitute; minute-fields would add ceremony and false precision. Priority fields (P1–P3) — the Now-cap *is* the priority system; adding per-item priority reintroduces exactly the ranking-fiddling Phase's philosophy rejects. Velocity/burndown analytics — §7's miss-rate covers the one number that changes behavior.

**Already overengineered.** `Session` — persisted, exported, dead; delete it or ship it, but don't let export schemas carry ghosts. `Task` — same, except the right answer is shipping it (#1). The stat-chip row on the board ("planned actions left") — four headline metrics for four projects is dashboard cosplay; two chips (focus, behind-schedule) carry all the signal. The AI-prompt-copy modal is honest and cheap — fine — but it's a second Break implementation; fold it into the planner's Break as an optional "copy prompt" affordance rather than a parallel feature.

**Simplification > addition.** One vocabulary (§5); one scheduling story told in one place (§4 fix); fewer, labeled metrics (#10). Each of these *removes* concepts while making the product feel bigger.

---

## 10. Prioritized implementation plan

### Immediate (days each, high impact)

1. **Task quick-capture** — *Problem:* small work has no home (#1). *Behavior:* third quick-add mode + "Tasks today" groups in Today/planner; tasks join triage and recap. *Areas:* `store.ts` (actions exist for none — add task CRUD), `views/today/`, `PlanWeekOverlay`, `lib/plan.ts`. *Risk:* blurring goal-focus philosophy — mitigate by keeping tasks visually subordinate (no %, no board presence). *Accept:* capture-to-today <3 s; never on Goals board; appears in next-day triage.
2. **Suggestion fairness** — (#2). *Behavior:* round-robin ≤2/project, date-aware ranking, "+ plan" on suggested rows. *Areas:* `lib/plan.ts` (`nextUp`), `NextUpCard`. *Risk:* low — pure function + tests. *Accept:* criteria in #2.
3. **Default-date honesty** — (#7). *Behavior:* optional dates at creation; pace only on explicit dates; done-steps out of unscheduled warnings. *Areas:* quick-add path in `store.ts`, `NewProjectModal`, `GoalDrawer`, `lib/pct`/pace helpers, `NodeLane`. *Risk:* existing data with fake dates — migrate by flagging dates equal to the defaults. *Accept:* criteria in #7.
4. **Click-to-assign + reschedule affordances** — (#5, W4). *Areas:* `PlanWeekOverlay`, `NextUpCard`. *Accept:* mouse-only day assignment in 2 clicks; Esc mid-drag keeps planner open; "→ tomorrow" on any planned row.
5. **Drawer step usability** — persistent checkboxes, row-click toggles, `InlineEdit` on titles. *Areas:* `GoalTree.tsx` *(currently carries uncommitted WIP — coordinate before touching)*. *Accept:* a first-time user marks a step done in the drawer without hovering hunt-and-peck.

### Next iteration (the planning loop)

6. **`doneAt` + Done-today + close-the-day** — (#6, §6). *Areas:* `types.ts` (additive field), `store.ts` toggle actions, `NextUpCard`. *Risk:* none (optional field). *Accept:* #6 criteria + evening flow reachable and skippable.
7. **⌘K palette & ⌘N global entry** — (#3). *Areas:* new component, selector over store; Electron accelerator in `electron/main.cjs` for true global capture later. *Accept:* #3 criteria.
8. **Step dates in drawer + "phase"→"step" rename** — (#4). *Areas:* `GoalTree`, `NodeLane`, copy sweep. *Accept:* #4 criteria.
9. **Review overlay v1** — §7 steps 1–3 (payoff, miss-rate + suggested cap, moved/neglected). *Areas:* `PlanWeekOverlay` (extend the existing review path), `lib/plan.ts`. *Accept:* Sunday flow answers "what did I do, what did I drop, what's stale" in <2 min, and can set next week's cap.
10. **Soft delete + ⌘Z.** *Areas:* `store.ts` (`scheduleUndo` generalizes), `db.ts`. *Accept:* #9 criteria.

### Strategic

11. **Workstream-aware projects** — containers surface per-stream next steps (W2). Changes how the board scales for founders; risk: card visual density — cap at 3 streams shown.
12. **Course/Launch templates** — collapses time-to-value for the two core personas from ~15 min to ~2; risk: template staleness — keep them two hardcoded seeds, not a template system.
13. **Signature weekly ritual** — §7 steps 4–5 (pull-ahead planning + stop-doing detector) fused with the planner into one Sunday surface. This is the retention product.
14. **Decide `Session`'s fate** — delete, or ship as a "log a focus block on this project" one-liner feeding review step 1. Either is fine; limbo isn't.

### Sequencing note

Items 1–3 are the week-one payload: after them, a skeptical user can run a real mixed week (classes + startup + errands) entirely inside Phase. Everything in "Next iteration" deepens loyalty; nothing in it matters until capture, suggestions, and honest dates exist.

---

## 11. Final verdict

**Three changes most likely to improve weekly retention:** (1) task quick-capture — removes the reason the second app exists; (2) trustworthy Next Up — makes the first screen worth believing every morning; (3) the review-with-a-cap ritual — gives Sunday a payoff and Monday a contract, which is the habit loop retention hangs on.

**Three changes most likely to make users genuinely more productive:** (1) commitment-cap feedback from real miss-rates ("you finish ~60% of what you commit — commit 6?") — the only number that changes planning behavior; (2) due-vs-chosen separation at the day level — stops deadline surprises without importing a priority system; (3) the stop-doing detector on chronic carry-overs — converts productivity theater into an explicit decision.

**The signature advantage:** the **honest commitment loop** — cap of 3 in Now, one visible next step per project, week commitments snapshotted and *reviewed against reality*, pace pressure that can't be gamed by reorganizing. Every competitor does capture and lists better; none makes over-commitment and drift this visible. Phase should double down here and let ⌘K/⌘N/tasks be merely competent table stakes around it.

**The ideal Phase, one paragraph.** Phase is the only planner that refuses to let you lie to yourself. Anything on your mind goes in instantly (⌘N) and is findable forever (⌘K), but the app's opinion never wavers: three things in Now, one next step each, a week you commit to on Sunday and answer for the next Sunday. Each morning it hands you a two-minute contract — what's due, what slipped, what moves a goal — sized to what you actually finish, not what you wish you would. When plans break, rescheduling is one keystroke and carry-overs demand a decision rather than accumulating guilt; when a goal stalls, Phase says so in points and days, and its "behind" always means *behind a date you chose yourself*. It stays local, instant, and quiet — a tool that stores less ceremony than Notion, decides more than Things, and measures the only thing that matters: whether the few things you said were important actually moved.

---

*Corrections to my own first impressions, for honesty: step checkboxes do exist in the drawer (hover-revealed — a discoverability problem, not an absence); Enter-to-submit works in the app (early failures were the automation harness, verified via event inspection); and undo does work when the toast is clicked (my first failed attempt hit a stale element). The black-viewport rendering seen twice after programmatic scrolls appears to be a browser-pane capture artifact, not an app bug — no console errors accompanied it; worth a quick manual scroll-check to be sure.*
