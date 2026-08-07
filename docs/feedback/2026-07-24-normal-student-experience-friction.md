# Phase — experience-friction feedback

**Persona:** MIT CS sophomore. Normal load — 4 classes with weekly psets, a group
project, a UROP a few hours a week, one club I actually show up to. No startup, no
grand system. I just want somewhere to keep my psets, deadlines, and two or three
habits so exam week doesn't ambush me.
**Method:** ran Phase for a week as my only planner, from a cold empty board.
**Focus:** where the *experience* rubbed — the moments I hesitated, clicked twice, or
gave up — not the philosophy.
**Date:** 2026-07-24

---

## TL;DR

The bones are good and it's fast. But Phase asks me to run a weekly ritual before it
does much of anything, and the small daily moments — capturing a task, checking off a
habit, clearing yesterday's leftovers — each have one extra bump than they should.
None are dealbreakers. Together they're the reason I kept drifting back to a notes app
for the quick stuff.

The single highest-leverage fix: **make the empty app do something useful before I've
learned the ritual.**

---

## The friction, worst-first

### 1. Cold start: a blank 4-column board and no idea how deep to go

First launch drops me on Goals with *"No projects yet — create one by hand, or import a
plan an AI made for you"* and four columns — Now / Next / Later / Someday — with no
explanation of what they mean. I made "6.1010 pset 7" a project, then stalled: is a
*project* a class? A single pset? Do the checkboxes underneath go one per problem, or
one per pset? The app has a strong opinion about how progress rolls up (it's why the %
feels honest) but never teaches it, so my first tree was shaped wrong and I only found
out a week later when the numbers looked weird.

One seeded, deletable example project — "Here's what a good decomposition looks like" —
would have saved the whole first evening of guessing. Empty states that say *what to do*
("Add your first pset") beat empty states that just confirm emptiness.

### 2. Two different "add" boxes that don't agree

There are two capture surfaces and they behave differently, which made me hesitate every
time:

- **Quick Add** on Today (`src/views/today/QuickAdd.tsx`) defaults its type to **Goal**,
  not Task — so the fastest-looking box on my home screen is pointed at the thing I add
  least. A task added here silently lands on *today* with no project.
- **⌘N** opens a richer "Add task" modal — but it *forces* a date (Today / Tomorrow /
  Pick day; submit stays disabled until you choose one). There is no "someday /
  unscheduled" option. Half my captures are "deal with this eventually," and the app
  won't let me write one down without lying about when.

And the fast path is invisible: the only shortcut hint anywhere is the nav's hover
tooltip, *"Keyboard: 1–3 switch views · T jumps to today · Esc closes"* (`src/App.tsx`)
— which doesn't even mention ⌘N, the one shortcut I'd use twenty times a day. I found it
by accident. A `?` cheat-sheet overlay, and a visible "＋ ⌘N" affordance, would fix this
in an afternoon.

### 3. The app stays dim until I run the weekly ritual

This was the big one. For my first two days Today just said *"Nothing committed for
today"* even though I had projects with steps. That's because `commitments` only fill
from **dated tasks, past-due deadlines, or steps I placed in the weekly plan**
(`src/lib/dailyWork.ts`). Everything else is demoted to "Worth considering" (capped at 4,
Now-column only, with no explanation of why those four surfaced). So the whole
"commitments vs. suggestions" distinction — the thing the layout is built around — is
**invisible until you've done a plan**. A normal student who just wants to dump tasks and
tick them off sees an oddly empty screen and no arrow pointing at the ritual that lights
it up.

### 4. Planning is a mouse-only drag ritual

When I did open "Plan your week," it's a nice idea — recap last week, then place steps
into Mon–Sun. But:

- **Assigning a step to a specific day is drag-only.** Clicking a step in the rail plans
  it to "Any day"; to say "Wednesday" I have to drag it into a **66px-wide** column, in a
  grid of 8 columns that horizontally scrolls on my 13" laptop
  (`src/views/plan/PlanWeekOverlay.tsx`). For an app that's otherwise keyboard-first, the
  core planning verb is fine-motor mouse work.
- **"Break a step into day-sized tasks"** is genuinely useful but hidden — the *Break*
  button only appears on hover (`opacity-0 group-hover:opacity-100`), so I didn't know it
  existed until I went looking in the code.
- The rail is an **accordion** — one project open at a time — so I can't see everything I
  need to place at once while I'm placing it.

I'd keep the ritual, but let me plan with the keyboard: focus a step, press `1`–`7` for
the weekday. That alone would make it something I'd do on a Sunday instead of avoid.

### 5. "Needs a decision" is triage-by-micro-button, and there's no bulk defer

Unfinished work correctly doesn't auto-roll — it collects under **"Needs a decision"**
with per-item actions (Today / Tomorrow / Pick day / Delete, or Replan / Break down /
Remove). The *principle* is right; auto-carry is how a list rots. But the execution is a
row of tiny text buttons I have to click **one item at a time**. During exam week, when
five things pile up and triage itself is the luxury I don't have, I wanted a single
**"push everything open to next week"** action so I could deal with it Sunday, not at
1am. Right now the honest design punishes me exactly when I'm most underwater.

### 6. Habits: small but constant papercuts

- I couldn't attach a habit to a project **when creating it** — the add form is just
  name + cadence + weekly target (`src/views/today/HabitsCard.tsx`). The project tag
  shows up on the row later, but there's no way to set it up front.
- The weekly-target stepper is two **22px** +/− buttons — a fussy target for something I
  set once.
- If I forget to check a habit yesterday, there's no way to backfill it — the checkbox
  only toggles *today*. So one missed tap permanently dents the streak, which quietly
  made me stop trusting the streak number.

### 7. The guardrails are soft where I want them firm, and blunt where I want a nudge

- The board tells me Now is *"capped at 3 to keep focus honest,"* but it isn't — nothing
  stops me dragging a 4th, 5th, 6th project into Now; the counter just turns red
  (`src/views/goals/Column.tsx`). Either enforce it or don't promise "capped."
- Open Phase in a second tab and I get a warning banner — but it **still lets both tabs
  write and clobber each other**. A warning that doesn't prevent the loss it warns about
  isn't much of a guardrail.
- **Undo is a single level with a ~5-second window** and no countdown. Delete two things
  quickly and the first is gone. For a local-only app where the data is all I've got, that
  felt thin.
- **Import replaces everything** behind a plain browser `confirm()`
  (*"Importing a backup replaces everything currently in Phase. Continue?"*). The one time
  I'd touch import is to merge my laptop and lab-machine exports — and replace-only, via a
  native alert I can dismiss on reflex, is the scariest button in the app.

## Smaller stuff

- Metrics with no legend: *"habit hits,"* *"points behind pace,"* *"big week"* all appear
  before anything explains them. As a CS student I reverse-engineered them; most wouldn't.
- No mobile / read-only-on-phone. Half my "oh I need to do X" thoughts happen walking to
  class, and by the time I'm at my laptop they're gone. Not asking for sync — even a
  read-only glance would help.
- "Worth considering" gives no reason a suggestion appeared, so I never learned to trust
  or steer it.

## If I were you, in order

1. **Make the empty app useful on day one** — a seeded example project + empty states
   that say what to add. Kills the cold-start guessing.
2. **Unify capture and expose it** — one obvious box, an "unscheduled" option in the ⌘N
   modal, and a visible shortcut hint / `?` cheat sheet.
3. **A "defer all open to next week" action** in "Needs a decision" and the recap. One
   keystroke to survive exam week.
4. **Keyboard planning** — focus a step, press `1`–`7` to drop it on a weekday. Un-chains
   the ritual from the mouse.
5. **Decide what's a wall vs. a nudge** — enforce the Now-3 cap (or reword it), make undo
   multi-level, and make the second tab actually read-only.

## Bottom line

Phase is honest and quick, and for a normal courseload the model is right. What keeps it
from being the tool I *live* in is a stack of small frictions in the everyday moments —
capturing, checking off, clearing leftovers — plus a home screen that stays empty until I
learn a ritual it never introduces. Smooth the daily loop and teach the ritual gently, and
this goes from "the planner I open on Sunday" to "the planner I keep open."
