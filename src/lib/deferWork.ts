import type { Goal, GoalNode, Task } from '../db/types';
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
      const next: GoalNode = { ...node, plannedWeek: week };
      delete next.plannedDay;
      delete next.plannedStartMin;
      return next;
    }
    return node;
  });
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
  const nextTasks = taskIds.size === 0
    ? tasks
    : tasks.map((t) => (taskIds.has(t.id) ? { ...t, date: targetWeekMonday } : t));
  const nextGoals = stepIds.size === 0
    ? goals
    : goals.map((g) => ({ ...g, nodes: replanNodes(g.nodes, stepIds, targetWeekMonday) }));
  return { goals: nextGoals, tasks: nextTasks, count: taskIds.size + stepIds.size };
}
