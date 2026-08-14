# The shelf takes your gap as an argument, and never counts down

**Date:** 2026-08-15
**Status:** approved design, not yet planned

## What is wrong today

One screenshot of the shelf, measured rather than eyeballed, gives four faults.

1. **A focus ring is on 100% of the time.** `AdvicePanel`'s Start button carries
   `autoFocus` (`AssistantSurface.tsx:279`) and `index.css:174` paints
   `:focus-visible` as `2px solid accent` at `outline-offset: 1px`. The shelf
   autofocuses on every open, so the ring never distinguishes anything. It is
   decoration, in the one hue the system reserves for action.
2. **That ring is clipped.** Measured off the screenshot, the orange stops dead
   at the button's own right edge while the card's inner edge is 13px further
   out. The cause is not the card's `overflow-hidden` — it is
   `<div className="min-h-0 flex-1 overflow-y-auto">` (`AssistantSurface.tsx:373`).
   `overflow-y: auto` forces `overflow-x: auto`, and a scroll container clips at
   its padding box, taking the 3px the outline sits outside the button.
3. **"Other options" does not merely hide the alternatives — it loses them.**
   Expanded with two alternatives the card computes to ~237px inside a 219px
   window. The card hugs its content and the window CLIPS rather than scrolls
   (`shelfSizing`, `assistantWindow.cjs`), so the second alternative is partly
   cut off the bottom of the screen. **This must be measured for real during
   implementation; it is a computed figure, not an observed one.**
4. **The dial is labelled for the wrong axis.** `FOCUS_CAP` is
   `{ low: 25, medium: 60, high: Infinity }` under the comment "The longest
   piece of DISCRETIONARY work each level will offer, in minutes". The control
   that asks how you feel is, underneath, asking how long you have.

## What it becomes

```
┌──────────────────────────────────────────────────────────────┐
│ I’ve got [30m][1h][Any]   Focus [Low][Med][High]             │
├──────────────────────────────────────────────────────────────┤
│ Carried over                          │  Or                  │
│ Finish A Youtube video  [Start session]│  Pitch deck         │
│ Suggested 30m                         │  Launch · 25m        │
└──────────────────────────────────────────────────────────────┘
```

Two dials that never touch the same number, a body that spends the shelf's
WIDTH instead of its scarce height, and a session clock that only ever counts
up.

## The rule the whole thing hangs off

> **You say how long you've got so Phase can choose. Once you start, nothing
> counts down.**

The time dial picks the WORK. It never bounds the SESSION, and it never fires a
notice when you pass the gap you declared — you told the shelf thirty minutes so
it could pick something, not so it could hold you to it. A day with a university
class, traffic and a friend calling is not a day any app should be predicting;
the one number Phase needs is the one you are holding when you summon it.

This is why the shelf will not compute "you have 1h 10m free until 18:00", which
was the first design considered and is the wrong one. A predicted gap is wrong
exactly when the day goes sideways, which is exactly when you open the shelf.

## Decisions

### 1. `focusLens` becomes the time dial, under an honest label

The module is renamed to state what it already does. No cap changes, no
membership changes, no ranking anywhere — every rule it carries survives
verbatim:

- a history range is judged on its HIGH end;
- an unknown length is never assumed short, so the narrowest level refuses a
  `starter` as a RULE and not as arithmetic;
- a FACT about today — `scheduled-now`, `scheduled-next`, `due`,
  `committed-today` — is never filtered, so a two-hour block you are already
  committed to still appears even when you claim twenty minutes;
- an emptied lens answers `beyondWindow` and offers the unfiltered head rather
  than re-sorting to find something lighter.

| today | becomes |
|---|---|
| `src/lib/focusLens.ts` | `src/lib/timeLens.ts` |
| `FocusLevel` | `TimeLevel` |
| `FOCUS_CAP` `{25, 60, ∞}` | `TIME_CAP` `{30, 60, ∞}` — see below |
| `FOCUS_WORD` `Low/Medium/High` | `TIME_WORD` `30m / 1h / Any` |
| `fitsFocus` | `fitsWindow` |
| `beyondFocus` | `beyondWindow` |
| `DEFAULT_FOCUS_LEVEL` | `DEFAULT_TIME_LEVEL`, still `medium`, still reset per day by `focusLevelFor` |

**The cap for the narrowest level moves 25 → 30**, so the chip can say a round
number a person would actually think in. A chip reading `25m` states a
threshold nobody chose; `30m` is the gap people have.

**`Session.focus` keeps its storage name** and now records the TIME level, not
the display one. It is still written only at the narrowest setting, still
frozen onto the draft at start, and still read by exactly one thing —
`expectedTime`'s evidence gatherer, which skips it. The reason survives the
rename intact and gets sharper: a session run inside a declared thirty-minute
gap is not evidence that the work takes thirty minutes. The stored key diverging
from the UI word follows the precedent `checkpoint`/Milestone already sets.
The DISPLAY dial is never stored on a session, because how many options you were
shown cannot affect how long you worked.

### 2. Focus becomes how much the shelf puts in front of you

A task in Phase carries a title, an estimate, a status, dates and blocks.
Nothing says how HARD it is, so Focus cannot mean "give me easy work" without
inventing a field that must then be filled in by hand, forever, for every task.
What it can honestly mean is how many choices you are handed.

`src/lib/shelfDetail.ts`, new and thin:

```ts
export type DetailLevel = 'low' | 'medium' | 'high';
export const ALTERNATIVE_CAP: Record<DetailLevel, number> = { low: 0, medium: 1, high: 2 };
```

`MAX_ALTERNATIVES` (2) stands unchanged as the ceiling; the dial caps BELOW it
and never above. Low removes the sidecar column entirely — one card, no menu,
because choosing is the expensive part when you are tired.

It touches no ranking and no filter. The same work is there; you are handed less
of it. Pure view state, like `activeLifeId` on the board — held in memory, never
persisted, never on a session.

`elapsedAgainstExpected`'s third parameter changes type from `FocusLevel` to
`DetailLevel`. Dropping the comparison on a running session is a statement about
how much you want in front of you, not about how long your gap is — its own
comment says "the pressure was never the elapsed figure, it is the figure it is
being measured against", which is the display axis exactly.

The `1`/`2`/`3` keys keep driving the TIME dial, the one that changes what you
are offered. The display dial takes no shortcut: two dials on three number keys
would need six, and the shelf is not a keyboard surface (§6).

`ALTERNATIVE_CAP`'s middle value is the weakest thing in this spec. One
alternative versus two is a small gap for a whole segment of a control, and the
live alternative is a two-position switch (*One thing* / *Show me the options*)
at the cost of dropping `FOCUS_LEVELS` from three values to two. Three is kept
because two would churn the stored value space, the `1`/`2`/`3` shortcuts and
the daily-reset default for a cosmetic gain — but this is the first thing to
revisit after living with it.

### 3. The body is Sidecar, and it retires the disclosure

`OtherOptions` is deleted. The alternatives become a right-hand column at a
fixed 200px, under a quiet `Or`, each row one click from starting.

The reason to spend width rather than height is that height is the scarce
budget: `HEIGHT` is 219 and the window clips. Sidecar at Medium computes to
~168px where the disclosure expanded computes to ~237px, which is how a layout
change fixes fault 3 without touching the window at all.

**The sidecar is the `shelf` presentation only.** `AssistantHost` renders the
same surface in-app at `w-[380px]` (`AssistantHost.tsx:170`), where a 200px
column beside a primary would leave the title about 160px to live in. The
embedded presentation keeps its vertical stack and simply lists the same
alternatives as rows beneath the primary, capped by the same `ALTERNATIVE_CAP`.
One component, two arrangements — which is what `bodyClass(shelf)` already does,
extended rather than replaced. The disclosure is deleted in BOTH: it is the
disclosure that loses rows, not the layout.

**The sidecar is withheld whenever a session is running.** The running state
needs its width for two full-length buttons, and shortening "Complete session"
to "Complete" to make room for a menu would be the tail wagging the dog. While
you are working, a list of other things to do is the opposite of the point.
Switching work mid-session stays reachable exactly where it is today.

### 4. The session ring

A small circle on the running states — 34px, 2.5px stroke — under one rule:

> **The ring fills only against evidence, and only when the shelf is showing
> comparisons at all.**

- `history` — fills toward the HIGH end of the range, reusing `fitsWindow`'s
  existing "judged on its high end" rule rather than inventing a second one.
- `estimate` — fills toward the number, and past it: at 100% the arc completes
  and the overflow is drawn as a second arc in `accent`. It goes past and
  nothing bad happens, exactly as `38m of 30m` already reads today.
- `starter` — Phase's own guess, which the codebase already refuses to treat as
  evidence. **The ring does not fill against it.** It turns instead. Filling a
  ring against a guess is how a guess becomes a target, and a target is the
  countdown this design exists to avoid, wearing a circle.
- **Detail Low** — the ring turns regardless of evidence, because
  `elapsedAgainstExpected` already drops the comparison at that level
  ("the pressure was never the elapsed figure — it is the figure it is being
  measured against"). A graphic that kept asserting a target the text had just
  withheld would make the card contradict itself.
- **Break** — the arc holds its position and stops moving, track dashed. The one
  state where a still circle is the content.
- **Confirming** — no ring. Nothing is running and the question is not about
  time passing.

There is no ring on the idle card: it would be the only mark on the shelf that
means nothing.

### 5. The send-off carries a quote

`Good luck!` is replaced by a quote and its attribution.

`MESSAGE_AND_HOLD_MS` grows from 660ms to ~2400ms, because nobody reads a quote
in 660ms. This blocks nothing — the session has already started and the work is
under way — but it does leave an always-on-top panel over the screen for two
seconds, which is the whole cost of this decision, stated plainly.

Reduced motion drops the TRANSFORM and keeps the duration. Reduced motion means
less movement, not less content; closing before the quote can be read would show
that user a flash of text they can never finish.

`src/lib/sendoff.ts`:

```ts
interface Sendoff { text: string; who: string; source: string }
```

**`source` is required and is the point.** Famous-quote misattribution is
endemic — the Einstein, Ford, Twain and Churchill lines that circulate were
mostly never said by them. A quote that cannot name where it is documented does
not go in the file, which makes the list checkable instead of a matter of taste.
Every entry is to be verified against its named source during implementation;
the starting list below is the well-documented end, not a cleared one.

Selection is derived from the session's start timestamp, never `Math.random()`
— it varies every session and a test can still pin it.

The face stays Inter. Fraunces was mocked, is genuinely the prettiest of the
options, and would fail `designScale.test.ts`, which asserts `font-disp` appears
exactly once, on the wordmark. "The wordmark and the send-off" is a defensible
rule too, but it is a different rule and deliberately not adopted here.

**The empty state gets a quote as well** — `Nothing needs you right now.` was the
one state where two dials outweighed the content three to one. It is the only
surface with room and no hurry.

### 6. The ring around the button goes

`autoFocus` comes off every button on the surface. Nothing is focused when the
shelf opens, so nothing paints. This is the whole of fault 1: a shelf that
always focuses the same button gains nothing from a mark that says which button
is focused.

The cost is Enter-to-start, which was explicitly declined as unnecessary. A
keyboard contract for the shelf — Enter runs the one filled button, rings held
back until the first Tab — was designed and is deliberately NOT part of this
work.

For fault 2, focus rings inside the shelf become inset:

```css
[data-shelf] :focus-visible { outline-offset: -2px; }
```

Scoped to the shelf and stated with its reason: the shelf is a small card whose
panels scroll, and a scroll container clips at its padding box, so an outset
ring is cut by whichever scroller it lands nearest. An inset ring paints inside
the element's own border box and cannot be clipped by an ancestor. Accent on
`ink` measures 3.52:1, clearing the 3:1 WCAG 1.4.11 floor for a focus indicator
against its adjacent colour.

`data-shelf` already exists on the overlay card (`AssistantOverlay.tsx:111`) and
must be added to the embedded host, which needs it for the same reason and not
merely for consistency: `AssistantHost.tsx:170` carries its own `overflow-y-auto`
on a 380px panel, so it clips an outset ring exactly as the overlay's scroller
does.

### 7. Copy that stops being true

`Nothing light left — this is next when you're ready.` becomes
`Nothing that short left — this is next when you're ready.` Once the dial means
time, "light" describes an axis the control no longer has.

## Out of scope, deliberately

- **The `needs-hours` dead end.** It names Settings and cannot open them,
  because the overlay is a separate renderer with no store. Fixing it needs a
  new verb across the relay and belongs to its own change.
- **A predicted free-time readout, a day ribbon, and a day's ledger.** All three
  were designed and rejected with the prediction they rest on, except the ledger,
  which survives only as a possible tenant of the header's right side later.
- **The keyboard contract** (§6).
- **Any change to how sessions are logged.** `confirm-focus`, the stopwatch and
  every capacity figure are untouched.

## Invariants this must not break

- The overlay receives no new snapshot fields. It stays a separate renderer with
  a narrower preload, no store, no Dexie, no tab lock and no clock — and
  `entryBoundary.test.ts` must still prove it cannot reach those modules.
- No raw calendar event titles, notes, asset ids or URLs cross the relay. The
  design adds nothing here, which is the reason the prediction ideas died.
- The advisor keeps no ranking of its own. Both dials change membership or
  presentation; neither reorders.
- `MAX_ALTERNATIVES` stays 2 as the ceiling.
- `HEIGHT` in `assistantWindow.cjs` is MEASURED against the tallest state, never
  derived. The tallest state is expected to remain `confirming` with a notice,
  which would leave 219 standing — but it is re-measured at 620px wide before
  this is done, and the sidecar at High is measured too, since a two-row column
  can now outgrow the primary beside it.

## Testing

- `timeLens.test.ts` — the renamed module keeps every existing case; the
  narrowest cap is 30; a fact about today survives the narrowest window; a
  `starter` is refused as a rule.
- `shelfDetail.test.ts` — `ALTERNATIVE_CAP` is monotone and never exceeds
  `MAX_ALTERNATIVES`.
- `sendoff.test.ts` — every quote carries a non-empty `source`; selection is
  deterministic for a given start time and varies across sessions.
- `AssistantSurface.test.tsx` — no element carries `autoFocus`; the sidecar is
  absent at detail Low and while a session runs; the ring fills for `history`
  and `estimate`, turns for `starter`, turns at detail Low, and is absent while
  confirming.
- A regression test for fault 3: the alternatives are reachable without a
  disclosure, so no state of the advice card can exceed the window.
