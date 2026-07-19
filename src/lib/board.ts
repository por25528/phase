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
