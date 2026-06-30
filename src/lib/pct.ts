import type { Goal, GoalNode } from '../db/types';

export function nodePct(n: GoalNode): number {
  if (n.children && n.children.length)
    return n.children.reduce((s, c) => s + nodePct(c), 0) / n.children.length;
  return n.done ? 100 : 0;
}

export function goalPct(g: Goal): number {
  if (!g.nodes || !g.nodes.length) return 0;
  return g.nodes.reduce((s, n) => s + nodePct(n), 0) / g.nodes.length;
}
