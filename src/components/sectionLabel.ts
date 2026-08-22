/**
 * The one section-label voice.
 *
 * This string was hand-copied at 36 sites, which is the condition that lets a
 * voice drift — the same reason `dialogStyles.ts` exists for buttons. Changing
 * it here changes every region heading in the app.
 *
 * A section label names a REGION of a working surface: `Now`, `Free time`,
 * `Carried over`, `Done today`. In the mono voice it stops reading as a prose
 * heading and starts reading as the legend on an instrument, which is the
 * point. It is also quieter than what it replaced — 10.08px semibold sentence
 * case became 8.75px medium uppercase — so it recedes behind the content it
 * introduces while becoming more distinct from it.
 *
 * NOT for: a button that happens to be small (`TaskPage`'s time-log toggle,
 * `RecapPanel`'s show-more) or a row label in a sticky column (`Timeline`).
 * Those four sites share the old class string by coincidence, not by role, and
 * they keep it written out in full. A caption beside its control was the fifth
 * until it took the mono voice and became `captionLabel` below.
 */
export const sectionLabel = 'text-micro font-medium text-muted font-mono uppercase tracking-[.11em]';

/**
 * A caption sitting beside its control, in the same mono voice.
 *
 * Not `sectionLabel`, and the difference is not cosmetic — the two are
 * identical strings today and must be free to diverge. A section label names a
 * REGION of a surface; this names the CONTROL to its right, and the assistant
 * shelf's bottom status bar is the one place the two appear on the same card.
 *
 * It lives here rather than at its call site because `designScale.test.ts`
 * enforces that this file is the only one allowed to spell `uppercase` — the
 * rule being that a voice is declared once and imported, never hand-rolled.
 * Stone §5 originally kept this caption in the UI face for fear it would
 * compete with a region heading; once the dial strip became a status bar under
 * the content there was no heading left beside it to compete with, and the bar
 * reads as the legend on an instrument.
 */
export const captionLabel = sectionLabel;

/**
 * The label sitting INSIDE a rule, as a legend sits on a technical drawing.
 *
 * `sectionLabel` above is a label ON a surface: it floats over the rule that
 * separates two regions, and the two are separate objects. Today's frame makes
 * them one — the divider carries a tinted cell at its left end holding the
 * name, and a cell on the far end holding the section's one fact. That cell is
 * chrome and belongs to `RuleHeader`; what lives here is the VOICE, because
 * this file is the only one `designScale.test.ts` lets spell `uppercase`.
 *
 * Louder than `sectionLabel` — `text-ink` semibold rather than `text-muted`
 * medium — and that is the trade the cell buys. A label floating in whitespace
 * has to recede or it competes with the rows under it; a label in a bounded
 * cell is already separated by its own edges, so it can carry ink without
 * shouting, and at this size it needs to.
 */
export const ruleTag = 'font-mono text-micro font-semibold text-ink uppercase tracking-[.11em]';

/**
 * The date stamp above Today's masthead: two mono cells, the weekday inverted
 * against the day it names.
 *
 * Carries no COLOUR, unlike the two voices above, and that is the one thing
 * about it worth writing down: the stamp's first cell is ink-on-fill and its
 * second is muted-on-page, so a colour baked in here would be wrong for one of
 * the two halves it exists to serve. Everything else that makes it a stamp —
 * the border, the inversion, the split — is chrome and lives at the call site.
 */
export const stampLabel = 'font-mono text-micro uppercase tracking-[.11em]';
