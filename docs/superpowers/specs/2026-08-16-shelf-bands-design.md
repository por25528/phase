# The shelf in three bands

The assistant shelf is the surface Phase is summoned by. It is also the one
surface where the thing you came for — the name of the work — has less room than
anything else on screen. This gives it the room, and conforms the rest of the
card to the Stone remaster it shipped alongside but never fully inherited.

**Scope: layout and hierarchy.** No token value changes, no store action
changes, no new behaviour, no fact removed from the surface. One token
*misuse* is corrected (§6). Two pinned decisions are deliberately overturned
and named as such (§8).

## The problem

Measured, by rendering `dist/assistant.html` at the real 620px in both themes
(`scripts/measure-shelf.cjs`, extended to capture rather than measure).

**The title gets 165px of a 620px window.** `AdvicePanel`'s shelf branch is
`grid-cols-[minmax(0,1fr)_1px_200px]`, and inside that first column
`bodyClass(true)` is `grid-cols-[minmax(0,1fr)_auto]` with the Start button in
the `auto` track. After the sidecar's 200px, the divider, two gaps, the
checkbox and the button, the `<h2>` is left with about 165px. "Review the
onboarding copy" — five words — wraps mid-phrase.

**Hierarchy is inverted.** The two alternatives are bordered `optionRow` boxes
on `bg-panel`. The primary recommendation has no container at all. The only
things on the card wearing a border are the ones you are being invited *not* to
pick.

**The title's left edge moves between states.** The `info` block is preceded by
a checkbox and a ring, both rendered only when `focus.phase !== 'confirming'`.
So the heading starts at 71px in `active` and at 37px in `confirming` — the
shelf's most important line jumps left as a session ends.

**The dials outrank the content.** `DialStrip` is the first child of the card,
above the notice and above the work. The least important thing on the surface —
two view-state switches — holds the position the eye lands on first.

**`Other options` is an unstyled text button** stranded at the bottom-left of
`FocusPanel`, below the fold of every other element's rhythm.

## 1. Three bands

One column, three full-width bands, in every state. `shelf` presentation only;
`embedded` (380px, `AssistantHost`) keeps its stacked arrangement and inherits
only the shared fixes in §5–§7.

```
+------------------------------------------------------+
|  HAPPENING NOW                                       |   band 1 - the work
|  [ ] Review the onboarding copy for th... [ Start ]  |
|      Comparative Literature * Planned 45m            |
+------------------------------------------------------+
|  OR                                                  |   band 2 - alternatives
|  Rewrite the pricing page hero        Usually 45-60m |
|  Reply to the Figma thread              Suggested 30m|
+------------------------------------------------------+
|  Time [30m|1h|Any]    Focus [Low|Medium|High]        |   band 3 - the dials
+------------------------------------------------------+
```

**Provenance of the figures below.** They come from a throwaway HTML mockup
rendered at 620px against the app's real token stylesheet — close enough to
choose a layout by, and *not* a substitute for `measure-shelf.cjs` against the
real component. Every one of them is re-measured in §10 before `HEIGHT` moves.

Mockup: 230px against the 264px budget, with the alternatives open in every
state. The title gets **433px**, 2.6× today's 165px.

## 2. Band 1 — the work

**A reserved leading gutter.** The checkbox slot is always occupied — 22px plus
a 12px gap — including in `confirming`, which renders no checkbox and today
therefore starts its heading 34px further left than the state that preceded it
one click earlier.

The ring's slot (34px plus 8px) is reserved across **all three** session phases
— `active`, `break` and `confirming` — not only the two that draw a ring. The
indent therefore holds for as long as a session lasts, which is the interval
over which a person actually watches this line. Idle work indents 34px, a
session indents 76px; that step happens only when the whole card's content
changes anyway.

The ring stays second, after the checkbox, per the existing invariant — it is
not moved to the right to make the gutter uniform.

**Actions right, on the title's row.** `Start session` idle; `Take break` +
`Complete session` running; `Didn't happen` + `Log Nm` confirming. Order and
variants are unchanged — `dialogFooter`'s reading-edge rule still puts the
filled button last, and which button is filled still depends on the phase.

**`Complete session` keeps its full label.** The mockup shortened it to
`Complete` to fit; that was a mockup expedient, not a decision. Subtracting both
buttons at full width from the 588px content box leaves the title roughly 247px
— arithmetic, so §10 verifies it — which is still half again today's 165px.

The word `session` is load-bearing, and not for cross-app consistency: the
string appears in exactly one file, so nothing outside the shelf would have
disagreed. It is load-bearing because **this card carries two completion
controls**. The `TodayCheckbox` in the gutter finishes the WORK and is the only
thing here that moves a number; the button ends the SITTING and logs minutes.
Labelling the button `Complete` puts two controls reading "complete" on one
card with nothing but position to tell them apart.

If measurement contradicts the arithmetic, the buttons move to their own row
before the label is touched.

## 3. Band 2 — the alternatives

Rows lose `optionRow`'s border and background and become text rows separated by
`border-line-soft` hairlines: title in `text-body text-ink-soft`, the
`expectedTimeLabel` phrase right-aligned in `text-meta text-muted`. Each row
stays one button with the whole row as its hit area.

**The `Other options` disclosure is retired.** It survived in `FocusPanel`
because two full-length buttons ate the width, which is exactly the constraint
band 1 removes. The running-session alternatives move into the open, in this
band, under a `Switch to` label — `Or` when idle. Two labels because they are
two verbs: starting work you have not begun, and abandoning a sitting for
another. Both use `sectionLabel`; they name regions.

The band renders nothing when there are no alternatives.

## 4. Band 3 — the dials

Bottom bar on `bg-bg` with a hairline above, so the settings sit under the
content rather than over it.

**Captions become parallel nouns: `TIME` and `FOCUS`.** Today they read
`I've got` and `Focus` — one completes a sentence with its control, the other
names a thing. Two nouns of the same kind fixes that, and `30m / 1h / Any`
reads naturally after `Time`.

**They take the mono voice, and this amends Stone §5.** That section lists
`AssistantSurface.tsx:77` — the `Focus` caption — as one of five sites that
share the section-label class string by coincidence and must keep
`text-meta font-semibold text-muted` written out, on the grounds that a caption
beside its control is not a region heading. That reasoning was sound while the
caption sat in a strip at the TOP of the card, where it competed with the
work's own eyebrow one line below it. In a bottom status bar it competes with
nothing: the two bands above it are the only content, and the bar reads as the
instrument's legend, which is the exact quality the mono voice was adopted for.

So the captions take that voice — but **as a second export in
`src/components/sectionLabel.ts`, named `captionLabel`, not as a string spelled
at the call site.** An earlier draft of this spec had `AssistantSurface.tsx`
hand-roll it, reasoning that a caption must not follow the section-label
constant if that constant changes. The reasoning survives; the implementation
does not.

**Why it moved, and it is not a detail.** `designScale.test.ts`'s uppercase
guard is a FILE allowlist: it compares only the filename against the four
weekday strips and `sectionLabel.ts`, and never inspects the line. `font-mono`
on the same line does NOT make `uppercase` legal — an earlier version of this
section asserted that it did, and was simply wrong. The guard's own doc comment
describes a co-occurrence rule its code does not implement; what the code
enforces is the stricter and better rule stated in its second paragraph — *a
voice is declared once and imported, never hand-rolled.*

Declaring `captionLabel` beside `sectionLabel` satisfies that rule, keeps
`AssistantSurface.tsx` free of the word `uppercase`, and still gives the caption
its own name to diverge under. The guard is not edited and gains no new
exception — weakening a guard to accommodate a spec's mistake is backwards.

Stone §5's table entry for this site is amended in the same change, so the doc
and the code agree; the other four exceptions are untouched.

`SegmentedSwitch` at `sm` is unchanged.

## 5. The notice

Stays a line above the body, per the existing invariant — it is never a
replacement for the body, and there is no state of the shelf with nothing to
press. It gains `truncate`: today `Completed "…" · logged 45m` with a real task
title wraps to two lines and becomes the largest block of text on the card.

## 6. The skeleton

`Skeleton` fills its rows with `bg-fill`, which is the **ink** token —
`#1A1A18` light, `#EBE7DE` dark. In light mode the loading state is three solid
black bars.

Rows move to `bg-hover` (`#F2F1EE` / `#262421`), and the three shapes are
reshaped to band 1 / band 2 / band 3 so the card does not reflow into a
different layout when the snapshot lands.

## 7. Title overflow

`line-clamp-2` becomes `truncate`, with the full string on `title` for hover.

The card's height then does not depend on its content, which is what a window
that is fixed-height and **clips rather than scrolls** wants. It also collapses
the worst case `HEIGHT` is budgeted against: the current 264px was measured
against a title long enough to wrap, and that input no longer exists.

`HEIGHT` must be re-measured with `scripts/measure-shelf.cjs` after this lands
and moved to whatever the tallest state then prints. It is a measurement, never
an arithmetic guess — that is the standing rule in `assistantWindow.cjs`, and
its own comment records a pass that shipped the number 20px low.

## 8. Decisions this overturns

Both are pinned in tests and are being changed on purpose, not worked around.

| Pinned | Where | Why it changes |
|---|---|---|
| `line-clamp-2` on the primary title | `AssistantSurface.test.tsx:427` — "wraps a long primary title to two lines while quiet metadata truncates" | The clamp was correct when the title had 165px and needed two lines to say anything. At 433px one line carries the name, and constant height is worth more to a clipping window. |
| `Other options` disclosure in `FocusPanel` | `AssistantSurface.test.tsx:101` asserts its absence on the idle panel; the running panel renders it | Its stated reason was width. Band 1 gives the width back. |

`assistantWindow.cjs`'s `HEIGHT` comment describes `line-clamp-2` as the
worst case and must be rewritten with the new measurement, not merely
re-numbered.

## 9. What does not change

- Every action, every state, every fact the surface states today.
- `AssistantAction` / `AssistantSnapshot` — the protocol is untouched, so the
  Electron relay, `agentIpc` and the overlay's store-free boundary are too.
- `dialogStyles` variants and which button is filled in which phase.
- `SessionRing`, `TodayCheckbox`, `SegmentedSwitch`, `useAssistantSendoff` and
  the send-off's pinned-height behaviour.
- The `embedded` presentation's stacked arrangement.
- Every colour token value. Stone is inherited, not amended.

## 10. Tests

- `AssistantSurface.test.tsx` — the two overturned assertions rewritten to pin
  the new decisions (`truncate` on the title; alternatives reachable without a
  disclosure in the running state). Every other assertion in the file must pass
  unchanged; they are about actions and accessible names, which this does not
  touch.
- A new assertion that the leading gutter is present in `confirming`, so the
  left-edge jump cannot come back unnoticed.
- A new assertion that the running state keeps `Complete session` at its full
  label, so the mockup's expedient cannot creep back in under height pressure.
- `designScale.test.ts` and `paletteContrast.test.ts` must pass untouched — no
  literal hex, no arbitrary `text-[Nrem]`, no uppercase without `font-mono`.
- `npm run build` then `npx electron scripts/measure-shelf.cjs`, and `HEIGHT`
  set from its output.

## Out of scope

The spacing scale (Stone deferred it last, and it still is), the `embedded`
presentation's layout, and any change to what the advisor recommends.
