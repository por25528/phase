import type { Goal, GoalNode, Task } from '../db/types';
import { clearBlocks } from './blocks';
import { buildDailyWork } from './dailyWork';

export interface DeferResult {
  goals: Goal[];
  tasks: Task[];
  count: number;
}

// Replan the matching leaves onto `week`, clearing any day pin. Containers are
// walked, never matched — only leaves carry a plan.
//
// This deliberately produces a `plannedWeek`-with-no-`plannedDay` node: under
// the calendar-grid model that is legal backlog ("committed to the week, not
// yet pinned to a day"), not a half-scheduled item — dailyWork.ts's carry-over
// and this-week checks both key off exactly that shape. plannedStartMin has no
// meaning without a day, though, so it is cleared alongside plannedDay to keep
// the "never present without plannedDay" invariant intact.
function replanNodes(nodes: GoalNode[], stepIds: Set<string>, week: string): GoalNode[] {
  return nodes.map((node) => {
    if (node.children && node.children.length > 0) {
      return { ...node, children: replanNodes(node.children, stepIds, week) };
    }
    if (stepIds.has(node.id)) {
      // Pushed to another week means UNPLACED: every sitting goes, because a
      // sitting is a specific hour on a specific day and "next week" is neither.
      const next: GoalNode = { ...node, plannedWeek: week };
      clearBlocks(next);
      return next;
    }
    return node;
  });
}

/**
 * How many items `deferOpenWork` would move, without building the new arrays.
 *
 * A control offering a bulk action has to know whether there is anything to act
 * on before it renders, and it re-renders far more often than it is clicked.
 * Counting through `deferOpenWork` would clone every goal tree on each pass
 * just to read `.count` off the end.
 */
export function countOpenCarryOver(goals: Goal[], tasks: Task[], today: string): number {
  return buildDailyWork(goals, tasks, today).carryOvers.length;
}

// Bulk-triage every "Needs a decision" carry-over onto `targetWeekMonday`: overdue
// tasks get that date, slipped planned steps get that plannedWeek with their day
// pin cleared. The carry-over set is read straight from buildDailyWork, so this
// always moves exactly what Today surfaces — a due step (a real commitment) is
// never swept along. Returns the untouched arrays and count 0 when nothing is open.
export function deferOpenWork(
  goals: Goal[],
  tasks: Task[],
  today: string,
  targetWeekMonday: string,
): DeferResult {
  const { carryOvers } = buildDailyWork(goals, tasks, today);
  const taskIds = new Set<string>();
  const stepIds = new Set<string>();
  for (const item of carryOvers) {
    if (item.kind === 'task') taskIds.add(item.id);
    else stepIds.add(item.id);
  }
  if (taskIds.size === 0 && stepIds.size === 0) {
    return { goals, tasks, count: 0 };
  }
  // The day pin goes with the day — for tasks exactly as `replanNodes` above
  // already does it for steps. Carrying `startMin` across meant two overdue
  // tasks both pinned at 10:00 landed on top of each other on the target
  // Monday, and one pinned at 19:00 landed at 19:00 on a day whose window
  // closes at 18:00. This bulk path never consults availability, so it was
  // manufacturing precisely the overlaps `resolveSlot` gatekeeps every other
  // route against. `rescheduleTask` states the rule: a different day cannot
  // inherit this day's minute.
  const nextTasks = taskIds.size === 0
    ? tasks
    : tasks.map((t) => {
      if (!taskIds.has(t.id)) return t;
      const next: Task = { ...t, date: targetWeekMonday };
      clearBlocks(next);
      return next;
    });
  const nextGoals = stepIds.size === 0
    ? goals
    : goals.map((g) => ({ ...g, nodes: replanNodes(g.nodes, stepIds, targetWeekMonday) }));
  return { goals: nextGoals, tasks: nextTasks, count: taskIds.size + stepIds.size };
}
