/**
 * The vocabulary every dialog speaks.
 *
 * Four dialogs shipped four footers. Three button paddings (`px-[12px]`,
 * `px-[13px]`, `px-[14px]`), two type sizes (`text-ui` and `text-body`), two
 * primary colours (`bg-ink` and `bg-accent`), two alignments, and two orders —
 * Create sat to the LEFT of Cancel in New goal and to the RIGHT of it in Import
 * backup, so the same hand movement committed in one dialog and dismissed in
 * the next. None of that was a decision; it was four authors each reaching for
 * a class list. It lives here now, so there is one place to change it and
 * nothing left to drift from.
 *
 * A button is a control, so it is `text-ui` — the scale names that step
 * "default control text" and `text-body` "default reading text".
 */

/**
 * Right-aligned, Cancel first. The commit button lands under the reading edge,
 * where the eye already is after the last field, and the destructive-adjacent
 * one is never the button nearest the cursor's resting place.
 *
 * It carries its own top margin and sits OUTSIDE the fields' `gap-*` container,
 * so the space above it is one number rather than a gap and a margin summing to
 * whatever they happen to sum to.
 */
export const dialogFooter = 'mt-[20px] flex items-center justify-end gap-[8px]';

/**
 * One height for every control in a dialog: 33px, reached four different ways.
 *
 *   field / date field   1 + 5 + 21 + 5 + 1   (border, padding, line, …)
 *   filled button            6 + 21 + 6
 *   outlined button      1 + 5 + 21 + 5 + 1
 *   segmented control    2 + 4 + 21 + 4 + 2   (track padding, segment padding)
 *
 * Written out because the arithmetic is the point: the track's 2px inset stands
 * in for the field's 1px border, and a `min-h` alone cannot make those agree —
 * it floors a control without telling you which side of the box it grew on.
 */
export const CONTROL_H = 'min-h-[33px]';

/**
 * The line box every dialog control is built on, pinned rather than inherited.
 *
 * An `<input>` takes `line-height: normal` from the UA (≈21.2px at `text-ui`)
 * while a `<span>` inherits the body's 1.5 (19.2px), so a date field and a
 * segmented control given identical padding still came out 2px apart, and the
 * `min-h` floor hid it as a 1px gap between two controls sharing a grid row.
 * Stating the number is what lets the four sums in `CONTROL_H` land on 33 for a
 * reason instead of by coincidence.
 */
export const CONTROL_LINE = 'leading-[21px]';

/**
 * No vertical padding here — each variant supplies its own, because a bordered
 * variant needs 5 where a borderless one needs 6. Putting `py-[6px]` in the base
 * and `py-[5px]` in the override would leave which one applies to the order
 * Tailwind happens to emit them in, which is the exact bug `DateField`'s `size`
 * prop exists to undo. A class list is not a cascade.
 */
const btnBase =
  `${CONTROL_H} ${CONTROL_LINE} inline-flex items-center justify-center px-[13px] rounded-field text-ui`;

/** Borderless: 6 + 21 + 6. */
const btnPadY = 'py-[6px]';

/**
 * `disabled:pointer-events-none` is not cosmetic. Without it a dimmed button
 * still runs its `hover:` rule and still shows a pointer, so "Create" advertised
 * itself as clickable for exactly as long as it refused to be clicked.
 */
export const primaryBtn =
  `${btnBase} ${btnPadY} font-semibold bg-ink text-paper hover:bg-ink-hover disabled:opacity-40 disabled:pointer-events-none`;

/**
 * Colour is reserved for trouble, so the one irreversible action in Phase is
 * the only button that gets any.
 *
 * `accent` means ACTION (index.css says so, in the comment explaining why the
 * project hues stay away from it) and every dialog's commit button is an
 * action — spending accent on one of them said nothing the neutral button did
 * not already say. `warn` means TROUBLE, which is what replacing every goal,
 * habit and task in the app actually is. It clears AA on both themes as a
 * surface for `paper`: 5.09:1 light, and dark inverts both tokens together.
 */
export const dangerBtn =
  `${btnBase} ${btnPadY} font-semibold bg-warn text-paper hover:bg-warn/90 disabled:opacity-40 disabled:pointer-events-none`;

export const ghostBtn = `${btnBase} ${btnPadY} text-muted hover:bg-hover hover:text-ink`;

/**
 * A secondary action inside a dialog's BODY. Outlined, never filled: a filled
 * button in the body beside a filled button in the footer reads as two commit
 * actions, and in Import goal the one higher up the page was the lesser of the
 * two.
 *
 * `py-[5px]`, not the borderless 6: the 1px border it wears costs those 2px
 * back, so it still measures 33.
 */
export const secondaryBtn = `${btnBase} py-[5px] border border-line-2 text-ink hover:bg-hover`;

/**
 * The shared dialog field — and `placeholder:text-faint` is not decoration.
 *
 * Five inputs in the app each hand-rolled that class (`CommandPalette`,
 * `QuickAdd`, `BlockComposer`, `AssistantShortcutSettings`, and
 * `.ghost-in::placeholder` in `index.css`); the one SHARED primitive was the
 * only one without it, so a placeholder here inherited `text-ink` and read as
 * typed text. New goal was the visible casualty: the field showed "Physics
 * Final", `disabled={!title.trim()}` was correctly true, and a dialog whose
 * two behaviours were both right read as broken because the FIELD was lying
 * about being filled in. An empty form has to look empty, or the dimmed commit
 * button takes the blame for it.
 *
 * `faint`, not `muted`, and `index.css` already named the tone: its own token
 * comment reserves faint for "decorative marks, placeholders and disabled
 * states" and muted for "anything a user must READ". An EXAMPLE is not read —
 * it is a specimen of the answer, and it disappears the moment you type. That
 * is the opposite of an unset VALUE like `DatePopover`'s "No deadline", which
 * is read, is the only affordance for setting one, and stays `text-muted`.
 */
export const fieldCls =
  `w-full ${CONTROL_H} ${CONTROL_LINE} rounded-field border border-line-2 bg-transparent px-[8px] py-[5px] text-ui text-ink placeholder:text-faint outline-none focus-visible:border-accent`;

export const labelCls = 'text-meta font-medium text-muted';

/**
 * An action that lives inside a list row.
 *
 * `primaryBtn` is 33px, sized for a dialog footer; a filled button of that
 * height inside a row would break the row rhythm and reverse the decision that
 * made the section label the emphasis and put Now on the same axis as every
 * other row. Outlined and row-height reads as an action rather than as
 * metadata without reopening that.
 *
 * 31px: 1 + 4 + 21 + 4 + 1. Two less than `CONTROL_H`, because a row is not a
 * dialog — and stated here so the two cannot drift into "nearly the same".
 */
export const rowBtn =
  `${CONTROL_LINE} inline-flex items-center justify-center px-[10px] py-[4px] rounded-field `
  + 'border border-line-2 bg-panel text-ui font-semibold text-ink hover:bg-hover';

/**
 * The ONE filled button on a working surface — the reason you came to the page.
 *
 * This does not reopen `rowBtn`'s argument. That one was about HEIGHT: a 33px
 * `primaryBtn` inside a 31px row breaks the row rhythm and puts Now back on its
 * own axis. The metrics here are `rowBtn`'s exactly (1 + 4 + 21 + 4 + 1 becomes
 * 5 + 21 + 5, the border's 2px paid back as padding), so the rhythm is untouched
 * and only the FILL differs.
 *
 * What it fixes is that Today rendered `Replan`, `Start session` and a
 * carry-over's `Today` as three identical outlined buttons, so the page offered
 * no answer to "which of these is the point" — the one control that begins work
 * looked exactly like the one that dismisses yesterday. `bg-ink`, not `bg-accent`:
 * `dialogStyles` already reserves colour for trouble, and the app shell's own
 * ⌘N button is filled ink for the same reason.
 *
 * A surface gets at most one. Two filled buttons is the state this exists to end.
 */
export const rowBtnPrimary =
  `${CONTROL_LINE} inline-flex items-center justify-center px-[10px] py-[5px] rounded-field `
  + 'bg-ink text-paper text-ui font-semibold hover:bg-ink-hover';

/* ───────────────────────── The Instrument frame ─────────────────────────
 *
 * A dialog drawn as a measured object rather than as a card with a heading on
 * it: a ruled strip carrying the VERB, a masthead carrying the NAME, fields as
 * labelled lines with a mono key column, and the footer on its own ruled bar.
 * Four surfaces already speak this way; a dialog was the last one that did not.
 *
 * These are all NEW exports and nothing above is redefined. `dialogStyles` is
 * consumed by twelve files and three of them are open on other branches right
 * now, laying out against `primaryBtn`/`secondaryBtn`/`ghostBtn`/`rowBtn`
 * heights that are argued for in comments — so the frame is added beside them
 * rather than folded into them. `dialogFooter` in particular survives
 * untouched for every dialog that keeps the card chrome, and its reading-edge
 * rule is the one thing `dialogBar` below inherits verbatim.
 */

/**
 * The rule across the top of the panel, and the reason the ✕ is gone.
 *
 * `items-stretch`, so the two cells are the full height of the rule and read as
 * cells rather than as text floating on a line. The far cell states the
 * dialog's one fact — how to leave it — and that is what pays for dropping the
 * close button: the affordance did not disappear, it stopped being an icon and
 * became a sentence. Scrim click and the footer's Cancel are both still there.
 */
export const dialogRule = 'flex items-stretch border-b border-line rounded-t-card overflow-hidden';

/**
 * The tinted cell holding the verb. Pair it with `ruleTag` from
 * `sectionLabel.ts`, which is the VOICE — that file is the only one
 * `designScale.test.ts` lets set the label voice in caps, and this is the
 * chrome. (Naming the class here would trip that same guard, which scans
 * comments too.)
 *
 * `bg-chip`, not `bg-panel-bright`: bright IS panel in the light theme, so a
 * cell painted with it would be invisible on exactly one of the two themes.
 * `chip` is a bounded tinted surface in both, which is what this cell is.
 */
export const dialogRuleCell = 'bg-chip border-r border-line px-[10px] py-[4px] inline-flex items-center';

/** The far cell: how to leave. Mono, because it is quoting a key. */
export const dialogRuleHint =
  'border-l border-line px-[10px] py-[4px] inline-flex items-center font-mono text-micro text-muted';

/** The masthead band. The name of the thing, and nothing else on the line. */
export const dialogHead = 'px-[18px] pt-[14px] pb-[13px]';

/**
 * `mast`, one step above `page`, and set in the UI face.
 *
 * `page` is a DOCUMENT's own title and has to outrank a heading typed inside
 * that document; this is a masthead over an 11px rule tag, and the two ends of
 * that range have to be far enough apart to read as composition. Fraunces is
 * not an option and the fontSize key says why: the display serif is locked to
 * three sites by `designScale.test.ts`, which is the whole reason the step is
 * named for its ROLE rather than for a face.
 */
export const dialogTitle = 'text-mast font-semibold tracking-[-0.02em] leading-[1.05]';

/** Where the lines live. */
export const dialogBody = 'px-[18px] pt-[14px] pb-[16px]';

/**
 * One labelled line: a mono key, the control, a hairline under it.
 *
 * This is `TaskPage`'s `PropertyLine` idea, deliberately restated rather than
 * imported. That component is 140px of key column with an icon in it, sized
 * for a document's property list; a dialog is 480px wide, has three or four
 * lines, and an icon per line would be four glyphs introducing four controls
 * that already name themselves. What carries over is the GRAMMAR — a quiet key
 * column, the value carrying the ink, one hairline per row — so a goal's fields
 * read the same before the goal exists and after.
 *
 * `border-line-soft`, a step quieter than the rule above and the bar below:
 * those two bound the dialog, these only separate its rows.
 */
export const dialogLine =
  'flex items-center gap-[12px] py-[8px] border-b border-line-soft last:border-b-0';

/**
 * The same line, for a control taller than one row — Import goal's textarea.
 * `items-start` and a matching top pad on the key, so the key sits on the
 * control's FIRST line rather than halfway down 8 rows of it.
 */
export const dialogLineTall = 'flex items-start gap-[12px] py-[8px] border-b border-line-soft last:border-b-0';

/**
 * 104px. Wide enough for `DEADLINE`, narrow enough that the value column still
 * holds a 33px control at a usable width inside a 480px panel — and a fixed
 * column is the point: keys that shrink-wrap their own text are not a column,
 * they are four different indents.
 *
 * `aria-hidden` at the call site, exactly as `PropertyLine` does it: every
 * control on these lines names itself, and a visible key repeated into the
 * accessible name is a label announced twice.
 */
export const dialogLineKey = 'w-[104px] flex-none';

/** The key for a tall line, nudged onto the control's first line. */
export const dialogLineKeyTall = 'w-[104px] flex-none pt-[7px]';

/**
 * `grid`, not a bare flex child — and the one column is the point.
 *
 * A grid item stretches to its track by default, so every control on a line
 * ends on the SAME right edge whether it is an `<input class="w-full">`, a
 * `Popover` trigger (`relative inline-flex`, which shrink-wraps) or a
 * `SegmentedControl` (`inline-flex`, likewise). Left alone, those three
 * measured 328, 126 and 182 pixels in one dialog, and a key column reading
 * down a ragged right edge is a list, not an instrument.
 *
 * A line that genuinely holds two things side by side — Import goal's
 * button-plus-caption — nests its own flex row INSIDE this cell rather than
 * appending `flex` to it: `grid` and `flex` are the same property, and which
 * one applied would be decided by the order Tailwind happened to emit them in.
 * `DateField`'s `size` prop exists because that bug shipped once already.
 */
export const dialogLineValue = 'flex-1 min-w-0 grid';

/**
 * The footer on its own ruled bar, on `bg-bg` inside a `bg-panel` card.
 *
 * The same object the assistant shelf's dial strip is — `border-t border-line
 * bg-bg` — because one idiom on three surfaces is worth more than three
 * surfaces each solving a footer. `dialogFooter`'s reading-edge rule is
 * unchanged and inherited: Cancel first, the filled commit button last, under
 * where the eye already is.
 */
export const dialogBar =
  'flex items-center justify-end gap-[8px] border-t border-line bg-bg px-[14px] py-[9px] rounded-b-card';
