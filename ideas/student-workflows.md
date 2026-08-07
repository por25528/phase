# Student Workflows

Ideas specific to coursework: psets, exams, labs, recitations, a UROP, and the
shape of a semester. This is the half of my life Phase already models well, so
these are mostly about removing repetition and closing the last accuracy gaps —
not about changing the model.

---

## ST-1. Import a syllabus once, get a semester

**Problem.** Setting up a course means creating a project, typing every pset
deadline off the syllabus, guessing estimates, and repeating four times. It is
forty minutes of transcription in the first week of term — precisely when I have
the least patience — and it is the highest-friction moment in the entire product.
Get it wrong and every downstream number (pace, capacity, over-commitment) is
wrong all semester.

**Proposed experience.** Extend the existing import path with a syllabus flow:
`Import project → From a syllabus`. It shows me the JSON schema plus a
ready-to-copy instruction, I paste my syllabus into Claude, and I paste back a
set of projects — one per pset, with real due dates, milestones for the exams,
and a first-pass decomposition. `parseGoals` already validates the shape;
`addGoals` already normalises by column; the date-review banner and `Confirm all`
already exist to sanity-check what lands.

**Why it matters.** Phase's AI story is a clipboard round-trip, and that is the
right call for a local-first app — but today it only decomposes *one step*
(`SubtaskAiModal`). The syllabus is the highest-leverage document a student
owns and it is perfectly structured for this. This is the feature that makes the
first week of term take four minutes.

**MIT use case.** 6.5840, 6.1810, 18.404 and 6.3900 syllabi pasted in on
registration day. Twelve psets, four exams and two projects, dated correctly, in
one sitting.

**Impact:** Critical · **Effort:** M (mostly prompt + preview UI; the parser and
the store path exist) · **Risks:** (1) An LLM will hallucinate dates — the
preview-before-commit step is mandatory, and `datesConfirmed: false` on import
already provides exactly the right safety rail. (2) Estimates will be generic;
better to emit none than to emit fiction, since `unestimated` is an honest state
the app already reports. · **Priority:** P0

---

## ST-2. My class schedule is invisible to the capacity engine

**Problem.** This is the largest source of error in the number Phase leads with.
`BusyBlock` is fully specified and threaded through `visibleRange`,
`weekCapacity`, `freeIntervals`, `resolveSlot` and `clampResize` — and **every
call site passes `[]`**. So Phase believes my Tuesday 09:00–18:00 is nine free
hours. In reality it holds two lectures, a recitation and a lab section, and I
have maybe four. Every capacity figure, every over-commitment verdict and every
auto-placement is computed against a fiction.

The only workaround is to shrink the availability window, which throws away the
usable hours either side of a class.

**Proposed experience.** Ship the designed read-only calendar pull
([F-12](features.md#f-12-ship-the-read-only-calendar-pull)). My class schedule is
already in Google Calendar; nothing needs typing.

**Why it matters.** A student's week is not a blank window minus what they plan —
it is a fixed skeleton of classes with gaps between them, and the gaps are the
entire planning problem. Until Phase can see the skeleton, its headline number is
its least accurate one.

**MIT use case.** "Can I fit the Raft lab before Friday?" is unanswerable while
the app thinks I have 45 hours instead of 26.

**Impact:** Critical · **Effort:** L · **Risks:** Documented in the design doc.
· **Priority:** P0

---

## ST-3. Psets repeat; my typing should not

**Problem.** 18.404 Pset 6 has the same shape as Pset 5: read the chapter, do
problems 1–4, write it up, submit. Twelve times a semester, four courses. Phase
has no duplicate, no template and no recurrence, so I retype the same five-step
tree roughly forty times a term.

**Proposed experience.** Layered, cheapest first:
[QW-8](quick-wins.md#qw-8-duplicate-a-project) (duplicate a project, clearing
done-state and scheduling but **keeping estimates**) covers most of it in an
afternoon. [F-13](features.md#f-13-project-templates) makes it durable across
semesters. [F-4](features.md#f-4-recurring-work) covers the recurring *task*
case ("submit the pset") without pre-generating twelve rows into the backlog.

**Why it matters.** Keeping the estimates on a duplicate is the subtle part and
the most valuable: by Pset 6 my estimates for that course's shape are calibrated,
and that calibration is the thing worth copying.

**Impact:** High · **Effort:** S (duplicate) · **Risks:** A duplicate that keeps
scheduling metadata lands on a past week — must clear `plannedWeek`/`plannedDay`/
`plannedStartMin`. · **Priority:** P1

---

## ST-4. Exam prep needs to be planned backward

**Problem.** A pset is a forward problem: here is the work, when do I do it. An
exam is a backward one: it is in nine days, there are six topics, is that
survivable? Phase can only answer this after the fact, via a pace deficit on a
project whose "steps" are review topics.

**Proposed experience.** [F-9](features.md#f-9-backward-planning-from-a-deadline)
applied to exams: given the exam date and the remaining review leaves with
estimates, distribute across available days — or refuse: *"18h of review, 11h
free before Thursday. Cut two topics or start tonight."*

**Why it matters.** The refusal is the whole feature, and it has to arrive a week
early to be actionable. This is `isOverCommitted` — which Phase already computes
correctly — pointed at a single deadline instead of a calendar week.

**MIT use case.** 6.1810 quiz 2, nine days out, six topics. I want to know *today*
whether "I'll review over the weekend" is a plan or a wish.

**Impact:** High · **Effort:** M · **Risks:** Do not schedule into the final 20%
of the runway — leave slack, or the plan breaks on first contact. · **Priority:** P1

---

## ST-5. Warn me when deadlines cluster

**Problem.** Capacity is computed per day and per week. But the thing that
actually ruins a term is three deadlines landing on the same Thursday from three
different projects, each individually reasonable. `weekCapacity` will show the
week as tight; it will not show me that Wednesday night is where it detonates.
`dayLoadLabel` reports load on the day work is *planned*, not the day it is *due*.

**Proposed experience.** A collision signal on the week header and the Timeline:
*"3 deadlines on Thu Oct 16 — 14h of remaining work across them."* Computed from
project deadlines plus each project's unfinished estimated effort, which is all
already derivable.

**Why it matters.** This is the failure mode the horizon board cannot catch,
because each project is individually within its pace. The damage comes from
*correlation between projects*, and nothing in the app currently looks across
projects at a single date.

**MIT use case.** Two psets and a project checkpoint on the same day, discovered
on the Monday of that week instead of two weeks earlier when I could still move.

**Impact:** High · **Effort:** M · **Risks:** False alarms — only fire when the
remaining estimated effort exceeds the free time between now and that date.
· **Priority:** P1

---

## ST-6. Track the late-day budget

**Problem.** Most MIT courses give a fixed number of late days per term. That
budget is a real, scarce, spendable resource that governs genuine decisions — and
I track it in my head, badly, and discover in November that I have none left.

**Proposed experience.** A course-level counter: late days total, spent, remaining.
When a project's deadline passes with work outstanding, offer *"Use a late day"* —
which shifts the deadline by one day and decrements the budget, rather than just
letting the project go red.

**Why it matters.** This is the most MIT-specific idea here and the one I would
be most delighted to find. It also fits the product thesis exactly: a scarce
resource, made visible, so that spending it is a decision instead of a drift. It
is the 3-slot *Now* cap applied to a second kind of scarcity.

**MIT use case.** "Do I take the hit on 6.1810 or burn a late day?" — with two
left and five weeks to go, that is a completely different answer than with six
left.

**Impact:** Medium (niche, but very high delight) · **Effort:** M · **Risks:**
Needs a course concept, which Phase does not have — a project-level field is the
cheap version and probably sufficient, since one project ≈ one pset.
· **Priority:** P2

---

## ST-7. Where did my week actually go?

**Problem.** At the end of a bad week I know I was busy and I cannot say where
the time went. Phase records what I planned and what I completed, never what I
spent. The recap even has a line ready for this — *"You logged N minutes across M
sessions"* — that can never render, because no action creates a `Session`.

**Proposed experience.** [F-3](features.md#f-3-close-the-estimateactual-loop),
reported per project: *"6.5840 took 14h this week against 6h planned. 18.404 got
40 minutes."*

**Why it matters.** The single most useful fact a student can learn is which
course is eating the term, and it is invisible until grades arrive. It also
produces the estimate calibration that makes every forward-looking number in the
app trustworthy.

**Impact:** High · **Effort:** L · **Risks:** See F-3. · **Priority:** P1

---

## ST-8. Estimates should calibrate per kind of work, not globally

**Problem.** A single global "you run 1.5× over" multiplier would be wrong in both
directions for me. My coding estimates are nearly accurate; my "read the paper"
estimates are off by 3×; my writing estimates are off by 2×.

**Proposed experience.** Once [F-3](features.md#f-3-close-the-estimateactual-loop)
has data, calibrate **per project** rather than globally — a project is already a
good proxy for a kind of work, and it requires no new taxonomy, no tags and no
user input. *"Your 18.404 estimates run 2.4× short"* is both more accurate and
more actionable than a global figure.

**Why it matters.** It gets per-category calibration for free from the hierarchy
that already exists, which is exactly the move [F-2](features.md#f-2-weight-the-roll-up-by-estimate)
makes with weights.

**Impact:** Medium · **Effort:** S (given F-3) · **Risks:** Small samples produce
wild ratios — require a minimum number of completed, logged steps before showing
one. · **Priority:** P2

---

## ST-9. Group psets stall on other people

**Problem.** Half my psets have partners and my UROP has a supervisor. Work that
is waiting on someone else looks identical to work I am failing to do, and it
drags the pace deficit down as though it were my fault.

**Proposed experience.** [F-5](features.md#f-5-blocked--waiting-on), with the
"waiting on" note naming the person, and blocked items excluded from
`behindPaceBy`.

**Why it matters.** Phase's willingness to make me uncomfortable is its best
quality, and it only survives if the discomfort is deserved. The first time the
board tells me I am behind because my pset partner has not replied, I start
discounting the number — and once I discount it, every other honest signal in the
app goes with it.

**Impact:** High · **Effort:** M · **Risks:** See F-5. · **Priority:** P1

---

## ST-10. Office hours are a resource, not an event

**Problem.** When I get stuck, the correct action is usually "take this to office
hours Thursday" — but there is nowhere to record that. So the step sits in the
rail looking actionable, I keep skipping it, and it silently becomes the reason
the pset is late.

**Proposed experience.** Combine [F-5](features.md#f-5-blocked--waiting-on) with
recurrence: mark a step `blocked → office hours`, and if a recurring office-hours
block exists on the calendar, offer to place the step immediately after it. The
blocked item surfaces in the daily ritual on the morning of that day.

**Why it matters.** It converts "stuck" from an invisible state into a scheduled
action, which is the single highest-value transition in a student's week.

**Impact:** Medium · **Effort:** M · **Risks:** Depends on F-4, F-5 and F-12
landing first. · **Priority:** P3

---

## ST-11. Finals week: keep the cap, change the rail

**Problem.** The instinct during finals is to want the 3-slot *Now* cap relaxed,
because everything is urgent at once.

**Proposed experience.** **Do not relax it.** Finals week is precisely when a
tool refusing to let me pretend I am pushing on six things is doing me the biggest
favour. What should change is the *rail*, not the cap: during a period where three
projects share a deadline inside two weeks, sort the rail strictly by deadline
across projects rather than by board order with a per-project cap.

**Why it matters.** I want to record this as an explicit anti-recommendation,
because it is the feature I would ask for in the moment and would regret getting.
The prior persona reached the same conclusion independently: *"keep this
non-negotiable — don't ship a raise-the-limit escape hatch."*

**Impact:** Medium · **Effort:** S · **Risks:** A mode that changes sort order
needs to announce itself, or the rail reorders mysteriously — same rule as
[UX-20](ux-ui.md#ux-20-say-why-a-rail-row-is-where-it-is). · **Priority:** P2

---

## ST-12. A semester view I can actually read

**Problem.** Timeline defaults to a span derived from the data and renders 12
projects clustered in a three-week band as slivers. The view whose entire purpose
is comparing spans against deadlines is unreadable at its default framing, and
`Fit` — one click away — produces the right answer.

**Proposed experience.** Run the `Fit` computation on mount and on project-set
change, clamped to a sane minimum span. Preserve `scrollLeft` and scale across
row expand/collapse. With [F-17](features.md#f-17-semester--term-as-a-first-class-span),
default the framing to the current term and mark exam milestones on the ruler.

**Why it matters.** The semester overview is genuinely the thing Timeline is
uniquely good for, and it is one default away from working.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1

---

## ST-13. Shopping period: projects I might not keep

**Problem.** For the first two weeks of term I am registered for six courses and
will drop two. Creating six full projects pollutes the board, the rail and every
capacity number with work I may never do.

**Proposed experience.** No new feature — **the horizon board already solves
this** and nobody explains it. Prospective courses belong in *Later*, which
`PLANNING_HORIZONS` already excludes from the rail and from `weekCapacity`.
Dropping one is a delete; keeping one is `⌥←` twice.

This is a documentation and onboarding gap, not a product gap: it should be the
worked example in the Projects empty state.

**Why it matters.** The most valuable thing about the horizon model is the
situation it handles that users do not realise it handles. The rail's silent
Now/Next filter ([QW-16](quick-wins.md#qw-16-name-the-horizon-rule-when-the-rail-hides-work))
is the same story — a good rule nobody can see.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P2
