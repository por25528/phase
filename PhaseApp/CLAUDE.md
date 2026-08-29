# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Phase is a local-first goal/habit/task planner — React 19 + TypeScript + Vite + Tailwind, persisted to IndexedDB via Dexie, packaged as a native macOS app via Electron.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — typecheck (`tsc -b`) then `vite build`
- `npm test` — run the Vitest suite (`vitest run --config vitest.config.ts`)
- `npm run app:dev` — Electron shell against the Vite dev server (hot-reload)
- `npm run build:mac` — production build, then `electron-builder --mac` (.dmg)
- `npm run verify:mac` — assert what that build actually produced

## Packaging

The `mac` config is NOT a static block in `package.json`. `electron-builder.cjs`
calls `scripts/releaseConfig.cjs`, which is a pure function of the environment,
and one variable decides everything: `PHASE_RELEASE_SIGNING` unset gives the
ad-hoc developer build, `=1` gives the Developer ID release the workflow
publishes. Both harden the runtime and sign against `build/entitlements.mac.plist`
so an entitlement mistake breaks a laptop build rather than a user's launch.

The reason it is a function and not a config file: electron-builder only WARNS
("skipped macOS notarization") when a credential is missing and then produces a
DMG Gatekeeper rejects everywhere. `buildConfig` therefore throws on a
half-configured release, `scripts/check-release-credentials.cjs` runs that check
as the workflow's first release step, and `scripts/verify-macos-artifacts.sh`
proves the signature, the runtime flag, the entitlements, the staple and the
`spctl` verdict before anything is published. `scripts/releaseConfig.test.ts` and
`scripts/releasePackaging.test.ts` cover the rules and the workflow; both run
under `npm test`. Credentials live only in GitHub Actions secrets — see
`../docs/macos-signing.md`.

## Layers

- `src/db/types.ts` — all domain types: `Goal`, `GoalNode`, `Habit`, `Task`, `Session` and `WorkBlock`. A leaf's completion is `GoalNode.status?: StepStatus` (`'todo' | 'doing' | 'blocked' | 'done'`), LEAVES ONLY, where the old `done?: boolean` used to live. Absent means `'todo'`, and `'todo'` is never written. `blockedOn?: string` is present only while `status === 'blocked'` and is cleared on any other transition.
- `src/db/db.ts` — Dexie persistence for app state and settings.
- `src/db/assets.ts` — the only module that touches the `assets` table.
- `src/lib/*` — pure, side-effect-free helpers; new logic here ships with a sibling `*.test.ts`. `src/lib/doneFold.ts` is the single vocabulary for which finished rows the goal tree folds away. `src/lib/status.ts` is the single vocabulary for a leaf's `status` — `stepStatus`, `isDone`, `containerStatus`, `cycleStatus`, `applyStatus`, `STATUS_WORD` — readers go through it and never touch the field directly. `src/lib/effort.ts` is the goal header's one answer — remaining minutes. It had a second, `health.ts`, and that went with working hours: every `Health` verdict compared remaining work against the free hours before a deadline, so with nothing pricing free hours the verdict had no arithmetic left to make. The project header and Overview state effort, a deadline and a MEASURED rate (`describeVelocity`); they forecast nothing.
- `src/state/store.ts` — the single global store (`useSyncExternalStore`). All mutations go through `actions`, which call `setAndPersist`. Views never call `db` directly.
- `src/views/<View>.tsx` orchestrates a top-level view; its components live in a per-view subfolder (`plan/`, `timeline/`, `goals/`, `project/`, `today/`).
- `src/lib/commands.ts` describes the command palette's verbs — ids, labels and the words people actually type — and nothing else. The handlers live in `App.tsx` because they need the store; keeping them apart is what lets the matching be tested without mounting anything.
- `src/components/` — shared visual primitives.
- `electron/main.cjs` — desktop shell (BrowserWindow, dev-server/dist URL switch).

## Invariants

- The `goals` array is kept column-major (all column-0 goals in order, then column-1, …). `normalizeByColumn` (called from `addGoals`) and the column-ordered rebuild in `setGoalBoard` — both in `store.ts` — are what maintain it; other mutations preserve existing order.
- Node `start`/`deadline`/`plannedWeek`/`blocks`/`estimateMin` are scheduling metadata and never affect the pct roll-up in `src/lib/pct.ts`. A checkpoint is deliberately not metadata: it is a real node and counts in the roll-up, unlike the `Milestone` object it replaced. It is spelled **Milestone** in the UI and `checkpoint` in storage, and the remaster's proposal to make milestones non-counting is deliberately NOT followed — that is the dead-marker problem the object was retired for. `effort.ts` is where both things stay true at once: a checkpoint counts in `total`/`done` and contributes nothing to `remainingMin`, and never lands in `unestimated`.
- **A step's `status` never moves the roll-up; it moves attention.** `pct.ts` counts `'done'` and nothing else, so `'doing'` and `'blocked'` weigh exactly what an unticked box always did — ticking the checkbox remains the only thing that moves a number. What `status` changes instead is the queue: `firstOpenLeaf` (and `nextOpenAction`, which must not disagree with it) prefers a `'doing'` leaf, skips `'blocked'`, and can return `null` when open work exists but all of it is blocked; `cardPrimaryAction` answers `'unblock'` for a fully-blocked project, but only after the `PLANNING_HORIZONS` gate below, so a parked project stays quiet either way; `focusSummary` carries `blocked` as a fifth signal; and `backlogGroups` drops a blocked leaf from the rail unless it carries a `plannedWeek` — the same committed-work exception a parked project already gets, for the same reason. `weekCapacity` is untouched: blocked-but-scheduled work is still booked time, guaranteed structurally because `PlannedLeaf` has no `status` field — status is dropped at that projection boundary. A container carries no stored status of its own — `containerStatus` derives one for display, and its `blocked` reading is strict: EVERY open descendant must be blocked. `migrateNodeStatus` runs on load and on import and reads the raw legacy `done` off stored JSON — that is deliberate, not something to "clean up". **`'parked'` is the fifth status and it is "not now", never "waiting".** It moves attention exactly as `blocked` does — `firstOpenLeaf`/`nextOpenAction` skip it, `backlogGroups` drops it unless it carries a `plannedWeek`, `containerStatus` reads it only when EVERY open leaf is parked (checked after the blocked rule; a mix reads `'todo'`) — and it carries no `blockedOn`. `executionAdvisor` drops blocked AND parked work even when committed, on both its candidate path and its free-time offer path: the advisor answers "now", and the rail keeps that row only so the figure `weekCapacity` bills has a row beside it. Everything that COUNTS blocked work (`blockedLeafCount`, `isFullyBlocked`, `hiddenProjectCounts.blocked`, the focus chip) stays blocked-only: parked is not a problem to surface, which is the point of it. `cycleStatus` does not visit it; `actions.toggleParked` — one store action, like `toggleCheckpoint` — is what `P`, the row menu's Park/Unpark and the task page's menu all call. The Board tab's Parked column reaches the same state through `setNodeStatus` instead and arms nothing, because a dragged card is direct manipulation. The toast ALSO fires from `P`, the row menu and the task page, because the action cannot see its caller and a spurious way back is cheaper than a missing one. The rail's row has a Park button for steps only (a loose `Task` has no status), and the board draws it as its own column. **That button is a TOGGLE and it ARMS AN UNDO, where `setNodeStatus` does not.** It calls `actions.toggleParked`, which does its own `withUndo` write (`Parked "X"` / `Unparked "X"`, slice `goals`) rather than delegating — parking from the rail makes the row vanish from the only surface it was on, which is the distance-write rule restated: a write you cannot see the result of needs a way back. `setNodeStatus`'s own callers are the tree row and the task page, where the step you changed is still in front of you, so it stays silent — and the agent's `set_status` inherits that silence. The rail keeps the row for a parked step carrying a `plannedWeek`, which is what `BacklogItem.parked` is for: the flag turns the button's name into `Unpark`, because that row is the only route back. **A box must LOOK parked**: `STATUS_BOX.parked` is `border-check`, the same border as `todo`, and the fact is carried by a short `bg-muted` BAR inside it — `border-faint` was the untouched box one shade quieter, which is the one state that must read as a decision reading as the absence of one. `StatusMark` and the rail button draw the same bar. **`hiddenProjectCounts` has a third count, `setAside`**: a Now/Next project every one of whose open leaves is parked with nothing committed — so `backlogGroups` returns no group for it and the rail's empty state would otherwise read "Nothing left to plan" over work only put down. It is STRICT where `blocked` is loose, because it is the count that claims the rail is empty BECAUSE of that project; `parked` still names a project deferred to Later/Someday, and the three are independent counts of different rules. The KNOWN COST is that `cardPrimaryAction` still answers `'plan'` for such a project (`isFullyBlocked` is blocked-only by design — parked is not a problem to surface), so the palette offers "Plan next task" on a goal with nothing plannable and the press only switches view. Fixing it would mean a fourth verdict, or teaching `isFullyBlocked` about parked and breaking every blocked-only count that reads it; neither is worth it for a button that lands you on the tree where the parked rows are. The rail's first shown row per group is the HEAD and is drawn as a card (`data-backlog-head`) — the most urgent row is the grab handle — and its background is one precedence chain with `revealed`, because two `bg-*` utilities are settled by stylesheet order, not class order.
- Deletes (and other destructive edits) are undo-aware: the action snapshots the affected slice and calls `scheduleUndo`, giving a 5-second undo window (`store.ts`). Any edit that discards user data to hold an invariant — `indentNode` clearing the new parent's completion and slot, `addChild` converting a scheduled leaf into a container — must be undoable too.
- **The Undo toast never outlives its restore.** `setAndPersist`'s sweep drops every non-surgical entry when an ordinary edit lands, and clears `pendingUndo` in the same write (`armedSurgical`). A visible Undo button that does nothing is worse than no button.
- **An import is a generation boundary.** `importBackup` clears `undoStack`/`pendingUndo`: a whole-slice restore armed against the previous dataset would otherwise overwrite the imported one and persist it.
- Backup export/import is disabled until `hydration === 'ready'` (`App.tsx`). A Web Lock (`src/lib/tabLock.ts`) rejects a second tab — Phase assumes a single writer. **A tab that does not own the lock never writes at all**: `persist` is gated in `setAndPersist`, every settings write goes through `ifOwner`, and `importBackup` refuses outright. A single write is a full clear + bulkPut of all four tables, so one from a stale tab rewrites the whole database.
- **`assets` lives outside `AppState` and outside `persist()`.** A single write is a full clear + bulkPut of all four tables, so image bytes in a goal row would be rewritten on every checkbox tick. Asset writes are surgical, go through `ifOwner`, and are append-only — an orphaned blob is inert, and deleting one eagerly would let undo restore a note pointing at nothing, exactly as `Session.nodeId` is allowed to dangle.
- **Note autosave is held while `pendingUndo` is live.** `setAndPersist`'s sweep is correct and must not be exempted; instead a *timer* never spends the undo, while an explicit departure — blur, navigation, unmount — always saves, because losing typing is worse than losing an unused undo.
- A failed write latches `persistFailed` until a later write succeeds, and `App.tsx` renders it as a banner. In-memory state advances regardless, so Export stays available as the recovery path.
- **`ORDINARY_DAY` is an AIM. There is no fence, and there is no denominator.** Working hours are gone — the `AvailabilityWindow` model, the Settings section, the hatch on the week grid, and every figure priced against them. What is left is one frozen constant in `lib/slot.ts`, 08:00–20:00, never drawn, never configurable, and spent by exactly one class of caller: the paths where the APP chooses the hour (`proposeReplan`, `replanNode`, `migrateSlots`, `todayPlan`'s day scan). Without it those would search `WHOLE_DAY` from minute 0 and book 4am, which is not a recovery. Every MANUAL placement still passes `WHOLE_DAY`: a drag, a drop, a drawn block, `1`-`7`, `ScheduleMenu`, `TaskPage`'s add-a-sitting. So a block goes where it is aimed, at any minute of any day, and every column of the week grid is the same ground from top to bottom — `DayColumn` has now lost three readings of the same idea in turn, a `bg-hover/60` wash that read as disabled chrome, then a `.hatch` marking, and finally nothing, because there is no fact left for either to state. COLLISION handling is untouched and always was: `freeIntervals` still subtracts calendar events and placed sittings, `resolveSlot` still slides to the nearest gap that fits, `assignLanes`/`busyLayout` still lay overlaps out side by side, and `clampResize` still caps a drag at the next block. `describeNoRoom` keeps all three callers and means one thing — the day is booked solid. **`NO_PAST_LIMIT` survives the removal**, and it is worth saying why: it reads like part of the free-minutes tense rule, and it was, but it is also the clock every manual placement passes — a drag onto this morning is how you record what actually happened, and resizing a block that started an hour ago is an ADJUSTMENT rather than a new booking. `MIN_VISIBLE_START`/`END` in `grid.ts` are `ORDINARY_DAY` restated and deliberately not imported from it: that constant is where a placement AIMS and this is where a scroller STARTS. They agree today and nothing says they must.
- **Two numbers that get compared have to be ONE derivation.** The bar this rule was written for is gone: `capacityMeter` spanned `max(freeMin, plannedMin + backlogMin)` and delegated its `over` flag to `isOverCommitted`, so a bar reading full could never sit above text reading healthy — and with no free time there is no denominator, so a bar would be a decoration that is always exactly full. `CapacityMeter.tsx` is `LoadRule.tsx` now and draws the labelled cells alone. The RULE outlived it, and its current instance is `longestFreeGap` (`lib/slot.ts`): Today's offer, which names a day with room on it, and the week grid's `fits`/`full` chip, which answers whether a dragged bar will land, spend the same function — so a heading cannot read `fits` above a column that then refuses the drop. It reports a RUN and never a SUM, which is the second half of the same discipline: three separate half-hours are not an hour of room, and a figure that added them up would promise a sitting `resolveSlot` cannot place. The two callers pass different REGIONS on purpose — the offer measures `ORDINARY_DAY` because its button places automatically, the drag chip measures `WHOLE_DAY` because a manual drop lands where it is aimed.
- **The Plan header is an instrument.** Three bands, not four and not one baseline row: a STAMP (`Week 34` inverted against `17 – 23 Aug 2026`, in `stampLabel`) carrying the week number and the year the heading below cannot; the RANGE at the `mast` step in the UI face; and the figures as labelled cells on a rule (`weekLoadCells` — `Planned` is the one `head`, `To place` `quiet` beside it, `Unestimated` last on the reading edge with its affordance). The fourth band was a seven-cell GAUGE, `capacityMeter` applied per day, and it went with the free minutes it was drawn against. `weekLoadParts` is a one-line map over `weekLoadCells`, so `12h planned` and the `Planned / 12h` cell cannot drift. `head` is spent EXACTLY ONCE — two headlines is no headline — and it falls to `To place` on a week whose whole commitment is unplaced, because a readout with no head at all is this shape's hierarchy undone. An untouched week returns `[]` and the header draws its stamp and range alone; the render is guarded on the CELLS rather than on the capacity object, so a week with nothing planned and four unpriced tasks still shows its one figure. Month mode keeps `spanLabel` beside the figures, before the spacer, because the reading edge belongs to the exception.
- **A month's figures are the WEEK ROWS DRAWN, summed.** `views/plan/monthCapacity.ts` calls `weekCapacity` once per row of `monthGrid(ym)` and adds the results. `capacity.ts` is untouched: this is a projection for one surface, not a new fact about time, which is why it lives in the view folder beside `capacityLabel.ts`. It does not compute "a month" because a week straddling 31 July and 2 August has no principled owner for its `plannedWeek` commitments, and whichever month you award them to, the OTHER month's figure stops matching the rows on its own screen. Summing the drawn rows makes the gutter sum to the header BY CONSTRUCTION rather than by a test keeping two computations in step. The cost is that the total does not cover the month named in the heading, which is the entire job of `spanLabel` — printed beside the figures so a six-week total can never be read as August's. There was a second rule here — spend `weekLoadParts`, never `loadParts`, because a past day's `freeMin` counted its whole window and printed `270h free` for hours that were mostly gone, making a past month read as entirely free. Both functions state COMMITMENTS now and neither can lie about tense, so the distinction went with the figure.
- In the backlog rail, a due date only reorders a row if `dueChip` will also show it (`DUE_CHIP_DAYS`). Anything that jumps the queue has to say why.
- **`PLANNING_HORIZONS` (2) is the one Now/Next boundary.** `projectAttention` silences active-work verdicts above it, `backlogGroups` keeps a parked project's untouched work out of the rail, and `cardPrimaryAction` — which the command palette spends, not the board card — withholds "Plan next task" — all from that one constant, so a project cannot be quiet on the board and loud in the rail. Commitment is the exception: a parked project's step carrying a `plannedWeek`, or task carrying a `date`, stays listed, because `weekCapacity` bills it to "to place" and `countOpenCarryOver` offers to move it — a number you plan against must have a row beside it. An uncommitted one is DROPPED, never demoted to "Loose tasks": that bucket means "belongs to no project", and it sits at the bottom of the rail, which is more prominent than where the row started, not less.
- **Today's free-time offer spends `backlogGroups` and nothing else.** `todayPlan` takes the FIRST item of each group, orders by `sortByDue` and caps at `PROPOSAL_MAX` (5) — one choice per project, never a project's queue, or it is a second backlog rail on a page that is not the backlog. Every membership rule it appears to have (the `PLANNING_HORIZONS` gate, the parked-project commitment exception, blocked work, loose tasks) is inherited, so the offer cannot disagree with the rail about what is worth doing. A day HAS ROOM when `longestFreeGap` finds an unbooked run of at least `MIN_SITTING_MIN` (30) inside `ORDINARY_DAY` — the region the offer's own button places into, so the sentence and the placement cannot name different days, and a fifteen-minute crack between two meetings is not somewhere to start a project task. `placedOn` is a FUNCTION rather than a precomputed map, because the scan stops at the first day with room, which is almost always today. `no-hours` was a distinct verdict here, never a zero — "nobody said when you work" and "you are out of time" are different sentences — and it is deleted with the state it named; the surviving instance of that idea is `beyondFocus` in `focusLens.ts`. Placement is `scheduleNode`/`scheduleTask` unchanged — they resolve the slot and toast `describeNoRoom` themselves, so there is no second way to say "no room" and nothing optimistic to roll back — but the AIM is now `aimFor`, not `0`: a bare zero only ever landed sensibly because the window fenced the search.
- **Today shows the slipped work it names, and names it once.** A carry-over is a COMMITMENT whose day or week has passed (`task.date < today`, `plannedWeek < currentWeek`, both in `buildDailyWork`) — a different population from `slippedWork`, which walks `blocksOf` for past SITTINGS, which is why the Replan strip can count nothing on a day the page says something slipped. `carryOverRows` orders oldest-first and caps at `MAX_CARRY_OVER` (5) with a `+N more` line that is STATIC TEXT, never a link: sending it to Plan is the dead end the section was built to retire, and that was the whole complaint about the `attentionItems` carry-over row it replaced — that row is GONE, not demoted, because a count in the exceptions region beside the rows themselves is the same fact stated twice and its click had nowhere to go but Plan. The row's verb is `place()` — the same function the free-time offer rows spend — because `ScheduleMenu` already spends the word "Today" to mean *place a block today*, and one word cannot mean two things on one page. That reuse is also why there is no new store action: no `blockId` means a distance booking, so `scheduleTask`/`scheduleNode` vacate the stale sitting and arm the undo unaided, and on a day booked solid the verb refuses via `describeNoRoom` exactly as the offer row above it does — a fallback that committed without placing would put two behaviours behind one label. That refusal used to read "at 19:00 with the window shut"; the window shuts nothing now, so the only thing that can turn the verb away is a day with no gap left in it.
- **Today ends with what you finished, and that section is a record — never
  filler.** `completedToday` was computed by `buildDailyWork` on every render
  and discarded except for its `.length`, so the page's whole acknowledgement
  of a finished day was one grey sentence below the whitespace: a surface whose
  reward for use is a blanker screen. It renders LAST, because work that is
  done cannot outrank work that is not, and only when something was actually
  finished — so it adds nothing to the sparse page, which the one-gesture spec
  correctly diagnosed as an empty database rather than a layout fault. It takes
  NO cap where `Carried over` takes `MAX_CARRY_OVER`, because that section's
  input is unbounded backlog and this one's is one day of one person's work.
  It makes no chronological claim: `doneAt` is a `'YYYY-MM-DD'` date with no
  time in it, and ordering the list by when things finished would need a
  completion timestamp written on every tick of every leaf and task, to
  decorate one list. What a row states instead is what the work COST —
  `loggedForItemOn`, which is `loggedForNode`/`loggedForTask` scoped to a date
  and inheriting their `nodeId`-takes-precedence rule — and it states nothing
  when nothing was logged, because `0m` reports a measurement nobody took.
  Un-ticking needs no undo and gets none: `toggleTask` and `toggleLeaf` each
  already branch on `wasDone` and take a plain `setAndPersist` when
  un-completing, so the section is a new READER of existing behaviour and
  changes no store action.
- **Today's exclude set IS the advisor's `seen` set.** `executionAdvisor` pushes commitments AND carry-overs into `seen` before handing it to `todayPlan`, so `Today.tsx`'s `shown` must cover both — it was commitments only, which was invisible while carry-overs had no rows and became a duplicate the moment they got some: the free-time offer re-listed the row the Carried over section was already showing, and both spell the button `Plan “X” today` (the offer's `dayLabel` resolves to "today"), so the page rendered two buttons with one accessible name. The exclusion runs the other way too — `carryOverRows` takes an optional third `exclude: ReadonlySet<string>` and `Today.tsx` passes the primary's key, because a carry-over is a candidate the advisor may LEAD with and Now is already drawing that row; it is dropped in the same pass as a finished one, BEFORE the cap, so an excluded row is never counted as withheld in `+N more`. One rule stated from both ends: a key is drawn once per page, and a page that excludes LESS than the advisor it is required to agree with re-lists work another section is already showing. `src/views/Today.carryOver.test.tsx` pins it.
- **Today is a FRAME, and the margin is material.** The page is a three-track grid (`1fr minmax(0,720px) 1fr`): the reading column is bounded left and right by a hairline, and everything outside it — plus the tail below the last row — is filled with `.hatch`, a 45° gradient over a themed `--hatch` var declared beside `--scrim` for the same reason (dark needs a different HUE as well as a different alpha; a warm-ink stripe over `#141311` is invisible). It is a GRADIENT and never `border-dashed`, which is the drop-target signal. What this buys is the empty state: a short day, and a brand-new database, now read as ruled paper with room left on it rather than as a page that ran out — the old surface pinned a 720px column top-left of an unbounded field with ~60% of the frame unclaimed and nothing to say where the page ended. The tail is `flex-1`, so it needs a height to grow into: `App.tsx` gives Today's wrapper the main region's remaining height (`flex-1 min-h-0 flex flex-col`, with `main` made a flex column) and NO page padding, for this one view — padding outside the frame would be a band of nothing around a drawn object. At a narrow viewport the `1fr` gutters collapse to zero and the column takes the width; nothing overflows.
- **The rule IS the section heading.** `RuleHeader` (`components/RuleHeader.tsx` — it began view-scoped in `views/today/` and moved once the goal tree became its third consumer) puts the label in a tinted cell at the LEFT END of the divider, the way a legend sits on a technical drawing, with the section's one fact in a cell on the far end. It replaced `SectionHeader`, whose label floated ABOVE the rule — right when the alternative was four labels floating in nothing, and still two objects marking one boundary on a page whose whole argument is that it is a measured object. `SectionHeader` had no other caller and is deleted, not deprecated. The tag is FLUSH with the frame's border and the rows are inset past it — the reverse of the old rule, which insetted the label to sit over the checkbox and bled the rule full width; both readings are coherent, and this one follows from the frame, where a tag inset from a rule that terminates on a real border reads as a cell someone forgot to push home. `right` is still a FACT and never a control. **`rightClassName` is a KNOWN
  SEAM, not a feature.** `RuleHeader` was written twice on parallel branches —
  once for Today and the tree, once for the board — and the two agreed on every
  part of the chrome except the fact cell's tone: `text-meta text-muted` on one,
  `font-mono text-micro` (turning warn when Now is over `NOW_WIP_LIMIT`) on the
  other. The merge preserved both rather than restyling a shipped surface inside
  a merge commit, which is why a caller can currently pass a tone at all. Picking
  ONE tone and deleting the prop is the follow-up; until then, do not read the
  override as licence to style the chrome per surface — everything else about
  the cells is deliberately not configurable. Two props were added FOR the tree and default to Today's shape, so no caller moved: `lead` puts controls inside the tag cell (the tree's drag handle and twirl), and `as` swaps the `<h2>` for a `<span>` where the rule is already a `role="treeitem"` and a nested heading would announce a level for every container in the tree. What is deliberately NOT configurable is the chrome — the cells, their borders, the tint, the side the fact sits on — because that is the part a caller must not be able to reinvent per surface.
- **The row numbers name a queue you have COMMITTED to.** `TaskRow`'s `index` prop is per-caller and never automatic, because a rank is the strongest claim a list can make — it says these rows are one ordered sequence. `Next` and `Rest of today` share ONE sequence (`rest` is literally the committed list with the primary removed, so restarting it would print `01` twice for one queue); `Carried over` restarts, because slipped commitments are a population `buildDailyWork` keeps disjoint on purpose. The free-time offer and `Done today` pass `index={null}`, which RESERVES the column and prints nothing: withholding the number is the claim — an offer is work nobody has agreed to, and `Done today` makes no chronological claim at all — while withholding the column would just pull their titles 20px left of the rows above and below. The approved mockup numbered `01`, `02` straight across `Next` and `Free time`, and that was overruled for exactly this: one sequence spanning both asserts they are one queue, when the separate offer projection exists to say they are not. `Today.freeTime.test.tsx` pins all three rules.
- **The day gauge is gone.** `lib/dayGauge.ts` and `views/today/DayGauge.tsx` turned the working window, the day's sittings and the clock into geometry — a hull, `open` spans, clipped `blocks`, ticks and a now-marker — and both went with the window, because with no window there is no hull, and a flat empty bar would answer "you are out of time" to someone who was never asked when they work. Recorded here so the next reader does not go looking for the module. What it taught survives two bullets up: any number printed beside a drawing has to be the same derivation as the drawing.
- **A row's action is `rowBtn`, and 31px is why.** `primaryBtn` is 33px, sized for a dialog footer; filling a row with one would break the row rhythm and reverse the decision that made the section label the emphasis and put Now on the same axis as every other row. Three spend it: `Start session`, the Replan strip's button, and the carry-over row's `Today` — that last one also `.quiet-control`, because it is a control on a row rather than the reason the row is there. `expectedTimeLabel` stays BESIDE it rather than moving into the subtitle: it returns whole phrases (`Usually 45–60m`), and there is no honest one-number form of a range.
- **"Planned" means on the calendar** — the item has at least one `WorkBlock`, the predicate `scheduledOn`/`backlogGroups` partition on via `isPlaced`. Work that is merely committed is `backlogMin` ("to place"), reported separately, because a `⌘N` capture that sets `@friday` sets a date and never a start minute: folding the two made the capacity readout contradict the rail beside it. `isOverCommitted` compared the two against free time, and it went with the free time; the SPLIT survives, because it is what the rail partitions on and what the header states as two cells. Quick add sets NO date unless the line asked for one — capture and commitment are different acts, and `Task.date` has always been optional.
- Bulk edits are ONE undoable write (`removeNodes`/`completeNodes`/`setNodesStatus`/`applyReplan`), never a loop over the single-node action — each call arms its own undo entry and each write's sweep discards the ones before it. They return whether they wrote; callers must not report success on a refusal.
- `withUndoSlices` is the multi-slice form of `withUndo`; `withUndo` is now a one-key wrapper over it. Only reach for it where an edit GENUINELY spans tables — `applyReplan` moves goal tasks and loose tasks in the same breath, and undoing half would leave a week that is neither the old one nor the new one. It does not make cascading deletes safe on its own: `Session.nodeId` is still allowed to dangle deliberately.
- **`finishWork` is the second genuine multi-slice edit, and the half-undo is why.** It ends the WORK where `completeFocus` ends only the SITTING, so a tick that lands mid-session writes the completion (`goals` or `tasks`) AND the logged `Session` at once. Composing it from the two existing actions is the trap: `toggleLeaf` arms `Completed "X"` and `logSession` arms `Logged 12m on "X"`, and the second write's sweep discards the first's entry — the toast would then offer `Completed "X"` and restore `goals` alone, un-ticking the task while KEEPING its minutes. So it is one `withUndoSlices` per path, never two calls in sequence, and `store.finishWork.test.ts` pins it from the undo side ("restores BOTH slices, never half of them") rather than from the write side, because the write was never the part that broke. It returns the label it armed — the same move `undoLastDelete` makes — so the shelf's notice and the toast cannot drift apart. A STALE draft is the one case that splits: the tick is certain and lands as a single slice, the minutes are not and park in `confirming` for the question the shelf already knows how to ask. `setFocusDraft` is safe to call afterwards because it spends `set()`, not `setAndPersist` — it cannot sweep the undo the write just armed.
- **A replan proposes; it never writes.** `proposeReplan` builds moves against a growing map of what its OWN earlier proposals took, so the preview and the write agree about where things land, and work that will not fit inside `REPLAN_HORIZON_DAYS` is listed as unplaceable rather than dropped. `applyReplan` uses the days and minutes the user already saw — recomputing slots at apply time is how "nothing moves silently" turns into "it moved somewhere other than the screen promised".
- The tree's rows are covered by children that stop propagation, so row-level MODIFIER clicks are caught in the capture phase (`onClickCapture`). A test that dispatches at the row element cannot see this — component tests must click the child a person actually hits.
- **A container in the goal tree is a RULE, not a row — and that is what makes the gutter unfixable-again.** `ROW_CLS`'s comment used to claim the two-column grid "deletes the ~700px gutter the pinned right-edge cells used to leave". True for a LEAF, whose metadata moved to line 2; false for a CONTAINER, which has no line 2, so its `%`, its derived `blocked` flag and its WHEN readout stayed on line 1 behind a `flex-1` title that took every pixel of slack — `0%` sat ~1,300px from the words it described. A container now renders through `RuleHeader`: its name in the tinted cell at the left end, its facts in the cell on the far end of the same hairline. A rule has exactly two cells, so there is no arrangement in which the name and the figure end up apart, and the hairline between them is what makes the far cell a legend rather than a number stranded in whitespace. It is STILL the `role="treeitem"` — the drag handle, the twirl, the `⋯` menu, the rename editor, `aria-level`, `aria-expanded` and `aria-owns` are all unchanged; only the drawing moved. The rename editor takes `normal-case`, because the cell's voice is capitalised and the stored title is not.
- **The container's bar has ONE segment, and that is the whole design.** `pct.ts` counts `'done'` and nothing else, so a second lighter segment for `'doing'` work would put a proportion on screen that the app does not compute and cannot defend — a bar is read as a share of the whole, and half-credit for started work is the one lie this surface must not tell. In-progress work says so on its own row, in its own checkbox, where it is a STATE and not a quantity; a blocked container says so in a WORD beside the bar for the same reason. The bar is `aria-hidden` because the figure beside it states the same fact in words.
- **A finished run of siblings folds to one line, in place.** `lib/doneFold.ts` is the vocabulary — `isFinished`, `foldDone`, `foldSummary`, `MIN_FOLD_RUN` — and the rule is Today's `Done today` rule applied to a tree: work that is done cannot outrank work that is not. It is a LENS and never an edit: it folds per RUN of adjacent finished siblings and never reorders, because the order of a sibling list is the user's and is what a drag sets. **It can never hide a container with open children**, and that holds by construction rather than by a check — a container has no status of its own, and `containerStatus` reads `'done'` only when every leaf beneath it does. `MIN_FOLD_RUN` is 2 because folding one row saves no space and costs the checkbox that would un-tick it. `visibleRowIds` takes the revealed-key set and spends the same `foldDone`, so a shift-range can never reach a row nobody can see; the fold line sits in its own `role="group"`, the accommodation `AddChildInput` already takes, because a `tree` may own only `treeitem`s and `group`s.
- **A leaf's estimate is a READOUT on the reading edge, in its own grid track.** It used to live inside `LeafMeta`, which put it on line 1 for a bare row and line 2 for a populated one — so it was never a COLUMN, and a goal card saying "4 unestimated" could not be checked against the tree without hovering every row. Column 3 of `ROW_CLS` states it at the same x on every row, at rest, with `—` where nobody has priced the work. `EstimateControl`'s `emptyLabel` is what carries that: passing one also drops `.quiet-control`, because `+ est` is an OFFER and may hide until hover while `—` is a FACT and may not. `metaPlacement` therefore no longer treats an estimate as a reason to open line 2 — leaving it as one would have cost a leaf whose only metadata was its estimate a second line holding nothing but a hover control.
- **One gesture, one dimension, on a task row.** The checkbox completes, the chevron expands, a plain click opens the row (`openStep` — a leaf's own page, a container's docked inspector), and a double-click or `Enter` on the title renames. The row itself no longer runs a "primary action" that depended on what the row was — completion on a leaf, expand on a container — because that bound the one action which moves every number to the largest click target on the page. On the keyboard: `X` completes (the selection if there is one), `Space` toggles selection per the ARIA treeview pattern, `Enter` renames, `⌘Enter` inserts a sibling below, `S` cycles status, `⇧S` schedules, `E` estimates, `O` opens a container as a workspace, `⌘]`/`⌘[` indent and outdent. `S` and the row's `◐` `.quiet-control` are two routes to `'doing'`/`'blocked'` (via `cycleStatus`: `todo → doing → blocked → todo`) that cannot reach `'done'` by design. `TaskPage`'s status popover and the bulk bar's `<select aria-label="Set status">` (`GoalTree.tsx`) both DO offer `'done'` directly. The popover routes it through `toggleLeaf` — the same function the checkbox calls — so completing a task from its page arms the identical `Completed "X"` undo; the bulk bar calls `setNodesStatus` instead, because one write for N nodes needs its own undo entry, but it still lands on the same `writeStatus` primitive and the same `Completed N task(s)` wording. `StepPanel` offers no status control at all — a container's status is derived from its descendants, so it renders as an inert `PropertyStatic`.
- **Everything below daily frequency on a row lives in one `⋯`.** `lib/rowActions.ts` names the verbs and states when each applies; `RowActions.tsx` binds them to the store — the same split `commands.ts`/`App.tsx` already use, and what lets "does a container offer Schedule?" be a unit test. The row kept only the controls that are also READOUTS: the checkbox, `◐` (the one thing telling in-progress from untouched), the estimate, and the WHEN cell — the last two became the controls for the values they were already displaying. Rename, add-subtask and delete moved into the menu; the time ledger moved to the inspector, then again to `TaskPage` when the leaf inspector became a page. Duplicate and move-to-goal are deliberately ABSENT: neither has a store action, and a menu item that needs a new undoable mutation underneath it is a feature wearing a menu change. `ProposalPanel` ("Break X into subtasks") is LEAF-only and therefore lives on `TaskPage`, not under the tree — a leaf no longer opens in `StepsTab` at all, and `rowActions` withholds `breakdown` for the same reason: a row offering it would open a surface the row has nowhere to put. Accepting a proposal converts the leaf, which the render-time branch turns into the container inspector unaided. **The verb reaches it two ways, and the second one has to earn the room.** `taskPageActions` carries `breakdown` in its own run between Rename and the move verbs — that is the standing route, and it replaced a permanent button under the note which, on an untouched task, was the only thing on the page competing with the document and sat stranded past 220px of blank body. The inline INVITATION survives only for `looksOversized`, where a sentence saying the estimate will not fit one sitting has earned it, and it renders ABOVE the note beside the Estimate line it is a remark about — never below, where it argued with the document while pointing at something off the top of the screen.
- **A menu needs more than one verb to exist.** The `⋯` on a tree row earned itself because that row carried TEN controls; the backlog rail's row carries two, and a `⋯` replacing a single `×` adds a click and a popover to a 249px row. A rail menu was designed and then abandoned mid-plan, and the reason is worth keeping: `ScheduleMenu` takes `goalId: string` and `node: GoalNode` (`components/SchedulePopover.tsx`), all three of its callers pass a real node, and a `BacklogItem` has NEITHER — `goalId` is nullable and no node hangs off it. Without `Schedule…` every rail row's menu held exactly one item, which is strictly worse than the `×` it replaces. So the rail keeps `×` on the row for LOOSE TASKS ONLY — a goal's task is still deleted in the Goals view, where its tree is visible — and the route to a project went onto the GROUP HEADER, which was already rendering the project's name inert. One control per GROUP rather than per row: less UI for the capability that was actually missing, since a rail row had never had any route at all to the tree it belongs to. Generalising `ScheduleMenu` to loose tasks is the change that would unblock a rail menu; check that before proposing one again.
- **The rail's header states a COUNT and no time.** A time total was added so the rail and the Plan header's meter could be checked against each other by eye, and removed because they count different populations: the rail lists unplaced work from EVERY week, while the header's "to place" is `weekCapacity.backlogMin`, THIS week's committed-but-unplaced. They can never agree, and a figure that invites a comparison it cannot survive is worse than no figure — the same rule that keeps `plannedMin` and `backlogMin` apart in the first place. It would also hide its own gaps: an unestimated row contributes zero, so `12 · 1h 45m` can stand for nine rows nobody has priced, which the header reports separately as `N unestimated`.
- **`Popover` is the one anchored-panel primitive** (`components/Popover.tsx`), with `PropertyRow`/`PropertyToggle`/`PropertyStatic` on top of it for the docked inspector (`PropertyToggle` currently unused there), and `PropertyChip`/`PropertyChipToggle`/`PropertyChipInline`/`PropertyOption` — the same idea restated as chips, plus the menu option a status chip opens onto — for `TaskPage`. **Escape is CONSUMED, not observed, and it takes TWO mechanisms because there are two ways to lose it.** Against a listener on a DIFFERENT node — `App.tsx`, on the bubble phase — a capture-phase `stopPropagation` is enough, and without it a popover would dismiss itself and the page behind it in one press. Against a listener on the SAME node it is useless: `Modal` also listens on `window` in the CAPTURE phase, `stopPropagation` does not reach a sibling listener on the same target (that needs `stopImmediatePropagation`), and capture listeners on one node run in REGISTRATION order — the modal always registers first, because it opened first. So the modal answered first, and one press closed the New goal calendar *and* the dialog behind it. The second mechanism is an attribute: `Popover` marks its wrapper `data-popover-open` while open, and `Modal`'s Escape branch defers when the event target sits inside one. It is on the WRAPPER, so it covers the trigger as well as the panel, and it is ABSENT while closed — a focused trigger on a shut popover must not swallow the key that should close the dialog. This was unreachable until the New goal calendar became the first popover ever nested inside a modal; `Modal.test.tsx` is the guard, and it fails without either half. It is deliberately NOT in `modalRegistry` — that registry answers "is a dialog blocking the view shortcuts", and an anchored panel is not; `data-popover-open` answers the narrower "does something anchored own Escape right now". **The panel flips above when it does not fit below**, measured in a layout effect from the real box, never derived — `BoardCard` carried a `MENU_HEIGHT_PX = 210` guess for this at its one call site, and the panel it stood for measures 272. A popover panel whose contents include a textbox must be `role="dialog"`, never `menu`: a menu's permitted children do not include one.
- **A property states a fact and hides its editor — and WHERE it states it depends on how much room it has.** The docked inspector keeps the original rule: `PropertyRow`/`PropertyStatic`, no label, the value IS the label, because four short facts in one narrow column would double their width for an eyebrow each. `TaskPage` does NOT. It states them as labelled lines — `PropertyLine`/`PropertyLineToggle`/`PropertyLineInline`/`PropertyLineField`, a quiet 140px label column and a value that carries the ink. The chips this replaced were five bordered objects between the title and the document, and on an untouched task FOUR of them read "No dates", "Not scheduled", "No estimate", "Not a milestone" — a row of negations louder than the note they introduced. **The negations are the point: a rule that reads well filled can read as nagging empty, so an unset property is a quiet value, never a bordered one.** An unset value is `text-muted` and NEVER `text-faint` — it is read, and it is the only affordance for setting one, so it takes the tone that clears AA. Both forms open the identical `Popover` with the identical children and carry the identical accessible name (`"Status: done"`), which is what stops the page and the panel drifting. `EstimateControl` and `LogTimeControl` keep their own inline badge→field swap and only borrow the metrics: putting either behind a popover would nest a disclosure inside a disclosure. The blocked reason stays OUT of the status popover — it is what makes a blocked task actionable, and hiding it behind the control that set the status would let the page say "Blocked" without ever saying what by; as a `PropertyLineField` it is now labelled as well as visible. `StepPanel`, the docked inspector a container still gets, has none of this: no estimate, no log-time control, no status popover and no blocked reason, because a container's status is DERIVED from its descendants rather than set — it renders as an inert `PropertyStatic`, and the only editor left is the date span.
- **A placeholder is an EXAMPLE and takes `faint`; an unset VALUE is read and takes `muted`.** `fieldCls` (`components/dialogStyles.ts`) sets no placeholder colour for years, so every dialog placeholder inherited `text-ink` and read as typed text — New goal showed "Physics Final", the form was empty, `disabled={!title.trim()}` was correctly true, and the dialog read as broken because the FIELD was lying. Five inputs each hand-rolled `placeholder:text-faint` (`CommandPalette`, `QuickAdd`, `BlockComposer`, `AssistantShortcutSettings`, `.ghost-in::placeholder`) and the one SHARED primitive was the only one without it. It is on `fieldCls` now, and `index.css`'s own token comment is the authority: faint is for "decorative marks, placeholders and disabled states", muted for "anything a user must READ". `DateField` takes the OTHER tone — `placeholder:text-muted` — because none of its placeholders is an example: "No dates", "Not set", "Start", "End" and "Due" each name an UNSET property, which is the `TaskPage` rule two bullets up, and `PropertyLineField` (`PropertyRow.tsx`) already spells it that way. `DatePopover` is untouched by either: its "No deadline" is a rendered `text-muted` span, not a real placeholder. New goal's own example carries `e.g.` because "Physics Final" alone is a plausible real answer, which is the worst kind of placeholder.
- **A dialog with a VERB wears the Instrument frame; one without keeps the card.** `Modal`'s optional `verb` prop is the whole switch, because the two are one decision: a dialog whose rule states the verb is one whose title is free to be a name. The frame is a ruled strip (`dialogRule` + `ruleTag` in the tinted `dialogRuleCell`, `dialogRuleHint` reading `Esc to cancel` at the far end), a `mast` masthead in the UI face (`dialogTitle` — never `font-disp`, which is display-only and guarded to three sites), fields as labelled lines (`dialogLine` + a 104px `dialogLineKey` in the `captionLabel` voice + `dialogLineValue`), and the footer on its own ruled `bg-bg` bar (`dialogBar`) — the same object the assistant shelf's dial strip is. **The ✕ is gone and the hint is what pays for it**: the affordance became a sentence, and scrim-click and the footer's Cancel both survive. `NewGoalModal`, `ImportGoalModal` and `ConfirmImportModal` wear it; `SettingsModal`, `AvailabilityModal` and the week planner keep the card. Three rules hold it together. The panel takes **no `overflow-hidden`** — New goal's calendar is a `Popover` positioned inside it and deliberately taller than the dialog, so clipping the panel to round the strip's corners would cut the picker off; the strip and the bar round their own instead. `dialogLineValue` is a **`grid`**, so a `w-full` input, a shrink-wrapping `Popover` trigger and an `inline-flex` `SegmentedControl` all end on one right edge — they measured 328, 126 and 182 before it — and a line needing two things side by side NESTS a flex row rather than appending `flex` to a `grid`. And the keys are **`aria-hidden`** while every control names itself, exactly as `PropertyLine` does: the New goal title input keeps `What do you want to finish?` as its accessible name while the key column reads `Finish`, because 104px of mono cannot hold a sentence and nothing forces the two to be the same string. Everything in `dialogStyles.ts` here is a NEW export — `primaryBtn`/`secondaryBtn`/`ghostBtn`/`dangerBtn`/`rowBtn`/`rowBtnPrimary` are untouched, their heights are argued for in comments, and `dialogFooter`'s reading-edge rule (Cancel first, the filled commit button last) is what `dialogBar` inherits verbatim.
- **The note IS the task page, not a field on it.** `.note-prose.note-page` strips the box, the padding and the focus border, so the body's first line sits on the same left edge as the title and the property labels, and the whole column is centred (`max-w-[720px] mx-auto`) — it used to be pinned LEFT inside the 1100px container, putting 170px of margin on one side and 550px on the other. The title is `text-page`, a step ABOVE `text-h1`, because `text-h1` is what a heading typed *inside* the note renders at and the page title was `text-h2`: a heading in the body came out larger than the name of the thing it was in. Two horizontal rules are gone with it, including the one over a `Time` section whose single control is the `Time logged` property line now. The docked inspector keeps the box: there the note is one control among several, and the border is what says which one you are typing in.
- **A milestone is a lens on the open goal, not a destination.** `openArea` sets `openAreaId` and leaves `openGoalId` alone, so the breadcrumb is real navigation and Back is one step; `closeArea` reselects the container it was showing. `openArea` still refuses a leaf, but a leaf is no longer panel-only: it has its own `TaskPage`, the SECOND lens on the goal, reached by the same mechanism — `openGoalId` stays set, the breadcrumb is real navigation, and `closeStep` (which Escape already ran) is the one way out. The rule this replaces said a page for a leaf "would be the inspector again with more chrome"; the answer is that the page's job is the NOTE at full measure, with the properties above it as chips over the SAME `Popover` controls the inspector used — not a second property list. **The leaf/container branch is computed at render**, in `Project.tsx` and `AreaPage.tsx`, via `isLeafNode`/`isContainerNode` (`lib/tree.ts`) — the one predicate, so a task that gains children becomes a container on the next paint and `StepPanel` never needs a leaf branch — it no longer has one. Three tabs (`AreaTab`), not the goal's five: a Board over one container has one container's work in it. Escape peels the workspace off BEFORE leaving the goal page.
- **`projectTabByGoal` is keyed by goal, and that is the whole point.** The rule used to be "always open on steps", which was right against a single global last-tab — a goal never once opened on Notes still opened there. Keyed per goal the surprise cannot happen, so the memory is kept. A node focus (⌘K on a task) still forces steps: being pointed at a row means the tree, which is the only tab that has one.
- **`+ Add` and `⌘N` share one resolver** (`lib/addAction.ts`) — a shortcut doing something other than the button advertising it is worse than either alone. It creates what the surface is made of: a goal on Goals, a task in an open goal, a task on Plan and Today. Only the DEFAULT moves; every verb stays in `⌘K`.
- **A task's placements are a LIST of `WorkBlock`, held inside the node or task.** `src/lib/blocks.ts` is the only vocabulary for them — `blocksOf`, `isPlaced`, `blocksOn`, `sortedBlocks`, `plannedMinutes`, `planVsEstimate`, and the mutators. `blocks` is ABSENT, never `[]`: presence is what "placed" means, and an empty array is the legacy-leaf ambiguity `children` already suffers. A block owns its own `minutes`, so **resizing a sitting never touches the estimate** — that is what makes "planned sittings exceed the estimate" two real numbers rather than a guess, and why `warnIfEstimateOverflows` no longer exists. `plannedWeek` (leaf) and `Task.date` survive as the COMMITMENT, a separate fact: committed-with-no-block is the rail's "to place". Blocks live inside their owner rather than in a table, because a stray `Session` is inert but a stray block would draw itself on a Tuesday. `ScheduleMenu` (`components/SchedulePopover.tsx`) offers "Clear schedule" on `placed || node.plannedWeek !== undefined`, not `isPlaced(node)` alone — a leaf committed to a week with no sitting yet is exactly the "to place" state above, and gating on placement only left it with no way to un-commit. Both surfaces that open the menu, a leaf row's WHEN cell in `GoalTree.tsx` and `TaskPage`'s Schedule chip, inherit the fix from the one function.
  **A booking made from a distance arms an undo; direct manipulation does not.**
  `scheduleNode`/`scheduleTask` call `withUndo` unless `opts.blockId` is present
  — `blockId` names the one bar a drag is moving, and a bar you watched land is
  a bar you can drag back, which is why `resizeNode`/`resizeTask` are silent
  too. Everything else — Today's proposal row, the backlog's `1`-`7` keypress,
  `ScheduleMenu`, `TaskPage`'s add-a-sitting — books something the user did not
  see arrive, and on Today the row IS the button, so a stray press must be
  reversible. The snapshot is the whole slice because one write sets both the
  block and the `plannedWeek` commitment.
- `spansOn`'s exclude argument is BLOCK ids, never a task id: moving one bar excludes just that bar (its siblings are real occupancy it must work around), while REPLACING a task's placement excludes all of them (they are about to be vacated, and leaving them in makes the drop slide past its own aim). `vacating()` in `store.ts` is the one place that choice is made.
- **`migrateSlots` runs before `migrateWorkBlocks`.** The first repairs pre-slot data by WRITING the legacy `plannedDay`/`plannedStartMin` pair the second consumes; the other order leaves it nothing to read. `migrateWorkBlocks` is read-time only, with no done-flag and no snapshot — it is idempotent by construction and computes nothing, exactly like `migrateNodeStatus`. It degrades a day-with-no-time to a week commitment rather than inventing an hour.
- **The week grid is a calendar, and the four things that make one are the clock, the ground, the grip and the gutter.** The CURRENT MINUTE is drawn twice: a hairline across today's column (`DayColumn`) and a dot in the time gutter (`WeekGrid`), both `warn` and never `accent` — accent means ACTION here, it is already the drop-target tint and every primary control, so a permanent accent rule across one column read as something to click; and both stay a hairline and a dot because the clock is not an error either. Two marks rather than one because the grid is `min-w-[780px]` and scrolls sideways, so today's column leaves the screen on any narrow window while the gutter is `sticky`. A BLOCK paints an opaque `bg-panel` ground and lays its project tint over it (`projectTintClass`/`projectAccentClass`, both derived from the arrays `projectBlockClass` joins): the tint is an alpha, the hours outside the working window are `.hatch` now, and an alpha over a 45° stripe reads as texture rather than as an object — the ground also puts the hue on exactly the background `projectColour.test.ts` measures its contrast against. The RESIZE GRIP is a decoration and the 8px strip under it is the control, which is why it may spell `group-hover:opacity-70` where `.quiet-control` is otherwise the rule: a 24px interactive floor on something `pointer-events-none` would be taller than the shortest block the grid draws, and `designScale.test.ts` carries that exemption in words. The GUTTER labels are centred ON their hour rule (`-translate-y-1/2`, over an opaque axis above `Z_RULES`) and stop one short of `hourMarks()` — minute 1440 is the grid's own bottom edge, not an hour of this day, and `clockLabel` renders it `12am+1`. There is NO all-day row: `state.allDayBlocks` is a preference boolean, not a list, and `blocks` is `[]` until a calendar integration lands, so the row would be permanently empty. There is no weekend tint either, so there is nothing for today's tint to be "distinct from" — the hatch already marks whatever the user calls non-working, and a second category of column shading would fight it.
- **A calendar block is a dimension line, and 84px is the whole budget.** The
  project hue is a drawn SPINE (`BlockSpine`, `projectFillClass`) rather than a
  `border-l-[3px]`, capped with a 9×2px tick at each end — a border says "this
  belongs to project X", a capped spine says "this span runs from HERE to HERE",
  and the second is the fact a calendar exists to state. 2px, not 1: a hairline
  cap is invisible at 1x, and the caps are the entire difference between the two
  readings. Every time on the grid is `blockTimeCls` (mono, `text-micro`,
  tabular) because a start is a MEASURED FIGURE and mono is already this app's
  voice for those. **What a block prints is decided by the BLOCK, not
  by us** — `BlockTime` renders the full span AND the bare start, and the
  `@container` query in `index.css` (`.blk-cq`, `.blk-span`/`.blk-start`, 113px
  on the content box) keeps whichever fits. That is not fence-sitting: a fixed
  choice is wrong in both directions, and this was very nearly got wrong twice.
  `9am – 10:30am` needs 86px of mono and `10:15am – 11:45am` needs 113. At the
  grid's `min-w-[780px]` FLOOR a column is ~105px and a block has 84 inside it,
  where nothing but a start fits — but that floor is reached only when the
  window is narrow enough to scroll sideways, and on an ordinary 1440px window
  the same column is ~146px and every span fits with room to spare. Only the
  block knows which it is, because two overlapping bars halve its width with no
  change to the column at all. 113px is the widest span the app can render and
  not a round number: below it SOME span clips, and a readout exact at 10am and
  elided at 10:15 is worse than one consistently short. Both forms are
  `aria-hidden` — the block's `aria-label` states the span and the length, and
  CSS hiding one does not remove it from the accessible tree, so without that
  BOTH would be announced. The LENGTH is printed at neither width: it is the one
  fact here that is DRAWN, and a cell restating it took 46px from a span that
  needed all of them. `blockChrome.tsx`
  holds `blockPadCls` (8px left — clears the 3px spine by five; 10px clipped)
  and `blockFootCls` (the rule's negative margins mirror that padding, or it
  reads as an underline), because `EventBlock`, `BlockGhost` and `BlockComposer`
  all draw them and a rule that reached the edge on two of three is the drift
  that file exists to prevent. `flex-1 min-h-0` and `line-clamp-3` may never
  share an element — the clamp needs `display:-webkit-box`, the fill needs a
  flex item, and with both the clamp stops cutting.
- **The drag says where it will land, and it says it by asking the store.**
  `DragOverlay` renders `BlockGhost` — the bar at its true height, not a 220px
  text pill — and `LandingOutline` draws the RESOLVED slot in the hovered
  column. Resolved, never the raw aim: `previewPlacement` (`store.ts`) is a dry
  run that shares one `resolvePlacement` helper with `scheduleNode` and
  `scheduleTask`, so the outline names the minute the write will choose even
  when `resolveSlot` slides the bar past occupied work. Views still never call
  `resolveSlot`. `null` covers item-gone, project-frozen and day-booked-solid
  identically — all three mean "draw no outline", and the day heading's `full`
  chip already says the last one in words. `aimFromDrag` (`dropTarget.ts`) is
  the one reading of where the pointer is, spent by `onDragMove` and
  `onDragEnd` alike; two copies would drift by minutes and look like rounding.
  **`dropAnimation={null}` is load-bearing**: dnd-kit's default flies the
  overlay back to the ACTIVE node's rect — where the bar came FROM — so every
  drop animated the block returning to its old slot, contradicted a frame later
  by the re-render. A bar in the air leaves a dashed HOLE rather than a 40%
  copy of itself, which is `border-dashed`'s third licensed use and is the same
  sentence as the outline said from the other end.
- **A composer is the bar it is about to become.** `text-badge` goes on the
  INPUT and not the wrapper: `index.css` sets `input, select { font-size: 14px }`
  in `@layer base`, inheritance loses to any rule that matches the element, and
  the title being typed rendered 14px while the bar it became rendered 12px —
  the one field on the calendar that did not measure like the calendar. Its
  `onPointerDown` calls `preventDefault` as well as `stopPropagation`, or a
  press on the composer's own body moves focus off the field, `onBlur` fires
  and everything typed is discarded; blur still cancels, which is what makes
  this a one-click gesture, and what was fixed is that the composer counted as
  "somewhere else". It takes NO spine and keeps the padding that would hold one
  — an accent spine inside an accent border stacks two marks of one colour into
  a black edge — so committing draws the spine into a space already reserved.
  `↵ add · esc` sits at the foot of the BODY rather than on the rule's reading
  edge, because the rule has room for exactly one mono cell and the span wins
  it; the hint takes the dead space instead, which is the space the whole change
  is about.
- Layout that depends on the Plan sidebar must measure the RAIL, not the viewport: it is 249px at every viewport ≥768px. Use `@container` on `.hb-rail`.
- **One filled control per screen, and it lives in the app header.** `App.tsx` says of its `+ New task`: "The one filled control in the header, and the only one that writes anything." That was false on Plan for as long as `Habits.tsx` rendered three `bg-ink text-paper` buttons inside the sidebar — and the loudest button on the whole page was `+ Habit`, the least important action on it. All three are outlined now (`border-line-2 bg-panel text-ink-soft`). A SELECTED SEGMENT is not a commit button and keeps its fill: the habit cadence toggle stays `bg-ink text-paper` for the active option, because that is how a segmented control says which one is chosen.
- Visual identity is locked — don't restyle unless explicitly asked. Colours come from the theme tokens: `designScale.test.ts` fails the build on a literal hex, on an arbitrary `text-[Nrem]`, and on a `fontSize` key that collides with a `colors` key (Tailwind emits both as `text-<key>`, and the colour silently wins). Corner radii are the same kind of build-failing rule: the permitted set is `[4px]`, `[6px]`, `rounded-field` (8px), `rounded-card` (12px) and `rounded-full` — `[11px]` was a fourth near-duplicate and is retired. It also pins the type roles. **`font-disp` (Fraunces) is display-only** and reaches exactly three places: the wordmark, `TaskPage`'s own title, and headings typed inside a note (`.note-prose > div > h1/h2/h3`). The guard sees only the first two — it scans `.tsx`/`.ts`, and the third lives in `index.css` — so a reader taking its allowlist as the whole story will undercount by one. **All-caps travels with `font-mono`**, or is one of the three weekday strips; uppercase in the UI face is a build failure. **A section label is `sectionLabel`** from `components/sectionLabel.ts` — mono, uppercase, `text-micro`, `tracking-[.11em]` — and it is a constant precisely because that string was hand-copied at 36 sites before it was one. That file now holds three voices and holds them for a MECHANICAL reason as well as a stylistic one: it is the only file the guard lets spell `uppercase`, so a new all-caps voice is declared there and imported, never hand-rolled. `ruleTag` is the label set INTO a rule (`text-ink` semibold — louder than `sectionLabel`, which is the trade the cell's own edges buy), and `stampLabel` is Today's date stamp, deliberately carrying NO colour because its two cells invert against each other. The type scale's top step is `mast` (34px), Today's masthead, and the name is the point: `display` would read as "use the display face here" to the next person, which is the exact mistake the `font-disp` guard exists to catch — this headline is deliberately Public Sans. `page` (25.9px) stays what it is, a DOCUMENT's own title. Five sites that share the old class string are NOT labels (two buttons, two Timeline row labels, `AssistantSurface`'s "Focus" caption) and keep it written out. And `border-dashed` is reserved for the drop preview and for a calendar block whose height is a guessed hour — spending it on ordinary empty states is how the drop signal stops meaning anything.
- **Dark is warm charcoal (`#141311` page, `#1E1D1B` panel), not OLED black — and the panel's luminance is what sets the floor of the band the six project hues may occupy.** `#1E1D1B` is brighter than the `#0D0D0E` it replaced, which raised that floor and is why the six hues now sit around `L ∈ [0.160, 0.196]` and read more pastel than they used to. That pastel quality is a CONSEQUENCE of the contrast floor, not a taste decision — re-saturating them is the change most likely to look like an improvement and drop them under 3:1 on the panel. `projectColour.test.ts` asserts each hue's ratio against both panels, reading the dark one out of the stylesheet, so the `L` comments in `index.css` are build-enforced claims rather than notes; it is LIGHTENING the panel further, never darkening it, that would raise the floor again and force the hues to move.
- Hover-revealed row controls use the `.quiet-control` class, never a hand-rolled `opacity-0 group-hover:opacity-100`: it carries the `@media (hover: hover)` gate that keeps them reachable on touch, plus the 24px target floor. It needs a literal `group` ancestor (`group/name` does not match).
- dnd-kit's `attributes` go on a dedicated drag handle, or through `containerDragAttributes` when the draggable is a container holding real buttons — `role="button"` around buttons is invalid and swallows their labels.
- **The Goals board scopes to one life; the week never does.** `activeLifeId` is
  in-memory view state beside `activeHorizon` — never persisted, so every load
  starts at `All` — and `src/lib/lifeScope.ts` is the one vocabulary for it:
  `resolveScope` (an unknown id is `'all'`, the same dangling licence
  `Goal.lifeId` has), `lifeTabs` (empty when no life is named; a named life kept
  when empty, `Unassigned` dropped when empty), `goalsInScope`, `nowLimit` and
  `withScopeLife`. The cap is `NOW_WIP_LIMIT` per tab and, on `All`, the SUM of
  the tabs beside it — so the figure can be checked against the strip by eye.
  Today, Plan, the backlog rail and every capacity figure are deliberately NOT
  scoped: this overturns D-7's refusal of a switcher and leaves its refusal of
  per-life capacity standing.
- **A partial board layout weaves the rest back.** `weaveHidden` (`lib/board.ts`)
  re-inserts every goal absent from an incoming `setGoalBoard` layout at the
  within-column index it held — the reason a scoped reorder cannot scramble the
  other life's ranks, and why it is named for the general case rather than for
  completion. `rankMoveTarget` is the keyboard half: `moveGoalRank` steps by
  VISIBLE neighbours, so `Alt+↑` never swaps a card with one that is off screen.
- **A column claims no more width than its cards can fill** (`lib/boardTracks.ts`),
  and **every column equalises while something is in the air** — `handleDragOver`
  moves ids live, so widths that tracked card count would reflow under the
  cursor and an empty Now would be narrowest exactly when you need to hit it.
  This bullet used to promise PROPORTION, and `minmax(FLOOR, {n}fr)` delivered
  greed instead: the one populated column of a sparse board took every leftover
  pixel — ~714px of 1100 — and `Column.tsx` then drew a single 188px card in it,
  stranded beside two dead tracks its own `auto-fill` grid had created (the
  identical grid in `views/project/BoardTab.tsx` had always used `auto-fit`).
  `columnCap` is the ceiling that ends it: `CARDS_ABREAST_MAX` cards at
  `CARD_MAX_PX` plus the gaps between them, and the remainder goes to ONE
  trailing spacer rather than to a column that would leave it empty. It is a
  ceiling and NOT a ratio — under it, grid hands out free space equally from a
  common floor — and that is the honest promise, because the columns that
  differ visibly in what they hold are exactly the ones whose caps bind.
  `Goals.tsx` renders the spacer only at rest, since the dragging branch emits
  no track for it and a fifth child against four tracks would fall into an
  implicit second row. `COLUMN_GAP_PX` is 0 for the reason below.
- **The board is a ruled sheet, and everything it does not fill is hatched.**
  A horizon's header IS its divider — `components/RuleHeader.tsx`, a fixed-height
  rule with the name in a tinted cell at one end and the count in a cell at the
  other, in the shared `ruleTag` voice, which is why the count no longer drifts
  to `ml-auto` 700px from its label. The bays share hairlines (`COLUMN_GAP_PX`
  is 0, each column draws a `border-r`, the board draws `border-y`) so the four
  rules join into one line. Below them the `.hatch` gradient runs from the last
  card to the bottom edge of EVERY bay, not only the empty ones — a bay holding
  one card beside a bay holding three has more unclaimed area than an empty one
  does — and it is a gradient precisely so it can fill four bays at once
  without being mistaken for `border-dashed`, which is this app's drop-target
  signal and nothing else. `Nothing here` survives only in the narrow solo
  switcher, where one bay fills the screen and a hatch with no words in it
  would read as a rendering fault. The trailing spacer draws an unlabelled
  `RuleHeader` plus hatch, so the margin is ruled like the rest of the sheet;
  it carries no tag, which is the whole difference between a bay and a margin,
  and it cannot mislead as a drop target because it is not rendered mid-drag.
  There is a near-duplicate `RuleHeader` under `views/today/`; consolidating
  the two is a follow-up, not an invitation to import across views.
- **The Now limit is drawn, not described.** `WipGauge` (`views/goals/FocusSummary.tsx`)
  is one cell per slot, filled to the count, and it replaces the FIRST focus
  chip only — `1 planned action left` is a different fact and keeps its own
  words. It is the one signal in that row with a ceiling to draw against; the
  other four are open-ended counts, and a bar with no maximum is a decoration.
  Over the limit the gauge PEGS to warn rather than growing an extra cell: the
  cell count is the limit, and a gauge that ran past its own scale would stop
  being a limit you can see — the overage is what the figure beside it says.
  The chip stays a filter button with its old accessible name, so the drawing
  is added to the signal and does not replace it.
- **The assistant shelf speaks `dialogStyles`, and its primary is whatever moves the session forward.** `AssistantSurface` renders in two places — the in-app panel and the Electron overlay — and it used to hand-roll a `quietButton` whose "primary" was a one-shade border difference, which is how two equal-weight buttons came to offer "end this session" and "resume it" with no hierarchy between them. It now spends `primaryBtn`/`secondaryBtn`/`ghostBtn`, one filled button per state, placed LAST per `dialogFooter`'s reading-edge rule. Which button is filled depends on the phase — `break` fills Continue, `active` fills Complete session — so "Complete session" changes side between the two. That is deliberate: the states are mutually exclusive and the filled button is always the reason you summoned the shelf. The dismissive answers ("Didn't happen", "Cancel") are `ghostBtn`, never outlined, so they cannot be mistaken for a secondary action. `altRow`, the alternatives band's row, is NOT a fourth variant — it is a row in a list of choices, and a list is not a commit. Copy splits the same way: `expectedTimeLabel` states an EXPECTATION and belongs to work that has not started, `elapsedAgainstExpected` is the progress readout and belongs to a session under way. Using the first on a running session is what made a paused shelf read `0m worked · on a break · Start with 30m` — the starter's wording at the time, since renamed. All three of `expectedTimeLabel`'s cases now name their provenance and then the figure — **Usually / Planned / Suggested** — because the starter's old `Start with 30m` opened with a verb, and on Today it sits immediately left of a `Start session` button, so one row said the same word twice and the readout read as a second control. The prefix is what the function is FOR: a bare `30m` would throw away where the number came from, and the history case is a RANGE no single number can state.
- **The shelf's `HEIGHT` is a measurement, and the zero state is why.** The window is unresizable, so that one constant in `electron/assistantWindow.cjs` is the only thing between a state and its own bottom edge. The number itself, and the state it is measured against, live beside it in that file and in the card-hugging rule below — the states this bullet used to enumerate (a capture proposal, a `choose-subject` list) no longer exist, and a stale height here is worse than a pointer. What stays is the discipline: it is MEASURED at 620px wide, never derived, because arithmetic against the type scale put the tallest state 20px low once already and would have shipped a shelf that came up short in the state you are in most. If a state grows, measure it again.
- **The overlay's palette arrives on the snapshot, and `loading` carries none.**
  `AssistantSnapshot.theme` is the RESOLVED `'light' | 'dark'`, published by the
  owner (`App` computes `effectiveTheme`; it is the only place `'system'` meets
  the OS) and applied by `AssistantOverlay` with `applyTheme`. It is REQUIRED
  and the relay validates it, because an absent theme is indistinguishable from
  light — which is the bug this closed, wearing a default. The bug is subtler
  than "nothing applies `.dark`": `assistant.html` has always carried a no-FOUC
  script that applies it itself, but that script GUESSES (a raw preference read
  in a second renderer, falling back to the OS) and runs once per page LOAD,
  while the overlay window is created once and thereafter hidden and shown
  rather than reloaded. So a `dark` preference on a light OS, or any theme
  changed after the shelf first existed, left a light card beside a dark app.
  The inline script keeps its job — the first frame — and that is exactly why
  `loading` repaints nothing: re-deciding on the way to the owner's answer
  introduces a flash rather than removing one. `lib/theme.ts` is reachable from
  the overlay without widening `entryBoundary.test.ts`'s proof, because it is a
  leaf; what must NEVER cross is `resolveTheme`/`readStoredTheme`, or two
  windows can disagree about one media query read at two moments. The embedded
  `AssistantHost` panel ignores the field entirely: it renders in the main
  window, which already has the class.
- **On the shelf a label sits INSIDE its rule; embedded it sits above one.**
  `RuleTag` in `AssistantSurface.tsx` is the shelf's `ruleTag` cell plus the
  hairline plus an optional figure at the reading edge, and it replaces
  `SectionLabel` over the work band and the alternatives band — behind
  `shelf === true`, like every other 620-vs-380 branch in that file. The figure
  is `expectedTimeLabel` and belongs ONLY to work that has not started: a
  running session has no expectation left to state, it has progress, and a
  readout that changes belongs beside the work rather than on the label
  introducing it — `expectedTimeLabel` vs `elapsedAgainstExpected`, restated as
  a position. The alternatives rule carries `N more`, which describes the ROWS
  and is therefore true whether or not `MAX_ALTERNATIVES` bit. The dial bar is
  two ruled cells for the same reason: two axes crowded onto one row read as
  one wide control with six segments. `Skeleton` draws the REAL rule chrome
  rather than a grey bar standing in for it, so the promised height is right by
  construction — which took loading-to-idle reflow from 57px to 11px.
- **The primary title clamps to two lines, and the alternatives yield their
  width to the work.** Both overturn rules that were argued well and measured
  badly. `truncate` was adopted to make the card's height independent of its
  content — sound, because the window CLIPS rather than scrolls — but its
  premise was measured against short test titles, and against real ones the
  shelf's own primary was cut at the moment it has to be read; the answer is to
  pay the budget (`HEIGHT` 308 → 343) rather than shorten the sentence. An
  alternative's metadata was `shrink-0` under a comment saying that was "right
  at 620px and wrong at 380" — it was wrong at both, and only visibly
  catastrophic at 380. The title now carries `min-w-[50%]`, a FLOOR and not a
  width: while the metadata is short nothing binds, and a greedy meta hits the
  floor and gives its own width back instead. Metadata that repeats a project
  the primary already named in full is dropped, via `lib/sharedPrefix.ts` —
  only when EVERY label carries the prefix, cut back to a token boundary so
  `Midterm — 2301265` and `Midterm — 2301230` can never yield `1265` and
  `1230`, and refused outright if any row has no project at all.
  `expectedTimeLabel` stays WHOLE in that metadata: a bare `45m` throws away
  where the number came from, exactly as the bullet above says.
- **Both dials own number keys, and only the shelf prints them.** `1`-`3` set
  time, `4`-`6` set focus. This overturns "two dials would want six keys, and
  the shelf is not a keyboard surface" — an argument written while the focus
  dial was the junior of the two, and falsified by the dials themselves the day
  they shipped side by side, same size, captioned as parallel nouns: two
  controls presented as peers, one of them mouse-only, is worse than six keys
  on a surface you summon with a keyboard shortcut. The rest of that argument
  survives — the shelf has no text field for the number row to be stolen from.
  The legend is `SegmentedOption.hint`, always `aria-hidden` so a segment's
  accessible name stays `30m` and never `30m 1`, and always `text-micro`
  because 11px is the app's smallest role and an engraving does not get to open
  a step below it. The BINDING is live in both presentations; the engraving is
  shelf-only, so the 380px panel's appearance is unchanged.
- **The shelf starts work; it does not parse sentences.** The typed vocabulary
  (`assistantCommands.ts`, the input, the proposal panels, `rankedWork` and
  `workThatFits`) is RETIRED — `⌘K` is the one place a sentence becomes a task,
  and a second parser is a second opinion about what a sentence means. What
  survives of `workThatFits` is its discipline, carried into `fitsFocus`: a
  history range is judged on its HIGH end, and a `starter` is never evidence
  about length. A notice is a LINE ABOVE the body and never a replacement for
  it — there is no state of the shelf with nothing to press.
- **The shelf hands you work, so it has to be able to take it back.** Its three
  buttons all answer "what happened to the SITTING" — `Complete session` logs
  minutes, `Take break` parks, `Didn't happen` discards — and none of them
  finishes the WORK, which in this app is the only thing that moves a number.
  So the card carries a `TodayCheckbox`, dispatching `complete-work` into
  `finishWork` above. It is a checkbox and NOT a fourth button because the
  checkbox is what completion IS here; a button would be a second gesture for a
  fact the rest of the app has exactly one gesture for, and it would put two
  commit verbs side by side that both plausibly mean "I'm finished". It sits
  LEFTMOST, before the `SessionRing`, because that is where a checkbox sits on
  every task row — the ring stays second and stays decorative, which is what
  `aria-hidden` says and why tests select `svg[aria-hidden]` rather than `svg`
  (a bare query matches the checkbox's own tick glyph and would report a ring
  after the ring was deleted). It renders unchecked always: the shelf only
  shows OPEN work, so ticking recomputes the card into the next thing. The ring
  and the tick share one condition — `confirming` carries NEITHER, because that
  state is already asking "was that real work?" and a tick there would answer a
  different question than the one on screen. No checkbox on the alternatives
  band's rows: those are lists of things to PICK, and a list of choices is not
  a commit.
- **A row in the shelf's `Or` / `Switch to` band is a CHOICE, and `Start
  session` is the only thing that starts a clock.** Picking a row dispatches
  `switch-focus`, which POINTS the shelf at that work — `AssistantHost` holds
  `chosen` and reads the advice through `promoteWork` (`lib/pickWork.ts`), a
  lens that moves the picked row to primary and never invents one — and
  starts nothing. With a session running it is logged first (a stale one still
  parks in `confirming` and the choice waits behind the answer), and the shelf
  lands idle on the chosen row. It used to end one clock and start another in
  one press. `switchCandidates` is the other half: the band beside a running
  session lists primary AND alternatives minus the running ref, because
  `alternatives` alone hid the advisor's head and could offer the task already
  on the clock. `chosen` clears when a session starts and when the shelf
  closes.
- **A focus draft follows the work it names.** `finishWork` was the only path
  that settled `activeFocusSession`, but Today's checkbox, the bulk bar and the
  agent socket all reach `toggleLeaf`/`toggleTask`, and a delete removes the
  step outright — so the shelf kept a session ticking on a task the page below
  had struck through (`20h 43m of 20m`). `reconcileFocusDraft`
  (`lib/focusSession.ts`) is the one rule, run by `setAndPersist` after any
  write touching `goals`/`tasks`: work open → untouched; work gone → discarded;
  work done → `confirming` with the elapsed minutes PROPOSED, never logged —
  logging there would be a second write sweeping the undo the completing write
  just armed, and the shelf already knows how to ask. It spends `set()` via
  `setFocusDraft`, so it cannot re-enter the sweep.
- **`focusLens.ts` is the one vocabulary for how much focus the room supports**,
  and it is a LENS, never a ranking: order never changes, membership does, the
  same move `lifeScope` makes on the board. The caps (`low` 25, `medium` 60,
  `high` ∞) are monotone. A FACT about today — `scheduled-now`,
  `scheduled-next`, `due`, `committed-today` — is never filtered, because a
  shelf that hid your 2pm block because you said you were tired would be lying
  about your day; only the discretionary tail is. Unknown length is not short,
  so Low refuses a `starter` as a RULE and not as arithmetic. An emptied lens
  answers `beyondFocus` — "Nothing light left" is a different sentence from
  "nothing needs you" — and offers the unfiltered head rather than re-sorting
  to find something lighter. This is now the ONLY place that distinction is
  drawn. `todayPlan`'s `no-hours` and the shelf's `needs-hours` made the same
  point about a missing model, and both were deleted with the model.
  `ExecutionAdviceInput.focusLevel` is OPTIONAL and absent everywhere but the
  shelf: `Today.tsx` calls the same function, and a mood set in a café must not
  rewrite the plan you check on the train home.
- **The level a session ran at is stored and never shown.** `Session.focus` is
  only ever `'low'`, is frozen onto the draft at start beside `title` and
  `expected`, and is read by exactly one thing: `expectedTime`'s evidence
  gatherer, which skips it. A 90-minute slog in a loud room is not evidence
  that the work takes 90 minutes. ACTUALS are untouched — `loggedForNode` and
  every capacity figure count those minutes in full. The daily reset to
  `medium` is arithmetic over the stored date at hydrate (`focusLevelFor`), so
  nothing runs at midnight; a window left open across it keeps the level until
  it reloads, which is the deliberate cost of having no timer.
- **The shelf's card ends where its content does.** `shelfSizing` hugs on
  macOS, where the window behind it is transparent, and fills elsewhere, where
  it would leave a painted notch. `HEIGHT` in `electron/assistantWindow.cjs` is
  therefore a BUDGET — the guarantee that the tallest state fits — and not the
  size of the pane: a hugging card is CLIPPED by the window edge rather than
  scrolled, so anything past that line is invisible and not merely awkward.
  Still MEASURED at 620px wide, never derived. A click on the transparent
  remainder closes the shelf. The one thing that does NOT hug is the send-off,
  which pins the card's own measured height while it plays — a farewell that
  collapsed to its two words would read as the window closing twice.
- **The agent surface is a CALLER of `actions`, never a second path to the
  data.** `mcp/server.js` reaches the app over a `0600` Unix socket in
  `userData`; `agentSocket.cjs` frames it, `agentIpc.cjs` relays it to the
  renderer, and the renderer — still the only writer, still holding the Web Lock
  — dispatches through `agentReads.ts`/`agentWrites.ts` into the same `actions`
  the UI calls. `validAgentRequest` runs THERE and nowhere earlier: the two
  Electron modules import nothing from `src/` by design, so the renderer is the
  first side of the seam that can spend it. Every read SPENDS the lib function
  its view spends and re-derives nothing, so Claude Code and the Today page
  cannot disagree about the day — and `week` therefore returns the
  `WeekCapacity` object whole and passes no verdict. It once had a verdict to
  withhold, `isOverCommitted`, kept out because it lived in `src/views/plan/`
  and a lib module reaching up for it would invert the layering; there is no
  verdict to withhold now, because nothing weighs a week against available
  hours at all. A write is one action call, and it refuses rather than lies: a
  frozen project, an already-ticked task and a full day are all errors, and
  `persistFailed` is re-read after every mutation because in-memory state
  advances even when nothing landed. `undo_last` exists because a write from a
  terminal is the ultimate distance write, and it reaches the STACK, never
  `pendingUndo` — the toast timer nulls that in 5s (15s destructive), which
  would hand the agent a narrower window than the `⌘Z` in the same app and
  invert the whole reason the verb exists. **`undoLastDelete` returns the label
  it restored** (`null` when the stack was empty), so one call is both the
  action and the honest report, and the choice between "name what you undid"
  and "reach as far as `⌘Z` does" was never a real trade: the label was already
  sitting on `UndoEntry`, unreturned. `⌘Z` and the toast button ignore that
  return because the user watched it happen. `docs/mcp-server.md` is the setup
  and the limits. **The dispatcher flushes the note editor before every
  request** (`actions.flushNote`, `App.tsx`), so `get_note` is a pure read that
  still sees what was typed a second ago, and `append_note` is one
  read-modify-write inside the app rather than two calls across the socket.
  There is deliberately no live-session verb: `log_time` writes the ledger
  after the fact, because a terminal cannot watch a timer and the shelf's
  "was that real?" question would have no one to answer it. Prompts and
  resources are declared in `server.js` and pinned to `AGENT_PROMPTS`/
  `AGENT_RESOURCES` and the `agentPrompts.ts` text by `agentProtocol.test.ts`,
  the same way `AGENT_TOOLS` is. `propose_replan`/`apply_replan` are the
  replan rule restated across a socket: the read proposes, the write joins each
  returned move to `slippedWork` by `blockId` and passes `to`/`startMin`
  through un-resolved — all-or-nothing, because it is one undo entry.

## Conventions

- New pure logic goes in `src/lib` with a test file; views stay thin and delegate to `actions`.
- Run `npm test` and `npx tsc -b` before committing.
