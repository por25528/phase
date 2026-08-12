import type { GoalNode, StepStatus } from '../db/types';

export type { StepStatus };

/**
 * A leaf's status. Absent means 'todo' — 'todo' is never written.
 */
export function stepStatus(n: GoalNode): StepStatus {
  return n.status ?? 'todo';
}

export function isDone(n: GoalNode): boolean {
  return stepStatus(n) === 'done';
}

function isLeaf(n: GoalNode): boolean {
  return !n.children || n.children.length === 0;
}

/**
 * A container's status, derived and never stored — a container has no `done`,
 * so it can have no `status` either without breaking leaf-XOR-container.
 *
 * `blocked` is deliberately strict: EVERY open descendant must be blocked. One
 * stuck child among four workable ones is not a stuck container.
 */
export function containerStatus(n: GoalNode): StepStatus {
  const leaves: GoalNode[] = [];
  const walk = (node: GoalNode): void => {
    if (isLeaf(node)) { leaves.push(node); return; }
    node.children!.forEach(walk);
  };
  walk(n);

  if (leaves.length === 0) return 'todo';
  const open = leaves.filter((l) => !isDone(l));
  if (open.length === 0) return 'done';
  if (open.some((l) => stepStatus(l) === 'doing')) return 'doing';
  if (open.every((l) => stepStatus(l) === 'blocked')) return 'blocked';
  return 'todo';
}

/**
 * The one place a status is put into words. Shared rather than redeclared in
 * each view: the tree's accessible label, the panel's radio group and the board
 * chip must not drift into three different vocabularies for the same state.
 */
export const STATUS_WORD: Record<StepStatus, string> = {
  todo: 'to do',
  doing: 'in progress',
  blocked: 'blocked',
  done: 'done',
};

/**
 * The row cycle. `done` is unreachable from here by design — ticking the
 * checkbox remains the only thing that moves a number.
 */
export function cycleStatus(s: StepStatus): StepStatus {
  switch (s) {
    case 'todo': return 'doing';
    case 'doing': return 'blocked';
    default: return 'todo'; // 'blocked' and 'done' both land back on todo
  }
}

/**
 * Return a COPY of `n` at `next`, with the dependent fields kept honest:
 * `doneAt` is stamped entering `done` and cleared leaving it, `blockedOn`
 * survives only while blocked, and `'todo'` is stored as an absent field.
 */
export function applyStatus(
  n: GoalNode,
  next: StepStatus,
  today: string,
  blockedOn?: string,
): GoalNode {
  const out: GoalNode = { ...n };

  if (next === 'todo') delete out.status;
  else out.status = next;

  if (next === 'done') out.doneAt = today;
  else delete out.doneAt;

  const reason = blockedOn?.trim();
  if (next === 'blocked' && reason) out.blockedOn = reason;
  else delete out.blockedOn;

  return out;
}
