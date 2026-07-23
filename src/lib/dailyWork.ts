import type { Goal, GoalNode, Task } from '../db/types';
import { addDays, weekDates } from './dates';

export type DailyWorkSource =
  | 'due'
  | 'task-today'
  | 'pinned-today'
  | 'this-week'
  | 'suggested'
  | 'carry-over'
  | 'completed-today';

export interface DailyWorkItem {
  key: string;
  kind: 'task' | 'step';
  id: string;
  title: string;
  goalId: string | null;
  goalTitle?: string;
  due: boolean;
  done: boolean;
  source: DailyWorkSource;
  plannedDay?: string;
  scheduledDate?: string;
}

export interface DailyWorkSections {
  commitments: DailyWorkItem[];
  suggestions: DailyWorkItem[];
  carryOvers: DailyWorkItem[];
  completedToday: DailyWorkItem[];
}

interface GoalLeaf {
  goal: Goal;
  node: GoalNode;
  order: number;
}

interface SuggestionQueue {
  goal: Goal;
  milestoneSoon: boolean;
  items: GoalLeaf[];
}

// The one tree traversal used by every step-based section. An empty children
// array is a legacy leaf, while a non-empty array identifies a container.
function walkLeaves(nodes: GoalNode[], visit: (node: GoalNode) => void): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      walkLeaves(node.children, visit);
    } else {
      visit(node);
    }
  }
}

function taskItem(
  task: Task,
  source: DailyWorkSource,
  goalById: Map<string, Goal>,
): DailyWorkItem {
  const goal = task.goalId ? goalById.get(task.goalId) : undefined;
  return {
    key: `task:${task.id}`,
    kind: 'task',
    id: task.id,
    title: task.title,
    goalId: goal?.id ?? null,
    ...(goal ? { goalTitle: goal.title } : {}),
    due: false,
    done: task.done,
    source,
    scheduledDate: task.date,
  };
}

function stepItem(leaf: GoalLeaf, source: DailyWorkSource): DailyWorkItem {
  const { goal, node } = leaf;
  return {
    key: `step:${node.id}`,
    kind: 'step',
    id: node.id,
    title: node.title,
    goalId: goal.id,
    goalTitle: goal.title,
    due: source === 'due',
    done: Boolean(node.done),
    source,
    ...(node.plannedDay ? { plannedDay: node.plannedDay } : {}),
    ...(node.deadline ? { scheduledDate: node.deadline } : {}),
  };
}

function suggestionTier(node: GoalNode, today: string): number {
  if (
    node.start
    && node.deadline
    && node.start <= today
    && node.deadline >= today
  ) {
    return 0;
  }
  if (node.start && node.start > today) return 2;
  return 1;
}

function milestoneWithin14Days(goal: Goal, today: string): boolean {
  const end = addDays(today, 14);
  return Boolean(goal.milestones?.some((milestone) => (
    milestone.date >= today && milestone.date <= end
  )));
}

export function buildDailyWork(
  goals: Goal[],
  tasks: Task[],
  today: string,
): DailyWorkSections {
  const currentWeek = weekDates(today)[0];
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const leaves: GoalLeaf[] = [];

  for (const goal of goals) {
    if (goal.completedAt) continue;
    let order = 0;
    walkLeaves(goal.nodes, (node) => {
      leaves.push({ goal, node, order });
      order += 1;
    });
  }

  const commitments: DailyWorkItem[] = [];
  const committedKeys = new Set<string>();
  const addCommitment = (item: DailyWorkItem): void => {
    if (committedKeys.has(item.key)) return;
    committedKeys.add(item.key);
    commitments.push(item);
  };

  for (const leaf of leaves) {
    if (!leaf.node.done && leaf.node.deadline && leaf.node.deadline <= today) {
      addCommitment(stepItem(leaf, 'due'));
    }
  }
  for (const task of tasks) {
    if (!task.done && task.date === today) {
      addCommitment(taskItem(task, 'task-today', goalById));
    }
  }
  for (const leaf of leaves) {
    const { node } = leaf;
    if (
      !node.done
      && node.plannedWeek === currentWeek
      && node.plannedDay === today
    ) {
      addCommitment(stepItem(leaf, 'pinned-today'));
    }
  }
  for (const leaf of leaves) {
    const { node } = leaf;
    if (
      !node.done
      && node.plannedWeek === currentWeek
      && (!node.plannedDay || node.plannedDay < today)
    ) {
      addCommitment(stepItem(leaf, 'this-week'));
    }
  }

  const carryOvers: DailyWorkItem[] = [];
  for (const task of tasks) {
    const key = `task:${task.id}`;
    if (!task.done && task.date < today && !committedKeys.has(key)) {
      carryOvers.push(taskItem(task, 'carry-over', goalById));
    }
  }
  for (const leaf of leaves) {
    const { node } = leaf;
    const stale = Boolean(node.plannedWeek && node.plannedWeek < currentWeek);
    const slipped = (
      node.plannedWeek === currentWeek
      && Boolean(node.plannedDay)
      && node.plannedDay! < today
    );
    const key = `step:${node.id}`;
    if (!node.done && (stale || slipped) && !committedKeys.has(key)) {
      carryOvers.push(stepItem(leaf, 'carry-over'));
    }
  }

  const completedToday: DailyWorkItem[] = [];
  for (const task of tasks) {
    if (task.doneAt === today) {
      completedToday.push(taskItem(task, 'completed-today', goalById));
    }
  }
  for (const leaf of leaves) {
    if (leaf.node.doneAt === today) {
      completedToday.push(stepItem(leaf, 'completed-today'));
    }
  }

  const latestSuggestionStart = addDays(today, 30);
  const suggestionQueues: SuggestionQueue[] = goals
    .filter((goal) => (
      !goal.completedAt
      && (goal.column ?? 0) === 0
      && (!goal.start || goal.start <= today)
    ))
    .map((goal) => {
      const candidates = leaves
        .filter(({ goal: owner, node }) => (
          owner.id === goal.id
          && !node.done
          && !node.plannedWeek
          && (!node.deadline || node.deadline > today)
          && (!node.start || node.start <= latestSuggestionStart)
        ))
        .sort((a, b) => (
          suggestionTier(a.node, today) - suggestionTier(b.node, today)
          || a.order - b.order
        ));
      return {
        goal,
        milestoneSoon: milestoneWithin14Days(goal, today),
        items: candidates,
      };
    })
    .filter((queue) => queue.items.length > 0)
    .sort((a, b) => Number(b.milestoneSoon) - Number(a.milestoneSoon));

  const suggestions: DailyWorkItem[] = [];
  for (let round = 0; round < 2 && suggestions.length < 4; round += 1) {
    for (const queue of suggestionQueues) {
      const leaf = queue.items[round];
      if (leaf) suggestions.push(stepItem(leaf, 'suggested'));
      if (suggestions.length === 4) break;
    }
  }

  return {
    commitments,
    suggestions,
    carryOvers,
    completedToday,
  };
}

export function tasksForWeek(tasks: Task[], week: string): Task[] {
  const start = weekDates(week)[0];
  const end = addDays(start, 6);
  return tasks
    .filter((task) => task.date >= start && task.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
