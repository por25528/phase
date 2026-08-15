# The shelf can say you finished, not only that you stopped

**Date:** 2026-08-15
**Status:** approved design, not yet planned

## What is wrong today

The shelf has three buttons that end a session and none that end the WORK.

`Complete session` calls `completeFocus` (`store.ts:1912`), which logs a
`Session` — minutes, a date, and nothing else — and clears the draft. `Take
break` parks it. `Didn't happen` throws the minutes away. All three answer the
question "what happened to the sitting". None of them answers "is the task
finished", and in this app that second question is the only one that moves a
number: `pct.ts` counts `'done'` and nothing else.

So the flow the shelf was built for has a hole in exactly the place it ends.
You press ⌘Space, take the work it offers, press `Start session`, and the shelf
sends you off and hides itself in about a second. You do the work. You come
back, press ⌘Space again — and the shelf that just handed you the task will not
take it back. It offers `Take break` and `Complete session`. To tick the thing
off you have to leave the shelf, find the app, find the goal, find the row.

The shelf already knows which task it is. Every state carries a `WorkRef`, which
is precisely the handle `toggleLeaf` and `toggleTask` need. Nothing has to be
plumbed. The verb is simply absent.

## What it becomes

```
You come back, hit ⌘Space, session still running:
┌──────────────────────────────────────────────────────────────┐
│ I’ve got [30m][1h][Any]   Focus [Low][Med][High]             │
├──────────────────────────────────────────────────────────────┤
│ ☐  ◜◝  Focus session                        [Take break]      │
│    ◟◞  Write intro paragraph          ▐Complete session▌      │
│        Thesis · 12m of 45m                                    │
└──────────────────────────────────────────────────────────────┘
     ↑ tick it — that is the whole gesture

No session running — the same box, no new state:
┌──────────────────────────────────────────────────────────────┐
│ ☐  Fits your free time                │  Or                   │
│    Write intro paragraph  ▐Start▌     │  Pitch deck           │
│    Thesis · Planned 45m               │  Launch · 25m         │
└──────────────────────────────────────────────────────────────┘
```

## The rule the whole thing hangs off

> **The shelf hands you work. It has to be able to take it back.**

One tick means "I am finished with this" — which settles the task AND the
sitting, because a timer still counting on a completed task is not a state any
honest surface would render.

## Decisions

### 1. The gesture is the checkbox, and it is leftmost

`TodayCheckbox` unchanged — it is already purely presentational (`checked`,
`onToggle`, `ariaLabel`, `disabled`; no store, no `db`), so the overlay renderer
can draw it with the same nothing it draws everything else with.

It is a checkbox and not a button because the checkbox is what completion IS
here. The rule is already written down — ticking the checkbox remains the only
thing that moves a number — and a shelf that spelled the same act as a button
would be a second gesture for a fact the rest of the app has exactly one gesture
for. It also costs the action row nothing: `dialogFooter`'s one-filled-primary
rule survives untouched, where a third button would have put two commit verbs
side by side that both plausibly mean "I'm finished".

**Leftmost, before the ring.** `FocusPanel`'s info row is already
`flex items-center gap-3` with a 34px `SessionRing` leading it
(`AssistantSurface.tsx:246–266`), so the slot is taken. The checkbox goes
outside it, at the head of the row, because that is where a checkbox sits on
every task row in the app, and because it keeps ONE rule across both panels:
the checkbox is always the first thing in the card. The ring stays second and
stays decorative.

`AdvicePanel`'s `primaryColumn` (`AssistantSurface.tsx:372–382`) gains the same
leading checkbox and no ring, which is what makes the two panels read as the
same card in two states rather than two cards.

Rejected: **making the ring itself tickable.** It is 34px, it is already the
right shape, and it is exactly the wrong element — it is `aria-hidden` and
decorative by design, its own file says so, and turning the progress display
into the commit control would put two dimensions on one gesture.

**It never renders checked.** The shelf only ever shows open work, so ticking
recomputes the card into the next thing rather than filling the box in. That is
not a defect to design around: it is the same behaviour a Today row has, where
completing makes the row leave.

The accessible name carries the verb and the title — `Complete "Write intro
paragraph"` — so it is never announced as a bare box.

### 2. One tick is one write

This is the part that needs a new store action rather than two existing calls.

`logSession` arms `Logged 12m on "X"` (`store.ts:1780`, `withUndo` at the tail)
and `toggleLeaf` arms `Completed "X"` (`store.ts:978`). Call them in sequence
and the second write's sweep discards the first's undo entry — `setAndPersist`
drops every non-surgical entry when an ordinary edit lands. The toast would then
read `Completed "X"` and restore `goals` alone: you would un-tick the task and
keep the logged minutes, a half-undo that leaves the data in a state that is
neither the old one nor the new one.

`withUndoSlices` (`store.ts:759`) exists for exactly this, and its own comment
names the test — an edit that GENUINELY spans tables, where undoing half is the
worst of the three outcomes. This qualifies: `goals` (or `tasks`) and `sessions`
in one breath.

```ts
finishWork(ref: WorkRef, nowMs = Date.now()):
  'done' | 'needs-confirmation' | 'refused'
```

One `withUndoSlices`, one label — `Completed "X" · logged 12m`.

Named for what it does to the WORK, not for the surface that calls it. The shelf
is its first caller and must not be its only possible one.

### 3. Four states, and one of them refuses to guess

| State | Behaviour |
|---|---|
| No session running | Single-slice write, label `Completed "X"`. Delegates to `toggleLeaf`/`toggleTask` unchanged. Returns `'done'`. |
| Session running on this work | One `withUndoSlices` over `{goals \| tasks, sessions}`. Minutes logged, task ticked, draft cleared. Returns `'done'`. |
| Session running but **stale** | Tick the task (single slice, single-slice undo); park the draft in `confirming` via `finishFocusSession`. Returns `'needs-confirmation'`. |
| Session running on OTHER work | Tick the task, single slice, draft untouched. Returns `'done'`. |
| `confirming` | **No checkbox rendered.** |

The fourth row is unreachable from the shelf — `AssistantSurface` renders
`FocusPanel` whenever `activeFocus` is set, so the idle checkbox cannot be
pressed while a session runs — but `finishWork` is a store action and has to be
total. Ticking work you are not currently sitting on must not touch a draft that
is about someone else's minutes.

The stale case is the one that matters. `finishFocusSession` returns
`needs-confirmation` past `staleFocusLimitMin` — three hours, or twice the high
end of what your own history says this work runs. Logging that silently would
poison the evidence behind every `Usually 45–60m` the shelf shows you, and a
nine-hour session is more likely a laptop lid than a marathon. So the tick
writes the fact it is certain about (you said you are finished) and leaves the
fact it is not (how long you actually worked) to the question the shelf already
knows how to ask. Only one slice is written, so undo stays whole; the
`confirming` card resolves the minutes separately with its own undo.

`confirming` gets no checkbox for the same reason. That state is already asking
a question — "This session shows 3h 20m — was that real work?" — and a tick
there would answer a different question than the one on screen. It is also the
state the window's HEIGHT is measured against, and the one state that carries no
ring, so this costs the budget nothing.

`Session.focus` is written exactly as `completeFocus` writes it today:
`draft.focusLevel === 'low' ? 'low' : undefined` — the TIME level frozen at
start, never the display one.

### 4. A refusal is reported, never swallowed

A frozen project makes `toggleLeaf` no-op and `logSession` return `false`.
`finishWork` returns `'refused'` and `AssistantHost` turns that into a warning
notice. Callers must not report success on a refusal, and a checkbox that
appeared to tick and then sprang back would be the worst possible way to learn
a project is frozen.

One wrinkle for the plan: **`toggleLeaf` returns `void`** (`store.ts:978`), so
it cannot tell `finishWork` whether it wrote. `toggleTask` likewise. The
preconditions are therefore checked in `finishWork` before it commits to a path
— `isActiveNode`, and the leaf test that refuses a container the way `toggleLeaf`
and `startFocus` both already do. Widening `toggleLeaf`'s return type is the
alternative and is NOT taken here: it has callers all over the tree that ignore
the result, and a signature change across them is a bigger edit than the feature.

### 5. The notice confirms; the undo lives where it already lives

The shelf's existing `notice` line reports it — `Completed "Write intro
paragraph" · 12m logged`, neutral tone. No new state, no new mechanism, and the
notice is already inside the height budget.

The undo toast renders in the main window, which you may not be looking at when
you tick from a floating panel. That is accepted rather than fixed: the entry
lands on the undo STACK, and `⌘Z` in the app reaches the stack through
`undoLastDelete` (`App.tsx:244`), so it survives the 5-second toast expiring.
Giving the shelf its own Undo button would be a second undo affordance for one
action, on the surface with the least room for it.

## What this deliberately does not do

- **No checkbox on `Sidecar` or `OtherOptions` rows.** Those are lists of things
  to PICK, and a list of choices is not a commit — the same reason `optionRow`
  is not one of the three dialog button variants.
- **No change to the ~1s send-off.** Confirmed as out of scope: the auto-hide is
  why the gap bites, not a fault of its own.
- **No new protocol beyond one action.** `{ type: 'complete-work'; ref: WorkRef }`
  joins the `AssistantAction` union. Plain JSON, survives `structuredClone`,
  crosses the overlay IPC on the existing relay. `AssistantHost` stays the only
  action executor.
- **No `detailLevel` interaction.** The dial says how much to SHOW; a control is
  not detail. The checkbox is present at every level.

## Height

`HEIGHT` is 248, measured against `confirming` with a title long enough to hit
the `line-clamp-2` cap. `confirming` is the one state that renders no checkbox,
so the tallest state is untouched. The other states gain 22px of LEADING WIDTH
and no height — the title is already clamped at two lines, so the worst case is
already the worst case.

That reasoning is not a substitute for the measurement. That file's own rule is
that arithmetic against the type scale put the number 20px low once already, and
a hugging card is clipped rather than scrolled, so anything past the line is
invisible and not merely awkward. Re-measure all four reachable candidates in a
hidden 620px `BrowserWindow` before shipping.

## Testing

- `store.ts` — `finishWork` writes ONE undo entry across both slices, and undo
  restores both. The regression this guards is a half-undo, so the test asserts
  the sessions slice too, not just the tick.
- `store.ts` — the stale path ticks the task, writes no session, and leaves the
  draft in `confirming`.
- `store.ts` — a frozen project returns `'refused'` and writes nothing.
- `AssistantSurface.test.tsx` — the checkbox renders in `active`, `break` and
  the idle advice panel; is ABSENT in `confirming`; is absent on every `Sidecar`
  and `OtherOptions` row; and carries the accessible name `Complete "…"`.
- `electron/assistantWindow` — the budget measurement, re-run.

## Files touched

| File | Change |
|---|---|
| `src/state/store.ts` | new `finishWork` action |
| `src/lib/assistantProtocol.ts` | `complete-work` added to `AssistantAction` |
| `src/components/assistant/AssistantSurface.tsx` | checkbox in `FocusPanel` and `AdvicePanel` |
| `src/components/assistant/AssistantHost.tsx` | `complete-work` → `finishWork`, notice on refusal |
| `electron/assistantWindow.cjs` | re-measured budget comment (number likely unchanged) |
