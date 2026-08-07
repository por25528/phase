# Quick Wins

Changes measured in hours or a day or two, mostly reusing code that already
exists. I have checked each against the current build — none of these are
already shipped.

Ordered by value per unit of effort, not by area.

---

## QW-1. Let me set an estimate where I write the step

**Problem.** `EstimateField` is imported in exactly one place in the entire
application: `src/views/plan/sidebar/Backlog.tsx:10`. The file says so itself —
*"it is the only route to `setTaskEstimate`/`setNodeEstimate` left in the app."*
The rail only lists work that is (a) in a **Now or Next** project
(`PLANNING_HORIZONS = 2`) and (b) **not yet on the grid**. So:

- A step in a *Later* project can never be given an estimate.
- A step already on the calendar can only be re-estimated by dragging a resize
  handle — and `resizeNode` refuses outright if the new duration collides
  (`store.ts:1408`).
- The drawer, where I actually decompose a project, has no estimate control at
  all. `GoalTree.tsx` contains the string "estimate" zero times.

**Proposed experience.** Render `EstimateField` on every leaf row in `GoalTree`,
right-aligned in the space the `.quiet-control` cluster already occupies. Empty
reads as a faint `est` affordance; set reads `90m`. Same click-to-swap
interaction the rail already uses.

**Why it matters.** `estimateMin` is the fuel for the entire differentiating
engine — `weekCapacity`, `isOverCommitted`, `dayLoadLabel`, the `N unestimated`
warning. Phase asks me to plan in minutes and then hides the only field where
minutes come from. This is the single largest gap between what the app computes
and what it lets me tell it.

**MIT use case.** I break "6.5840 Lab 2: Raft" into nine steps in one sitting in
the drawer. Right now I estimate none of them, switch to Plan, discover the rail
shows three, and estimate those. The other six are invisible to capacity forever.

**Impact:** Critical · **Effort:** S · **Risks:** Row density in the tree; solve
by reusing `.quiet-control` so it is hover/focus-revealed, not permanent chrome.
· **Priority:** P0

---

## QW-2. Make "N unestimated" a button

**Problem.** `capacityParts()` emits `` `${c.unestimated} unestimated` `` into the
week header (`capacityLabel.ts:44`). It is a dead number. There is no way to
find which items it counts.

**Proposed experience.** Render it as a button. Clicking it calls the existing
`actions.revealInPlan(...)` on the first unestimated item — the exact code path
the command palette already uses to scroll-and-highlight a rail row. Repeated
clicks walk the list, the way the Projects date-review banner's `Review` button
already walks unconfirmed projects (`Goals.tsx:248`).

**Why it matters.** The header is telling me my capacity number is partly
fictional and then refusing to say which part. Both the reveal machinery and the
cursor-walking pattern are already written.

**MIT use case.** Sunday planning: header says `4 unestimated`. One click, four
times, and the week's arithmetic is real.

**Impact:** High · **Effort:** S · **Risks:** None material. · **Priority:** P0

---

## QW-3. Parse `~90m` out of the step title as I type it

**Problem.** Decomposing and estimating are two passes over the same list.

**Proposed experience.** In the drawer's `+ add step…` field, strip a trailing
`~90m` / `~1.5h` / `~90` and route it to `setNodeEstimate`. `src/views/plan/
estimateInput.ts` already parses exactly this vocabulary for `EstimateField`;
reuse it rather than writing a second parser. Echo the parsed value in the row so
it is visibly understood, never silently swallowed.

**Why it matters.** This is Todoist's real lesson — not natural language for its
own sake, but *never making the user make two passes over one list*. Nine steps
becomes nine lines instead of nine lines plus nine estimate edits.

**MIT use case.** `Implement AppendEntries ~2h` ⏎ `Write the figure-8 test ~45m` ⏎ …

**Impact:** High · **Effort:** S · **Risks:** A step legitimately containing `~`;
only strip when the token parses and sits at the end. · **Priority:** P1

---

## QW-4. Delete the recap's dead time-logging branch — or produce a `Session`

**Problem.** `RecapPanel.tsx:26` renders:

> You logged **2h 15m** across 3 sessions.

gated on `logged.sessions > 0`. There is **no action anywhere in the store that
creates a `Session`** — no `addSession`, no `logSession`, nothing. `loggedTimeForWeek`
is real, tested (`plan.test.ts:785`) and wired into the panel, but its input array
is only ever populated by an imported backup. For every user who has not
hand-edited their JSON, this branch is unreachable code.

**Proposed experience.** Two honest options, and I would take the second:
1. Delete the branch and drop `Session` from the schema and every backup.
2. Ship the producer — see [F-3](features.md#f-3-close-the-estimateactual-loop).

**Why it matters.** A test suite that passes over a feature no user can trigger
is the most expensive kind of dead code: it looks maintained. And `Session` is
serialised into every export, so every backup carries a table that is always `[]`.

**Impact:** Medium · **Effort:** S (delete) / L (build) · **Risks:** Deleting
forecloses F-3, which I think is the app's biggest opportunity — so decide F-3
first and only then delete. · **Priority:** P1

---

## QW-5. `⌘⇧N` — new project

**Problem.** `⌘N` captures a task. There is no keyboard route to creating a
**project**, which is the app's primary noun. `NewGoalModal` opens only from a
mouse click on the Projects header.

**Proposed experience.** `⌘⇧N` opens `NewGoalModal` from any view, switching to
Projects first. Add it to `ShortcutsOverlay`'s global block.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1

---

## QW-6. Give the empty palette something to say

**Problem.** `CommandPalette.tsx:92` — with an empty query the palette returns
exactly the three navigation commands. Opening `⌘K` with no query is the most
common palette interaction in Linear and it currently shows me a menu I could
have reached with `1`, `2`, `3`.

**Proposed experience.** With an empty query, show, in order:
1. **Recent** — the last 3–5 projects/steps opened this session (module-scope
   ring buffer, same reasoning as `Plan.tsx`'s `lastViewedWeek`: ephemeral, not
   data, should not persist).
2. **Resume** — the item currently in progress or next by clock time.
3. The nav commands, demoted to the bottom.

**Why it matters.** The quick-switcher's value is *returning* to context, not
finding it fresh. Obsidian's `⌘O` and Linear's `⌘K` both open on recents.

**MIT use case.** I bounce between the Raft lab and the seed deck twenty times a
day. `⌘K ⏎` should be the whole interaction.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1

---

## QW-7. Palette scoping prefixes

**Problem.** `searchEntries` returns a flat, score-ordered list of up to 12 hits
across four entity kinds. Typing `raft` returns the project and every step inside
it interleaved.

**Proposed experience.** Reserve leading sigils, Linear/Slack style:
`#` projects only · `>` commands only · `@` habits · `!` tasks. Plain text keeps
today's mixed behaviour. The `SearchKind` discriminator already exists on every
entry — this is a filter predicate, not new indexing.

**Impact:** Medium · **Effort:** S · **Risks:** Discoverability; show the legend
in the palette footer. · **Priority:** P2

---

## QW-8. Duplicate a project

**Problem.** No duplicate/template action exists. Every pset in a course has the
same five-step shape and I rebuild it twelve times a semester.

**Proposed experience.** `⋯ → Duplicate` on a board card. Copies the tree with
fresh ids, clears every `done`/`doneAt`, clears all scheduling metadata
(`plannedWeek`/`plannedDay`/`plannedStartMin`), **keeps** `estimateMin` — the
estimates are the reusable part — and appends " (copy)" to the title. Lands in
the same column, opens the drawer with the title selected.

**Why it matters.** This is 80% of [F-14 templates](features.md) for 10% of the
work, and it is the single highest-frequency repeated input in my semester.

**MIT use case.** 18.404 Pset 6 is Pset 5 with different problems.

**Impact:** High · **Effort:** S · **Risks:** Must clear scheduling metadata or
the copy lands on last week's grid. · **Priority:** P1

---

## QW-9. Working hours: "apply to every weekday"

**Problem.** `AvailabilitySettings` edits one `dow` at a time — toggle the day on
(defaulting 09:00–18:00), then edit start, then edit end. Setting a normal
Mon–Fri week is fifteen interactions, and it is the *first* thing a new user must
do: with `availability.length === 0` the Plan view says "every day is off, so
nothing can be scheduled."

**Proposed experience.** Two presets above the day list — `Weekdays 9–6` and
`Every day` — plus a `copy to all weekdays` control on any configured row.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1

---

## QW-10. Redo

**Problem.** `⌘Z` is bound to `undoLastDelete`. `⌘⇧Z` is unbound, so an
accidental undo is unrecoverable.

**Proposed experience.** `⌘⇧Z` re-applies the undone change. Given the existing
sweep semantics — `setAndPersist` drops every non-surgical undo entry when an
ordinary edit lands — the redo entry must be discarded on the same sweep, or it
will restore a slice armed against a superseded dataset. Same invariant that
makes `importBackup` clear the stack.

**Impact:** Low · **Effort:** M · **Risks:** Real. The undo stack's generation
semantics are subtle and this is where a data-loss bug would live. Do it
carefully or not at all. · **Priority:** P2

---

## QW-11. Keyboard route into the board card's `⋯` menu

**Problem.** A focused card supports `Enter` (open), `⌥←/→` (horizon) and
`⌥↑/↓` (rank). Everything else — Duplicate, Delete, Complete, jump to a specific
horizon — lives behind a `⋯` button reachable only by pointer.

**Proposed experience.** Bind `.` (Linear's "open context menu") on a focused
card, and move focus into the menu with roving `role="menuitem"` navigation.

**Impact:** Medium · **Effort:** S · **Risks:** `.` must not fire while a field
has focus — `isEditableTarget()` already handles this. · **Priority:** P2

---

## QW-12. Make the focused backlog row obviously focused

**Problem.** `1`–`7` place the focused rail row on a weekday, and the first-run
hint teaches it. But focus is the *only* thing that arms the keys, and a rail row
is a plain focusable element with default ring styling competing against
`revealed` highlighting and drag affordances.

**Proposed experience.** A distinct armed state on the focused row — accent left
border plus a trailing `1–7` hint chip that appears only while focused. The keys
become self-documenting at the exact moment they work.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1

---

## QW-13. Show the week-navigation keys in the week header

**Problem.** `[`, `]` and `t` work anywhere in Plan regardless of focus and are
genuinely fast. They are documented only in `?`.

**Proposed experience.** Put `[` / `]` kbd hints inside the existing prev/next
buttons in `WeekHeader`, and `t` on the Today control. Zero new behaviour.

**Impact:** Low · **Effort:** S · **Risks:** None. · **Priority:** P2

---

## QW-14. Load the example project from Plan's empty state too

**Problem.** `Load example` (`addSampleProject`) lives only in the **Projects**
empty state. Plan is now the landing view. A brand-new user lands on an empty
grid with an empty rail and a hint telling them to drag from a rail that has
nothing in it.

**Proposed experience.** When there are no goals at all, the Plan rail's
`To plan` section shows the same three-button empty state.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1

---

## QW-15. Click a day heading to plan into that day

**Problem.** `dayLoadLabel` renders `1h 30m / 6h` per day heading. It is inert
text. Placing work still means a drag, or focusing a rail row and pressing a
digit.

**Proposed experience.** Clicking a day heading selects it as the placement
target, so the *next* rail row clicked places there with a single `Enter`.
Effectively a two-handed alternative to remembering which digit Thursday is.

**Impact:** Medium · **Effort:** M · **Risks:** Adds a selection mode; keep it
purely additive to the existing digit path. · **Priority:** P2

---

## QW-16. Name the horizon rule when the rail hides work

**Problem.** `PLANNING_HORIZONS = 2` means the rail draws from *Now* and *Next*
only. This is a good rule, carefully threaded through `backlogGroups`,
`projectAttention` and `cardPrimaryAction`. It is also **completely invisible**:
a *Later* project's steps simply are not there, with nothing on screen to say why
or how to change it.

**Proposed experience.** When ≥1 active project sits beyond the horizon, a single
muted line at the foot of the rail: *"3 projects in Later and Someday aren't
planned from here."* — the count links to Projects. No new rule, just an
explanation of the existing one.

**Why it matters.** A silent filter is indistinguishable from a bug. I lost ten
minutes convinced the rail was broken.

**Impact:** High · **Effort:** S · **Risks:** None. · **Priority:** P0

---

## QW-17. Say what the delete cost

**Problem.** Deleting a project removes its whole tree, milestones, notes and a
week of scheduling. `removeGoal` arms an undo, but the toast names only the
project.

**Proposed experience.** `Deleted "6.5840 — Lab 2: Raft" and its 9 steps`.
`leafCount(g.nodes)` already returns `{total, done}` and is already imported by
the drawer.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1

---

## QW-18. Export as Markdown as well as JSON

**Problem.** Export produces JSON for re-import. It is a backup format, not a
readable artifact.

**Proposed experience.** A second item in the `⋯` menu: **Export as Markdown** —
projects as headings, steps as nested `- [ ]` / `- [x]`, deadlines and estimates
inline. Pure formatting over state already in memory.

**Why it matters.** Obsidian's actual lesson is that your data should be readable
without the app. It also makes a project pasteable into a Slack message, a
cofounder DM, or a Claude prompt.

**Impact:** Medium · **Effort:** S · **Risks:** One-way; do not pretend it
round-trips. · **Priority:** P2

---

## QW-19. "Copy project as prompt" — invert the import

**Problem.** `SubtaskAiModal` copies a prompt out and takes JSON back, and
`docs/import-schema.md` documents the shape. But there is no way to hand an LLM
the *current* state of a project and ask it to re-plan.

**Proposed experience.** `⋯ → Copy as prompt`. Puts on the clipboard: the schema,
the project's current tree with done-state and estimates, its dates, and a short
instruction. I paste that into Claude, say "I have four days left and I'm behind
on 2 and 3 — re-plan", and paste the result back through the existing import.

**Why it matters.** Phase's local-first stance means it will never run a model.
That is correct, and the right move is to make the *clipboard* the integration
surface and make it excellent in both directions.

**MIT use case.** Thursday, the Raft lab is 30% done, due Monday. I want the plan
rewritten around what is actually left.

**Impact:** High · **Effort:** S · **Risks:** Prompt drift versus the schema —
generate the prompt from the same constant the parser validates against.
· **Priority:** P1

---

## QW-20. Show step counts beside the percentage

**Problem.** `goalPct` is an unweighted mean **per branch** (`pct.ts`). A project
with one giant container and one trivial leaf reads 50% when the trivial leaf is
ticked. The number is honest about what it measures and misleading about what I
assume it measures.

**Proposed experience.** Render `42% · 5/12 steps` wherever the percentage
appears. `leafCount` already computes it and the drawer already shows `done/total`
in the Steps header — it just is not next to the number people actually read.

**Why it matters.** It is the cheapest possible mitigation for the structural
issue that [F-2](features.md#f-2-weight-the-roll-up-by-estimate) fixes properly,
and it is useful even after F-2 ships.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1

---

## QW-21. Habits deserve a fast path

**Problem.** Habits sit in a collapsible rail panel. Checking one off means
opening the panel and clicking a dot. There is no shortcut and no palette verb —
`revealInPlan` can *scroll to* a habit but not *check it*.

**Proposed experience.** Palette verb: typing a habit name offers
`Check off "Run 5k" today` as an action row alongside the reveal row. Pairs with
[UX-1](ux-ui.md#ux-1-put-verbs-in-the-palette).

**Impact:** Medium · **Effort:** S (once UX-1 exists) · **Risks:** None.
· **Priority:** P2
