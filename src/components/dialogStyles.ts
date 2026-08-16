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

export const fieldCls =
  `w-full ${CONTROL_H} ${CONTROL_LINE} rounded-field border border-line-2 bg-transparent px-[8px] py-[5px] text-ui text-ink outline-none focus-visible:border-accent`;

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
