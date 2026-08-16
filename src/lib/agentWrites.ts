import type { Goal, GoalNode } from '../db/types';
import type { actions as storeActions, FullState } from '../state/store';
import type { AgentRequest, AgentResponse } from './agentProtocol';
import { okResponse, errorResponse } from './agentProtocol';
import { parseGoalImport } from './goalImport';
import { isValidLocalDate } from './schedule';
import { findNode, isLeafNode } from './tree';
import { isDone } from './status';
import { todayStr } from './dates';

/**
 * The write half of the agent surface.
 *
 * Every branch is ONE call into the action the UI already calls, so undo,
 * toasts and persistence come for free and no new path to the database is
 * created. `actions` is injected so this is testable by asserting which
 * action ran, not by driving a store.
 *
 * Three honesty rules live here, and they are all the same rule.
 *
 * 1. A bulk action returns whether it WROTE, and a refusal is never reported
 *    as success. `removeNodes`, `setNodeStatus`, `scheduleNode` and
 *    `scheduleTask` all answer a boolean; it is propagated, never assumed.
 * 2. Where the action returns `void` and refuses SILENTLY — `addChild`,
 *    `addRootNode`, `setNodeEstimate` all no-op on a frozen project or a shape
 *    they will not touch — the store is re-read afterwards and the write is
 *    confirmed to have landed. A pre-check mirroring the action's own guard
 *    would drift the first time that guard moved.
 * 3. `persistFailed` latches independently of any return value — in-memory
 *    state advances even when the write did not reach IndexedDB — so it is
 *    checked after every mutation, through `settled`.
 *
 * And one rule about the request rather than the write: a field this surface
 * cannot honour is REFUSED, never dropped. `schedule`'s `minutes` and a
 * `blockedOn` attached to a non-blocked status are both requests the store has
 * nowhere to put, and answering `ok` to one would be a silent lie about what
 * was stored.
 */

export interface AgentWriteDeps {
  actions: typeof storeActions;
  getState(): FullState;
}

const PERSIST_FAILED =
  'The change was applied in memory but could not be saved. Use Export in Phase to recover your data.';

/** Only used when the store refused without saying anything — see `schedule`. */
const NO_ROOM = 'That day had no room for it.';

type Found<T> = { found: T } | { error: string };

function failed<T>(result: Found<T>): result is { error: string } {
  return 'error' in result;
}

/** Every id in a goal's tree, so an add can be confirmed by what appeared. */
function nodeIds(goal: Goal, into = new Set<string>()): Set<string> {
  const walk = (nodes: GoalNode[]) => {
    for (const n of nodes) {
      into.add(n.id);
      if (n.children) walk(n.children);
    }
  };
  walk(goal.nodes);
  return into;
}

/** The project a request names, or the sentence explaining why there isn't one. */
function project(state: FullState, goalId: string): Found<Goal> {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) return { error: `No project with id "${goalId}".` };
  // Every node action begins `if (!isActiveNode(id)) return` — a completed
  // project is frozen, and calling through would be a silent no-op.
  if (goal.completedAt) {
    return { error: `"${goal.title}" is a completed project — reopen it in Phase first.` };
  }
  return { found: goal };
}

/**
 * The step a request names.
 *
 * `goalId` narrows the search when the request carries one (a `WorkRef` of
 * kind `'step'` always does), which is also what catches a parent id that
 * belongs to some OTHER project.
 */
function step(state: FullState, nodeId: string, goalId?: string): Found<GoalNode> {
  if (goalId !== undefined) {
    const owner = project(state, goalId);
    if (failed(owner)) return owner;
    const node = findNode(owner.found.nodes, nodeId);
    return node ? { found: node } : { error: `No task with id "${nodeId}".` };
  }
  for (const goal of state.goals) {
    if (!findNode(goal.nodes, nodeId)) continue;
    const owner = project(state, goal.id);
    if (failed(owner)) return owner;
    return { found: findNode(owner.found.nodes, nodeId)! };
  }
  return { error: `No task with id "${nodeId}".` };
}

/** A leaf, or the reason this verb has nothing to do with a group. */
function leaf(state: FullState, nodeId: string, clause: string, goalId?: string): Found<GoalNode> {
  const result = step(state, nodeId, goalId);
  if (failed(result)) return result;
  if (!isLeafNode(result.found)) {
    return { error: `"${result.found.title}" is a group — ${clause}` };
  }
  return result;
}

export function handleAgentWrite(
  request: AgentRequest,
  deps: AgentWriteDeps,
): AgentResponse {
  const { actions, getState } = deps;
  const state = getState();

  /** Every mutation exits through here, so the persist check cannot be forgotten. */
  const settled = (data: unknown): AgentResponse =>
    getState().persistFailed ? errorResponse(PERSIST_FAILED) : okResponse(data);

  switch (request.tool) {
    case 'create_project': {
      // `parseGoalImport` takes the RAW TEXT, not a parsed object: it owns the
      // schema (docs/import-schema.md) and its own JSON handling, including the
      // fence-stripping a pasted AI reply needs. The request arrived as JSON,
      // so this hands it straight back the string it expects.
      const parsed = parseGoalImport(JSON.stringify(request.project), todayStr());
      // Verbatim. The parser owns the contract; restating it here would let
      // the two drift, and it is the message the Import modal already shows.
      if ('error' in parsed) return errorResponse(parsed.error);
      actions.addGoals(parsed.goals);
      return settled({
        created: parsed.goals.map((goal) => ({ id: goal.id, title: goal.title })),
      });
    }

    case 'add_task': {
      const owner = project(state, request.goalId);
      if (failed(owner)) return errorResponse(owner.error);
      if (request.parentId !== undefined) {
        // Searched inside the named project, so a parent id belonging to a
        // different goal is caught rather than silently obeyed.
        const parent = findNode(owner.found.nodes, request.parentId);
        if (!parent) {
          return errorResponse(`No task with id "${request.parentId}" in "${owner.found.title}".`);
        }
      }
      const before = nodeIds(owner.found);
      if (request.parentId !== undefined) actions.addChild(request.parentId, request.title);
      else actions.addRootNode(request.goalId, request.title);
      // Both actions return void. The new id is what the model needs next — to
      // estimate it, schedule it, or set its status — and looking for it is
      // also the only honest check that anything was added at all.
      const after = getState().goals.find((g) => g.id === request.goalId);
      const added = after ? [...nodeIds(after)].filter((id) => !before.has(id)) : [];
      if (added.length === 0) return errorResponse(`"${request.title}" was not added.`);
      return settled({ nodeId: added[0], goalId: request.goalId, title: request.title });
    }

    case 'rename': {
      // Containers rename too — the tree's `Enter` renames whatever row it is
      // on — so this is `step`, not `leaf`.
      const target = step(state, request.nodeId);
      if (failed(target)) return errorResponse(target.error);
      actions.renameNode(request.nodeId, request.title);
      return settled({ nodeId: request.nodeId, title: request.title });
    }

    case 'estimate': {
      const target = leaf(state, request.nodeId, 'only a task carries an estimate.');
      if (failed(target)) return errorResponse(target.error);
      actions.setNodeEstimate(request.nodeId, request.minutes);
      // `setNodeEstimate` returns void and refuses silently on shapes this
      // cannot see from outside. Reading the number back is exact, and a
      // request that asked for what was already there reads as success —
      // which it is.
      const after = getState().goals.find((g) => findNode(g.nodes, request.nodeId));
      const stored = after ? findNode(after.nodes, request.nodeId)?.estimateMin : undefined;
      const wanted = request.minutes === null || request.minutes <= 0
        ? undefined
        : Math.round(request.minutes);
      if (stored !== wanted) return errorResponse(`"${target.found.title}" did not take that estimate.`);
      return settled({ nodeId: request.nodeId, minutes: wanted ?? null });
    }

    case 'set_status': {
      const target = leaf(
        state,
        request.nodeId,
        "a group's status is derived from its descendants, never stored.",
      );
      if (failed(target)) return errorResponse(target.error);
      // `blockedOn` is present only while the status is 'blocked' — every other
      // transition clears it. Accepting one here would store nothing.
      if (request.blockedOn !== undefined && request.status !== 'blocked') {
        return errorResponse('A reason belongs to "blocked" — set the status to blocked to give one.');
      }
      if (request.status === 'done') {
        // Route 'done' through `toggleLeaf`, exactly as TaskPage's popover
        // does, so completing from here arms the identical `Completed "X"`
        // undo the checkbox arms. `toggleLeaf` TOGGLES, so it may only fire on
        // the transition INTO 'done'.
        if (isDone(target.found)) return errorResponse('That status change did not apply.');
        actions.toggleLeaf(request.nodeId);
        return settled({ nodeId: request.nodeId, status: 'done' });
      }
      // `setNodeStatus`, not `setNodesStatus`: the singular form is the one
      // that carries `blockedOn`, and one node is not a bulk edit.
      if (!actions.setNodeStatus(
        request.nodeId,
        request.status,
        request.status === 'blocked' ? request.blockedOn : undefined,
      )) {
        return errorResponse('That status change did not apply.');
      }
      return settled({
        nodeId: request.nodeId,
        status: request.status,
        ...(request.blockedOn === undefined ? {} : { blockedOn: request.blockedOn }),
      });
    }

    case 'set_life': {
      const owner = project(state, request.goalId);
      if (failed(owner)) return errorResponse(owner.error);
      // Named, not id'd, and resolved HERE rather than by the store: a life id
      // is invisible from outside the app, and there is no read verb that
      // reports one — so the refusal has to double as the way to discover what
      // there is to pick from.
      let lifeId: string | null = null;
      let lifeTitle: string | null = null;
      if (request.life !== null) {
        const wanted = request.life.trim().toLowerCase();
        const match = state.lives.find((l) => l.title.trim().toLowerCase() === wanted);
        if (!match) {
          const known = state.lives.map((l) => `"${l.title}"`).join(', ');
          return errorResponse(
            known
              ? `No life called "${request.life}". Phase has ${known}.`
              : `No life called "${request.life}" — Phase has none yet, so create one there first.`,
          );
        }
        lifeId = match.id;
        lifeTitle = match.title;
      }
      actions.setGoalLife(request.goalId, lifeId);
      // `setGoalLife` returns void and refuses SILENTLY — on a goal it cannot
      // find, and on a life id that is not in `lives`. Rule 2: re-read rather
      // than mirror its guard. The field is ABSENT when unassigned, never
      // `undefined` in place, which is why this compares against `?? null`.
      const after = getState().goals.find((g) => g.id === request.goalId);
      if ((after?.lifeId ?? null) !== lifeId) {
        return errorResponse(`"${owner.found.title}" did not take that life.`);
      }
      // The STORED title, not the one that was typed — the match is
      // case-insensitive, so echoing the request would misreport what landed.
      return settled({ goalId: request.goalId, lifeId, life: lifeTitle });
    }

    case 'complete_task': {
      if (request.ref.kind === 'step') {
        const target = leaf(
          state,
          request.ref.id,
          'tick the steps inside it instead.',
          request.ref.goalId,
        );
        if (failed(target)) return errorResponse(target.error);
        // `toggleLeaf` and `toggleTask` TOGGLE. On something already finished
        // they would un-tick it, and reporting `{ completed }` about that is
        // the one thing this surface may never do.
        if (isDone(target.found)) return errorResponse(`"${target.found.title}" is already done.`);
        actions.toggleLeaf(request.ref.id);
      } else {
        const task = state.tasks.find((t) => t.id === request.ref.id);
        if (!task) return errorResponse(`No task with id "${request.ref.id}".`);
        if (task.done) return errorResponse(`"${task.title}" is already done.`);
        actions.toggleTask(request.ref.id);
      }
      return settled({ completed: request.ref.id });
    }

    case 'schedule': {
      // A fresh sitting is sized from the estimate — the only thing there is to
      // go on — and only `resizeNode`/`resizeTask` change a block's own length,
      // both of which need the `blockId` of a bar that already exists. Silently
      // dropping the number would book a sitting of a length nobody asked for.
      if (request.minutes !== undefined) {
        return errorResponse(
          'A sitting is sized by the task\'s estimate. Set it with "estimate" first, then schedule.',
        );
      }
      // The protocol's `YYYY-MM-DD` shape check passes '2026-13-45';
      // `scheduleTask` would refuse it silently and `scheduleNode` would go
      // looking for free time on a day that does not exist.
      if (!isValidLocalDate(request.day)) {
        return errorResponse(`"${request.day}" is not a real date.`);
      }
      // No `blockId`: this is a booking from a distance, so the store arms the
      // undo and — on a full day — writes `describeNoRoom`'s own sentence as a
      // toast before refusing. Reading it back is what keeps this from being a
      // second way to say "no room".
      const before = getState().toast;
      const say = () => {
        const toast = getState().toast;
        return errorResponse(toast && toast !== before ? toast : NO_ROOM);
      };
      if (request.ref.kind === 'step') {
        const target = leaf(
          state,
          request.ref.id,
          'a sitting belongs to a task, not to the group holding it.',
          request.ref.goalId,
        );
        if (failed(target)) return errorResponse(target.error);
        if (!actions.scheduleNode(
          request.ref.goalId,
          request.ref.id,
          request.day,
          request.startMin ?? 0,
        )) return say();
      } else {
        const task = state.tasks.find((t) => t.id === request.ref.id);
        if (!task) return errorResponse(`No task with id "${request.ref.id}".`);
        if (!actions.scheduleTask(request.ref.id, request.day, request.startMin ?? 0)) return say();
      }
      return settled({
        scheduled: request.ref.id,
        day: request.day,
        ...(request.startMin === undefined ? {} : { startMin: request.startMin }),
      });
    }

    case 'delete': {
      // `removeNodes(ids)` for a step, because the bulk form is the one that
      // reports whether it wrote; `removeTask(id)` returns nothing, so its only
      // honest checks are that the task exists and that `persistFailed` is
      // clear afterwards.
      if (request.ref.kind === 'task') {
        const task = state.tasks.find((t) => t.id === request.ref.id);
        if (!task) return errorResponse(`No task with id "${request.ref.id}".`);
        actions.removeTask(request.ref.id);
        return settled({ deleted: request.ref.id });
      }
      const target = step(state, request.ref.id, request.ref.goalId);
      if (failed(target)) return errorResponse(target.error);
      if (!actions.removeNodes([request.ref.id])) return errorResponse('Nothing was deleted.');
      return settled({ deleted: request.ref.id });
    }

    case 'undo_last': {
      // Gated on the STACK, not `pendingUndo` — the toast timer nulls that
      // after 5s (15s for a destructive edit), and a write made from a
      // terminal is the one case where nobody was watching the toast. Reading
      // it here gave the agent a NARROWER window than the ⌘Z sitting in the
      // same app, which inverts the reason this verb exists.
      //
      // `undoLastDelete` answers with the label it restored, so one call is
      // both the action and the honest report. Null means the stack was
      // empty, which after an ordinary in-app edit is `setAndPersist`'s sweep
      // having dropped every non-surgical entry.
      const undone = actions.undoLastDelete();
      if (undone === null) {
        return errorResponse('Nothing to undo — an edit in Phase since then cleared it.');
      }
      return okResponse({ undone });
    }

    default:
      return errorResponse(`"${(request as { tool: string }).tool}" is not a write.`);
  }
}
