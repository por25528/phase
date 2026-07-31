/**
 * The one phrasing for "behind pace", used by the Goals board, the Today rail
 * and the Timeline.
 *
 * The number is percentage POINTS below the linear-pace expectation, not a
 * percentage of anything. The board used to render it as "Behind 44%", which
 * reads as "44% behind schedule" and disagreed with the "44 pts behind" the
 * other two surfaces showed for the very same project.
 */
export function behindPaceLabel(pts: number): string {
  return `${pts} pts behind pace`;
}

/** Tooltip that shows the arithmetic: "33% done, 77% expected by today". */
export function behindPaceHint(donePct: number, expectedPct: number): string {
  return `${donePct}% done, ${expectedPct}% expected by today`;
}
