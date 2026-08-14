# The shelf does one job, and takes the room you are in as an argument

**Date:** 2026-08-14
**Status:** approved design, not yet planned

## What is wrong today

Three faults, all visible in one screenshot of the shelf:

1. **It dead-ends.** `snapshot.notice` does not sit beside the body — it
   *replaces* it (`AssistantSurface.tsx:421`). Ask it anything it cannot parse
   and the shelf becomes one grey sentence with no button on it, no
   recommendation, and no way forward but Escape.
2. **It is mostly empty.** The window is a fixed 620 × 192 sized to the tallest
   working state, so every shorter state — the notice at ~90px, the zero state
   at 136 — floats at the top of a pane with a hundred pixels of nothing under
   it. That is not a spacing problem. It is the window contract.
3. **It is a second command palette.** The input is the first thing the eye
   lands on and the first thing focus goes to, so a surface whose whole purpose
   is *"here is what to do next, press Start"* opens by asking the user to
   think of something to type. `⌘K` already captures and schedules, inside the
   app, with a matcher that is unit-tested. The shelf's own parser was a second
   answer to a question already answered.

## What it becomes

**One job: name the work, start the work.**

```
┌─────────────────────────────────────────────────┐
│ Focus   [ Low ][ Medium ][ High ]               │
├─────────────────────────────────────────────────┤
│ UP NEXT                                         │
│ Lab report                        [ Start ]     │
│ Physics · Usually 40–50m                        │
│ Other options                                   │
└─────────────────────────────────────────────────┘
```

## Decisions

### 1. The input goes, and the typed vocabulary retires with it

`assistantCommands.ts` and its test file are deleted, along with
`ASSISTANT_EXAMPLES`, `interpretAssistantInput`, `proposeAssistant`, the
`AssistantProposal` type, `ProposalPanel`, the `choose-subject` list, and the
`submit-input` / `confirm-proposal` / `choose-subject` / `cancel-proposal`
verbs on both sides of the relay.

`rankedWork` and `workThatFits` go with them: the "what fits in 30m?" intent
was their only caller. Their *discipline* does not go — the rule that a history
range fits only when its HIGH end does, and that a `starter` is never evidence
about length, is carried forward verbatim into `fitsFocus` below, which is the
one place it now lives.

The shelf keeps no parser, and therefore can never disagree with `⌘K` about
what a sentence means.

### 2. A notice never replaces the body

`notice` renders as a line ABOVE the body and the body always renders. There is
no state of the shelf in which there is nothing to press. Warning and neutral
notices differ in tone only — never in whether the surface still works.

### 3. The card hugs its content; the window does not move

On macOS the shelf window is already `transparent`. `AssistantOverlay`'s root
stops being `h-screen` and sizes to its content, so the leftover window area is
invisible rather than white. A click on that transparent remainder closes the
shelf, which turns the void into click-outside-to-dismiss.

Not resizing the native window is deliberate: the popup research
(`docs/research/2026-08-13-popup-architecture.md`) names native resizing as the
likeliest source of flicker, and a ResizeObserver round-tripping content height
over IPC on every state change is a moving part bought for a problem CSS
already solves.

Non-darwin keeps `h-screen`: without a transparent window the remainder is a
painted rectangle, and hugging would leave a visible notch.

**`HEIGHT` changes meaning, not method.** It stops being "how tall the shelf
is" and becomes "how tall the shelf may grow" — a budget. The tallest state
must still be MEASURED at 620px wide and the constant set above it, exactly as
`CLAUDE.md` requires; arithmetic against the type scale got this wrong by 20px
once already.

### 4. Focus level is a standing mode, reset each day

`FocusLevel` is `'low' | 'medium' | 'high'`. You set it when you sit down in a
crowded café and it stays until you change it — it is a fact about the room,
not about one task, so it does not belong to a session.

It is stored beside `assistantAccelerator` as `{ level, date }`, and the daily
reset to `medium` is computed AT READ TIME by `focusLevelFor(stored, today)` —
a pure function over the date it was set. No timer advances it, nothing is
written at midnight, and a machine that was asleep for three days comes back at
Medium without a migration. This is the same instinct as `focusSession`, which
banks timestamps and does arithmetic at read time rather than ticking.

The control is `SegmentedSwitch` at `sm` (26px) — `aria-pressed` buttons, not
radios, because this is view state and not form data, the same distinction
Board/Timeline already makes.

The strip is present in every state that has a body — including during a
running session, because the room can change while you are working — and absent
only from the skeleton and the "Good luck!" send-off, which have no body to
qualify.

### 5. The lens is a cap on expected length, never a second ranking

`executionAdvisor` states its own constitution: *"This module deliberately
contains no ranking of its own… A second weighted priority score would be a
second opinion about the same day, and two opinions is how the assistant and
the Today page start disagreeing."*

The lens honours that. **Order never changes; membership does.** It is the same
move `lifeScope` makes on the board, and it lives in its own module for the
same reason.

`src/lib/focusLens.ts` is the one vocabulary:

```ts
export type FocusLevel = 'low' | 'medium' | 'high';
export const FOCUS_CAP: Record<FocusLevel, number>;      // low 25, medium 60, high Infinity
export const DEFAULT_FOCUS_LEVEL: FocusLevel;            // 'medium'
export function focusLevelFor(stored, today): FocusLevel;
export function parseStoredFocusLevel(raw: unknown): StoredFocusLevel | null;
export function fitsFocus(level, expected: ExpectedTime): boolean;
export function isCommitment(reason: AdviceReason): boolean;
export function admits(level, reason, expected): boolean;
```

The caps are monotone: every level admits everything the level below it admits,
plus more. A dial whose middle setting hid something its lowest setting showed
would not be a dial.

### 6. A fact about today is never filtered

`scheduled-now`, `scheduled-next`, `due` and `committed-today` are true whatever
mood you are in. A shelf that hid your 2pm block because you told it you were
tired would be lying about your day, and the one thing this surface must be is
believable at a glance.

The lens therefore applies only to the discretionary tail — `committed-week`,
`carried-over`, `free-time`. Low changes how a fact is FRAMED (§8); it never
deletes one.

### 7. Unknown length is not short

`expectedTimeFor` returns a 30-minute `starter` when it has no evidence at all,
and the retired `workThatFits` refused to treat that as a prediction: *"an
invitation to begin, not evidence about length"*. Low inherits the refusal —
it requires positive evidence of shortness, so unestimated work drops out of
it. Medium and High admit it.

This is stated as a rule and not derived from the arithmetic. `30 > 25` and
`30 ≤ 60` happen to give the same answers today; if a cap moves, the rule is
what should decide, not the coincidence.

### 8. An emptied lens says so, and still offers something

Low will empty the discretionary tail routinely — that is what it is for. The
shelf must not answer that with "Nothing needs you right now", which means
something else entirely.

`ExecutionAdvice`'s work verdict gains `beyondFocus?: true`: when the lens
admits nothing but the unfiltered pool is not empty, the primary is the
unfiltered head, flagged. The surface says **"Nothing light left — this is next
when you're ready."**

It does NOT re-sort to find "the lightest thing available". That would be the
second opinion §5 forbids. The honest answer to "nothing here is short" is to
say so and show what is actually next.

This is the same distinction the codebase already keeps twice: `no-hours` is
not a zero, and `no-forecast` is not `at-risk`.

### 9. Low removes the comparison, not the number

The pressure in a running session is not the elapsed figure, it is the figure
it is measured against: `18m of 45m`. At Low, `elapsedAgainstExpected` returns
`18m so far` — the number survives, the verdict does not.

`expectedTimeLabel` is untouched. It is the INVITATION, shown on work that has
not begun, and softening an invitation the user has not accepted yet would be
patronising rather than kind.

### 10. A low-focus session is stored as low, and never learned from

`Session.focus?: 'low'` — written, never displayed. No trend, no readout, no
badge, nothing in the UI reads this field.

Its only job: `expectedTime`'s evidence gatherer skips low-focus sessions. A
90-minute slog through a 45-minute task in a loud room is not evidence that the
task takes 90 minutes, and without this the feature would quietly inflate every
future estimate on exactly the days the user was already struggling.

Only `'low'` is ever stored. `medium` and `high` are the norm, and a field
whose value on most rows means "nothing special" is a field that should be
absent — the same reason `status` never writes `'todo'` and `blocks` is absent
rather than `[]`.

**Actuals are untouched.** `loggedForNode` / `loggedForTask` and every capacity
figure count a low-focus session in full. The time really happened; it is only
disqualified as a PREDICTOR, never as a fact.

The level is frozen onto the draft at start (`ActiveFocusSession.focusLevel`),
beside `title` and `expected`, which are frozen for the same reason: changing
the dial mid-session must not relabel work already done.
`parseActiveFocusSession` validates it and treats absence as `medium`.

### 11. The lens stops at the shelf

`Today.tsx:60` calls `executionAdvice` too. `focusLevel` on
`ExecutionAdviceInput` is OPTIONAL and defaults to `'high'` — no cap — so
Today, Plan, the backlog rail and every capacity figure are unaffected.

This is the boundary the life switcher already holds: the board scopes, the
week never does. A mood set in a café must not rewrite the plan you check on
the train home.

### 12. Keyboard

Enter no longer belongs to a text field, so it goes to the thing the shelf
exists for.

| Key | Does |
|---|---|
| `Enter` | Start the primary session (or Continue / Complete, per phase — always the filled button) |
| `1` `2` `3` | Low / Medium / High |
| `Esc` | Close |

`Enter` binds to whichever button `dialogFooter`'s reading-edge rule already
put last and filled. There is one filled button per state, so there is never a
question of which one `Enter` means.

## Modules

| File | Change |
|---|---|
| `src/lib/focusLens.ts` + test | NEW — the whole vocabulary |
| `src/lib/assistantCommands.ts` + test | DELETED |
| `src/lib/assistantProtocol.ts` | `focusLevel` on the snapshot, `set-focus-level` in, four proposal verbs out; `elapsedAgainstExpected` takes the level |
| `src/lib/executionAdvisor.ts` + test | optional `focusLevel` input, membership filter, `beyondFocus`; `rankedWork` / `workThatFits` deleted |
| `src/lib/expectedTime.ts` + test | evidence gatherer skips `focus === 'low'` |
| `src/lib/focusSession.ts` + test | `focusLevel` frozen on the draft, parsed and defaulted |
| `src/db/types.ts` | `Session.focus?: 'low'` |
| `src/db/db.ts` | persist/read the stored focus level |
| `src/state/store.ts` | `focusLevel` state, `setFocusLevel` action, level onto the logged session |
| `src/components/assistant/AssistantSurface.tsx` + test | input and proposals out, focus strip in, notice beside the body |
| `src/components/assistant/AssistantHost.tsx` | proposal state and parser branches deleted |
| `src/assistant/AssistantOverlay.tsx` | card hugs content on darwin; click the remainder to close |
| `electron/assistantIpc.cjs` + test | new verb validated, four retired |
| `electron/assistantWindow.cjs` | `HEIGHT` re-measured, comment restated as a budget |

## Tests

Pure lib first, per the project's convention:

- `focusLens`: caps are monotone; `focusLevelFor` resets on a date change and
  holds within a day; a malformed stored value reads as `medium` rather than
  throwing; `fitsFocus` refuses a `starter` at Low and admits it at Medium;
  a history range is judged on its high end; `isCommitment` covers all seven
  reasons exhaustively.
- `executionAdvisor`: a scheduled 90m block still leads at Low; a 45m
  free-time item does not; order is byte-identical with and without the lens
  when nothing is filtered; `beyondFocus` is set when the lens empties a
  non-empty pool and never when the pool was empty to begin with.
- `expectedTime`: a low-focus session is excluded from evidence while a
  same-length ordinary session is included; actuals still count it.
- `focusSession`: the level is frozen at start and survives a
  serialize/parse round trip; a draft written before this field parses as
  `medium`.
- `AssistantSurface`: a notice never removes the primary action; the focus
  strip sets the level; Low drops the comparison from a running session;
  `beyondFocus` renders its sentence; there is no textbox on the surface at all.
- `entryBoundary`: unchanged and must stay green — the overlay still reaches
  no store, no Dexie, no lock.

Then `npm test` and `npx tsc -b`.

## Non-goals

- No focus-level trend, history view, or badge anywhere in the app.
- No per-life or per-goal focus level.
- No change to Today, Plan, the backlog rail, or any capacity figure.
- No native window resizing.
- No replacement for the retired natural-language verbs; `⌘K` is the answer.

## Risks

- **The retired verbs are a real capability loss.** Anyone who used
  "Add lab report Friday" from the shelf now opens the app and presses `⌘K`.
  Accepted deliberately: the shelf's job is starting work, and the parser was a
  second opinion about sentences.
- **Low may feel empty on a new dataset**, where most work is a `starter` and
  §7 refuses it. §8 is the mitigation — the shelf always offers something and
  says why it is not light. If this bites in use, the fix is more estimates,
  not a looser lens.
- **`Session.focus` is a schema addition**; older rows simply lack it and read
  as ordinary sessions, which is the correct default.
