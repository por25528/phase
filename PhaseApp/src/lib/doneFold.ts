import type { GoalNode } from '../db/types';
import { containerStatus, isDone } from './status';

/**
 * Which finished rows a sibling list folds away, and which it leaves alone.
 *
 * Two of five top-level rows in the goal tree were done, struck through, in
 * the most prominent position on the page. `CLAUDE.md` already states the
 * principle for Today's `Done today` section — work that is done cannot
 * outrank work that is not — and this is the same rule applied to a tree
 * instead of a page.
 *
 * It folds IN PLACE, per RUN of adjacent finished siblings, and never
 * reorders. Sinking done rows to the bottom of their list would be the
 * stronger version of the rule and the wrong one: the order of a sibling list
 * is the user's, it is what a drag sets, and rewriting it to express a
 * completion state would make the tree disagree with itself about where a row
 * lives the moment it is ticked.
 *
 * The fold is a LENS and not an edit — the same move `lifeScope` makes on the
 * board and `focusLens` makes on the shelf. Nothing here writes, nothing here
 * changes what `pct.ts` counts, and every folded row comes straight back.
 */

/**
 * A run of two, not of one.
 *
 * One finished row costs exactly one line, and a fold line costs one line, so
 * folding a single row saves nothing and takes away the checkbox that would
 * un-tick it. What the rule is actually about is done work outranking open
 * work by BULK and by POSITION, and one row does neither. It also means
 * ticking a task never makes it vanish out from under the cursor unless its
 * neighbour was already finished.
 */
export const MIN_FOLD_RUN = 2;

/**
 * Whether a node counts as finished for the fold.
 *
 * A leaf answers with its own `status`. A container has none — its status is
 * derived — so it answers `containerStatus`, which is `'done'` only when every
 * leaf beneath it is. That is what keeps the spec's one hard rule true by
 * construction: **folding must never hide a container that still has open
 * children.** A container holding no leaves at all reads `'todo'` and is never
 * folded either, which is right — an empty group is not a finished one.
 */
export function isFinished(n: GoalNode): boolean {
  return n.children && n.children.length > 0 ? containerStatus(n) === 'done' : isDone(n);
}

/** A run of adjacent finished siblings, keyed by the first of them. */
export interface DoneRun {
  /**
   * The first node's id.
   *
   * Stable enough to hold "the user opened this run" across a re-render, and
   * deliberately not derived from the run's contents: un-ticking the LAST
   * member should not close the fold the user just opened. Un-ticking the
   * first one does re-key it, which is correct — that run is a different run.
   */
  key: string;
  nodes: GoalNode[];
}

export type FoldItem =
  | { kind: 'run'; run: DoneRun }
  | { kind: 'node'; node: GoalNode };

/**
 * One sibling list, with each run of `MIN_FOLD_RUN`+ finished siblings
 * gathered into a single item. Order is preserved exactly.
 *
 * The caller decides what a run LOOKS like and whether it is open; this only
 * says where the runs are, so the renderer and `visibleRowIds` cannot disagree
 * about which rows are on screen.
 */
export function foldDone(list: GoalNode[]): FoldItem[] {
  const out: FoldItem[] = [];
  let i = 0;
  while (i < list.length) {
    if (!isFinished(list[i])) {
      out.push({ kind: 'node', node: list[i] });
      i += 1;
      continue;
    }
    let end = i;
    while (end < list.length && isFinished(list[end])) end += 1;
    const run = list.slice(i, end);
    if (run.length >= MIN_FOLD_RUN) out.push({ kind: 'run', run: { key: run[0].id, nodes: run } });
    else for (const n of run) out.push({ kind: 'node', node: n });
    i = end;
  }
  return out;
}

/**
 * What a folded run's one line says it is holding.
 *
 * The count is the fact; the names are what make it checkable against what
 * disappeared, the same reason the delete toast names a subtree count. Capped
 * because a run can be a whole finished project and the line is one line: past
 * the cap it says how many more rather than running off the edge.
 */
export const FOLD_NAMES_MAX = 3;

export function foldSummary(run: DoneRun): string {
  const shown = run.nodes.slice(0, FOLD_NAMES_MAX).map((n) => n.title);
  const hidden = run.nodes.length - shown.length;
  return hidden > 0 ? `${shown.join(', ')} +${hidden} more` : shown.join(', ');
}
