# Phase — usability & experience review

**Persona:** 2nd-year MIT CS student. Ran my semester through it — two psets, a side
project (a small web app), and a couple of habits (LeetCode daily, gym 3×/week).
**Focus:** usability and experience, grounded in actually walking the flows.
**Date:** 2026-07-24

---

## TL;DR

The thinking here is a cut above the usual habit-tracker — the Now WIP cap, the
leaves-drive-progress invariant, and the "why this surfaced" suggestion reasons show
real product taste. But three things get in the way: the **Plan loop has no keyboard
route**, two **headline metrics don't mean what they say** (progress % and habit-hit %),
and there's **no recurrence** for the weekly deliverables that define coursework.

---

## First 60 seconds

Opened it, landed on **Today** — three empty cards: *"Nothing committed for today,"*
*"No habits yet,"* *"No goals yet — add your first above."* Clean, but it doesn't tell me
where to start. The real onboarding — the *"Load example"* button and the good line
*"A project is one outcome you can finish — a pset, a paper, a launch"* — lives one tab
over in **Goals**, which I only found by clicking around. The example is literally
**"Finish Pset 7"** with `recursion` / `graph search` / `dynamic programming` sub-problems.
That's exactly my life and it sold me on the model instantly — but it's hidden behind a
tab I had no reason to open first.

**Fix:** on a cold board, put the "Load example / New project" CTA on Today, or auto-route
a zero-data user to Goals. The best onboarding asset is the one thing a new user never sees.

---

## What genuinely clicked

- **The core mental model is honest.** Only leaf checkboxes move the %; containers just
  group; dates/milestones are metadata and never touch progress. Clean invariant, and the
  sample project teaches it without a tutorial.
- **Commitment horizons with a WIP cap.** Now/Next/Later/Someday with **Now capped at 3**
  ("to keep focus honest") is the best decision in the app. Every other planner lets me lie
  to myself with 40 active projects; this one won't.
- **"Worth considering" tells me *why*.** Each suggestion carries a reason chip —
  `In its window`, `Milestone soon`, `Next open step`. That's the difference between a
  suggestion I trust and one I ignore.
- **Tree editing is Notion-grade.** Tab/Shift-Tab to indent, arrows to move, Space to check.
  I built out my side project's feature tree without touching the mouse.

---

## Usability friction, worst-first

### 1. The Plan view is a keyboard dead zone — and it's the app's whole point
Nav shortcuts are `1` Today, `2` Goals, `3` Timeline… and then the weekly planning ritual
is a **modal with no tab and no shortcut**, reachable only via "Plan week" buttons buried in
two cards. For an app that advertises `1–3 · T · ⌘N · ?` in its header tooltip, the most
important recurring action is the one I can't reach from the keyboard.
**Fix:** give it `4` (or `p`) and a home in the nav.

### 2. Progress % depends on how I *nest*, not how much I do
`nodePct` is an unweighted average of children (`src/lib/pct.ts`). In the sample, "Problem 3"
(3 sub-steps) counts exactly as much as "Write up + submit" (1 step), so the Pset sits at
**50%** with 2 of 4 top-level items done. Flatten those same 6 actions to one level and the
identical work reads **33%**. So the headline number — which drives "behind pace" badges and
the Timeline fill — moves when I *reorganize*, not when I *progress*. A CS student spots this
in five seconds.
**Fix:** weight a container by its leaf count; otherwise the pace warnings sit on a number
I don't trust.

### 3. The habit-hit % punishes weekly habits
The Hero shows "habit hits" as `hits / (habits × 20 days)` (`src/lib/today.ts:habitHitPct`),
tooltip *"Share of the last 20 days your habits were completed."* But my gym-3×/week habit
can hit at most ~9 of 20 days by design, so a *perfectly* adhered weekly habit drags the
aggregate toward ~45%. Mixing one daily and one weekly habit makes the top-line number
meaningless.
**Fix:** make the denominator cadence-aware (weekly target × weeks), or the metric quietly lies.

### 4. Fast planning is invisible
In the planner you can focus a step and press **1–7** for a weekday, **0** for Any day —
genuinely great, but documented *only* in a hover title on a rail chip and one line of
instruction text. I used drag-and-drop for a week before discovering it.
**Fix:** surface it in the `?` cheat sheet.

### 5. "Needs a decision" is right, but relentless
Every stale carry-over demands an explicit `Today / Tomorrow / Pick day / Delete`.
Philosophically correct — no silent rollover — but after a busy week I opened Today to a wall
of decisions and just wanted "push everything to next week and move on" without hunting for
the one bulk button.
**Fix:** a lower-effort escape hatch on heavy days.

---

## Fit for my two actual use cases

### Learning / coursework — one real gap: recurrence
A pset is *weekly*. Phase models a single pset beautifully but has no recurring project or
template, so every week I'm rebuilding the same `write recurrence / implement / test / submit`
skeleton by hand. Habits cover "LeetCode daily," tasks cover one-offs, but the
weekly-deliverable-with-substeps — the core unit of a CS course — has no clone/template
affordance. This is the one thing that would keep me from using it past week 2.

### Side project — strong, with two wishes
The goal-tree → feature breakdown and the semester-long Gantt on **Timeline** are exactly
what I want for a multi-week build. Two friction points:
- **Sessions are manual entry** — no start/stop timer, so logging deep-work time means mental
  math and typing minutes. A live timer would make me actually track it.
- **AI breakdown is copy-paste to ChatGPT and paste JSON back.** I respect the local-first,
  no-API-key stance, but the round-trip is clunky enough that I'd rather just type the subtasks.

### One structural caveat for a student
Data is local-IndexedDB, single-tab, manual JSON export/import. I move between my laptop and
lab machines constantly. No sync means Phase is effectively a one-device tool for me, and a
second tab throws *"Phase is already open in another tab. Edits from two tabs overwrite each
other."* That's a reasonable local-first tradeoff — just be honest that it scopes the audience
to single-device users.

---

## Bottom line — top 3 fixes

1. **Give Plan a keyboard route + nav presence** — it's the core loop and currently the
   hardest thing to reach.
2. **Fix the two metrics I don't trust** — leaf-count-weight the progress %, and make
   habit-hit % cadence-aware. Both are noticed immediately, and the pace/behind logic is
   downstream of them.
3. **Add recurring-project templates** — without it, coursework (the app's own headline
   example) is a weekly copy-paste chore.
