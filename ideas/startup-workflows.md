# Startup Workflows

The half of my life Phase currently models badly — and it is badly for an
interesting reason, not a careless one. The app's honesty comes from *only*
counting ticked leaves. Coursework decomposes into checkable leaves perfectly.
A company does not.

---

## SU-1. My goals are numbers, not checkboxes

**Problem.** My real objectives are "$2k MRR", "10 design-partner interviews",
"cut activation time in half", "close the seed". None of those is a checkbox. To
represent them in Phase I invented sub-tasks so the percentage had something to
average — and the instant I did that, the number became exactly the theatre the
app's whole philosophy exists to prevent. Phase made me lie to it in order to use
it.

**Proposed experience.** [F-1](features.md#f-1-numeric--target-leaves): an
optional `target: {current, goal, unit}` on a leaf, rolling up proportionally.
`7/10 interviews` contributes 70%, not 0% or 100%.

**Why it matters.** This is the single change that makes the non-coursework half
of my life first-class, and — this is the part I want to stress — it *strengthens*
the thesis rather than compromising it. A number I have to move is harder to fake
than a checkbox I can tick. It is more honest than what exists today, not less.

**MIT use case.** "Close the seed" becomes `Intro calls 12/20`,
`Partner meetings 3/6`, `Term sheet 0/1` — and the roll-up finally means
something instead of averaging four invented sub-tasks.

**Impact:** Critical · **Effort:** M · **Risks:** See F-1. · **Priority:** P0

---

## SU-2. The pace engine goes silent on open-ended work

**Problem.** This is the subtler half of SU-1, and I think it is under-appreciated.
`expectedPct` and `behindPaceBy` both require `start` **and** `deadline`, gated by
`hasTrustedSchedule`. My startup projects have neither — "grow to $2k MRR" has no
honest deadline, and inventing one to get a progress line would be the same
self-deception as inventing sub-tasks.

So the drawer renders **"No project schedule"** and every pace signal, the
`BehindChip`, and the board's attention badge simply switch off. Phase's best
feature is unavailable for exactly the work where I am least able to judge my own
progress.

**Proposed experience.** For a project with no deadline, replace *pace against a
line* with *velocity against recent history*: **"3 steps completed in the last 14
days · 8 open · at this rate, ~5 weeks left."** Derived entirely from `doneAt`,
which is already recorded on every completed leaf and currently used for almost
nothing.

**Why it matters.** The pace line is the best information design in the product
because it explains rather than asserts. Open-ended work needs the same treatment
with a different denominator. Trailing velocity is the honest analogue of linear
pace, and the data is already on disk.

**MIT use case.** "Is the startup actually moving, or have I spent three weeks in
meetings?" Today Phase cannot answer that; `doneAt` already contains the answer.

**Impact:** High · **Effort:** M · **Risks:** Velocity is noisy over short
windows and near-meaningless below ~5 completions — say "not enough history yet"
rather than printing a confident wrong number. That refusal is the same instinct
`capacityParts` already shows in never blending unestimated work into a total.
· **Priority:** P1

---

## SU-3. The thought happens away from the laptop

**Problem.** Startup thinking happens walking between buildings, in the ten
minutes after a design-partner call, on the T. Phase is a Mac app and a browser
tab with a single-writer lock. Every one of those thoughts goes into Apple Notes
and roughly half never make it back out.

**Proposed experience.** [F-6](features.md#f-6-reach-get-phase-onto-my-phone-without-breaking-local-first),
tier 1 and tier 2: a read-only `.ics` feed so my phone's calendar shows the week,
and an append-only capture inbox that Phase drains on next launch. Neither creates
a second writer, so the architecture is untouched.

**Why it matters.** This is the constraint most likely to make me churn — not
because I want a mobile app, but because a tool that cannot receive a thought at
the moment I have it will always be a partial record, and a partial record cannot
be trusted for capacity.

**Impact:** Critical · **Effort:** S (tier 1) / L (tier 2) · **Risks:** See F-6.
· **Priority:** P0 (tier 1)

---

## SU-4. Everything is blocked on a person

**Problem.** Startup work stalls on other people constantly: waiting on a design
partner to reply, on a lawyer to send the SAFE, on my cofounder's review. All of
it looks like work I am failing to do, and it degrades every signal on the board.

**Proposed experience.** [F-5](features.md#f-5-blocked--waiting-on), with the
blocker named and blocked age shown (`waiting on Priya · 6 days`). Excluded from
pace and from `backlogMin` — I cannot plan hours for work I cannot start.

**Why it matters.** The blocked-age display is the part that earns its keep: it
turns "waiting" from a parking space into a follow-up trigger. Six days of silence
from a design partner is itself the next action.

**Impact:** High · **Effort:** M · **Risks:** Becomes a procrastination hatch;
surface anything blocked >7 days in the weekly recap as its own decision bucket.
· **Priority:** P1

---

## SU-5. Two lives, one board — without a second hierarchy

**Problem.** Coursework and the startup compete for the same hours, and their work
is qualitatively different (deadline-driven versus open-ended, solo versus
people-blocked). The obvious ask is "areas" or "workspaces" or tags.

**Proposed experience.** **Do not add a hierarchy.** Two mechanisms already
present handle it better:
1. The horizon board is *already* a shared scarcity pool. Three *Now* slots across
   coursework **and** startup is the correct, uncomfortable constraint — it is the
   real tradeoff, and separating them into lanes would let me pretend to have
   three of each.
2. For time separation, [F-15](features.md#f-15-labelled-availability-windows):
   label availability windows (`mornings = coursework`, `evenings = startup`) so
   auto-placement prefers the right hours. This shapes *when* without duplicating
   *what*.

**Why it matters.** This is the request I would make loudest and that would do
the most damage. A second organising axis would let me carry six *Now* projects
while feeling disciplined, which is the precise failure the cap exists to prevent.
The shared pool is the feature.

**Impact:** High (as a decision) · **Effort:** M (F-15) · **Risks:** Users will
keep asking for areas — the answer needs to be in the product's copy, not just in
its architecture. · **Priority:** P2

---

## SU-6. Do not build a CRM

**Problem.** I have an investor pipeline and a design-partner pipeline. Both are
genuinely stage-based, and the instinct is to ask for a kanban of contacts.

**Proposed experience.** **Refuse.** [SU-1](#su-1-my-goals-are-numbers-not-checkboxes)'s
numeric leaves cover the part that belongs in a *planner*: `Intro calls 12/20`,
`Partner meetings 3/6`. The per-contact state belongs in a spreadsheet or Attio,
and Phase should link to it via a project note rather than absorb it.

**Why it matters.** A CRM inside Phase would require contacts, stages, custom
fields and views — which is Notion, and it would dissolve the "one right way to
decompose" invariant that makes the app worth using. The correct product answer
is that Phase tracks *my commitment to the pipeline*, not the pipeline.

**Impact:** High (as a decision) · **Effort:** — · **Risks:** —
· **Priority:** P1 (decide and write it down)

---

## SU-7. Standup, investor update, weekly review

**Problem.** Daily standup, the Friday investor update, the monthly board email.
Habits cover rituals that leave no artifact; these leave artifacts and have real
deadlines, so they should be tasks. There is no recurrence, so I recreate them or
forget them.

**Proposed experience.** [F-4](features.md#f-4-recurring-work) — recurring tasks
materialising the next instance on completion of the current one, never
pre-generating a quarter of phantom load into `weekCapacity`.

**Impact:** High · **Effort:** L · **Risks:** See F-4. · **Priority:** P1

---

## SU-8. Which half of my life is eating the other?

**Problem.** Some weeks the startup silently consumes the coursework hours, or
the reverse. I find out from a grade or a missed sprint. Phase records what I
planned and what I completed, never what I spent.

**Proposed experience.** [F-3](features.md#f-3-close-the-estimateactual-loop)
reported as a split: *"This week: 22h logged — 60% startup, 40% coursework.
Planned: 50/50."*

**Why it matters.** The gap between the intended split and the actual split is
the single most decision-relevant number in my life, and it is currently
unknowable. It is also the honest version of the question SU-5 refuses to answer
with a hierarchy — you do not need lanes to measure the split, you need actuals.

**Impact:** High · **Effort:** L · **Risks:** See F-3. · **Priority:** P1

---

## SU-9. A snapshot my cofounders can read

**Problem.** My cofounders ask what I am working on. Phase is single-writer,
local-first and — correctly — will never be multiplayer. But "no collaboration"
should not mean "no communication".

**Proposed experience.** `Export as Markdown`
([QW-18](quick-wins.md#qw-18-export-as-markdown-as-well-as-json)), scoped to one
project: title, progress, open steps, blocked items with their blockers, and the
next milestone. Paste into Slack or Notion. One-way, static, honest.

**Why it matters.** It is the local-first answer to collaboration: export a
representation, not a connection. It costs almost nothing and removes the most
common reason someone abandons a single-player tool for a team one.

**Impact:** Medium · **Effort:** S · **Risks:** Must be obviously a snapshot —
date-stamp it so a stale paste is not mistaken for live state. · **Priority:** P2

---

## SU-10. Turn `doneAt` into a shipping record

**Problem.** Every completed leaf carries `doneAt`. It is used for essentially
nothing — the weekly recap works from the `PlanReview` snapshot, not from
completion dates. Meanwhile I write "what shipped this month" by hand for investor
updates, from memory, badly.

**Proposed experience.** A `Shipped` list: completed leaves in a date range,
grouped by project, copyable as Markdown. Feeds SU-9 and the monthly update
directly. This is a pure read over data already on disk — no new fields.

**Why it matters.** It converts a field that currently exists only to be exported
into the source of a document I write every month.

**Impact:** Medium · **Effort:** S · **Risks:** `doneAt` is optional on legacy
data; degrade gracefully rather than dropping items. · **Priority:** P2

---

## SU-11. The meeting-to-follow-ups gap

**Problem.** I finish a design-partner call with three follow-ups, one of which is
a real project. The follow-ups are captured on my phone if at all
([SU-3](#su-3-the-thought-happens-away-from-the-laptop)), and they arrive as
dateless, projectless tasks — which land in the rail's "Loose tasks" bucket at the
very bottom, which is more prominent than where they should be but semantically
correct and easy to ignore.

**Proposed experience.** A triage pass in the daily ritual
([F-8](features.md#f-8-the-daily-ritual)): anything captured today that is still
dateless and projectless gets three verbs — assign to a project, schedule, or drop.
The GTD inbox principle, but bounded to one moment a day so it never becomes a
second backlog.

**Why it matters.** Phase already made the correct model decision here — `Task.date`
is genuinely optional and the type comment explains exactly why the rail makes a
dateless task reachable. What is missing is the *ritual* that empties it.

**Impact:** Medium · **Effort:** M · **Risks:** Do not build an Inbox view; that
is a fourth destination and a second backlog. It is a step in an existing ritual.
· **Priority:** P2

---

## SU-12. Ask a model about my actual week

**Problem.** Phase holds every number needed to answer "what should I drop this
week" — capacity, estimates, deadlines, pace, horizons — and there is no way to
ask it. The clipboard round-trip is manual, one-directional, and scoped to
decomposing a single step.

**Proposed experience.** [F-16](features.md#f-16-an-agent-bridge-mcp): a local MCP
server exposing the store read-only plus a narrow guarded write set. Short of
that, [QW-19](quick-wins.md#qw-19-copy-project-as-prompt--invert-the-import)
("copy project as prompt") gets 70% of the value this week.

**MIT use case.** "Here are my next two weeks. The seed close moved up ten days.
What do I drop?" — a question with a correct answer that Phase can compute and
cannot be asked.

**Impact:** High · **Effort:** L · **Risks:** Model writes to a local-first
database need the undo net and probably a confirm-before-write mode; the Web Lock
must cover the MCP process or it becomes the stale second writer `tabLock` exists
to prevent. · **Priority:** P3

---

## SU-13. Batch the context switches

**Problem.** Switching between a distributed-systems lab and a fundraising email
costs me twenty minutes of ramp each way. Phase places work by capacity and
urgency and is entirely blind to switching cost, so an auto-placed day can
alternate between four projects.

**Proposed experience.** When [F-7](features.md#f-7-auto-place-fill-my-week)
places work, prefer contiguous same-project runs over strict deadline order where
capacity allows. Surface it as a plain sentence — *"grouped 3h of 6.5840 together"* —
rather than as a hidden heuristic.

**Why it matters.** It is the difference between a schedule that is arithmetically
valid and one a person can actually execute. It only becomes possible once
auto-placement exists, which is why it sits behind F-7.

**Impact:** Medium · **Effort:** S (as an F-7 heuristic) · **Risks:** Must never
override a deadline — grouping is a tiebreak, not a priority. · **Priority:** P3
