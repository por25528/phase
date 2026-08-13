# Assistant shelf — control vocabulary, session copy, frame

**Date:** 2026-08-13
**Scope:** Visual and copy only. No change to what the shelf does, which actions
it offers, how it is laid out, or how the window is sized at runtime.

## The problem

The floating shelf (`⌘Space` → `AssistantSurface` at `presentation="shelf"`,
620×200) reads as unfinished in three separate ways.

**It speaks its own control language.** `AssistantSurface` hand-rolls
`quietButton` — `rounded-field border border-line bg-panel px-3 py-1.5` — and
expresses "this one is primary" as `border-line-2 font-medium`, a one-shade
border difference. The app already settled this question in
`src/components/dialogStyles.ts`, whose header comment is a written account of
four dialogs having drifted into four button styles. The shelf is the fifth
drift. At 620px the consequence is that "Complete session" and "Continue" are
two identical buttons with no primary between them, and during a break the
shelf gives equal billing to ending the session and to resuming it.

**One line of copy contradicts itself.** `FocusPanel`'s status line renders
`expectedTimeLabel(focus.expected)` on a session that is already running. For
`kind: 'starter'` that function returns "Start with 30m" — deliberately an
*invitation to begin*, per its own doc comment — so a paused session reads
`0m worked · on a break · Start with 30m`: three clauses, the last of which
addresses a state that has already passed.

**The frame is loose.** `p-4` + `gap-3` + the dialogs' absent control metrics
leave the common case short of the 200px window while the case with
alternatives overflows it. The empty band is most visible on a session with no
goal title, which is the screenshot this work started from.

## Decisions

### 1. The shelf adopts `dialogStyles`

`quietButton` is deleted. `AssistantSurface` imports `primaryBtn`,
`secondaryBtn` and `ghostBtn` from `../dialogStyles`.

| state | `primaryBtn` (filled) | `secondaryBtn` (outlined) | `ghostBtn` (borderless) |
| --- | --- | --- | --- |
| `active` | Complete session | Take break | — |
| `break` | **Continue** | Complete session | — |
| `confirming` | Log *N*m | — | Didn't happen |
| advice (`work`) | Start session | — | — |
| proposal | Confirm | — | Cancel |

**The filled button is whatever moves the session forward from the state you
are in.** It is why the shelf was summoned in that state: on a break you came
back to resume, mid-session you came to finish, and in `confirming` the shelf
is asking a question whose expected answer is yes.

**The dismissive answer is `ghostBtn`, never outlined.** "Didn't happen" and
"Cancel" are the *no*. A border on them makes them compete with a real
secondary action, and neither is one.

**The primary sits last**, per `dialogFooter`'s rule — the commit button lands
under the reading edge. The shelf's actions column is already right-aligned, so
this is the same rule, not a new one. The accepted cost: "Complete session"
changes side between `active` and `break`, because which button is primary
changes. The two states are mutually exclusive and the labels are distinct, so
the target that moves is never ambiguous.

The list-shaped buttons — `choose-subject` choices, and the alternatives inside
`OtherOptions` — are **rows, not dialog buttons**. They keep a local
left-aligned style, renamed `optionRow`, so that it is legible as a row
treatment rather than as a fourth button variant that drifted from the other
three.

### 2. A running session states progress, not an invitation

A new pure helper beside `expectedTimeLabel` in `src/lib/assistantProtocol.ts`,
with cases in the sibling test:

```ts
elapsedAgainstExpected(0,  { kind: 'starter',  minutes: 30 })      // "0m of 30m"
elapsedAgainstExpected(5,  { kind: 'estimate', minutes: 30 })      // "5m of 30m"
elapsedAgainstExpected(12, { kind: 'history', lowMin: 45, highMin: 60 }) // "12m of 45–60m"
```

`FocusPanel`'s non-confirming line becomes `0m of 30m · On a break` — two
clauses, and the break clause is capitalised because it is now a clause rather
than a trailing aside.

`expectedTimeLabel` is **unchanged and stays in use**. It is correct where it
lives on `AdvicePanel`, describing work that has not started. The defect was
only ever reaching for the not-yet-started phrasing on a session in progress.

**No other verb changes.** The session verbs exist nowhere else in the app:
"Start session" already matches `views/Today.tsx`, and "Complete" matches the
completion language `store.ts` uses in its undo toasts.

### 3. The frame tightens and the window follows

- `p-4` → `p-3` and `gap-3` → `gap-2` on the surface root, and `p-4` → `p-3` on
  `Skeleton`, so the loading state does not jump when the real content lands.
- `HEIGHT` 200 → 190 in `electron/assistantWindow.cjs`, with its comment
  rewritten — the current one explains 620×200 as a deliberate choice, so the
  new number needs the new reason rather than the old reason with a new
  numeral.

The target is that **no state scrolls**, including the focus-with-alternatives
state that overflows 200px today. Note that adopting `dialogStyles` raises each
control from `py-1.5` to the dialogs' 33px, which the 190 must absorb.

The arithmetic that produced 190 is an estimate from the type scale, not a
measurement. **190 is provisional and must be confirmed against the running
shelf**; see Verification.

## Out of scope

Named here because each was considered and rejected for this pass, not
overlooked:

- Sizing the window to its content over IPC.
- Rearranging the layout — where the input sits, whether `OtherOptions` is
  always expanded, how the proposal panels compose on a 620px bar.
- Changing which actions the shelf offers, or adding keyboard operability
  beyond the Escape handling that already exists.

## Verification

- `npm test` and `npx tsc -b`.
- **The running status line has no test today.** `AssistantSurface.test.tsx:112`
  asserts `Start with 30m`, but inside *"distinguishes history, planned
  estimate, and starter language"*, which renders an **advice** snapshot — work
  that has not started. That assertion is correct and stays exactly as it is.
  The only test touching a session in `break` (line 238) clicks Continue and
  never reads the status line. That absence is why the defect shipped, so the
  work adds the missing assertion rather than flipping an existing one.
- `assistantWindowController.test.ts` pins `height: 200` in eight places
  (lines 125, 128, 129, 187, 193, 223, 245, 291). Several other `200`s and
  `height:`s nearby are unrelated and must not be swept up: the cursor point
  `{ x: -100, y: 200 }` (lines 202, 221), the work-area `height: 957`/`900`
  fixtures (111, 186, 192, 204, 641), and `elapsedMin: 200` in
  `AssistantSurface.test.tsx`.
- Physical: the shelf is an `NSPanel` invisible to the usual accessibility
  tooling. Probe it through the System Events AX window list, per the standing
  note on verifying this surface, and confirm against a real session that no
  state scrolls at 190px. If one does, 190 is wrong and moves — the constant
  serves the states, not the other way round.

## Files

| file | change |
| --- | --- |
| `src/components/assistant/AssistantSurface.tsx` | delete `quietButton`; adopt `dialogStyles`; `optionRow`; button order; status line; `p-3`/`gap-2` |
| `src/lib/assistantProtocol.ts` | add `elapsedAgainstExpected` |
| `src/lib/assistantProtocol.test.ts` | **new file** — the module has no sibling test today, and `expectedTimeLabel` is currently covered only indirectly through `AssistantSurface.test.tsx`. Cases for all three `ExpectedTime` kinds, for both functions |
| `src/components/assistant/AssistantSurface.test.tsx` | **add** a running-session status-line assertion and a button-order assertion. Nothing existing flips |
| `electron/assistantWindow.cjs` | `HEIGHT` 200 → 190, comment |
| `electron/assistantWindowController.test.ts` | five `200`s — not the cursor point |
