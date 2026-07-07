import type { Goal, GoalNode } from '../db/types';

export function leafCount(nodes: GoalNode[]): { total: number; done: number } {
  let total = 0, done = 0;
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      const sub = leafCount(n.children);
      total += sub.total;
      done += sub.done;
    } else {
      total++;
      if (n.done) done++;
    }
  }
  return { total, done };
}

export function groupByColumn(goals: Goal[], n: number): string[][] {
  const cols: string[][] = Array.from({ length: n }, () => []);
  for (const g of goals) {
    const c = Math.min(Math.max(g.column ?? 0, 0), n - 1);
    cols[c].push(g.id);
  }
  return cols;
}
