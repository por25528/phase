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

// Rebuild a full column-major id layout from an incoming (possibly active-only)
// layout, re-inserting any goal absent from `columns` at the within-column index
// it holds in `goals`. Completed/hidden projects stay pinned in place — never
// dropped or appended — so completing a project, reordering the actives, then
// reopening it preserves its horizon and position (spec §2.5).
export function weaveCompleted(goals: Goal[], columns: string[][]): string[][] {
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
