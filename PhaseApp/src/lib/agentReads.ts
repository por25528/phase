import type { Goal } from '../db/types';
import type { FullState } from '../state/store';
import type { AgentRequest, AgentResponse } from './agentProtocol';
import { okResponse, errorResponse } from './agentProtocol';
import { executionAdvice, type ExecutionAdviceInput } from './executionAdvisor';
import { weekCapacity, type CapacityInput, type Now } from './capacity';
import { backlogGroups } from './backlog';
import { goalEffort } from './effort';
import { goalPct } from './pct';
import { todayStr } from './dates';
import { HORIZON_LABELS } from './horizons';
import { plannedLeaves, weekOf } from './plan';
import { coversWeek } from './calendarRange';
import { tasksForWeek } from './dailyWork';
import { spansOn } from './scheduled';
import { findNode } from './tree';
import { loggedForNode, loggedForTask } from './actuals';
import type { NoteRef } from './agentProtocol';
import type { WorkRef } from './expectedTime';
import { proposeReplan } from './replan';

/**
 * The read half of the agent surface.
 *
 * Every branch SPENDS the lib function its view spends and re-derives
 * nothing. A `today` that computed its own idea of what matters could
 * disagree with the Today page — the exact failure that "`todayPlan` spends
 * `backlogGroups` and nothing else" exists to prevent.
 *
 * Returns `null` for anything that is not a read, so the dispatcher can fall
 * through to the write handlers without listing the verbs twice.
 */

/**
 * The moment a read is answered.
 *
 * `blocks` is `[]` at every call site below, exactly as it is in `Today.tsx`
 * and `Plan.tsx`: the calendar cache lives outside `AppState`, so there is
 * nothing in the state handed to this module to pass.
 */
function nowOf(): Now {
  const clock = new Date();
  return { date: todayStr(), minute: clock.getHours() * 60 + clock.getMinutes() };
}

/** `Today.tsx`'s `executionAdvice` call, with the state supplied from outside React. */
function adviceInput(state: FullState, now: Now): ExecutionAdviceInput {
  return {
    goals: state.goals,
    tasks: state.tasks,
    sessions: state.sessions,
    blocks: state.busyBlocks,
    placedOn: (date: string) => spansOn(state.goals, state.tasks, date),
    allDayBlocks: state.allDayBlocks,
    today: now.date,
    week: weekOf(now.date),
    now,
  };
}

/** `Plan.tsx`'s `weekCapacity` call, verbatim — `leaves`/`tasks` filtered to the week first. */
function capacityInput(state: FullState, now: Now): CapacityInput {
  const week = weekOf(now.date);
  return {
    week,
    blocks: state.busyBlocks,
    leaves: plannedLeaves(state.goals, week),
    tasks: tasksForWeek(state.tasks, week),
    now,
    allDayBlocks: state.allDayBlocks,
    // Derived from the range the store actually holds, exactly as `Plan.tsx`
    // does it. It was hardcoded `false`, which said "nobody has fetched this
    // week" about a week every block was already in hand for — the more
    // damaging of the two errors, because it invites a caveat on an answer
    // that needs none.
    hasData: !!state.calendarRange && coversWeek(state.calendarRange, week),
  };
}

/**
 * One project, as the Goals board describes it.
 *
 * `remainingMin` never travels without `unestimated`: the first is a FLOOR
 * while the second is above zero, and "8h left" alone is a number that grows.
 */
function projectSummary(goal: Goal) {
  const effort = goalEffort(goal);
  return {
    id: goal.id,
    title: goal.title,
    // The board's commitment horizon, in its own words. `Goal` has no
    // `priority` field — the column IS the priority, and `HORIZON_LABELS` is
    // the one place it is spelled.
    horizon: HORIZON_LABELS[goal.column ?? 0],
    pct: goalPct(goal),
    remainingMin: effort.remainingMin,
    unestimated: effort.unestimated,
    // A subject's figure. All zeros for a project with no topics area, so a
    // reader can tell "no topics" from "none rated" without a second field.
    readiness: effort.readiness,
  };
}

/**
 * The title and note a `NoteRef` names. Shared by `get_note` here and the
 * note writes in `agentWrites.ts`, so the two halves resolve a ref identically.
 * A step is found in ANY project, completed or not — reading a frozen
 * project's notes is fine; writing is the write half's refusal to make.
 */
export function noteOf(
  state: FullState,
  ref: NoteRef,
): { title: string; markdown: string; goalId: string } | null {
  if (ref.kind === 'project') {
    const goal = state.goals.find((g) => g.id === ref.id);
    return goal ? { title: goal.title, markdown: goal.notes ?? '', goalId: goal.id } : null;
  }
  for (const goal of state.goals) {
    const node = findNode(goal.nodes, ref.id);
    if (node) return { title: node.title, markdown: node.notes ?? '', goalId: goal.id };
  }
  return null;
}

/** "No task with id" / "No project with id" — the same sentence the other reads use. */
export function missingRef(ref: NoteRef | WorkRef): string {
  return `No ${ref.kind === 'project' ? 'project' : 'task'} with id "${ref.id}".`;
}

/**
 * The ledger for one piece of work: the same `loggedForNode`/`loggedForTask`
 * `TaskPage` prints, plus the entries behind the figure. `nodeId` takes
 * precedence in the filter for the reason `loggedForTask` states.
 */
function timeLogOf(state: FullState, ref: WorkRef) {
  const sessions = state.sessions
    .filter((s) => (ref.kind === 'step'
      ? s.nodeId === ref.id
      : s.nodeId === undefined && s.taskId === ref.id))
    .map((s) => ({ id: s.id, date: s.date, minutes: s.minutes, note: s.note }));
  const loggedMin = ref.kind === 'step'
    ? loggedForNode(state.sessions, ref.id)
    : loggedForTask(state.sessions, ref.id);
  return { loggedMin, sessions };
}

export function handleAgentRead(
  request: AgentRequest,
  state: FullState,
): AgentResponse | null {
  switch (request.tool) {
    case 'today': {
      // No `timeLevel`: a gap declared in the shelf must not reach this surface.
      const now = nowOf();
      return okResponse({ advice: executionAdvice(adviceInput(state, now)) });
    }
    case 'week': {
      // The whole object, no verdict. There is no over-commitment verdict
      // left to pass: nothing prices a week against available hours. What this
      // carries is what has been taken on — planned, to place, unestimated —
      // and the caller reads it as such.
      const now = nowOf();
      return okResponse({ capacity: weekCapacity(capacityInput(state, now)) });
    }
    case 'backlog': {
      const today = todayStr();
      return okResponse({
        groups: backlogGroups(state.goals, state.tasks, weekOf(today), today),
      });
    }
    case 'list_projects': {
      return okResponse({
        projects: state.goals.map((goal) => projectSummary(goal)),
      });
    }
    case 'get_project': {
      const goal = state.goals.find((g) => g.id === request.goalId);
      if (!goal) return errorResponse(`No project with id "${request.goalId}".`);
      return okResponse({ project: goal });
    }
    case 'propose_replan': {
      // `Today.tsx`'s call, verbatim — the store's cached busy time included,
      // so the assistant never proposes an hour the planner would refuse.
      // Proposes only: `apply_replan` is the write, and it takes these moves
      // back rather than recomputing them.
      const now = nowOf();
      return okResponse(proposeReplan({
        goals: state.goals,
        tasks: state.tasks,
        today: now.date,
        blocks: state.busyBlocks,
        allDayBlocks: state.allDayBlocks,
        now,
      }));
    }
    case 'get_note': {
      const note = noteOf(state, request.ref);
      if (!note) return errorResponse(missingRef(request.ref));
      return okResponse({ title: note.title, markdown: note.markdown });
    }
    case 'time_log': {
      const exists = request.ref.kind === 'step'
        ? state.goals.some((g) => findNode(g.nodes, request.ref.id))
        : state.tasks.some((t) => t.id === request.ref.id);
      if (!exists) return errorResponse(missingRef(request.ref));
      return okResponse(timeLogOf(state, request.ref));
    }
    default:
      return null;
  }
}
