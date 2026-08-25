import type { Goal, GoalNode } from '../db/types';
import { isDone, stepStatus } from './status';

export function leafCount(nodes: GoalNode[]): { total: number; done: number } {
  let total = 0, done = 0;
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      const sub = leafCount(n.children);
      total += sub.total;
      done += sub.done;
    } else {
      total++;
      if (isDone(n)) done++;
    }
  }
  return { total, done };
}

/** Open leaves nobody can work. Zero for a project with nothing stuck. */
export function blockedLeafCount(nodes: GoalNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.children && node.children.length) n += blockedLeafCount(node.children);
    else if (stepStatus(node) === 'blocked') n++;
  }
  return n;
}

/**
 * The first blocked leaf in document order, or null if nothing is stuck.
 * "Unblock" deep-links to this one node — the same tree walk `blockedLeafCount`
 * does, stopping at the first match instead of counting all of them.
 */
export function firstBlockedLeaf(nodes: GoalNode[]): GoalNode | null {
  for (const node of nodes) {
    if (node.children && node.children.length) {
      const found = firstBlockedLeaf(node.children);
      if (found) return found;
    } else if (stepStatus(node) === 'blocked') {
      return node;
    }
  }
  return null;
}

export function groupByColumn(goals: Goal[], n: number): string[][] {
  const cols: string[][] = Array.from({ length: n }, () => []);
  for (const g of goals) {
    const c = Math.min(Math.max(g.column ?? 0, 0), n - 1);
    cols[c].push(g.id);
  }
  return cols;
}

// Rebuild a full column-major id layout from an incoming (possibly PARTIAL)
// layout, re-inserting any goal absent from `columns` at the within-column
// index it holds in `goals`. Hidden projects stay pinned in place — never
// dropped or appended — so completing a project, reordering the actives, then
// reopening it preserves its horizon and position (spec §2.5).
//
// Named for the general case on purpose. It was `weaveCompleted` when
// completion was the only reason a goal could be missing; the life switcher is
// the second, and a scoped reorder relies on exactly this behaviour to leave
// the other life's ranks alone. A name that describes one of two callers is
// how the next person writes the bug this function already prevents.
export function weaveHidden(goals: Goal[], columns: string[][]): string[][] {
  const present = new Set<string>(columns.flat());
  const out = columns.map((ids) => [...ids]);
  const n = out.length;
  for (let c = 0; c < n; c++) {
    const inColumn = goals.filter((g) => Math.min(Math.max(g.column ?? 0, 0), n - 1) === c);
    inColumn.forEach((g, i) => {
      if (!present.has(g.id)) out[c].splice(Math.min(i, out[c].length), 0, g.id);
    });
  }
  return out;
}

/**
 * Where a keyboard rank move should land, counting only what the reader can see.
 *
 * `moveGoalRank` builds its neighbour list from every active goal, so under a
 * life scope `Alt+↑` swapped a card with one that is not on screen: the card
 * visibly did not move and the toast said it did. This steps by VISIBLE
 * neighbours and returns the index of that neighbour in the FULL list, so the
 * card moves exactly one visible slot and every hidden goal keeps its place.
 *
 * `null` at either end of the visible list — which the store turns into
 * `false`, which the view reads as "do not ring the card". Ringing a card for
 * a write that never happened is the bug `moveToHorizon` already guards
 * against, and it is worse here because the highlight focuses through a
 * `requestAnimationFrame`.
 */
export function rankMoveTarget(
  list: string[],
  visibleIds: Set<string>,
  goalId: string,
  delta: number,
): number | null {
  if (!visibleIds.has(goalId)) return null;
  const visible = list.filter((id) => visibleIds.has(id));
  const from = visible.indexOf(goalId);
  if (from === -1) return null;
  const to = from + delta;
  if (to < 0 || to >= visible.length) return null;
  const target = list.indexOf(visible[to]);
  return target === -1 ? null : target;
}
