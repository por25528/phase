import type { Goal } from '../db/types';
import type { FullState } from '../state/store';
import type { AgentRequest, AgentResponse } from './agentProtocol';
import { okResponse, errorResponse } from './agentProtocol';
import { executionAdvice, type ExecutionAdviceInput } from './executionAdvisor';
import { weekCapacity, type CapacityInput, type Now } from './capacity';
import { backlogGroups } from './backlog';
import { goalEffort } from './effort';
import { goalHealth } from './health';
import { goalPct } from './pct';
import { todayStr } from './dates';
import { HORIZON_LABELS } from './horizons';
import { plannedLeaves, weekOf } from './plan';
import { tasksForWeek } from './dailyWork';

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
    availability: state.availability,
    blocks: [],
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
    windows: state.availability,
    blocks: [],
    leaves: plannedLeaves(state.goals, week),
    tasks: tasksForWeek(state.tasks, week),
    now,
    allDayBlocks: state.allDayBlocks,
    hasData: false, // no calendar cache reaches this module — see `nowOf`
  };
}

/**
 * One project, as the Goals board describes it.
 *
 * `remainingMin` never travels without `unestimated`: the first is a FLOOR
 * while the second is above zero, and "8h left" alone is a number that grows.
 */
function projectSummary(goal: Goal, state: FullState, today: string) {
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
    // `effort` is passed rather than recomputed: `goalEffort` walks the whole
    // leaf tree, and asking it twice per project would double the walk.
    health: goalHealth({
      goal,
      effort,
      today,
      windows: state.availability,
      blocks: [],
      allDayBlocks: state.allDayBlocks,
    }),
  };
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
      // The whole object, no verdict. `isOverCommitted` does exist, but it
      // lives in `src/views/plan/capacityLabel.ts` — above this seam — so
      // spending it here would invert the layering, and the comparison it
      // makes (`plannedMin + backlogMin > freeMin`) is the caller's to make
      // from figures this response already carries.
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
      const today = todayStr();
      return okResponse({
        projects: state.goals.map((goal) => projectSummary(goal, state, today)),
      });
    }
    case 'get_project': {
      const goal = state.goals.find((g) => g.id === request.goalId);
      if (!goal) return errorResponse(`No project with id "${request.goalId}".`);
      return okResponse({ project: goal });
    }
    default:
      return null;
  }
}
