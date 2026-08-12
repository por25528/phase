import type { Goal, GoalNode, Task } from '../db/types';
import { addDays, weekDates } from './dates';
import { isValidLocalDate } from './schedule';
import { isDone } from './status';
import { blocksOf, blocksOn } from './blocks';
import { normalizeEstimate } from './capacity';

export type DailyWorkSource =
  | 'due'
  | 'task-today'
  | 'pinned-today'
  | 'this-week'
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
  plannedWeek?: string;
  plannedDay?: string;
  scheduledDate?: string;
  /**
   * Minutes from local midnight, mirrored from `Task.startMin` /
   * `GoalNode.plannedStartMin`. Absent means the item is committed to the day
   * but not placed on the Plan grid — it sorts below everything timed.
   */
  startMin?: number;
  /**
   * Mirrored from `Task.estimateMin` / `GoalNode.estimateMin`, normalised the
   * same way every other reader of an estimate does. Today's Now card states
   * how long the thing in front of you is meant to take; without it the one
   * row the surface exists for is the one row with no size.
   */
  estimateMin?: number;
}

export interface DailyWorkSections {
  commitments: DailyWorkItem[];
  carryOvers: DailyWorkItem[];
  completedToday: DailyWorkItem[];
}

interface GoalLeaf {
  goal: Goal;
  node: GoalNode;
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

/**
 * The sitting on `today`, if there is one.
 *
 * A task can now have several, and Today shows the day's schedule — so the time
 * a row carries is the time of THIS day's sitting, not of the earliest one. A
 * task sat on Monday and Wednesday reads 14:00 on Wednesday, not Monday's hour.
 */
function todayBlock(item: GoalNode | Task, today: string) {
  return blocksOn(item, today).sort((a, b) => a.startMin - b.startMin)[0];
}

function taskItem(
  task: Task,
  source: DailyWorkSource,
  goalById: Map<string, Goal>,
  today: string,
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
    ...(todayBlock(task, today) === undefined ? {} : { startMin: todayBlock(task, today)!.startMin }),
    ...(estimate(task.estimateMin) === undefined ? {} : { estimateMin: estimate(task.estimateMin) }),
  };
}

function stepItem(leaf: GoalLeaf, source: DailyWorkSource, today: string): DailyWorkItem {
  const { goal, node } = leaf;
  return {
    key: `step:${node.id}`,
    kind: 'step',
    id: node.id,
    title: node.title,
    goalId: goal.id,
    goalTitle: goal.title,
    due: source === 'due',
    done: isDone(node),
    editable: !goal.completedAt,
    source,
    ...(isValidLocalDate(node.plannedWeek) ? { plannedWeek: node.plannedWeek } : {}),
    ...(todayBlock(node, today) === undefined ? {} : { plannedDay: today }),
    ...(isValidLocalDate(node.deadline) ? { scheduledDate: node.deadline } : {}),
    ...(todayBlock(node, today) === undefined ? {} : { startMin: todayBlock(node, today)!.startMin }),
    ...(estimate(node.estimateMin) === undefined ? {} : { estimateMin: estimate(node.estimateMin) }),
  };
}

/** The one definition of a usable estimate, shared with the capacity math. */
const estimate = normalizeEstimate;


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
      carryOvers: [],
      completedToday: [],
    };
  }

  const currentWeek = weekDates(today)[0];
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const allLeaves: GoalLeaf[] = [];

  for (const goal of goals) {
    walkLeaves(goal.nodes, (node) => {
      allLeaves.push({ goal, node });
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
      !isDone(leaf.node)
      && isValidLocalDate(leaf.node.deadline)
      && leaf.node.deadline <= today
    ) {
      addCommitment(stepItem(leaf, 'due', today));
    }
  }
  for (const task of tasks) {
    if (
      !task.done
      && isValidLocalDate(task.date)
      && task.date === today
    ) {
      addCommitment(taskItem(task, 'task-today', goalById, today));
    }
  }
  for (const leaf of activeLeaves) {
    const { node } = leaf;
    if (
      !isDone(node)
      && hasValidPlannedWeek(node)
      && node.plannedWeek === currentWeek
      && blocksOn(node, today).length > 0
    ) {
      addCommitment(stepItem(leaf, 'pinned-today', today));
    }
  }
  for (const leaf of activeLeaves) {
    const { node } = leaf;
    if (
      !isDone(node)
      && hasValidPlannedWeek(node)
      && node.plannedWeek === currentWeek
      /*
       * Committed to this week and not spoken for.
       *
       * Nothing today (that is the bucket above) AND nothing still to come: a
       * leaf sat on Friday is Friday's work, and listing it under today would
       * put the whole week on one day. A leaf whose only sittings are in the
       * PAST does belong here — that is the slipped commitment.
       */
      && blocksOn(node, today).length === 0
      && !blocksOf(node).some((b) => b.date > today)
    ) {
      addCommitment(stepItem(leaf, 'this-week', today));
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
      carryOvers.push(taskItem(task, 'carry-over', goalById, today));
    }
  }
  for (const leaf of activeLeaves) {
    const { node } = leaf;
    const stale = Boolean(
      hasValidPlannedWeek(node) && node.plannedWeek < currentWeek,
    );
    const key = `step:${node.id}`;
    if (!isDone(node) && stale && !committedKeys.has(key)) {
      carryOvers.push(stepItem(leaf, 'carry-over', today));
    }
  }

  const completedToday: DailyWorkItem[] = [];
  for (const task of tasks) {
    if (task.done && task.doneAt === today) {
      completedToday.push(taskItem(task, 'completed-today', goalById, today));
    }
  }
  for (const leaf of allLeaves) {
    if (isDone(leaf.node) && leaf.node.doneAt === today) {
      completedToday.push(stepItem(leaf, 'completed-today', today));
    }
  }

  return {
    commitments: sortByClock(commitments),
    carryOvers,
    completedToday,
  };
}

/**
 * Where to draw the "now" line: the index of the first item that has not
 * started yet, so "what's next" is a glance rather than a scan.
 *
 * Null means don't draw one — either nothing is timed, or the whole day is
 * behind you and a rule under the last row would just be noise.
 */
export function nowDividerIndex(items: DailyWorkItem[], nowMinute: number): number | null {
  for (let i = 0; i < items.length; i += 1) {
    const start = items[i].startMin;
    if (start != null && start >= nowMinute) return i;
  }
  return null;
}

/**
 * Chronological, with untimed work sinking below everything timed.
 *
 * Items arrive in bucket precedence (due → task-today → pinned-today →
 * this-week), which stays as the tiebreak for equal times — hence the stable
 * index sort rather than sorting `commitments` in place.
 */
function sortByClock(items: DailyWorkItem[]): DailyWorkItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const at = a.item.startMin ?? Infinity;
      const bt = b.item.startMin ?? Infinity;
      return at - bt || a.index - b.index;
    })
    .map(({ item }) => item);
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
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.title.localeCompare(b.title));
}
