# Goals: a deadline you pick, and a card you can edit

## The problem

**A deadline is typed, and typing is the one thing this field cannot make
safe.** `DateField` exists because `<input type="date">` renders in the
browser's locale, and its own docstring names the stakes: `02/08/2026` is Feb 8
to a US reader and Aug 2 to everyone else, "on the one field where a misread
moves a deadline". It answered that by *refusing* the ambiguous form — a
correct answer, but one that leaves the user carrying the format. `parseDateInput`
is 59 lines of grammar for month names, word order and optional years, and every
one of them exists to recover from the fact that a person had to spell a date
out. On New goal the cost is paid at the worst moment: a dialog whose stated
purpose is to get you into a workspace after two fields makes the second field
the one with a parser behind it.

A calendar does not have this problem. There is no format to get wrong, no year
to omit, and nothing to reject.

**The board card states four things and lets you change none of them.** A
card's ⋯ menu offers Move to, Life and Delete. Renaming a goal or changing its
deadline — the two edits most likely to follow a glance at the board — require
opening the project workspace, editing in the header popover, and coming back.
`renameGoal` and `setGoalDates` both already exist as undo-aware store actions;
nothing is missing but a route to them.

**And the card's menu is the third hand-rolled popover the primitive was built
to end.** `Popover`'s docstring names the three it replaced and says why: three
copies is "three chances for one of them to forget `stopPropagation`". `BoardCard`
is a fourth, and it has already drifted — it never returns focus to its trigger,
so dismissing the menu drops focus on `<body>`, and it flips above or below
against `MENU_HEIGHT_PX = 210`, a hardcoded guess at its own height.

## What this is not

Not a second date vocabulary. `parseDateInput` and `DateField` stay exactly as
they are and keep serving `GoalMetaPopover`, `StepPanel` and `TaskPage` — the
project workspace, which is not Goals. `DatePopover` is built so those three can
adopt it later without changing, but this pass does not touch them.

Not a new input on New goal. The dialog deleted horizon, start date, first tasks
and notes for being ceremony, and its docstring is a standing argument against
adding anything back. This swaps one control for another and removes a branch;
it adds no field, and specifically does not add a line stating which horizon or
life the goal will land in.

Not a per-goal scheduling surface. A goal has a start and a deadline; this pass
gives the board a route to the deadline only, because the deadline is what the
card already prints.

## 1. The calendar

### `src/lib/calendar.ts`

Pure, no React, sibling test — per the conventions in CLAUDE.md.

| function | answers |
| --- | --- |
| `monthGrid(month)` | 6×7 ISO dates for a `'YYYY-MM'`, Monday-first, padded from adjacent months |
| `monthLabel(month)` | `'August 2026'` |
| `shiftMonth(month, n)` | `'YYYY-MM'`, n months away |
| `monthOf(iso)` | the `'YYYY-MM'` a date belongs to |
| `deadlinePresets(today)` | `{ label, date }[]` — the shortcut row |

**Monday-first**, because `weekDates` already computes `(d.getDay() + 6) % 7`
and the Plan grid draws Monday-first. A calendar that started on Sunday would be
the only surface in the app that did.

**Always six rows.** A month grid sized to its own content is 5 rows in most
months and 6 in some, so navigating `›` would resize the popover under the
cursor. Padding from the adjacent months is what makes the panel a fixed object.
Those padded days are selectable and render `text-faint` — they are genuinely
peripheral, which is the one thing that tone is for.

The two tones do not stack. A padded day is `text-faint` whether or not it is
also past, because the question it answers — "this belongs to another month" —
is the one that explains why it looks different from its neighbours in the same
row. Selecting a padded day commits that date and moves the grid to its month.

**Dates are built through `parseD`/`pad`**, never through `toISOString`. `parseD`
constructs a local-midnight `Date`; `toISOString` would shift a UK-evening
selection back a day. This is why `monthGrid` returns strings rather than
`Date`s: the boundary where a date stops being local is the boundary where it
gets wrong.

### Presets

`In 2 weeks · End of month · End of year`, and `Clear deadline` when one is set.

The rule is that a preset covers what the *grid is slow at*. Any day in the
visible month is already one click, so a preset for it buys nothing; "End of
year" from August is five presses of `›`. "Today" and "Tomorrow" — the presets
`ScheduleMenu` offers a task — are deliberately absent, because they are
task-shaped. A goal deadline is a semester-scale fact.

`End of month` earns its place on a different ground: it is visible in the grid,
but it requires knowing which day the month ends on.

### Past dates

Selectable, rendered `text-muted` against a future day's `text-ink`.

Refusing them would be presumptuous — a goal recorded after its deadline has
passed is a real thing to record, and `nearestMeaningfulDate` already carries
`past` for exactly that case. The card's warn tint is the downstream answer, and
it is a better one than a disabled cell that explains nothing.

`text-muted` rather than `text-faint`: a past day is *read* while scanning the
grid, and CLAUDE.md's rule is that anything read takes the tone that clears AA.
`text-faint` is reserved here for the adjacent-month padding, which genuinely is
peripheral.

### `src/components/DatePopover.tsx`

Trigger, `Popover`, grid. The grid stays a local component: nothing wants it
without the popover, and splitting it now would be a second file with one
caller.

**The trigger states the fact and hides the editor** — the rule `PropertyLine`
and `PropertyRow` already follow. Unset it reads `No deadline` in `text-muted`,
never `text-faint`: it is the only affordance for setting one, so it takes the
tone that clears AA. Set, it reads `Aug 30` in `text-ink`. `IconCalendar` and a
chevron, both already in `Icons.tsx`.

**Which month it opens on**, and where focus lands: the month containing the
current value, or the month containing today when there is no value. Focus goes
to the selected day, or to today when nothing is selected and today is in the
visible month, or to the 1st otherwise — so the grid always opens with exactly
one cell focused and arrows work on the first press.

**Keyboard.** A calendar that cannot be driven from the keyboard is a regression
from a text input, so this is a requirement and not a polish item. Roving
tabindex over a `role="grid"`: arrows move by day, PageUp/PageDown by month,
Home/End to the week's edges, Enter and Space commit and close. Arrowing past
the visible grid's edge pages the month and keeps the focused day, so navigation
never dead-ends. Escape is already handled — `Popover` consumes it on capture,
which is what stops the key closing the New goal modal behind it.

Roving tabindex also keeps `Modal`'s Tab trap honest: only one of the 42 cells
is `tabIndex={0}`. The trap's own selector matches `button:not([disabled])`, so
it still counts all 42 — but the popover renders between the fields and the
footer, so first and last remain the title input and Create goal, and the wrap
is unaffected.

**`role="dialog"`, never `menu`.** A grid is not a permitted child of a menu,
for the same reason a textbox is not — the rule CLAUDE.md already states for
`Popover`.

## 2. New goal

`DateField` becomes `DatePopover`. Nothing else about the dialog moves: the
`<form>` still commits on Enter from anywhere in it, the type inference stays
live, and a picked deadline still writes `datesConfirmed: true` — a date the
user just chose needs no review, exactly as a typed one did not.

One branch is deleted rather than kept. `projectDateError` is unreachable here
once the field cannot produce a malformed string, and the modal never sets
`start`, so the error paragraph and the error half of the submit button's
`disabled` both go. The button stays disabled on an empty title.

`projectDateError` itself is untouched — it still guards `setGoalDates` against
an imported or hand-edited date, which is where it was always earning its keep.

## 3. `Popover` gains flip

On open, a layout effect measures the panel and the trigger's rect; if the panel
does not fit below, it renders above. One `flip` behaviour, in the primitive.

This is a prerequisite, not an addition. The card menu is about to grow by two
items, and `MENU_HEIGHT_PX = 210` is a guess at a height that is about to be
wrong. Replacing a guess with a measurement is the same move the assistant
shelf's `HEIGHT` documents: *measured, never derived*.

It reaches outside Goals — six callers — which is the one risk in this pass. The
mitigation is that flip only engages when there is no room below, which today is
a bug in all six.

## 4. The board card

### Menu

Folded into `Popover` with `role="menu"` and `align="end"`. This deletes the
hand-rolled `pointerdown` listener, the Escape handler and `MENU_HEIGHT_PX`, and
picks up focus-return for free.

The Move-to items gain `hint="⌥←"` and `hint="⌥→"` through `PopoverItem`'s
existing prop. The card's `aria-label` already promises "Alt with arrow keys to
move" to a screen reader; the hint is what makes the same promise to everyone
else.

### Rename

A `Rename` item turns the card title into `InlineEdit`, which exists and already
draws the accent underline that means "you are editing this". Enter commits
through `renameGoal`, Escape cancels.

`InlineEdit` sits inside the drag activator, so its `pointerdown` must
`stopPropagation` — the card already does this for its action buttons through
`stopPointer`, and this is the same rule applied to a text field.

### Deadline

**The card's date chip is the trigger.** Clicking the thing you are reading is
the whole point; a menu item that opens a picker somewhere else is a longer
route to the same place.

With no deadline set there is no chip, so a `.quiet-control` `+ Due` renders in
the chip's slot on hover — the class CLAUDE.md mandates for hover-revealed row
controls, carrying its `@media (hover: hover)` gate and 24px floor. The ⋯ menu
keeps a `Deadline…` item as the keyboard and touch route, opening the same
popover with `ref.current?.click()`. That is the pattern `GoalTree` already uses
for `⇧S` and the schedule popover; there is no second mechanism here.

**A Milestone chip stays inert.** `nearestMeaningfulDate` returns a checkpoint
when one falls before the deadline, so the chip does not always name the
deadline. Wiring a chip reading `Milestone · Sep 3` to a control that sets
`goal.deadline` would be the card lying about what the click does. When the chip
is a checkpoint, it renders as it does today and the `+ Due` control appears
beside it.

Commit is `setGoalDates(goal.id, goal.start, picked)` — `start` passed through
so a deadline edit never silently drops it. The action already writes
`datesConfirmed: true` and already arms undo.

### `CardFace`

Takes an optional `deadlineControl?: React.ReactNode`. `BoardCard` supplies it;
`GoalCardVisual` — the drag overlay — does not, because an overlay must stay
inert. One optional prop is the smallest honest way to say "this face is
interactive and that one is a picture of it".

## 5. Date chips disclose the year

`fmtD` prints `Jun 30` with no year, so a Someday card due June 2027 and one due
June 2026 are the same six characters. On the board's most-read chip that is not
an inconvenience, it is misinformation — and it is visible today on a real card.

A new sibling in `src/lib/dates.ts`, `fmtDY(iso, today)`: `fmtD`'s output when
the year matches, `Jun 30, 2027` when it does not. `fmtD` itself is untouched —
it has many callers and most of them are inside a context that already fixes the
year.

Spent in two places: the card's date chip, and the Completed list, where a
several-year history is exactly where a bare `Jun 30` is worst.

## Testing

**New.** `calendar.test.ts` — grid shape (always 42 cells), month boundaries,
leap February, a DST transition month proving local-midnight construction, and
each preset. `DatePopover.test.tsx` — arrow/PageUp/Home navigation, Enter
commits, a preset commits, Clear clears, and the trigger's two label states.

**Rewritten.** `NewGoalModal.test.tsx`'s "treats a typed deadline as already
confirmed" drives `fireEvent.focus/change/keyDown` at a textbox that will no
longer exist; it becomes a click through the grid, and keeps asserting
`datesConfirmed: true`. "creates no deadline at all when none was typed" stands
as-is.

**Extended.** `BoardCard` gains rename and deadline coverage. Per CLAUDE.md,
these must click the child a person actually hits — the card's rows are covered
by children that stop propagation, and a test dispatching at the card element
cannot see that.

**Watched.** `Popover.test.tsx` for the flip, and the five existing `BoardCard.*`
test files for fallout from the menu swap.

`npm test` and `npx tsc -b` before commit.
