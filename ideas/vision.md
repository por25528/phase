# Phase — Vision

> **Smaller goals. More progress. Plan less. Finish more.**

**Date:** 2026-08-11
**Build inspected:** `touch-motion-next` @ `129ece6`
**Status:** decided in conversation, nothing implemented. This document is what
we agreed, why, and what it costs.

This supersedes the reach/mobile parts of [`features.md`](features.md) F-6 and
the nav proposal in [`ux-ui.md`](ux-ui.md) UX-6. It does not supersede
[`roadmap.md`](roadmap.md)'s diagnosis, which it agrees with and builds on.

---

## The one-paragraph version

Phase tells the truth about a week before the week happens. That is pillar one
and it is unchanged. What is new is pillar two: **Phase remembers what happened,
so it can stop asking you.** Everything expensive in this document — history,
sync, the pre-filled estimate — exists to make the app demand less of you over
time, because the tagline is *Plan less*, and the app as built is the most
planning-heavy tool in its category. The nearest work is small and needs none of
that architecture: **a person has more than one life, and Phase currently makes
them choose between a degree and a company for a column slot.**

---

## Positioning

Minimal in **surface**, not in power. Notion's actual trick — everything
summoned, nothing displayed — applied to a planner. The craft half of this is
already done and already enforced: `designScale.test.ts` fails the build on a
literal hex, on an arbitrary `text-[Nrem]`, and on a fontSize key colliding with
a colour key; `font-disp` appears exactly once. The invariants
*"everything below daily frequency on a row lives in one `⋯`"* and *"a property
states a fact and hides its editor"* are Notion's disclosure principle, already
written down.

What is not done is minimalism. Today: **5 nav-level views, 36 view components,
69 lib modules**, a rail of four stacked panels, and a first launch that demands
working hours, a goal, a decomposition, an estimate per leaf, a horizon, a week
commitment and a placement before it will say anything useful.

---

## The two pillars

**1 · Commitment honesty.** Unchanged and protected. Scarcity, pace deficit,
capacity-aware weeks, `PLANNING_HORIZONS` threading one rule through three
surfaces.

**2 · Phase remembers what happened.** Phase records what you *promised*
(`estimateMin`, `WorkBlock`) and what you *finished* (`status`, `doneAt`), and
nothing about what occurred. One missing noun costs three separate things:

| Symptom | Cause |
|---|---|
| Undo is 5 seconds (`UNDO_MS`, `store.ts:614`) with an elaborate sweep to keep the toast honest | there is no log to rewind |
| Calibration is only as good as manual entry, and manual entry stops in week three | no automatic producer |
| Sync is impossible | `persist` (`db/db.ts:101`) is `clear()` + `bulkPut()` of four tables — a snapshot model with no per-entity change identity |

History is not nostalgia. It is the mechanism by which the app earns the right
to ask less: once it knows your real durations, an estimate is pre-filled from
**your own arithmetic**.

---

## The decisions

### D-1 · One product, many surfaces

Not a suite, not a platform. Phase reaches you on desk and phone.

### D-2 · Full-peer sync, and an honest merge

Every device holds the whole truth. This deletes `persist`'s snapshot model, the
`tabLock` single-writer guarantee, and the README's *"nothing is sent to a
server."*

**When two devices merge into an impossible week, both blocks land and the week
reads over-committed.** No conflict dialog, no lost placement, no new
vocabulary. `isOverCommitted` already exists — over-commitment is a *supported,
honestly-reported state* in Phase, not an error. Routing merges into a verdict
the app already renders is why sync needs no conflict UI.

Exclusivity of time is a domain invariant, not a data-structure property. No
CRDT solves this; the product does.

### D-3 · Full-peer *sync* ≠ full-peer *UI*

**Desk decides. Phone answers.** Desk owns planning: decomposition, placement,
capacity, the week. Phone owns the moments away from it: capture, complete, and
the evening confirmation. The phone never grows a week grid.

### D-4 · Actuals come from confirming the plan

Not a timer, not inference. Phase asks using your own commitment as the prior —
*"planned 90m on the pset — yes / longer / didn't happen."*

A forgotten timer does not produce missing data, it produces a **14-hour
session**, which poisons the exact dataset calibration reads. Inference makes
Phase a surveillance tool. Confirmation costs one tap because the default is
usually right, and it gives the phone a job no other surface can do better.

### D-5 · Two moments, not five places

Phase has a weekly **planning flow** and a **doing surface**. The nav stops
being spatial and becomes temporal.

`Today.tsx`'s own docstring is already the spec for the doing surface:

> *Four zones, in this order, and nothing else: the one thing in front of you,
> the rest of the day, what to do with the time still free, and at most three
> exceptions. … a surface that answers one question stops answering it the
> moment it also answers nine others.*

The one surface already exists. Four other views stand beside it as nav peers,
which is that same docstring's rule violated one level up.

**The flow is a flow, not a room.** It has steps and it ends, because *Plan
less* needs a terminator and a workspace never tells you you are finished.

**Precedent, and the reason this is not a relapse:** `PlanReview.reviewed` is
scar tissue from a weekly ritual you already shipped and tore down.
`RecapPanel`'s docstring: *"The old planner made this a gate you passed through
before you could plan. It is a panel now."* What was deleted was a **toll
booth** — last week's review standing between you and this week's work. What
this describes is a **room with a door**. That distinction only holds while the
flow is optional, and it is: skip it and `todayPlan` still offers work against
your free time, so an unplanned week degrades to *"here's what I'd suggest"*
rather than an empty screen.

### D-6 · The flow will not end silently

The flow's climax is **refusal**. It closes one of two ways:

1. a week that fits, or
2. you naming what you are knowingly over-committing to.

Phase stores that admission and grades it at recap. *"You knowingly
over-committed three weeks running"* is a sentence no tool in the stack can say,
and it is pillar two paying for itself.

Every abandoned competitor lets you commit 40 hours to a 24-hour week and shows
a red number. That is a disclaimer, not honesty.

### D-7 · Two lives, one week

**The problem, in the user's words:** *"Sometimes I have a startup life and
university life… right now the app forces me to choose only a few when there is
more than 3 task for me to go through."*

Coursework and a startup do not compete for *attention* — they compete for
**hours**. A 3-slot cap makes you choose between a degree and a company at the
level of a column, which is not a choice anyone can make.

- **Boards split; the week never does.** Deliberation separates. One planning
  flow, one Today, one capacity, one over-commitment verdict.
- **Budget the week across lives before planning inside either.** *"15h
  coursework, 9h startup."* One trade, made once, at the right altitude —
  instead of task-by-task at 11pm on a Sunday. Giving one life more visibly
  costs the other, which is the trade you are already making invisibly.
- **The remainder is real.** The week splits into life + life + what's left. It
  never sums to 100%, and loose tasks, errands and slack live in the leftover.
- **Scoping exists only inside the planning flow** — one pass per life. There is
  **no global board switcher**, so the collision is unavoidable by construction
  and there is no mode to be lost in.

### D-8 · The Now cap becomes hours, not slots

`ideas/README.md` names the 3-slot cap as differentiator #1. **The principle
survives; the mechanism changes.** Now holds what its life's hours hold — five
small goals or two big ones.

Three was always a proxy for a constraint the app can now measure. It is also
the honest answer to D-7: more than three is fine *if it fits*.

**The debt:** three is a rule you can *feel*; "what fits" is a rule you have to
*read*. The board must make the budget as physically obvious as three columns
were. That bill comes due in the UI, not the schema.

### D-9 · Day one asks for almost nothing

A goal, and what you'll do today. Working hours, estimates, horizons and
placement all start **absent** and arrive as offers once history can source
them. The power stays; it arrives on Phase's initiative, never as a form.

A minimalist app that demands eight inputs on day one has no day thirty. This is
what makes both taglines true at once, and it is the hardest thing here to
build.

### D-10 · Goals are capped at three levels

Goal → steps → subtasks. Depth is where planning hides from finishing, and an
infinitely decomposable tree makes decomposition *feel* like progress while
producing none.

Consequences: `looksOversized` (`lib/proposal.ts`) needs a depth floor — a
subtask cannot be broken into sub-subtasks — and `addChild` / `indentNode` gain
a refusal.

### D-11 · Now / Next / Parked

Nothing in the codebase keys on column 3. The only behavioural thresholds are
`column === 0` and `column < PLANNING_HORIZONS` (2). **Later and Someday are two
labels with identical behaviour** — both invisible to the rail, both silenced in
`projectAttention`, both refused a "Plan next task" action.

So Someday is a feeling, not a horizon. Two live columns and one drawer makes
the board show the boundary `PLANNING_HORIZONS` already enforces — and with
lives multiplying columns, four was never going to survive.

Parked keeps its real job: it is the alternative to deleting, and deleting an
ambition feels like admitting failure.

### D-12 · A model transcribes; it never judges

Unstructured input in, Phase's structures out — a syllabus, a photo of a
whiteboard, a meeting's follow-ups. It never estimates, prioritises or places.

Two reasons. Once pillar two exists, *"your 18.404 estimates run 2.4× short"* is
**arithmetic over your own data**, so a model's prior is strictly worse than the
thing it would replace. And a guessed estimate is a confident fiction in the one
input the entire capacity engine runs on — precisely what `capacityParts`
already refuses to invent when it reports `4 unestimated`.

Today `src` contains **zero network calls**; `proposal.ts`'s comment shows the
LLM has always been the user's, outside the app.

### D-13 · Sharing is outbound only

**Nobody can put work into your Phase.** You publish evidence out of it: a
read-only week, a commitment to a date, the cost of a yes.

Phase becomes the only tool in the stack that lets you **decline with
arithmetic** — not *"I'm swamped"* but *"my week holds 24h, 22h are committed,
here's what I'd have to drop."* Sharing flows outward from capacity rather than
inward into it. An inbox is how a tool stops being yours.

### D-14 · Timeline is summoned, not cut

Reversed mid-conversation, and the reversal was right. **Timeline is the only
thing in Phase that shows goals against each other in calendar time** —
`focusOverlap`, `checkpointDates`, `hasGoalSpan`. `goalHealth` gives a verdict
per goal and can never say two deadlines land on the same Thursday. You cannot
run a weekly planning moment well without seeing past the week.

It was never a destination; it is an **instrument of the planning moment**.

**Kept whole rather than simplified** — do not delete a working, tested
subsystem before the planning flow reveals what is actually used. Two costs
booked: it rides along on every future migration (1,325 lines, plus
`lib/timeline.ts` and `lib/roadmap.ts`), and a year-wide ruler over three-week
goals renders as whitespace, which *reads* as "you have nothing going on." A
chart can be dishonest just by having the wrong scale.

### D-15 · A week is a record, and the budget lives in it

`PlanReview` is week-keyed but holds exactly one row by design — it is a
transient prompt, cleared at rollover. Budget history needs many rows, kept
forever, so it is a **new slice**, not an extension of that one.

```
WeekRecord {
  week: string;          // Monday, 'YYYY-MM-DD'
  capacityMin: number;   // what the week HELD when you planned it
  shares: { lifeId: string; minutes: number }[];
  overcommit?: {
    minutes: number;
    items: { title: string; goalId?: string }[];
    note?: string;
  };
}
```

Three decisions inside that shape:

- **`capacityMin` is stored, not derived.** The remainder is
  `capacityMin − sum(shares)`. If it were computed live, editing your working
  hours in November would silently rewrite what you budgeted in September.
  History that changes retroactively is not history.
- **The remainder has no row.** Only named lives get a share; what is left is
  arithmetic. A `lifeId: null` row would make the leftover look like a
  commitment, and it is the opposite — it is the space that stayed uncommitted.
- **`overcommit.items` stores titles**, exactly as `PlanReviewEntry` stores
  `leafTitle`/`goalTitle`, and for the same reason: *the intention was really
  stated*, so deleting the work afterwards must not erase the admission.

`PlanReview` is left alone. It works, it has a different lifecycle, and folding
it in to satisfy tidiness would put a transient `reviewed` flag inside permanent
history. It is a candidate to be absorbed when the event log lands, not before.

**This record is the first real piece of pillar two.** It is the only place
Phase will store what you *intended*, as opposed to what you promised or
finished — which is exactly what recap needs in order to grade you.

### D-16 · The budget is a line, not a bar

D-8 traded a rule you can feel for a rule you have to read. This is the
repayment.

On the board, a life's Now column stacks its goals in order, **each card's
height proportional to its remaining minutes**, and a **horizontal line is drawn
at that life's budgeted hours**. Work above the line fits the week. Work below it
does not.

A progress bar was the obvious alternative and it is wrong: a bar is a readout,
which is a number wearing a costume. A line through the stack is *physical* — it
names the specific goal that crosses it, and you fix it by dragging something
below the line or by making that goal smaller. That is "Smaller goals. More
progress." delivered at the moment of decision rather than as a slogan. It also
restores precisely what three columns gave you: a constraint you see without
reading.

Two honest costs, both with existing answers:

- **An unestimated goal has no height.** The `N unestimated` problem becomes
  visible instead of inert, which is what [QW-2](quick-wins.md) wanted anyway. It
  renders at the minimum height and is marked as unpriced. Not with
  `border-dashed` — that is reserved for the drop preview and the guessed-hour
  calendar block, and spending it here is how the drop signal stops meaning
  anything.
- **Wildly different goal sizes make short cards unreadable.** Same problem
  [UX-11](ux-ui.md) already found on the calendar, so it takes the same answer: a
  minimum card height, and the proportionality is honest above it.

  **This cost was underestimated, and it is what sank the first build.** A
  calendar block can be 20px and still say what it is; a board card carries a
  title, an effort figure, a next step and a schedule state, and needs ~240px to
  do it. A minimum tall enough for the card is tall enough to flatten the whole
  stack. See open question 3 — a compact card is now a precondition of D-16, not
  a refinement of it.

**Unassigned goals get a group too**, after the named lives, and its line is the
remainder. One rule holds across the whole board: every group has a budget line,
and the leftover is a group like any other. This also matches how the rail
already treats work that belongs to no project.

### D-17 · The phone is a PWA, and it ships after sync — never before

One codebase. The phone's job is three actions (capture, complete, confirm); a
second codebase in Swift, a developer account, App Store review and a release
cadence owned by Apple is an absurd price for three actions and an audience of
five.

The stated objection to a local-first PWA is that **iOS evicts IndexedDB after
~7 days idle**, and *"the app that ate your semester"* is unrecoverable. That
objection is real, and it is an argument against a PWA **without sync** — not
against a PWA. Once every device holds the whole truth (D-2), the phone is a
*cache*: eviction costs a re-download, not a semester.

So this is a sequencing constraint, not a technology preference. **No phone
before sync.** Shipping a capture-only phone first — F-6 tier 2 — would put the
only copy of a thought inside the browser most likely to delete it.

One consequence worth naming early: if the evening confirmation (D-4) is ever to
*nudge* rather than wait to be opened, that needs Web Push, which needs a push
service. That is a second argument for a relay over a file-based sync transport
(D-19), and it is the kind of requirement that is cheap to design for and
expensive to retrofit.

### D-18 · Transcription is bring-your-own-key

The user's model, the user's account, the user's bill. Zero recurring cost, zero
rate limiting, zero abuse surface, and no liability for someone else's syllabus.
On-device models are not good enough at document and image transcription to be
worth the size; a relay is a monthly bill and a support obligation for an
audience of five.

It also fits the shape of the work: transcription fires **rarely** — a syllabus
at the start of a semester — so a per-call cost the user already pays is
strictly better than a subscription that idles.

BYOK is a bad first experience for strangers, and that is fine: strangers are
later, and a hosted option can be added *beside* BYOK without removing it. The
reverse — starting with a relay — is a recurring bill you cannot put down.

**One invariant this creates:** the key is device-local and lives in settings,
never in `AppState`, and is **excluded from backup export**. Same reasoning that
already keeps `CalendarCache` out of the backup — a `phase-goals-*.json` the
user might share must not carry a credential. This is also Phase's first-ever
outbound network call, so the boundary should be one module, the way
`src/db/assets.ts` is the only module that touches the assets table.

### D-19 · Publishing outward is an image, not a link

D-13's artifact is **evidence at a moment**: *"my week holds 24h, 22h are
committed, here's what I'd have to drop."* That is a snapshot by nature.

So it renders **locally, as an image**, with the same content offered as text to
paste. No host, no account, no link to revoke, nothing that leaks more than what
is in the frame, and it works in every channel a cofounder or a professor
actually uses. It is also where a locked visual identity pays a dividend.

A hosted URL was the alternative and it fails on its own terms: it reopens the
server question D-2 answers only for sync, and a permanent link to your week is
a live feed of your capacity — which is uncomfortably close to the inbound
sharing D-13 refuses.

**This retires [F-6](features.md) tier 1.** The `.ics` export was a way to get
your own week onto your own phone; sync (D-2) does that properly, and the two
were never the same feature.

---

## The domain model

```
Life { id, title, order, defaultShareMin? }   // 5th slice in AppState, max 3
Goal.lifeId?: string                          // absent ⇒ unassigned, a real state
WeekRecord { week, capacityMin, shares[], overcommit? }   // 6th slice, see D-15
```

- **Max three lives, user-named.** A cap because scarcity is how this product
  thinks, and four lives is not a life, it is a tag system.
- **Two new slices in `AppState`**, not settings: lives are named user content
  and week records are stated intentions, so both must survive export, import
  and undo. Costs two tables in `persist`'s `clear()` + `bulkPut()`, two keys in
  the backup schema, one migration. Both are tiny — three lives and ~52 week
  records a year — so the churn against `goals` is negligible, and `persist` is
  slated for replacement by the event log regardless.
- **`Task`, `Habit` and `Session` gain nothing.** They already carry `goalId` —
  the established *"tag FOR CONTEXT ONLY"* pattern — and inherit a life through
  it. A loose task has no goal, therefore no life, and spends the remainder.
  This preserves the invariant that **capture and commitment are different
  acts**: quick add already refuses to demand a date, so it must not demand a
  life.
- **`Goal.type` stays exactly where it is, inert.** It is a template for what an
  empty workspace offers, not an organising dimension. Welding them would mean a
  study-shaped goal could never sit on the startup board.
- **The budget is a standing default, nudged per week.** `Life.defaultShareMin`
  is the standing number; `WeekRecord.shares` is what you actually chose that
  week (D-15). The common case is confirming, not choosing. Recap joins the
  record against sessions to say *"you budgeted 15h to MIT and spent 6."* Once
  history is deep enough, the default becomes what you actually spent — the
  first concrete instance of D-9.
- **Migration is a no-op.** Every existing goal stays unassigned; nothing breaks
  on first launch.

---

## What this breaks

Nine things in `CLAUDE.md` stop being true:

| Invariant | Fate |
|---|---|
| `persist` = full `clear()` + `bulkPut()` of four tables | replaced by an event log |
| 5-second undo, the sweep, `armedSurgical`, `pendingUndo` | become a history scrub |
| `tabLock` single-writer; *"a tab that does not own the lock never writes"* | deleted by sync |
| README's *"nothing is sent to a server"* | deleted by sync |
| Arbitrary tree depth | capped at three (`addChild`, `indentNode`, `looksOversized`) |
| Five nav-level views | one doing surface, one planning flow, everything else summoned |
| Board and rail as destinations | summoned surfaces |
| Four commitment horizons | Now / Next / Parked |
| The 3-slot Now cap | replaced by the life's hour budget |

`PLANNING_HORIZONS` itself survives and keeps its job.

---

## Sequencing

**First: lives, the budget, and the planning flow.**

Chosen over the confirmation ritual for one reason: it is the only thing here
that removes a pain that exists **today**, in the user's own words, rather than
testing a bet. It needs no history, no sync, and no rewrite of the write path.

**Then: the evening confirmation, desktop-only, on the store as it stands.**

**And the caution that goes with deferring it:** the riskiest assumption in this
entire document is that you will answer *"how did today go?"* for three weeks
running. Pre-filled estimates, calibration, the recap that grades your
over-commitment, the phone's whole reason to exist — all of it is downstream of
a habit nobody has confirmed forms. It is testable in a weekend against
`Session` and `actuals.ts` as they already exist. **If it does not stick, pillar
two is a wish and a third of this document has to be rewritten.** Do not let it
slide indefinitely.

Sync, the event log, the phone and transcription sit behind a lot of refinement
and are deliberately not next. When they do come, one ordering is fixed:
**event log → sync → phone** (D-17). Transcription is independent of all three
and can land whenever it is wanted.

---

## Open questions

Every question this document opened has been answered. Three things remain
genuinely unknown, and none of them are answerable by deciding harder.

1. **The sync transport — a file, or a relay.** Deliberately last, and that is
   the entire argument for building the event log first: the change
   representation is the expensive, irreversible decision, and the transport is
   a swap on top of it. When it comes, the answer is probably a relay, because
   D-17's push requirement and "strangers later" both rule out a file in
   iCloud — but nothing needs to be committed until the log exists.
2. **Whether the ritual sticks.** The behavioural bet under pillar two. Not a
   design question; a three-week experiment.
3. ~~**Whether D-16 works when rendered.**~~ **ANSWERED 2026-08-12 — it does
   not, as specified.** Built as slice 2a and driven in a browser against
   exactly the predicted case: one 10h goal and four 20m goals in one life.

   The line itself is vindicated. Placement is exact — it lands inside the goal
   that crosses the budget, to the pixel — and heights are honestly proportional
   above the floor. What fails is everything around it.

   **Proportional height is incompatible with the current card.** `BoardCard`
   needs 197–238px to render its title, effort, next step and schedule state.
   Every card on the board clipped, including the tallest at 132px. For nothing
   to clip the floor would have to be ~240px — at which point a goal needs 15h
   before proportionality engages, almost every card sits at the floor, the
   stack is uniform, and the line becomes decorative. **The floor that makes
   small cards readable is the floor that makes the idea meaningless.** That is
   structural, not a tuning error.

   **Splitting Now inside the four-column grid does not fit** either: each life
   got 93px of a 307px cell while three empty horizons kept 307px each.

   So D-16 survives only with a **compact card** for budgeted columns — title
   and one figure, nothing else — or a geometry where Now claims width in
   proportion to what it holds. Both are real design decisions and want their
   own spec; neither should be improvised on top of a failed layout.

   The bet cost exactly what this entry predicted: one layout, no schema. The
   arithmetic survives it — see
   `docs/superpowers/specs/2026-08-11-lives-budget-line-design.md`.

---

## Still refused

Everything [`README.md`](README.md) already refuses — tags, P1–P4 priority,
sub-projects, arbitrary databases — plus, from this session:

- **A model that estimates, prioritises or places.** (D-12)
- **Inbound sharing in any form**, including "it arrives as a request you can
  decline." An inbox with good manners is still an inbox. (D-13)
- **Per-life capacity.** You get one week and your lives share it. Any design
  that gives each life its own hours is lying. (D-7)
- **A global board switcher.** A switcher is a device for not seeing the
  collision, and the collision is the point. (D-7)
- **Inferring work from calendars, activity or location.** (D-4)
