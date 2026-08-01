import type { Goal, GoalNode } from '../db/types';
import { normalizeEstimate } from './capacity';

/**
 * The completion roll-up.
 *
 * Two rules, in order:
 *
 * 1. **Weighted by `estimateMin`, when every sibling in a set has one.** A
 *    project is lopsided by nature — one six-hour implementation leaf and four
 *    twenty-minute admin leaves — and an equal-weight mean reports 80% once the
 *    four trivial ones are ticked. That systematically flatters the easy work,
 *    and it is the number the pace deficit, the board card and the rail all
 *    read from.
 *
 *    The weight is `estimateMin`, NOT a new S/M/L field. The estimate already
 *    exists, the capacity engine already requires it, and the user is already
 *    being asked for it — a second effort scale would be redundant input that
 *    could contradict the first.
 *
 * 2. **Equal weight otherwise.** The fallback is deliberately all-or-nothing
 *    *per sibling set*: if any child of a node lacks a usable weight, that
 *    node's children are averaged equally. A partially-estimated set is the
 *    dangerous case — one estimated leaf among five unestimated ones would
 *    otherwise silently dominate its whole branch, which is worse than either
 *    honest alternative.
 *
 *    Evaluated per set, so a fully-estimated subtree is still weighted even
 *    when its cousin is a mess.
 *
 * A container's weight is the SUM of its subtree's weights, and is null if any
 * leaf beneath it lacks one. Without that, a set mixing a leaf with a container
 * could never be weighted — which is nearly every real project — and rule 1
 * would almost never apply. (Containers carry no `estimateMin` of their own;
 * `addChild` deletes it when a leaf becomes one.)
 *
 * Unchanged: node scheduling metadata (`start`, `deadline`, `plannedWeek`,
 * `plannedDay`, `plannedStartMin`, `estimateMin`) never affects this, and logged
 * `Session` time never affects this. A checkpoint is deliberately NOT metadata:
 * it is a real leaf node and counts in the roll-up, unlike the retired
 * `Milestone` it replaced. Ticking a leaf checkbox is still the only thing that
 * moves a number — an estimate changes how much a leaf is WORTH, never whether
 * it is done.
 */

interface Rollup {
  pct: number;
  /** Total estimated minutes beneath this node, or null if any leaf lacks a usable estimate. */
  weight: number | null;
}

/**
 * One pass computes both the percentage and the weight. Deriving the weight in
 * a separate recursive walk would re-descend the tree once per node — O(n²) on
 * a deep project, for a value this traversal already has in hand.
 */
function rollup(n: GoalNode): Rollup {
  // A node is a leaf XOR a container, and an empty `children` array counts as a
  // leaf — the same test every other module here uses.
  if (!n.children || n.children.length === 0) {
    return {
      pct: n.done ? 100 : 0,
      weight: normalizeEstimate(n.estimateMin) ?? null,
    };
  }
  return combine(n.children.map(rollup));
}

/** The shared weighted-or-equal mean over an already-rolled-up sibling set. */
function combine(kids: Rollup[]): Rollup {
  const total = kids.reduce<number | null>(
    (sum, k) => (sum === null || k.weight === null ? null : sum + k.weight),
    0,
  );

  // `total > 0` cannot fail for a non-empty set — `normalizeEstimate` rejects
  // every non-positive value — but dividing by it demands the guard be visible.
  if (total !== null && total > 0) {
    return {
      pct: kids.reduce((sum, k) => sum + k.pct * (k.weight as number), 0) / total,
      weight: total,
    };
  }

  return {
    pct: kids.reduce((sum, k) => sum + k.pct, 0) / kids.length,
    weight: null,
  };
}

export function nodePct(n: GoalNode): number {
  return rollup(n).pct;
}

export function goalPct(g: Goal): number {
  if (!g.nodes || !g.nodes.length) return 0;
  return combine(g.nodes.map(rollup)).pct;
}

/**
 * Which rule produced a project's percentage.
 *
 * Surfaced so the number can disclose its own basis. A percentage whose meaning
 * depends on whether the user happened to estimate everything, with nothing on
 * screen saying which, is exactly the quietly-misleading figure this app exists
 * not to produce.
 */
export function goalPctBasis(g: Goal): 'weighted' | 'equal' {
  if (!g.nodes || !g.nodes.length) return 'equal';
  return combine(g.nodes.map(rollup)).weight !== null ? 'weighted' : 'equal';
}
