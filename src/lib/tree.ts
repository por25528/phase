import type { Goal, GoalNode } from '../db/types';
import { stepStatus } from './status';

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

/**
 * A leaf carries no `children` key, or an empty one — the same ambiguity
 * `blocks` deliberately avoids by staying absent (see CLAUDE.md). Here it is
 * unavoidable: `addChild` and `indentNode` both leave a container with an
 * empty array mid-edit, so "no key" and "empty array" have to mean the same
 * thing, unlike `blocks` where an empty array would be a real state to distinguish.
 */
export function isLeafNode(node: GoalNode): boolean {
  return !node.children?.length;
}

export function isContainerNode(node: GoalNode): boolean {
  return !isLeafNode(node);
}

// Mutating removal — mirrors prototype's removeNode exactly
export function removeNode(nodes: GoalNode[], id: string): boolean {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
    if (nodes[i].children && removeNode(nodes[i].children!, id)) return true;
  }
  return false;
}

/**
 * The next leaf worth working: a step already in progress if there is one,
 * otherwise the first untouched one. Blocked and parked leaves are skipped
 * entirely.
 *
 * Two passes rather than one, because "already started" beats "earlier in the
 * document" — resuming is what a person means by "next step", and a single
 * depth-first pass cannot express a preference that spans the whole tree.
 *
 * Returns null when open work exists but ALL of it is blocked or parked.
 * Callers must not treat that as "nothing to do". They must not name the
 * remedy either: unblocking is the answer for a stuck step and the wrong word
 * for one set aside on purpose, and this function cannot tell the caller
 * which it found.
 */
export function firstOpenLeaf(nodes: GoalNode[]): GoalNode | null {
  return firstLeafMatching(nodes, (n) => stepStatus(n) === 'doing')
    ?? firstLeafMatching(nodes, (n) => stepStatus(n) === 'todo');
}

function firstLeafMatching(
  nodes: GoalNode[],
  match: (n: GoalNode) => boolean,
): GoalNode | null {
  for (const n of nodes) {
    if (n.children && n.children.length) {
      const hit = firstLeafMatching(n.children, match);
      if (hit) return hit;
    } else if (match(n)) {
      return n;
    }
  }
  return null;
}

// ---- immutable pure helpers ----

/** Deep-clone a goals array via JSON round-trip (safe: no Dates or functions in the type). */
export function cloneGoals(goals: Goal[]): Goal[] {
  return JSON.parse(JSON.stringify(goals));
}

// Internal: index-path from a node list root to the node with `id`.
function findPath(nodes: GoalNode[], id: string): number[] | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return [i];
    if (nodes[i].children) {
      const sub = findPath(nodes[i].children!, id);
      if (sub !== null) return [i, ...sub];
    }
  }
  return null;
}

// Internal: navigate to the node at `path` inside `nodes`.
function atPath(nodes: GoalNode[], path: number[]): GoalNode {
  let n = nodes[path[0]];
  for (let i = 1; i < path.length; i++) n = n.children![path[i]];
  return n;
}

// Internal: return the direct parent array of the node at `path`.
function listForPath(goal: Goal, path: number[]): GoalNode[] {
  if (path.length === 1) return goal.nodes;
  const parent = atPath(goal.nodes, path.slice(0, -1));
  return parent.children!;
}

/**
 * Returns the sibling array containing `id` and the node's index in it.
 * Returns null if not found.
 */
export function findParentList(
  goals: Goal[],
  id: string,
): { list: GoalNode[]; index: number } | null {
  for (const g of goals) {
    const path = findPath(g.nodes, id);
    if (path === null) continue;
    return { list: listForPath(g, path), index: path[path.length - 1] };
  }
  return null;
}

/**
 * Insert a new leaf directly BELOW `nodeId`, among its own siblings.
 *
 * The tree's Enter key used to call `addChild(parentId)`, which does
 * `children.push(...)` — so pressing Enter on the first of ten psets appended
 * the new row TENTH, and at root level `parentId` is null so Enter did nothing
 * at all. A fresh project's steps are all root-level, which made that the
 * common case: the whole "type out a list" loop, broken in both directions.
 *
 * Returns the new node's id so the caller can put it straight into edit mode.
 * Null when `nodeId` isn't in the tree.
 */
export function insertSiblingAfter(
  goals: Goal[],
  nodeId: string,
  title: string,
): { goals: Goal[]; newId: string } | null {
  const next = cloneGoals(goals);
  // `findParentList` hands back the live array inside `next`, so splicing it
  // edits the clone and never the caller's data.
  const found = findParentList(next, nodeId);
  if (!found) return null;
  const newId = uid();
  found.list.splice(found.index + 1, 0, { id: newId, title });
  return { goals: next, newId };
}

/**
 * Returns the sequence of node IDs from goal.nodes root down to the target node
 * (e.g. ['parentId', 'childId']). Returns null if not found.
 */
export function findNodePath(goals: Goal[], id: string): string[] | null {
  for (const g of goals) {
    const path = findPath(g.nodes, id);
    if (path === null) continue;
    const ids: string[] = [];
    let nodes = g.nodes;
    for (const idx of path) {
      ids.push(nodes[idx].id);
      nodes = nodes[idx].children ?? [];
    }
    return ids;
  }
  return null;
}

/**
 * Move `nodeId` under its immediately-preceding sibling in the same list.
 * That sibling becomes a container (loses `status`, gains `children`).
 * No-op (returns clone) if node has no preceding sibling.
 */
export function indentNode(goals: Goal[], nodeId: string): Goal[] {
  const next = cloneGoals(goals);
  for (const g of next) {
    const path = findPath(g.nodes, nodeId);
    if (path === null) continue;
    const list = listForPath(g, path);
    const idx = path[path.length - 1];
    if (idx === 0) return next; // no preceding sibling — no-op
    const node = list.splice(idx, 1)[0];
    const prev = list[idx - 1];
    if (!prev.children?.length) {
      delete prev.status;
      delete prev.blockedOn;
      delete prev.doneAt;
      delete prev.checkpoint;
      // A container can never carry a plan — the week commitment and every
      // sitting go together, or the tree would draw blocks for a node that has
      // no work of its own left.
      delete prev.plannedWeek;
      delete prev.blocks;
      delete prev.estimateMin;
    }
    (prev.children ??= []).push(node);
    return next;
  }
  return cloneGoals(goals);
}

/**
 * Move `nodeId` out to its parent's sibling list, inserted directly after the parent.
 * No-op if node is already at goal-root level.
 * If old parent loses its last child it becomes a leaf (children removed, absent
 * status — an absent field IS todo, so there is nothing left to reset).
 */
export function outdentNode(goals: Goal[], nodeId: string): Goal[] {
  const next = cloneGoals(goals);
  for (const g of next) {
    const path = findPath(g.nodes, nodeId);
    if (path === null) continue;
    if (path.length === 1) return next; // already at root level — no-op
    const parentPath = path.slice(0, -1);
    const parent = atPath(g.nodes, parentPath);
    const nodeIdx = path[path.length - 1];
    const node = parent.children!.splice(nodeIdx, 1)[0];
    if (parent.children!.length === 0) delete parent.children;
    const grandList = listForPath(g, parentPath);
    const parentIdx = parentPath[parentPath.length - 1];
    grandList.splice(parentIdx + 1, 0, node);
    return next;
  }
  return cloneGoals(goals);
}

/**
 * If `activeId` and `overId` share the same direct parent list, reorder active to over's index.
 * No-op if they are not siblings.
 */
export function reorderSiblings(goals: Goal[], activeId: string, overId: string): Goal[] {
  const next = cloneGoals(goals);
  for (const g of next) {
    const pa = findPath(g.nodes, activeId);
    const po = findPath(g.nodes, overId);
    if (!pa || !po) continue;
    if (pa.length !== po.length) continue;
    if (pa.slice(0, -1).join(',') !== po.slice(0, -1).join(',')) continue;
    const list = listForPath(g, pa);
    const ai = pa[pa.length - 1];
    const oi = po[po.length - 1];
    if (ai === oi) return next;
    const [item] = list.splice(ai, 1);
    list.splice(oi, 0, item);
    return next;
  }
  return cloneGoals(goals);
}

/**
 * Generic array reorder by id — moves active to over's original position.
 * Works for Goal[], Habit[], Task[] or any array with an `id` field.
 */
export function reorderTop<T extends { id: string }>(
  list: T[],
  activeId: string,
  overId: string,
): T[] {
  const ai = list.findIndex((x) => x.id === activeId);
  const oi = list.findIndex((x) => x.id === overId);
  if (ai < 0 || oi < 0 || ai === oi) return [...list];
  const next = [...list];
  const [item] = next.splice(ai, 1);
  next.splice(oi, 0, item);
  return next;
}
