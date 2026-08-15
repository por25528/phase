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
 * `RecapPanel`'s show-more), a row label in a sticky column (`Timeline`), or a
 * caption sitting beside its control (`AssistantSurface`'s "Focus"). Those five
 * sites share the old class string by coincidence, not by role, and they keep
 * it written out in full.
 */
export const sectionLabel = 'text-micro font-medium text-muted font-mono uppercase tracking-[.11em]';
