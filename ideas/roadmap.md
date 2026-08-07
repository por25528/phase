# Roadmap & Synthesis

The opinionated part. Everything below references ideas by ID from the other five
documents.

---

## The biggest weakness

> **Phase asks you to plan in minutes, then makes minutes nearly impossible to
> supply and completely impossible to correct.**

Everything that differentiates this product — `weekCapacity`, `isOverCommitted`,
`dayLoadLabel`, the `free / planned / to place` header, every over-commitment
verdict — is computed from two inputs: **how much time you have** and **how long
things take**. Phase's handling of both is starved, and each gap is verifiable in
the source:

| Input | State today | Consequence |
|---|---|---|
| **How long things take** (`estimateMin`) | `EstimateField` is imported in exactly one file. The rail shows only *Now/Next* projects and only *unplaced* work. `GoalTree` contains the string "estimate" zero times. | Most work in the app can never be given an estimate at all. |
| **Correcting an estimate** | Only by dragging a resize handle on a placed block — and `resizeNode` refuses outright on collision. | Estimates cannot be revised where they were made. |
| **Knowing they were wrong** | `Session` is specified, persisted, exported — and has **no producer**. `RecapPanel.tsx:26` renders "You logged N minutes across M sessions" behind a gate that can never open. | Estimates never improve. The app ships a visible feature that is unreachable code. |
| **How much time you have** (`BusyBlock`) | Fully threaded through `visibleRange`, `weekCapacity`, `freeIntervals`, `resolveSlot`, `clampResize`. **Every call site passes `[]`.** | For a student with fourteen hours of class a week, the headline free-time figure is wrong by roughly a third. |
| **Which numbers are fictional** | `capacityParts` honestly emits `4 unestimated` — and it is inert text with no way to find what it counts. | The app flags its own uncertainty and then refuses to help resolve it. |

This is not a polish problem and it is not an architecture problem. The
architecture is genuinely excellent: one write path, pure derivations, enforced
invariants, a `PLANNING_HORIZONS` constant threading one rule through three
surfaces, honest failure states, undo-instead-of-confirm. **The engine is
correct. It is running on fumes.**

The corollary is that the highest-leverage work available is unusually cheap.
[QW-1](quick-wins.md#qw-1-let-me-set-an-estimate-where-i-write-the-step) and
[QW-2](quick-wins.md#qw-2-make-n-unestimated-a-button) are hours of work each and
they address two of the five rows above.

**Runner-up weakness:** the app is excellent at *deciding* and weak at *doing*.
There is no "what am I working on right now", no way to start something, and no
record of what happened. Deleting the old Today view was correct — it was a weaker
Todoist — but the question it answered left with it ([UX-2](ux-ui.md#ux-2-answer-what-am-i-doing-right-now)).

---

## Top 10 ideas

Ranked by value to me as a user, not by cost.

| # | Idea | Why it is here |
|---|---|---|
| 1 | **[F-3](features.md#f-3-close-the-estimateactual-loop) — Close the estimate/actual loop** | The one change that turns a planner that guesses into one that learns. Fixes the biggest weakness at its root and makes an already-shipped recap line true. |
| 2 | **[F-12](features.md#f-12-ship-the-read-only-calendar-pull) — Ship the calendar pull** | Already designed and decided; the consumer side is built and tested. Until it lands, the headline number is the least accurate number on screen. |
| 3 | **[F-1](features.md#f-1-numeric--target-leaves) — Numeric / target leaves** | Makes an entire half of a user's life first-class, and does it by making the roll-up *more* honest, not less. |
| 4 | **[QW-1](quick-wins.md#qw-1-let-me-set-an-estimate-where-i-write-the-step) — Estimates in the drawer** | Hours of work. Unblocks the entire capacity engine for the majority of work that can currently never be estimated. |
| 5 | **[ST-1](student-workflows.md#st-1-import-a-syllabus-once-get-a-semester) — Syllabus import** | Turns the worst forty minutes of the product into four, using a parser and store path that already exist. |
| 6 | **[F-2](features.md#f-2-weight-the-roll-up-by-estimate) — Weight the roll-up by estimate** | Weighted progress for *zero* new user input, by reusing a field the app already demands. |
| 7 | **[UX-1](ux-ui.md#ux-1-put-verbs-in-the-palette) — Verbs in the palette** | One change that closes four separate keyboard gaps. The file already claims this pattern in its own header comment. |
| 8 | **[F-7](features.md#f-7-auto-place-fill-my-week) — Auto-place the week** | Where the app's arithmetic stops being judgement and becomes leverage. |
| 9 | **[F-6](features.md#f-6-reach-get-phase-onto-my-phone-without-breaking-local-first) tier 1 — `.ics` feed** | A day of work turns a desk tool into one I can consult anywhere, with zero architectural compromise. |
| 10 | **[F-5](features.md#f-5-blocked--waiting-on) — Blocked / waiting-on** | Protects the credibility of the pace deficit, which is the app's best asset. |

---

## Top 10 quality-of-life improvements

Small, cheap, and each removes a specific daily irritation.

| # | Idea | Effort |
|---|---|---|
| 1 | [QW-1](quick-wins.md#qw-1-let-me-set-an-estimate-where-i-write-the-step) — estimate field on every leaf row in the drawer | S |
| 2 | [QW-2](quick-wins.md#qw-2-make-n-unestimated-a-button) — make `N unestimated` a button that walks the list | S |
| 3 | [QW-16](quick-wins.md#qw-16-name-the-horizon-rule-when-the-rail-hides-work) — explain why the rail hides *Later*/*Someday* work | S |
| 4 | [QW-8](quick-wins.md#qw-8-duplicate-a-project) — duplicate a project, keeping estimates | S |
| 5 | [QW-9](quick-wins.md#qw-9-working-hours-apply-to-every-weekday) — working-hours presets | S |
| 6 | [QW-3](quick-wins.md#qw-3-parse-90m-out-of-the-step-title-as-i-type-it) — parse `~90m` from the step title | S |
| 7 | [QW-6](quick-wins.md#qw-6-give-the-empty-palette-something-to-say) — recents in the empty palette | S |
| 8 | [QW-20](quick-wins.md#qw-20-show-step-counts-beside-the-percentage) — `42% · 5/12 steps` | S |
| 9 | [QW-14](quick-wins.md#qw-14-load-the-example-project-from-plans-empty-state-too) — example project reachable from Plan | S |
| 10 | [QW-17](quick-wins.md#qw-17-say-what-the-delete-cost) — name the cost in the delete toast | S |

Honourable mentions: [QW-12](quick-wins.md#qw-12-make-the-focused-backlog-row-obviously-focused)
(armed-row affordance), [QW-19](quick-wins.md#qw-19-copy-project-as-prompt--invert-the-import)
(copy as prompt), [UX-11](ux-ui.md#ux-11-short-blocks-are-unreadable) (30px minimum block).

---

## Top 5 UX redesigns

Structural, not cosmetic. The visual identity stays exactly as it is.

1. **[UX-3](ux-ui.md#ux-3-make-capacity-the-visual-anchor-of-plan) — Capacity becomes the anchor of Plan.**
   The product's thesis is currently the smallest text on its landing view. Promote
   it, colour it by `isOverCommitted`, and make every part of it a control.
2. **[UX-2](ux-ui.md#ux-2-answer-what-am-i-doing-right-now) — A Now strip.**
   Restore the question the deleted Today view answered, as one line rather than a
   view. The home for `Start`, elapsed time, and the daily ritual.
3. **[UX-5](ux-ui.md#ux-5-mobile-a-day-view-not-a-scrolling-week) — A day view on mobile.**
   The board already folds four columns into a horizon switcher below 920px. Plan
   is the landing view and never got the equivalent; a 780px grid letterboxed at
   375px is not a plan I can read.
4. **[UX-6](ux-ui.md#ux-6-demote-timeline-from-a-nav-peer-to-a-mode) — Two destinations, not three.**
   Timeline becomes a mode inside Projects. Then the nav says the model out loud:
   **Plan is where time lives, Projects is where commitments live.**
5. **[UX-7](ux-ui.md#ux-7-the-rail-s-four-stacked-panels-compete) — The rail stops being four equal accordions.**
   `To plan` is the working surface and should not lose a scroll fight with a
   preferences editor that gets touched twice a semester.

---

## Top 5 ambitious bets

Bigger, riskier, and each could define the product's next year.

1. **[F-3](features.md#f-3-close-the-estimateactual-loop) — The learning planner.**
   Log actuals, compare to estimates, calibrate per project
   ([ST-8](student-workflows.md#st-8-estimates-should-calibrate-per-kind-of-work-not-globally)).
   *"Your 18.404 estimates run 2.4× short"* is a sentence no tool in my stack can
   say, and it is downstream of data Phase is one action away from collecting.
   **This is the bet I would make.**
2. **[F-7](features.md#f-7-auto-place-fill-my-week) + [F-9](features.md#f-9-backward-planning-from-a-deadline) — The week that plans itself and refuses honestly.**
   Propose a full week as ghost blocks; work backward from a deadline; and when it
   does not fit, say so a week early. Automation whose headline output is a
   *refusal* is a genuinely novel position.
3. **[F-1](features.md#f-1-numeric--target-leaves) — One honest place for a company and a degree.**
   Numeric leaves plus [SU-2](startup-workflows.md#su-2-the-pace-engine-goes-silent-on-open-ended-work)'s
   velocity-instead-of-pace for deadline-free work. No incumbent holds both halves
   of my life without one of them becoming decoration.
4. **[F-6](features.md#f-6-reach-get-phase-onto-my-phone-without-breaking-local-first) — Reach without sync.**
   `.ics` out, append-only capture in, single writer preserved. Proving local-first
   can be *ambient* without becoming a SaaS is a real product position, not a
   compromise.
5. **[F-16](features.md#f-16-an-agent-bridge-mcp) — The agent bridge.**
   Phase's guarded single-write-path store is unusually well-shaped for model
   access: the invariants hold whether the caller is a button or a model. *"Here
   are my next two weeks — what do I drop?"* is a question it can already compute
   and cannot be asked.

---

## Recommended implementation order

Sequenced by dependency and by value per unit of risk. Each stage is independently
shippable and leaves the product better than it found it.

### Stage 0 — Feed the engine *(days)*

Nothing here is architectural; all of it addresses the biggest weakness directly.

`QW-1` estimates in the drawer → `QW-2` unestimated click-through →
`UX-3` promote capacity → `QW-16` explain the horizon filter →
`QW-14` example from Plan → `QW-9` working-hours presets →
`QW-20` step counts → `QW-17` delete cost.

> **Why first:** every later stage is more valuable with real estimates in the
> data. Auto-placement, weighted progress and calibration are all worthless
> against a corpus where most work is unestimated. This stage is also the
> cheapest, so it de-risks everything after it.

### Stage 1 — Tell the truth about time *(2–3 weeks)*

`F-12` read-only calendar pull → `F-6` tier 1 `.ics` export.

> **Why here:** free time is the other half of the capacity equation and it is
> currently wrong by a third for the target user. Do it before anything that
> *acts* on capacity, or auto-placement will confidently schedule work into a
> lecture. The `hasData` → enum refactor flagged in `capacityLabel.ts` belongs in
> this change, not after it.

### Stage 2 — Make progress honest for everyone *(2–3 weeks)*

`F-1` numeric leaves → `F-2` estimate-weighted roll-up → `UX-1` palette verbs.

> **Why here:** F-2 depends on Stage 0's estimates existing. F-1 and F-2 both
> touch `pct.ts`, which is load-bearing for pace, the board, Timeline and the
> recap — do them together, extend `pct.test.ts` first, and ship the explanation
> of why percentages moved. `UX-1` rides along as the keyboard payoff.

### Stage 3 — Close the loop *(3–4 weeks)*

`F-3` layers 1 and 2 (produce `Session`s; show est vs actual) → `F-8` the daily
ritual → `UX-2` the Now strip.

> **Why here:** these three are one feature wearing three hats. The Now strip is
> where `Start` lives; the daily ritual is where actuals get captured; F-3 is what
> both produce. Hold F-3 layer 3 (calibrated capacity) until there is real data —
> an inflated number nobody asked for is exactly the invented authority
> `capacityParts` refuses to produce.

### Stage 4 — Remove the drudgery *(3–4 weeks)*

`UX-8` multi-select in the rail → `F-7` auto-place → `F-9` backward planning →
`F-5` blocked/waiting-on → `F-4` recurring work → `ST-1` syllabus import.

> **Why here:** every one of these depends on estimates (Stage 0), accurate free
> time (Stage 1), or both. `UX-8` first because it is the cheapest and it makes
> `F-7` feel like an accelerator rather than a replacement for manual control.

### Stage 5 — Bets *(open-ended)*

`F-6` tier 2 capture · `F-16` MCP bridge · `SU-2` velocity for deadline-free work ·
`F-11` merge import (needs `updatedAt` first) · `F-14` trash · `UX-5` mobile day view.

> **Why last:** each is genuinely large, none blocks anything above it, and all of
> them are better decisions with a semester of real usage data behind them.

---

### Two things to decide before Stage 0

1. **`Session`: build it or delete it.** Stage 3 assumes build. If the answer is
   delete, do it in Stage 0 — including the unreachable `RecapPanel` branch and
   the always-empty table in every export. What is not acceptable is leaving a
   tested, shipped, permanently-dead feature in place.
2. **Write down the refusals.** [F's anti-features list](features.md#features-i-argue-against),
   [SU-5](startup-workflows.md#su-5-two-lives-one-board--without-a-second-hierarchy)
   (no areas/lanes), [SU-6](startup-workflows.md#su-6-do-not-build-a-crm) (no CRM),
   and [ST-11](student-workflows.md#st-11-finals-week-keep-the-cap-change-the-rail)
   (never relax the *Now* cap) are the decisions that keep this product from
   becoming a worse Notion. They belong in `docs/decisions/`, next to the
   busy-blocks memo — which is exactly the right precedent for how this project
   already handles a well-argued "no".
