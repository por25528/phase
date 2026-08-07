# UX, UI, Information Architecture & Keyboard

Flows, hierarchy, navigation, keyboard-first use, and responsive behaviour.

The visual identity — Fraunces over Inter, the warm paper/ink palette, both
themes properly built — is an asset and is locked. Nothing here proposes
restyling it. The type scale is already tokenised (18 named steps in
`tailwind.config.js`) and `designScale.test.ts` fails the build on a literal hex
or an arbitrary `text-[Nrem]`, so the "arbitrary rem values" complaint in the old
review is resolved. These are structural ideas, not a repaint.

---

## UX-1. Put verbs in the palette

**Problem.** `⌘K` is a *finder*. `CommandPalette.tsx` sources exactly two things:
fuzzy hits from `searchEntries` (which navigate) and three hardcoded
`NAV_COMMANDS`. Every actual verb in the app — complete a step, schedule
something for today, set an estimate, create a project, check off a habit —
requires navigating to a surface and using a mouse or a surface-specific chord.

**Proposed experience.** One input that both finds and acts. Typing `raft`
surfaces the step, and the selected result exposes actions inline:

```
  Implement AppendEntries              6.5840 — Lab 2: Raft
  ⏎ open   ⌘⏎ plan today   ⌘D done   ⌘E estimate
```

Plus verb-first rows when the query starts with `>`: `> new project`,
`> plan week`, `> export`.

**Why it matters.** This is the actual Linear lesson, and the file's own header
comment claims it — *"One input that both finds and acts (the Linear ⌘K
pattern)"* — while implementing only the finding half. It is also the cheapest
route to keyboard parity for every gap the audit found: no keyboard path to
create a project, complete a project, check a habit, or set an estimate. A
palette verb fixes all four at once without inventing four chords.

**MIT use case.** Mid-lecture, remembering the pset is due: `⌘K` `pset 6`
`⌘⏎` — planned for today without leaving the notes I am typing.

**Impact:** High · **Effort:** M · **Risks:** Action rows must never be
mistakable for navigation rows — a `⌘D` that completes the wrong step is a
data-integrity event, so route every destructive verb through the existing undo.
· **Priority:** P0

---

## UX-2. Answer "what am I doing right now"

**Problem.** Plan is a **week** grid. It is the landing view and the correct home
for planning, but it is the wrong shape for execution. At 14:00 on a Tuesday I do
not want seven columns; I want one answer. The now-line ticks every 60 seconds
and is the only temporal cue on screen. Deleting the old Today view was right —
it was a weaker Todoist — but the *question* it answered went with it.

**Proposed experience.** A single **Now** strip above the grid, not a view: the
current or next block by clock time, its project, its estimate, elapsed time if
running, and one primary control. Collapses to nothing when the day is empty or
outside working hours. Pairs directly with [F-3](features.md#f-3-close-the-estimateactual-loop)
(the `Start` control lives here) and [F-8](features.md#f-8-the-daily-ritual).

**Why it matters.** Phase computes everything needed for this and renders none of
it. Things' "Today" and Sunsama's daily view both work because they collapse a
plan into a single next action. A week grid is a planning instrument; it should
not also have to be the execution instrument.

**Impact:** High · **Effort:** M · **Risks:** Re-creating the deleted Today view
by accident. The discipline: it is a strip, it has one item, and it never becomes
a list. · **Priority:** P1

---

## UX-3. Make capacity the visual anchor of Plan

**Problem.** `capacityParts()` produces the single best sentence in the product —
`24h 6m free · 9h 35m planned · 2h 10m to place · 4 unestimated` — and it is set
in small mono in the week header, visually subordinate to a large mostly-empty
grid. The board's `FocusSummary` chips get far more visual weight for far less
information.

**Proposed experience.** Promote it: larger type, and a state colour driven by
`isOverCommitted` (already computed, already correct — it compares
`plannedMin + backlogMin` against `freeMin`). Over-committed weeks should be
visible from across the room. Make each part a control:
`4 unestimated` → [QW-2](quick-wins.md#qw-2-make-n-unestimated-a-button);
`2h 10m to place` → focuses the rail.

**Why it matters.** This is the product's thesis rendered as a number. Nothing in
my stack computes it. Rendering it as the smallest text on the page is the single
clearest case of hierarchy inverted against value.

**Impact:** High · **Effort:** S · **Risks:** A permanently red header becomes
wallpaper — reserve the strongest treatment for genuine over-commitment, not for
"unestimated". · **Priority:** P0

---

## UX-4. Show capacity during the drag

**Problem.** Dropping onto a full day produces a refusal toast — careful work,
since `scheduleNode` returns a boolean and every caller respects it. But the
refusal arrives *after* the drag. During the drag there is no signal at all, even
though `capacity.days` is already computed per day and already passed into
`WeekGrid` as `dayCapacity`.

**Proposed experience.** On drag start, tint each day column against its remaining
free time versus the dragged item's estimate: comfortable / tight / will not fit.
Unestimated items tint nothing and say so.

**Why it matters.** This is the app's thesis expressed as direct manipulation
rather than as arithmetic reported afterwards. Google Calendar dims conflicts
during the drag for exactly this reason. The data is already in the component.

**Impact:** High · **Effort:** M · **Risks:** `handleDragEnd`'s aim arithmetic is
delicately balanced against `e.over.rect` measured at drag start, and auto-scroll
is deliberately off because of it. Tinting must be purely presentational and must
not touch layout, or it will drift the drop target. · **Priority:** P1

---

## UX-5. Mobile: a day view, not a scrolling week

**Problem.** `WeekGrid` is `min-w-[780px]` inside an `overflow-x-auto`, with
auto-scroll-to-today logic. The comment is honest — *"7 columns cannot be legible
on a phone, so the grid scrolls rather than compress"* — and that is the right
call given a week grid. But at 375px I see roughly two and a half days through a
letterbox, and the 249px rail plus the grid means the two primary surfaces of the
app cannot be on screen together.

Note the board solved this properly: below 920px it becomes a horizon switcher
showing one column at a time. Plan has no equivalent.

**Proposed experience.** Below `md`, Plan renders **one day** with a day
switcher — the same pattern the board already uses for horizons, and the same
pattern every mobile calendar uses. The week grid stays for tablet and up. The
rail becomes a bottom sheet rather than a sibling column.

**Why it matters.** The board proves the team knows the pattern; Plan is now the
landing view and is the one that did not get it. A planner I cannot read on a
phone between classes is a Sunday tool.

**Impact:** High · **Effort:** L · **Risks:** A second layout for `DayBlocks` and
its drag targets. Consider making mobile read-and-complete only, with placement
staying a desktop action — that is a much smaller change and probably the right
product answer anyway. · **Priority:** P1

---

## UX-6. Demote Timeline from a nav peer to a mode

**Problem.** Three top-level destinations: Plan, Projects, Timeline. Timeline is a
Gantt over the same project set that nothing else in the app depends on, and its
only unique control duplicates board filtering. It is a *presentation* of
Projects, not a separate place.

**Proposed experience.** `Projects` gains a `Board / Timeline` toggle. Nav drops
to two items. `1` Plan, `2` Projects.

**Why it matters.** Two destinations makes the product legible in a way three
never will: **Plan is where time lives, Projects is where commitments live.**
That is the whole model, and the nav should say it. It also frees the number keys
and removes a destination most users will visit twice.

**Impact:** Medium · **Effort:** M · **Risks:** Timeline is genuinely useful for
a semester overview ([F-17](features.md#f-17-semester--term-as-a-first-class-span)) —
demoting is not deleting, and the toggle must be as reachable as the tab was.
· **Priority:** P2

---

## UX-7. The rail's four stacked panels compete

**Problem.** `PlanSidebar` holds four accordions in a 249px column: `To plan`,
`Habits`, `Stats`, `Working hours`. Three of them are reference material; one is
the working surface. Their expansion state persists (`sidebarPanels`), so the rail
can easily open with the backlog collapsed below three panels I set up once and
never touch.

**Proposed experience.** `To plan` is not a peer — make it the rail's body,
always present, always first, taking the remaining height. Fold `Stats` into the
week header beside capacity (they are the same kind of fact). Move `Working hours`
behind a settings affordance — it is configured twice a semester. `Habits` stays
as the one genuine second panel.

**Why it matters.** The backlog is where planning happens; it should not be able
to lose a scroll-position fight with a preferences editor.

**Impact:** Medium · **Effort:** M · **Risks:** `Working hours` needs to stay
reachable from the empty-availability banner, which currently expands the panel
in place — keep that path working. · **Priority:** P2

---

## UX-8. Multi-select in the rail

**Problem.** The step tree has a genuinely good selection model: `⇧↑/↓` to extend,
`⌘click` to add, `⌘A` for all, `⌫` to delete the selection, `Space` to complete
it, and bulk actions land as **one undoable write** (`removeNodes`/`completeNodes`),
never a loop. The rail has none of it. Assigning six steps to Thursday is six
drags or six focus-plus-digit sequences.

**Proposed experience.** Port the same selection model to the backlog rail:
`⇧click` / `⇧↑↓` to select a range, then one digit places the whole selection onto
that weekday, or one drag moves it. The store guarantee to preserve is the one
already stated in `CLAUDE.md` — a bulk placement must be one write, not N calls to
`scheduleNode`, because each call arms its own undo entry and each write's sweep
discards the one before it.

**Why it matters.** This is the most repetitive interaction in the app, and the
component pattern already exists one directory away.

**Impact:** High · **Effort:** M · **Risks:** Partial refusal. If four of six fit
and two do not, the write must be all-or-nothing or must report precisely what
landed — `scheduleNode` already returns a boolean and callers already must not
report success on a refusal. · **Priority:** P1

---

## UX-9. `g`-prefix navigation and `j`/`k`

**Problem.** Navigation is bare digits `1`–`3`. Those digits are also Plan's
placement keys, resolved by a capture-phase listener in `Plan.tsx` that
`stopPropagation`s when a rail row is focused. It works, and it is carefully
commented, but it is hidden coupling: the same key means two things depending on
invisible focus state.

**Proposed experience.** Add `g p` / `g r` (Linear/Vim style chords) as unambiguous
aliases, keeping the digits. Add `j`/`k` as aliases for `↓`/`↑` in the tree, the
rail and the palette. All additive; nothing existing changes.

**Why it matters.** Chords do not collide, so they remain correct regardless of
focus — and they are what every keyboard-first user coming from Linear, Gmail or
Vim will try first.

**Impact:** Medium · **Effort:** S · **Risks:** A prefix key needs a timeout and
must not fire in fields; `isEditableTarget()` already exists. · **Priority:** P2

---

## UX-10. Per-project colour or initial

**Problem.** Identity is carried entirely by the title string, and titles are
`<course> — <assignment>`, where the identifying part is at the end. Board cards
now do carry `title={goal.title}` and `line-clamp-3`, so hover recovers the full
text — but a 15-minute grid block cannot show a tooltip usefully, and the rail
groups by project heading only.

**Proposed experience.** A colour derived deterministically from the project id
(no picker, no new field, no decision to make), rendered as a 3px left border on
grid blocks, rail rows and board cards.

**Why it matters.** It makes the week readable as a *shape* — "Tuesday is all
6.5840" — which is a question about balance that no number on the screen answers.

**Impact:** Medium · **Effort:** S · **Risks:** Must survive both themes at
sufficient contrast and must not compete with the accent, which already means
both "primary action" and "now". Derive from a constrained token set, not from
free hue space. · **Priority:** P2

---

## UX-11. Short blocks are unreadable

**Problem.** `EventBlock` floors height at `1.6%` of the grid. Against
`GRID_HEIGHT_PX` that is roughly 11–13px for a 15-minute block, rendering two
stacked lines inside `overflow: hidden` — so the time line is clipped entirely and
the block reads as a hairline. A student's day is full of 15- and 30-minute
commitments.

**Proposed experience.** A hard `min-height` of ~30px, and below ~40px switch to a
single line (`9:00 Standup`) instead of two stacked ones. Suppress the `×` and the
resize grip below that threshold, revealing them on hover — which also frees the
horizontal space the text needs.

**Reference.** Google Calendar enforces a ~22px minimum chip and inlines
`time — title` for sub-30-minute events. This is the universal convention.

**Impact:** Medium · **Effort:** S · **Risks:** Overlapping short blocks must stay
individually clickable; lane packing already exists. · **Priority:** P1

---

## UX-12. Explain the percentage where it is read

**Problem.** `goalPct` is an unweighted mean per branch. Users — including me —
read a percentage as "fraction of the work done". Those differ enormously on a
lopsided tree, and nothing on screen discloses the difference.

**Proposed experience.** Short term, [QW-20](quick-wins.md#qw-20-show-step-counts-beside-the-percentage):
render `42% · 5/12 steps`. After [F-2](features.md#f-2-weight-the-roll-up-by-estimate),
the drawer's pace line states the basis: *"weighted by estimate"* or *"equal
weight — 3 steps unestimated"*.

**Why it matters.** Phase's whole claim is that its numbers do not lie. A number
that is technically defensible but predictably misread is a lie by omission, and
this is the app's most-read number.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1

---

## UX-13. First run lands on an empty grid

**Problem.** Plan is now the landing view. A brand-new user sees: an empty week
grid, a banner saying every day is off so nothing can be scheduled, a first-run
hint telling them to drag from `To plan`, and a `To plan` section with nothing in
it. The genuinely good onboarding — the empty state that teaches what a project is
and offers `Load example` — is one view away on Projects, which they have no
reason to visit.

**Proposed experience.** When `goals.length === 0`, Plan's centre column shows the
first-run sequence directly: (1) set working hours — the one-click presets from
[QW-9](quick-wins.md#qw-9-working-hours-apply-to-every-weekday); (2) add or load a
project, inline; (3) *then* the drag hint, which now has something to drag.
Ordered by dependency, because the current hints are shown in an order that cannot
be followed.

**Why it matters.** The current first run instructs the user to do something
impossible, twice.

**Impact:** High · **Effort:** M · **Risks:** Do not duplicate the Projects empty
state — reuse the component. · **Priority:** P1

---

## UX-14. A past week should say what happened

**Problem.** Past weeks are correctly read-only (`isPast` disables droppables, and
the keyboard path now refuses with *"That week has already happened"* rather than a
misleading capacity refusal). `weekCapacity` also correctly reports what a past day
*held* via `NO_PAST_LIMIT` rather than claiming zero free. But the view is
otherwise identical to a future week: a plan, not a record.

**Proposed experience.** On a past week, blocks render by outcome — completed
solid, untouched outlined — and the header switches from `24h free · 9h planned`
to `9h planned · 6h completed`. With [F-3](features.md#f-3-close-the-estimateactual-loop)
it also carries actuals.

**Why it matters.** The week grid is the only place in the app that could show me
the shape of a week I actually lived. Right now looking backward shows me my
intentions, which is the least useful thing to learn from.

**Impact:** Medium · **Effort:** M · **Risks:** None material. · **Priority:** P2

---

## UX-15. The accent carries too many meanings

**Problem.** `warn` and `warn-tint` are now distinct tokens from `accent`, which
resolves the worst of the old overload. But `accent` still simultaneously means
primary action (buttons), progress fill, the now-line, milestone markers, and
"revealed by search". On a busy Plan view the eye cannot tell which accent marks
are actionable.

**Proposed experience.** Reserve solid `accent` strictly for *action and now*.
Move progress fill and milestone markers to `accent-soft`/`accent-tint`, which
already exist as tokens.

**Impact:** Low · **Effort:** S · **Risks:** Touches the locked visual identity —
this is a token-swap proposal, and it needs the designer's eye, not a mechanical
find-and-replace. · **Priority:** P2

---

## UX-16. Focus mode

**Problem.** Nothing in the app supports *doing* the work, only deciding it. When
I start a two-hour block I still have four columns, a rail and a nav on screen.

**Proposed experience.** From a block or the Now strip, a focus view: one step,
its notes ([F-10](features.md#f-10-notes-and-links-on-a-step)), a running timer
([F-3](features.md#f-3-close-the-estimateactual-loop)), and `Done` / `Pause`.
Escape returns.

**Impact:** Medium · **Effort:** M · **Risks:** Adjacent to Pomodoro-app scope
creep. No configurable intervals, no sounds, no gamification. · **Priority:** P3

---

## UX-17. Selection state should survive less

**Problem.** Tree selection is computed over `visibleRowIds`, so a collapsed
subtree removes rows from the selection basis, and a stale range anchor resolves
to `[]` silently. Combined with bulk delete on `⌫`, the failure mode is a keystroke
that does nothing — or, on a different collapse state, does more than expected.

**Proposed experience.** Clear the selection on any structural change (collapse,
expand, indent, outdent, project switch), and render the count persistently while
a selection exists rather than only in the action bar.

**Impact:** Medium · **Effort:** S · **Risks:** Clearing too eagerly makes
multi-select annoying; scope to structural changes only. · **Priority:** P2

---

## UX-18. Distinguish the nav focus ring from the selected tab

**Problem.** The selected tab is a filled pill (`bg-ink text-paper`); the
focus-visible treatment on an unselected tab is also a pill outline. After
clicking one tab and keyboard-focusing another, two tabs read as current.

**Proposed experience.** Move focus indication to an offset outline ring rather
than a filled or bordered pill, so selection and focus are different visual
channels.

**Impact:** Low · **Effort:** S · **Risks:** None. · **Priority:** P2

---

## UX-19. The drawer is a centred modal called a drawer

**Problem.** `GoalDrawer` is `fixed inset-0 grid place-items-center` with
`max-w-[960px]` — a centred dialog. It hand-rolls its own focus trap, scroll lock
and focus restore, duplicating `Modal.tsx`, which does all of this correctly and
additionally registers with `modalRegistry` so stacked dialogs do not fight over
Escape. The drawer does not register, which is why `App.tsx` has to special-case
`close-drawer` ahead of the modal check.

**Proposed experience.** Either rename it (it is the project *window*, not a
drawer) or make it an actual right-side drawer so the board stays visible behind
it — which is the more useful behaviour, since I open a project to check one thing
and want the board's context. Either way, build it on `Modal`.

**Why it matters.** Two focus-trap implementations is two places for a11y bugs to
diverge, and one of them is already known to have needed fixing.

**Impact:** Medium · **Effort:** M · **Risks:** The focus/scroll/reveal
interaction is subtle (there is a deliberate 70ms delay before the node highlight
so expansion settles). Regressions here are invisible until a keyboard user hits
them. · **Priority:** P2

---

## UX-20. Say why a rail row is where it is

**Problem.** `sortByDue` reorders the rail by due date, but **only within
`DUE_CHIP_DAYS`** — deliberately, so that anything jumping the queue also displays
a chip explaining itself. That invariant is well-reasoned and correct. But the
*grouping* above it is unexplained: projects appear in board order, each capped at
three items, with no indication that a cap is in effect or that more work exists
below it.

**Proposed experience.** Where a group is capped, show `+4 more` as a control that
expands it — the reveal path already force-expands a capped group when the palette
sends you to a hidden row, so the expansion state exists.

**Why it matters.** Same principle the due chip already establishes: anything the
rail hides or reorders has to say why.

**Impact:** Medium · **Effort:** S · **Risks:** None. · **Priority:** P1
