import type { Goal, GoalNode } from '../db/types';

export function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function findNode(nodes: GoalNode[], id: string): GoalNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const r = findNode(n.children, id);
      if (r) return r;
    }
  }
  return null;
}

export function findInAll(goals: Goal[], id: string): GoalNode | null {
  for (const g of goals) {
    const n = findNode(g.nodes, id);
    if (n) return n;
  }
  return null;
}

// Mutating removal — mirrors prototype's removeNode exactly
export function removeNode(nodes: GoalNode[], id: string): boolean {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
    if (nodes[i].children && removeNode(nodes[i].children!, id)) return true;
  }
  return false;
}
