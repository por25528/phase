import type { Goal, GoalNode, Session, Task } from '../../db/types';
import type { CompanionOp } from './ops';
import type { SyncSlices } from './stateFile';
import { cloneGoals, findNode, isLeafNode } from '../tree';
import { applyStatus } from '../status';

/**
 * The phone's projection: `state.json` plus a replay of the ops the Mac has
 * not ingested yet.
 *
 * Every branch here MIRRORS the matching branch of `handleAgentWrite`, because
 * the Mac will run that branch on the same op when it next ingests the
 * journal. Where the two could disagree the phone would flicker — a row ticked
 * on the phone un-ticking itself the moment the Mac exported — so a rule the
 * Mac refuses on (a group's status, a frozen project, a node that is gone) is
 * refused here too, and refusal is always a SILENT SKIP. There is nobody on
 * this side to report to: the Mac counts what it could not apply and toasts it
 * there.
 *
 * A new node or task takes the OP's id. That is deliberate and temporary: the
 * Mac mints its own id when it ingests, the phone re-renders from canonical,
 * and the temp row is replaced by the real one in the same paint. Keying it
 * off the op id is what stops a second replay of the same journal from
 * appending the row twice.
 *
 * Pure: the input slices are never mutated. `habits` and `lives` are shared by
 * reference because no companion verb touches them.
 */
export function replayOps(slices: SyncSlices, ops: readonly CompanionOp[]): SyncSlices {
  if (ops.length === 0) return { ...slices };
  const out: SyncSlices = {
    goals: cloneGoals(slices.goals),
    habits: slices.habits,
    tasks: slices.tasks.map((t) => ({ ...t })),
    sessions: [...slices.sessions],
    lives: slices.lives,
  };
  for (const op of ops) apply(out, op);
  return out;
}

/** The op's own day, which is what a completion or an unstated log is stamped with. */
function dayOf(op: CompanionOp): string {
  return op.ts.slice(0, 10);
}

/** An ACTIVE project — a completed one is frozen, exactly as `agentWrites` has it. */
function activeGoal(out: SyncSlices, goalId: string): Goal | null {
  const goal = out.goals.find((g) => g.id === goalId);
  return goal && !goal.completedAt ? goal : null;
}

/** A leaf of an active project, searched across every project when no goal is named. */
function activeLeaf(out: SyncSlices, nodeId: string, goalId?: string): GoalNode | null {
  const node = activeNode(out, nodeId, goalId);
  return node && isLeafNode(node) ? node : null;
}

function activeNode(out: SyncSlices, nodeId: string, goalId?: string): GoalNode | null {
  if (goalId !== undefined) {
    const goal = activeGoal(out, goalId);
    return goal ? findNode(goal.nodes, nodeId) : null;
  }
  for (const goal of out.goals) {
    if (!findNode(goal.nodes, nodeId)) continue;
    return goal.completedAt ? null : findNode(goal.nodes, nodeId);
  }
  return null;
}

/**
 * Write a status onto a node of the already-cloned tree — the same three-key
 * copy-back `store.ts`'s own `writeStatus` does, and for the same reason:
 * `applyStatus` returns a copy, so assigning it over the node would keep every
 * key the copy DROPPED.
 */
function writeStatus(n: GoalNode, next: GoalNode['status'] & string, day: string, blockedOn?: string): void {
  const updated = applyStatus(n, next, day, blockedOn);
  for (const key of ['status', 'blockedOn', 'doneAt'] as const) {
    if (updated[key] === undefined) delete n[key];
    else (n[key] as unknown) = updated[key];
  }
}

function apply(out: SyncSlices, op: CompanionOp): void {
  const request = op.request;
  switch (request.tool) {
    case 'complete_task': {
      if (request.ref.kind === 'step') {
        const leaf = activeLeaf(out, request.ref.id, request.ref.goalId);
        if (!leaf) return;
        writeStatus(leaf, 'done', dayOf(op));
        return;
      }
      const at = out.tasks.findIndex((t) => t.id === request.ref.id);
      if (at === -1) return;
      out.tasks[at] = { ...out.tasks[at], done: true, doneAt: dayOf(op) };
      return;
    }

    case 'set_status': {
      // A reason belongs to 'blocked'. The Mac REFUSES the pair rather than
      // dropping the reason, so the projection must show nothing happening.
      if (request.blockedOn !== undefined && request.status !== 'blocked') return;
      const leaf = activeLeaf(out, request.nodeId);
      if (!leaf) return;
      writeStatus(leaf, request.status, dayOf(op), request.blockedOn);
      return;
    }

    case 'add_task': {
      const goal = activeGoal(out, request.goalId);
      if (!goal) return;
      const leaf: GoalNode = { id: op.id, title: request.title };
      if (request.parentId === undefined) {
        goal.nodes.push(leaf);
        return;
      }
      // Only a CONTAINER takes a child here. `addChild` on the Mac would
      // convert a leaf, discarding its status, estimate and slot — a
      // destructive edit the phone has no way to offer or to undo, so the
      // projection declines to predict one.
      const parent = findNode(goal.nodes, request.parentId);
      if (!parent || isLeafNode(parent)) return;
      parent.children!.push(leaf);
      return;
    }

    case 'add_loose_task': {
      const task: Task = { id: op.id, title: request.title, done: false, goalId: null };
      if (request.date !== undefined) task.date = request.date;
      out.tasks.push(task);
      return;
    }

    case 'log_time': {
      const exists = request.ref.kind === 'step'
        ? activeLeaf(out, request.ref.id, request.ref.goalId) !== null
        : out.tasks.some((t) => t.id === request.ref.id);
      if (!exists) return;
      const session: Session = {
        id: op.id,
        goalId: request.ref.goalId,
        date: request.date ?? dayOf(op),
        minutes: request.minutes,
        note: '',
        ...(request.ref.kind === 'step' ? { nodeId: request.ref.id } : { taskId: request.ref.id }),
      };
      out.sessions.push(session);
      return;
    }

    case 'append_note': {
      // Appending to nothing is setting; `\n\n` between two paragraphs is what
      // makes the result one document rather than one run-on line.
      const join = (existing: string | undefined): string =>
        !existing ? request.markdown : `${existing}\n\n${request.markdown}`;
      if (request.ref.kind === 'project') {
        const goal = activeGoal(out, request.ref.id);
        if (!goal) return;
        goal.notes = join(goal.notes);
        return;
      }
      // A note hangs off any node — a group has one too — so this is a node
      // lookup, not a leaf one.
      const node = activeNode(out, request.ref.id);
      if (!node) return;
      node.notes = join(node.notes);
      return;
    }
  }
}
