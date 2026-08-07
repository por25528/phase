# Features

New capabilities. Each is checked against the current data model in
`src/db/types.ts` and the action surface in `src/state/store.ts`.

The section at the bottom — **Features I argue against** — matters as much as the
ones above it.

---

## F-1. Numeric / target leaves

**Problem.** A leaf is `done: boolean`. That models coursework perfectly and my
startup not at all. My real goals are "$2k MRR", "10 design-partner interviews",
"cut activation time in half". To fit them into Phase I invented sub-tasks so the
percentage had something to average — and the moment I did that, the number
became theatre, which is precisely what the app's honesty exists to prevent.

**Proposed experience.** A leaf gains an optional target:

```ts
target?: { current: number; goal: number; unit?: string }  // LEAVES only
```

`nodePct` returns `clamp(current / goal, 0, 1) * 100` when `target` is present,
falling back to `done ? 100 : 0` otherwise. The row renders `7/10 interviews`
with an inline stepper; `done` is derived (`current >= goal`) rather than stored,
so the leaf-XOR-container invariant is untouched and `addChild` clears `target`
exactly as it already clears `done`.

**Why it matters.** This is the one addition that makes a whole half of my life
first-class, and it *strengthens* the honesty thesis rather than weakening it: a
number I have to move is harder to fake than a checkbox I can tick. Every other
tool lets me feel productive by reorganising; a target leaf makes me report.

**MIT use case.** "Close the seed" decomposes into `Intro calls 12/20`,
`Partner meetings 3/6`, `Term sheet 0/1`. The roll-up finally means something.

**Impact:** Critical (unlocks the entire non-coursework use case) · **Effort:** M
· **Risks:** (1) `pct.ts` is load-bearing for pace, the board, Timeline and the
recap — its test file must be extended before the implementation, not after.
(2) Partial credit could tempt people to fake progress; mitigate by keeping the
stepper explicit rather than a free-text field. (3) `estimateMin` on a target leaf
is ambiguous — decide it means "effort remaining to reach the goal".
· **Priority:** P0

---

## F-2. Weight the roll-up by estimate

**Problem.** `nodePct` averages children **equally**. "Implement Raft leader
election" and "Rename the repo" as siblings each count 50%. My projects are
lopsided by nature — one enormous leaf and five trivial ones — and the percentage
systematically flatters the trivial work. The prior persona asked for S/M/L
weights.

**Proposed experience.** Do not add a weight field. **Use `estimateMin`, which
already exists**, is already required by the capacity engine, and which
[QW-1](quick-wins.md#qw-1-let-me-set-an-estimate-where-i-write-the-step) makes
easy to enter. Rule:

> Within one sibling set, if **every** child carries a usable estimate, weight
> the mean by it. If any sibling lacks one, fall back to the unweighted mean for
> that set.

Per sibling set, not globally, so a well-estimated subtree gets an honest number
even when its cousin is a mess. Surface which mode a project is in — the drawer
already has room on the pace line.

**Why it matters.** It gets weighted progress for **zero new user input**, using
a number the user is already being asked for and already benefits from. An S/M/L
field would be a second, redundant, and inevitably contradictory effort estimate.
The all-or-nothing rule is what keeps it honest: a partially-estimated set would
otherwise let one estimated leaf silently dominate five unestimated ones.

**MIT use case.** The Raft lab is one 6-hour implementation leaf and four 20-minute
admin leaves. Today ticking all four admin leaves reads 80%. Weighted, it reads 36%,
which is the truth, and it is the number that should be driving my panic level.

**Impact:** High · **Effort:** M · **Risks:** (1) The percentage will *drop* for
existing users the moment estimates land — that needs an explanation in-app, not
a silent recalculation. (2) `normalizeEstimate` must be the single definition of
"usable" here too, or capacity and progress will disagree about the same leaf.
· **Priority:** P1

---

## F-3. Close the estimate/actual loop

**Problem.** This is, in my view, the app's deepest gap. Phase knows what I
**promised** (`estimateMin`, `plannedStartMin`) and what I **finished** (`done`,
`doneAt`). It knows nothing about what actually **happened**. The consequences
compound:

- My estimates never improve. I guess 90m in September and 90m in December.
- The pace line can say "you are 35 pts behind" but never *why* — it cannot
  distinguish "you did not sit down" from "your estimates are 2× optimistic".
- `Session` is fully specified, persisted, exported, and **has no producer**.
  `RecapPanel.tsx:26` renders a "You logged N minutes across M sessions" line
  that is structurally unreachable (see [QW-4](quick-wins.md#qw-4-delete-the-recaps-dead-time-logging-branch--or-produce-a-session)).

**Proposed experience.** Three layers, shippable independently:

1. **Producer.** A scheduled grid block gets a `Start` control; a running block
   shows elapsed time. Stopping writes a `Session { goalId, date, minutes, note }`.
   Plus a manual `Log 45m` for work done away from the laptop. This is the whole
   of layer 1 and it makes the existing recap line true.
2. **Comparison.** On completing a step, the block shows `est 90m · actual 145m`.
   The weekly recap gains an accuracy line: *"You planned 9h 30m and logged
   14h 10m — your estimates run about 1.5× short."*
3. **Calibration.** Offer that ratio as a multiplier on the capacity readout:
   *"9h 35m planned (14h at your usual pace)"*. **Opt-in and always reversible** —
   an automatically inflated number the user did not ask for would be exactly the
   invented authority `capacityParts` deliberately refuses.

**Why it matters.** Phase's entire pitch is that it tells the truth about a week
*before* the week happens. It cannot do that while its central input is an
uncalibrated guess. Every other honesty mechanism here is a measurement; this is
the one place the app currently asks me to make something up. Sunsama's actual
insight is not the daily ritual — it is that the ritual is where estimates get
corrected.

**MIT use case.** I discover that every "read the paper" step takes 3× what I
budget and every coding step takes 1.1×. That single fact would change how I plan
a semester more than any other feature on this list.

**Impact:** Critical · **Effort:** L · **Risks:** (1) Time tracking is where
planners go to die — it must be one click and must never nag. (2) A running timer
is real-time state in an app whose store is snapshot-and-persist; keep the ticking
in component state and write the `Session` only on stop. (3) Layer 3 can make the
capacity number feel punitive; ship 1 and 2, then decide. · **Priority:** P0

---

## F-4. Recurring work

**Problem.** No recurrence exists anywhere. `Task` has `date`, not a rule. A pset
is due every Thursday for twelve weeks; standup is every weekday at 09:00; the
investor update is the first of the month. I recreate each of these by hand, and
the ones I forget to recreate simply stop happening.

**Proposed experience.** Two distinct things, and conflating them is the trap:

- **Recurring task** — a lightweight rule (`every Thu`, `every weekday`,
  `monthly on the 1st`) that materialises the *next* instance only, on completion
  of the current one. Never pre-generate twelve rows into the backlog; that is how
  a list becomes a graveyard and it would poison `weekCapacity` with a semester of
  phantom load.
- **Recurring project template** — see [F-13](#f-13-project-templates). "Pset N"
  is a *tree*, not a task, and it should be instantiated deliberately.

Habits already cover daily rituals with no artifact. Recurrence is for work that
produces something.

**Why it matters.** It is the single largest source of repeated input in my
semester, and forgotten recurring work is the failure mode a planner is supposed
to eliminate.

**MIT use case.** `Submit 18.404 pset` every Thursday, twelve times, entered once.

**Impact:** High · **Effort:** L · **Risks:** (1) Recurrence rules metastasise —
ship four presets and a custom weekday picker, not RRULE. (2) Materialise-on-
completion means a skipped week silently stops the series; surface that in the
recap. · **Priority:** P1

---

## F-5. Blocked / waiting-on

**Problem.** The model has exactly two states for open work: not done, and
overdue. Neither describes "waiting on Priya's design pass" or "blocked until the
6.5840 staff answer my Piazza question". So blocked work sits in the rail looking
like work I am failing to do, and it drags the pace deficit down as if it were my
fault.

**Proposed experience.** An optional `blockedOn?: string` on a leaf or task. A
blocked item: renders muted with a `waiting: Priya` chip, sorts to a **Blocked**
group at the foot of the rail, is **excluded from `behindPaceBy`**, and is
excluded from `weekCapacity`'s `backlogMin` — I cannot plan time for work I cannot
start. Unblocking is one click and returns it to its normal position.

**Why it matters.** Excluding it from pace is the whole point. Phase's
willingness to make me uncomfortable is its best quality and it is only credible
if the discomfort is deserved. A pace deficit driven by someone else's inbox
teaches me to ignore the number.

**MIT use case.** Group psets and UROP both stall on other people constantly.
Right now they poison every signal on the board.

**Impact:** High · **Effort:** M · **Risks:** "Blocked" becomes a
procrastination hatch. Mitigate: show blocked age (`waiting 6 days`) and surface
anything blocked >7 days in the weekly recap as its own decision bucket.
· **Priority:** P1

---

## F-6. Reach: get Phase onto my phone without breaking local-first

**Problem.** Phase is a Mac app and a browser tab, single-writer by design
(`tabLock.ts` rejects a second tab outright, and a non-owner never writes at all).
That constraint is correct and I would not trade it for a sync service. But half
my thinking happens walking between buildings, and a planner I can only open at
my desk is a Sunday tool, not a daily one. This is the one constraint most likely
to make me churn.

**Proposed experience.** Three tiers, in strict order of cost:

1. **Read-only `.ics` export** (see also [SU-11](startup-workflows.md)). Write the
   week's placed blocks to a file the OS calendar subscribes to. My phone's
   calendar becomes the read client, for free, today. This alone fixes "what am I
   supposed to be doing right now" when I am not at my laptop.
2. **Capture-only PWA.** A tiny page that writes nothing but an append-only
   inbox of `{title, capturedAt}` to a file or a single sync primitive. Phase
   drains it on next launch into dateless tasks. Append-only means no merge
   conflicts and no violation of the single-writer rule — there is still exactly
   one writer of the real database.
3. **Full sync.** Only if 1 and 2 prove insufficient. This is where the local-first
   guarantees actually get hard, and I would rather Phase never do it than do it
   badly.

**Why it matters.** Tier 1 is a day of work and converts the app from "a planner"
to "a planner I can consult". Tier 2 captures the thought that would otherwise be
lost. Neither compromises the architecture.

**MIT use case.** Walking out of a design-partner call with three follow-ups, on
the way to a lecture.

**Impact:** Critical · **Effort:** S (tier 1) / L (tier 2) / XL (tier 3)
· **Risks:** Tier 1's file needs somewhere to live that a phone can reach —
iCloud Drive/Dropbox is the pragmatic answer for an Electron app. Tier 2 must
never become a second writer. · **Priority:** P0 (tier 1) / P2 (tier 2)

---

## F-7. Auto-place: "fill my week"

**Problem.** Placing work is one drag per item, or focus-a-row-and-press-a-digit
per item. Assigning twelve steps to a week is twelve interactions, and the
app *already knows* the free intervals (`freeIntervals`), the durations
(`estimateMin`), and the urgency ordering (`sortByDue`). It has everything needed
to propose an answer and makes me do it by hand anyway.

**Proposed experience.** A `Fill week` control in the rail. It proposes placements
for everything in the backlog — respecting availability windows, existing blocks,
due dates and the day capacities already computed — and renders them as **ghost
blocks**, not commitments. `Accept all`, or drag any single one before accepting,
or discard. Never writes without an explicit accept.

**Why it matters.** This is where Phase's arithmetic becomes *leverage* instead
of *judgement*. Google Calendar's "find a time" is the reference, but Phase is in
a better position than Google ever was: it knows the work, the estimates and the
deadlines, not just the gaps.

**MIT use case.** Sunday night, fourteen steps across four courses, six hours of
availability a day. Right now that is twenty minutes of dragging and I do it
badly. This makes it one click plus three corrections.

**Impact:** High · **Effort:** L · **Risks:** (1) A bad auto-plan is worse than
none — the ghost-preview-then-accept flow is non-negotiable. (2) It must refuse
loudly rather than silently overfilling: if the work does not fit, say *"3h 20m
would not fit — these four are left in the rail"*, which is the honesty thesis
applied to automation. · **Priority:** P1

---

## F-8. The daily ritual

**Problem.** Phase has an excellent **weekly** ritual (`RecapPanel`: last week's
commitments, Done / Unfinished / Removed, with Replan / Break down / Remove
inline). It has no **daily** one. But the week grid is not what I need at 09:00 —
I need "here is today, does it fit, what is first" — and at 22:00 I need "what
actually happened".

**Proposed experience.** Two lightweight moments, both dismissible, neither a gate:

- **Start of day** — a strip above the grid: today's blocks in clock order, the
  first one promoted, `4h 20m planned · 5h free`. One control: `Looks right`.
- **End of day** — surfaces anything planned-and-untouched with the same three
  verbs the weekly recap already uses (Replan / Break down / Remove), and — once
  [F-3](#f-3-close-the-estimateactual-loop) exists — asks for actuals on anything
  completed.

**Why it matters.** Sunsama's real insight is not that a daily ritual is nice; it
is that *the ritual is the only reliable moment estimates get corrected and
carryover gets triaged*. Phase already proved it understands this at week scale.
The day is where the correction data actually lives.

**MIT use case.** 22:00, the Raft lab took three hours instead of ninety minutes.
That fact needs to enter the system while I still remember it.

**Impact:** High · **Effort:** M · **Risks:** Ritual fatigue — two prompts a day
is the maximum a planner survives. Both must be dismissible forever in one click,
and the recap's own precedent (a panel, not a gate) is the right model.
· **Priority:** P1

---

## F-9. Backward planning from a deadline

**Problem.** Every project has `start` and `deadline`, and `expectedPct` draws a
linear pace line between them. But planning is still forward and manual: I decide
what to do Monday, then Tuesday. Nothing works backward from "this is due Friday
and there are 6 hours of work left".

**Proposed experience.** In the drawer: `Plan backward from the deadline`. Takes
the project's unfinished leaves, their estimates, and the availability between now
and the deadline, and distributes them latest-possible-with-a-buffer — or refuses:
*"14h of work, 9h available before Friday. Cut scope or move the deadline."*

**Why it matters.** The refusal is the feature. It is the same
`isOverCommitted` honesty, applied to a single project against a real date, at the
moment I can still do something about it — which is a week earlier than the pace
line will tell me.

**MIT use case.** Exam in nine days, six topics to review, four hours a day free.
Tell me now whether that is real.

**Impact:** High · **Effort:** M (given F-7's placement engine) · **Risks:**
Loading everything to the last minute is bad advice — bias toward earliest-fit
with slack, and never plan into the final 20% of the runway. · **Priority:** P1

---

## F-10. Notes and links on a step

**Problem.** `Goal.notes` exists and is a good field. There is nothing equivalent
on a `GoalNode`. So the Piazza link, the paper URL, the error message I need to
come back to, and the "ask Kaashoek about this" all go in one project-level
textarea, disconnected from the step they belong to.

**Proposed experience.** `note?: string` on a node. A `.quiet-control` affordance
on the row; a set note renders a small indicator and expands inline. Plain text
with autolinked URLs — not a rich-text editor, not a wiki.

**Why it matters.** Obsidian's lesson is that capture has to happen where the
work is. The friction of "open drawer, scroll to project notes, describe which
step I mean" is exactly enough to make me put it in a different app, and then the
step and its context live in two places.

**MIT use case.** `Debug the figure-8 test` needs the failing seed and the log
line. Today those live in a scratch file I lose.

**Impact:** Medium · **Effort:** S · **Risks:** Scope creep toward a note-taking
app. Hard-cap it: plain text, no attachments, no backlinks. · **Priority:** P2

---

## F-11. Merge on import

**Problem.** `importBackup` **replaces everything**, behind a `window.confirm`.
It also — correctly — clears the undo stack, because a whole-slice restore armed
against the previous dataset would overwrite the imported one. But replace-only
means I can never reconcile my laptop with a lab machine, and the day I trust
Phase with a semester is the day this becomes frightening.

**Proposed experience.** An import mode picker: **Replace** (today's behaviour) or
**Merge**. Merge is union-by-id: unknown ids are added, known ids take the newer
version, nothing is deleted. Show a preview — *"12 new projects, 3 updated, 40
unchanged"* — before writing. The generation-boundary rule still applies: merging
clears the undo stack exactly as replacing does.

**Why it matters.** It is the difference between a backup and a data model I can
live in across two machines. It is also the safety net that makes every other
"just export it" recommendation in this document credible.

**Impact:** Medium · **Effort:** M · **Risks:** Genuine. Merge needs a defensible
conflict rule and there is no `updatedAt` on any entity today — adding one is a
prerequisite, and `doneAt`/`completedAt` are not substitutes. Do not ship merge
without it. · **Priority:** P2

---

## F-12. Ship the read-only calendar pull

**Problem.** `BusyBlock` is fully specified in `types.ts` and threaded through
`visibleRange`, `weekCapacity`, `freeIntervals`, `resolveSlot`, `clampResize` and
`DayBlocks`. **Every call site passes `[]`** — I found four in `Plan.tsx` alone.
`docs/decisions/2026-07-31-busy-blocks-source-of-truth.md` explicitly rejects
local authoring and commits to a read-only Google pull. So today there is no way
to tell Phase about a lecture, a lab or an exam, and the only workaround is to
shrink my whole working window — which throws away the hours either side of the
class.

**Proposed experience.** Ship the designed slice 2. Nothing new to invent; the
consumer side is already built and tested.

**Why it matters.** For a student this is the **largest single source of error in
the capacity number**. My real availability is not 09:00–18:00; it is 09:00–18:00
minus fourteen hours of scheduled class. Until that lands, `24h 6m free` is not
merely an upper bound, it is wrong by a third, and the app's headline number is
its least accurate one.

**MIT use case.** Lectures, two recitations, a lab section, and office hours —
the fixed skeleton every other hour has to fit around.

**Impact:** Critical · **Effort:** L · **Risks:** Already analysed in the design
doc. One flagged in `capacityLabel.ts:capacityNote` deserves repeating: the string
`'calendar not connected'` is derived from `hasData`, which after slice 2 also
goes false on a stale cache or a provenance mismatch — at which point the message
becomes a lie. That must become an enum in the same change. · **Priority:** P0

---

## F-13. Project templates

**Problem.** [QW-8](quick-wins.md#qw-8-duplicate-a-project) (duplicate) covers
repetition within a course. It does not cover the shape I want *before* I have an
instance, and it does not travel between semesters.

**Proposed experience.** Save any project as a named template (tree + estimates,
no dates, no scheduling, no done-state). `+ New project` offers templates
alongside blank. Templates are ordinary JSON in the existing import schema, so
they export, share and can be generated by an LLM with no new format.

**Why it matters.** The import path already proves the format. This is a
first-class home for it instead of a clipboard round-trip.

**Impact:** Medium · **Effort:** M · **Risks:** Overlaps with duplicate — ship
QW-8 first and only build this if the duplicate action proves insufficient.
· **Priority:** P2

---

## F-14. A recoverable trash

**Problem.** Deletes are undoable for five seconds, and `setAndPersist`'s sweep
deliberately drops non-surgical entries when an ordinary edit lands — so ticking
any checkbox inside that window consumes the undo. That design is *correct* (a
visible Undo button that does nothing is worse than no button), but the
consequence is that a mis-deleted project is unrecoverable almost immediately.
`completedAt` already gives archived projects a home and a `Reopen` path; deleted
ones have nothing.

**Proposed experience.** Route project deletion to a `deletedAt` tombstone.
Tombstoned projects are excluded from every view, every roll-up and every capacity
calculation, and are listed under a `Recently deleted` disclosure beside the
existing `Completed` section, purged after 30 days. The 5s undo stays exactly as
it is — this is the net *under* it, not a replacement.

**Why it matters.** Deleting my 6.5840 project — nine leaves, three containers,
two milestones, notes and a week of scheduling — is two clicks and gone. That is
the one interaction that could cost me a semester.

**Impact:** Medium · **Effort:** M · **Risks:** Every query that walks `goals`
must learn to filter tombstones — that is a wide blast radius across `lib/`, and
it is exactly the sort of change that needs the `pct`/`capacity`/`backlog` test
files extended first. · **Priority:** P2

---

## F-15. Labelled availability windows

**Problem.** `AvailabilityWindow` is `{dow, startMin, endMin}` — one undifferentiated
block of "time I can work". But 09:00–12:00 and 21:00–23:00 are not interchangeable
hours. I cannot write a distributed-systems lab at 22:00 and I should not spend a
sharp morning on email.

**Proposed experience.** An optional `label?: string` on a window ("deep",
"shallow", "startup"), plus an optional matching tag on a project. Auto-place
([F-7](#f-7-auto-place-fill-my-week)) prefers matching windows; nothing is ever
*forbidden*, only preferred. Purely additive — an unlabelled setup behaves exactly
as today.

**Why it matters.** It is also the cleanest answer to "how do I separate
coursework from the startup" (see [SU-5](startup-workflows.md)) without adding a
competing hierarchy like tags or areas, which would undermine the horizon board.

**Impact:** Medium · **Effort:** M · **Risks:** The beginning of a taxonomy.
Cap it at a small fixed set of labels rather than free text. · **Priority:** P3

---

## F-16. An agent bridge (MCP)

**Problem.** The clipboard round-trip in `SubtaskAiModal` is a legitimate and
even admirable choice for a local-first app — but it is one-directional and
manual, and it only decomposes a single step.

**Proposed experience.** A local MCP server exposing Phase's store read-only plus
a narrow set of writes (`addGoals`, `addChildren`, `setNodeEstimate`,
`scheduleNode`). Then Claude can answer "what is my week actually look like" and
"break the Raft lab into day-sized steps and place them" against live data,
with every write going through the same guarded actions the UI uses.

**Why it matters.** Phase's principled store — one write path, pure derivations,
enforced invariants — is unusually well-shaped for this. The invariants hold
whether the caller is a button or a model.

**MIT use case.** "Look at my next two weeks and tell me what I should drop."
Phase has every number needed to answer that and no way to be asked.

**Impact:** High · **Effort:** L · **Risks:** (1) Write access to a local-first
database from a model needs the undo net and probably a confirm-before-write
mode. (2) The single-writer Web Lock must cover the MCP process too, or it becomes
exactly the stale second writer `tabLock` exists to prevent. · **Priority:** P3

---

## F-17. Semester / term as a first-class span

**Problem.** Timeline draws a Gantt over whatever dates exist. There is no notion
of a term — the actual unit my life is organised in. So "am I overloaded *this
semester*" is a question the app cannot be asked, only "am I overloaded this week".

**Proposed experience.** An optional named span with a start and end. The Timeline
defaults its framing to the current term; the Projects board can show
`4 of 12 projects due this term`; the term's end is a milestone every project's
pace line can be read against.

**Impact:** Medium · **Effort:** M · **Risks:** Another organising concept
competing with horizons — keep it strictly a *display* span with no scheduling
semantics, exactly as `Milestone` is deliberately markers-only. · **Priority:** P3

---

## F-18. Habit pause / planned skip

**Problem.** `Habit` supports `daily`/`weekly` cadence, a `weeklyTarget`,
`checkins[]` and `createdAt`. There is no pause and no skip, so any unchecked day
breaks a streak. During finals week or a week away, every habit I keep is
destroyed by a system that cannot tell "I chose not to" from "I failed to".

**Proposed experience.** A date range during which a habit is paused: no misses
counted, streak preserved and visibly annotated rather than silently bridged.

**Why it matters.** A streak that punishes a deliberate, correct decision teaches
me to ignore streaks. This is the same principle as excluding blocked work from
pace ([F-5](#f-5-blocked--waiting-on)): the signal is only credible if it is fair.

**Impact:** Medium · **Effort:** S · **Risks:** Pausing becomes the escape hatch;
show paused days distinctly in the trail so the history stays honest.
· **Priority:** P2

---

# Features I argue against

Saying no is most of what protects this product. Each of these is a thing a
reasonable person would ask for, and each would damage the thesis.

- **Tags / labels.** The project hierarchy already supplies context and the
  horizon board already supplies priority. Tags would compete with both and, worse,
  would give me a way to *organise* instead of *decide* — the exact escape hatch
  Phase's scarcity model exists to close.
- **P1–P4 task priority.** The four horizons **are** the prioritisation mechanism,
  and the 3-slot *Now* cap is what makes them bite. A per-task priority field would
  let me mark nine things P1 and feel prioritised, which is what every other tool
  lets me do.
- **Raising or configuring the *Now* cap.** The friction is the feature. Ship no
  escape hatch, not even a setting.
- **Sub-projects / nesting projects.** The leaf-XOR-container invariant is the
  best idea in the data model. Arbitrary depth at the project level would dissolve
  the distinction between "an outcome I can finish" and "a folder".
- **Collaboration / shared projects.** Directly contradicts single-writer
  local-first. The cofounder case is served by an export snapshot
  ([SU-11](startup-workflows.md)), not by multiplayer.
- **Full step dependency graphs.** A `blocked` flag with a reason
  ([F-5](#f-5-blocked--waiting-on)) captures ~95% of the value. A real DAG brings
  cycle detection, critical paths and a scheduling problem, in a personal planner.
- **Rich text / databases / arbitrary views.** That is Notion, and Notion is worse
  at this. Phase's value is that there is one right way to decompose.
