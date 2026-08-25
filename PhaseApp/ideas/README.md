# Phase — Product Ideas

**Author persona:** MIT course-6 sophomore. Half my week is coursework (psets, a
systems lab, an exam every couple of weeks); the other half is a startup with two
cofounders, ~40 design partners, and a seed round to close. I have used Notion,
Linear, Todoist, Google Calendar, Things, Obsidian and Sunsama seriously, and I
have abandoned most of them.

**Date:** 2026-07-31
**Build inspected:** `main` @ `47703eb`, 1108 tests passing across 55 files.
**Scope:** brainstorming only. Nothing here was implemented.

---

## Read this first: the app changed, and most old feedback is stale

Three prior documents in this repo describe a version of Phase that no longer
exists. Before generating anything, I diffed them against the code:

| Prior finding | Status today |
|---|---|
| "No search of any kind" (`PRODUCT_UX_REVIEW` C‑3) | **Fixed.** `⌘K` palette over projects/steps/tasks/habits with scored fuzzy matching (`src/lib/search.ts`). |
| "Two weekly planners, one labelled *Old planner*" (C‑2) | **Fixed.** `PlanWeekOverlay` is deleted. |
| "Number keys map 1,3,4,5,2" (C‑5) | **Fixed.** `1` Plan, `2` Projects, `3` Timeline — matches nav order. |
| "Today's Work has no time field" (C‑1) | **Fixed.** `DailyWorkItem.startMin` exists and sorts (`dailyWork.ts:32,254`). |
| "Every undo toast prints *Undo* twice" (C‑8) | **Fixed.** Zero occurrences of `· Undo` in `store.ts`. |
| "Closed drawer stays in the a11y tree" (C‑9) | **Fixed.** `GoalDrawer` returns `null` when closed (`GoalDrawer.tsx:517`). |
| "Header overflows 484px at 375px" (C‑4) | **Fixed.** `overflow-x-clip`, `min-w-0`, bottom tab bar below `md`. |
| "Save dates is a manual save button" (C‑16) | **Fixed.** `commitDates` autosaves on valid change. |
| The whole **Today view** | **Deleted.** Merged into a calendar-home `Plan`. |

**So the app is now three views:** `Plan` (the home: week grid + a 249px rail
holding Backlog / Habits / Stats / Working hours, plus the week `RecapPanel`),
`Projects` (four commitment horizons, hard cap of 3 in *Now*), and `Timeline`
(Gantt).

Everything in these documents is written against *that* app. Where I propose
something, I have checked it does not already exist.

---

## What Phase is actually good at

I want to be precise about the thing worth protecting, because most of my ideas
are in service of it.

Phase's thesis is **commitment honesty**. Three mechanisms carry it and no tool
in my stack has all three:

1. **The 3-slot *Now* cap.** Prioritisation as scarcity, not sorting. Todoist
   will happily let me carry 60 open tasks across 9 projects and never once say
   that is more than a semester holds.
2. **Pace deficit.** `35 pts behind pace · expected 77% by today` shows the
   arithmetic instead of asserting a mood.
3. **Capacity-aware weeks.** `24h 6m free · 9h 35m planned · 2h to place`, with
   `plannedMin` (on the grid) and `backlogMin` (committed, not placed) held
   deliberately apart so the header can never contradict the rail beside it.

The engineering under this is genuinely better than the surface suggests: one
store, one write path, a pure `lib/` layer with sibling tests, a Web Lock
single-writer guarantee, latched persist failures, and undo-instead-of-confirm.
The `PLANNING_HORIZONS` constant threading one Now/Next rule through the board,
the rail, and the card actions is the kind of invariant most products never
find.

**Do not dilute this.** Several obvious-looking features (tags, P1–P4 priority,
sub-projects, arbitrary databases) would actively damage it, and I argue against
them explicitly rather than staying silent.

---

## The documents

| File | What is in it |
|---|---|
| [`quick-wins.md`](quick-wins.md) | 21 changes that are hours-to-days each and mostly reuse code that already exists. |
| [`features.md`](features.md) | 18 new capabilities, from a weighted roll-up to closing the estimate/actual loop. |
| [`ux-ui.md`](ux-ui.md) | 20 ideas on flows, hierarchy, information architecture, keyboard-first use, and mobile. |
| [`student-workflows.md`](student-workflows.md) | 13 ideas specific to coursework, psets, exams and a semester's shape. |
| [`startup-workflows.md`](startup-workflows.md) | 13 ideas for the half of my life that is metrics rather than checkboxes. |
| [`roadmap.md`](roadmap.md) | The synthesis: Top 10s, the single biggest weakness, and a sequenced build order. |
| [`vision.md`](vision.md) | **2026-08-11.** What Phase is becoming: two pillars, two moments, two lives. Decided in conversation; supersedes F-6 and UX-6. |

## How ideas are scored

Every strong idea carries **Problem / Proposed experience / Why it matters /
MIT use case / Impact / Effort / Risks / Priority**.

- **Impact** — Low / Medium / High / Critical, measured against adoption, not novelty.
- **Effort** — S (hours) · M (a day or two) · L (a week) · XL (multi-week).
- **Priority** — P0 (blocks me trusting it with a semester) · P1 (major) ·
  P2 (polish) · P3 (bet).

IDs are stable and cross-referenced: `QW-n` quick wins, `F-n` features,
`UX-n` experience, `ST-n` student, `SU-n` startup.

---

## The one-paragraph version

Phase has stopped being half-finished. The coherence failures that made the last
reviewer refuse to adopt it are gone, and what is left standing is a genuinely
differentiated planner. Its remaining weakness is no longer polish — it is that
**the entire capacity engine runs on `estimateMin`, a number the app makes
almost impossible to enter and completely impossible to learn from.** There is
exactly one place in the whole application to type an estimate, it is unreachable
for most of your work, and the weekly recap contains a "you logged N minutes"
line that is structurally guaranteed to read zero forever. Fix the estimate loop
and Phase becomes the only tool I know that tells the truth about a week before
the week happens. See [`roadmap.md`](roadmap.md).
