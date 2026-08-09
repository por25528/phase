import type { GoalNode } from '../db/types';
import { isDone } from './status';

/**
 * Pure set-arithmetic for multi-selecting steps in a project tree.
 *
 * Nesting is what makes this non-trivial. A selection can contain a container
 * AND something inside it, so every operation has to decide what that means
 * before it touches data:
 *
 * - Deleting is a SUBTREE operation, so an id whose ancestor is also selected
 *   is already covered — counting or removing it twice is a bug.
 * - Completing is a LEAF operation, because a container's done-ness is derived
 *   from its children (`pct.ts`), so "complete this group" means "complete the
 *   open leaves under it".
 * - Range selection follows what is on SCREEN, not the tree, because that is
 *   what shift-click means to the person doing it.
 *
 * Keeping all of it here means the store's batch actions and the tree's
 * keyboard handling agree by construction, and it can be tested without a DOM.
 */

/**
 * Ids in render order, counting only rows that are actually on screen.
 *
 * `GoalTree` unmounts a container's children when it is collapsed, so a
 * collapsed subtree contributes exactly one row. Shift-click and Shift+Arrow
 * must use this order — using tree order instead would silently pull in rows
 * the user cannot see.
 */
export function visibleRowIds(nodes: GoalNode[], expanded: Set<string>): string[] {
  const out: string[] = [];
  const walk = (list: GoalNode[]): void => {
    for (const n of list) {
      out.push(n.id);
      if (n.children?.length && expanded.has(n.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * The inclusive run between two ids in visible order, in either direction.
 * Empty when either endpoint is off screen — a stale anchor must not silently
 * select from the top of the tree.
 */
export function rangeBetween(visible: string[], anchor: string, focus: string): string[] {
  const a = visible.indexOf(anchor);
  const b = visible.indexOf(focus);
  if (a === -1 || b === -1) return [];
  return visible.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * The selection with every id that some other selected id already contains
 * removed — the set a delete should actually operate on.
 *
 * Select "Pset 8" and its two sub-problems and you meant three rows, but you
 * asked for one removal: splicing the children afterwards would look for nodes
 * that no longer exist, and counting them would report "3 steps deleted" for a
 * subtree of three.
 */
export function topLevelSelection(nodes: GoalNode[], ids: Set<string>): string[] {
  const out: string[] = [];
  const walk = (list: GoalNode[]): void => {
    for (const n of list) {
      if (ids.has(n.id)) {
        out.push(n.id); // its whole subtree goes with it — do not descend
        continue;
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Every not-yet-done leaf at or under the selection, deduplicated.
 *
 * A container carries no `done` of its own, so "complete these" has to mean
 * the leaves. Selecting a group and one of its leaves yields that leaf once.
 */
export function openLeavesUnder(nodes: GoalNode[], ids: Set<string>): string[] {
  return leavesUnder(nodes, ids, (n) => !isDone(n));
}

/**
 * Every leaf at or under the selection, deduplicated — done ones included.
 *
 * `setNodesStatus` has to be able to move a done step back to `'todo'`; that
 * is a transition the bulk bar's own "Set status…" select offers. Filtering
 * by done-ness — right for `completeNodes`, which only ever moves TOWARD
 * done — made picking "to do" on a finished step a silent no-op: the bar
 * offered the choice and nothing happened.
 */
export function allLeavesUnder(nodes: GoalNode[], ids: Set<string>): string[] {
  return leavesUnder(nodes, ids, () => true);
}

function leavesUnder(nodes: GoalNode[], ids: Set<string>, include: (n: GoalNode) => boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const collect = (n: GoalNode): void => {
    if (n.children?.length) {
      for (const c of n.children) collect(c);
      return;
    }
    if (!include(n) || seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n.id);
  };
  const walk = (list: GoalNode[], inside: boolean): void => {
    for (const n of list) {
      const take = inside || ids.has(n.id);
      if (take && !n.children?.length) {
        collect(n);
      } else if (n.children?.length) {
        walk(n.children, take);
      }
    }
  };
  walk(nodes, false);
  return out;
}

/**
 * How many nodes a delete of `ids` would actually remove, subtrees included.
 *
 * The delete toast has to name a number the user can check against what
 * disappeared. "Deleted 3 steps" for a group holding twelve is the kind of
 * quiet miscount that stops people trusting undo.
 */
export function selectionRemovalCount(nodes: GoalNode[], ids: Set<string>): number {
  const size = (n: GoalNode): number =>
    1 + (n.children?.reduce((sum, c) => sum + size(c), 0) ?? 0);
  let total = 0;
  const walk = (list: GoalNode[]): void => {
    for (const n of list) {
      if (ids.has(n.id)) {
        total += size(n);
        continue;
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return total;
}

/**
 * The selection with ids that are no longer in the tree dropped.
 *
 * A selection outlives the data it points at — a delete removes rows, an undo
 * brings them back, and the drawer can be looking at a different project than
 * the one the ids came from. A stale id in the set makes the action bar count
 * rows that aren't there and the next bulk action a partial no-op.
 */
export function pruneSelection(nodes: GoalNode[], ids: Set<string>): Set<string> {
  if (ids.size === 0) return ids;
  const alive = new Set<string>();
  const walk = (list: GoalNode[]): void => {
    for (const n of list) {
      if (ids.has(n.id)) alive.add(n.id);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  // Same-size means nothing was lost; returning the original set keeps the
  // identity stable so React does not re-render for a no-op.
  return alive.size === ids.size ? ids : alive;
}
