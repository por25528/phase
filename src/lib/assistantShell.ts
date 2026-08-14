/**
 * Whether the shelf's card should size to its content or fill its window.
 *
 * The window is a fixed height sized to the TALLEST state, so every shorter
 * state used to float at the top of a pane with a hundred pixels of nothing
 * under it. On macOS the window is `transparent`, so a card that hugs its
 * content leaves the remainder invisible rather than white — and a click on
 * that remainder can close the shelf, which turns dead space into
 * click-outside-to-dismiss.
 *
 * Everywhere else the window paints `backgroundColor`, so hugging would leave
 * a visible painted notch under the card. Those platforms keep filling.
 *
 * A string rather than a boolean because the two values name what they do at
 * the call site, where `sizing === 'hug'` reads and `transparent === true`
 * would not.
 */
export function shelfSizing(userAgent: string): 'hug' | 'fill' {
  return /Mac|Macintosh|Mac OS X/.test(userAgent) ? 'hug' : 'fill';
}
