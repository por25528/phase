import type { Goal, GoalNode, Task } from '../db/types';
import { addDays, weekDates } from './dates';
import { isValidLocalDate } from './schedule';

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
  editable: boolean;
  source: DailyWorkSource;
  reason?: string; // why a 'suggested' item surfaced — shown in "Worth considering"
  plannedWeek?: string;
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

type GoalNodeWithValidPlan = GoalNode & { plannedWeek: string };

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
    editable: true,
    source,
    ...(isValidLocalDate(task.date) ? { scheduledDate: task.date } : {}),
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
    editable: !goal.completedAt,
    source,
    ...(isValidLocalDate(node.plannedWeek) ? { plannedWeek: node.plannedWeek } : {}),
    ...(isValidLocalDate(node.plannedDay) ? { plannedDay: node.plannedDay } : {}),
    ...(isValidLocalDate(node.deadline) ? { scheduledDate: node.deadline } : {}),
  };
}

function suggestionTier(node: GoalNode, today: string): number {
  if (
    isValidLocalDate(node.start)
    && isValidLocalDate(node.deadline)
    && node.start <= today
    && node.deadline >= today
  ) {
    return 0;
  }
  if (isValidLocalDate(node.start) && node.start > today) return 2;
  return 1;
}

// The short "why this surfaced" line for a suggestion, so the list is steerable
// instead of opaque. Mirrors the same signals that ordered the queue: a soon
// milestone floats the whole project, an in-window step beats an undated one.
function suggestionReason(queue: SuggestionQueue, node: GoalNode, today: string): string {
  if (queue.milestoneSoon) return 'Milestone soon';
  if (suggestionTier(node, today) === 0) return 'In its window';
  return 'Next open step';
}

function milestoneWithin14Days(goal: Goal, today: string): boolean {
  const end = addDays(today, 14);
  return Boolean(goal.milestones?.some((milestone) => (
    isValidLocalDate(milestone.date)
    && milestone.date >= today
    && milestone.date <= end
  )));
}

function hasValidPlannedWeek(node: GoalNode): node is GoalNodeWithValidPlan {
  return isValidLocalDate(node.plannedWeek);
}

export function buildDailyWork(
  goals: Goal[],
  tasks: Task[],
  today: string,
): DailyWorkSections {
  if (!isValidLocalDate(today)) {
    return {
      commitments: [],
      suggestions: [],
      carryOvers: [],
      completedToday: [],
    };
  }

  const currentWeek = weekDates(today)[0];
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const allLeaves: GoalLeaf[] = [];

  for (const goal of goals) {
    let order = 0;
    walkLeaves(goal.nodes, (node) => {
      allLeaves.push({ goal, node, order });
      order += 1;
    });
  }
  const activeLeaves = allLeaves.filter(({ goal }) => !goal.completedAt);

  const commitments: DailyWorkItem[] = [];
  const committedKeys = new Set<string>();
  const addCommitment = (item: DailyWorkItem): void => {
    if (committedKeys.has(item.key)) return;
    committedKeys.add(item.key);
    commitments.push(item);
  };

  for (const leaf of activeLeaves) {
    if (
      !leaf.node.done
      && isValidLocalDate(leaf.node.deadline)
      && leaf.node.deadline <= today
    ) {
      addCommitment(stepItem(leaf, 'due'));
    }
  }
  for (const task of tasks) {
    if (
      !task.done
      && isValidLocalDate(task.date)
      && task.date === today
    ) {
      addCommitment(taskItem(task, 'task-today', goalById));
    }
  }
  for (const leaf of activeLeaves) {
    const { node } = leaf;
    if (
      !node.done
      && hasValidPlannedWeek(node)
      && node.plannedWeek === currentWeek
      && isValidLocalDate(node.plannedDay)
      && node.plannedDay === today
    ) {
      addCommitment(stepItem(leaf, 'pinned-today'));
    }
  }
  for (const leaf of activeLeaves) {
    const { node } = leaf;
    if (
      !node.done
      && hasValidPlannedWeek(node)
      && node.plannedWeek === currentWeek
      && (!isValidLocalDate(node.plannedDay) || node.plannedDay < today)
    ) {
      addCommitment(stepItem(leaf, 'this-week'));
    }
  }

  const carryOvers: DailyWorkItem[] = [];
  for (const task of tasks) {
    const key = `task:${task.id}`;
    if (
      !task.done
      && isValidLocalDate(task.date)
      && task.date < today
      && !committedKeys.has(key)
    ) {
      carryOvers.push(taskItem(task, 'carry-over', goalById));
    }
  }
  for (const leaf of activeLeaves) {
    const { node } = leaf;
    const stale = Boolean(
      hasValidPlannedWeek(node) && node.plannedWeek < currentWeek,
    );
    const key = `step:${node.id}`;
    if (!node.done && stale && !committedKeys.has(key)) {
      carryOvers.push(stepItem(leaf, 'carry-over'));
    }
  }

  const completedToday: DailyWorkItem[] = [];
  for (const task of tasks) {
    if (task.done && task.doneAt === today) {
      completedToday.push(taskItem(task, 'completed-today', goalById));
    }
  }
  for (const leaf of allLeaves) {
    if (leaf.node.done === true && leaf.node.doneAt === today) {
      completedToday.push(stepItem(leaf, 'completed-today'));
    }
  }

  const latestSuggestionStart = addDays(today, 30);
  const suggestionQueues: SuggestionQueue[] = goals
    .filter((goal) => (
      !goal.completedAt
      && (goal.column ?? 0) === 0
      && (!isValidLocalDate(goal.start) || goal.start <= today)
    ))
    .map((goal) => {
      const candidates = activeLeaves
        .filter(({ goal: owner, node }) => (
          owner.id === goal.id
          && !node.done
          && !hasValidPlannedWeek(node)
          && (!isValidLocalDate(node.deadline) || node.deadline > today)
          && (!isValidLocalDate(node.start) || node.start <= latestSuggestionStart)
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
      if (leaf) {
        suggestions.push({
          ...stepItem(leaf, 'suggested'),
          reason: suggestionReason(queue, leaf.node, today),
        });
      }
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
  if (!isValidLocalDate(week)) return [];
  const start = weekDates(week)[0];
  const end = addDays(start, 6);
  return tasks
    .filter((task) => (
      isValidLocalDate(task.date)
      && task.date >= start
      && task.date <= end
    ))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
