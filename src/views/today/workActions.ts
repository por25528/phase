import type { DailyWorkItem } from '../../lib/dailyWork';
import { addDays } from '../../lib/dates';
import { isValidLocalDate } from '../../lib/schedule';

export type QuickAddType = 'habit' | 'goal' | 'task';

interface QuickAddActions {
  addGoal(title: string): void;
  addHabit(title: string, cadence: 'daily', weeklyTarget: number): void;
  addTask(title: string, date: string): void;
}

export function dispatchQuickAdd(
  type: QuickAddType,
  rawTitle: string,
  actions: QuickAddActions,
  getToday: () => string,
): boolean {
  const title = rawTitle.trim();
  if (!title) return false;
  if (type === 'habit') actions.addHabit(title, 'daily', 4);
  else if (type === 'goal') actions.addGoal(title);
  else actions.addTask(title, getToday());
  return true;
}

interface ToggleActions {
  toggleTask(taskId: string): void;
  toggleLeaf(nodeId: string): void;
}

export function toggleDailyWorkItem(
  item: DailyWorkItem,
  actions: ToggleActions,
): boolean {
  if (!item.editable) return false;
  if (item.kind === 'task') actions.toggleTask(item.id);
  else actions.toggleLeaf(item.id);
  return true;
}

export type TaskCarryOverAction = 'today' | 'tomorrow' | 'delete';

interface TaskCarryOverActions {
  rescheduleTask(taskId: string, date: string): void;
  removeTask(taskId: string): void;
}

export function runTaskCarryOverAction(
  choice: TaskCarryOverAction,
  item: DailyWorkItem,
  today: string,
  actions: TaskCarryOverActions,
): boolean {
  if (!item.editable || item.kind !== 'task') return false;
  if (choice === 'delete') {
    actions.removeTask(item.id);
    return true;
  }
  if (!isValidLocalDate(today)) return false;
  actions.rescheduleTask(item.id, choice === 'today' ? today : addDays(today, 1));
  return true;
}

export function rescheduleTaskToPickedDate(
  item: DailyWorkItem,
  date: string,
  actions: Pick<TaskCarryOverActions, 'rescheduleTask'>,
): boolean {
  if (!item.editable || item.kind !== 'task' || !isValidLocalDate(date)) return false;
  actions.rescheduleTask(item.id, date);
  return true;
}

interface SuggestionActions {
  scheduleNode(goalId: string, nodeId: string, day: string, aimMin: number): void;
}

export function scheduleSuggestionForToday(
  item: DailyWorkItem,
  today: string,
  actions: SuggestionActions,
): boolean {
  if (
    !item.editable
    || item.kind !== 'step'
    || item.source !== 'suggested'
    || !item.goalId
    || !isValidLocalDate(today)
  ) {
    return false;
  }
  // No specific time to aim at — aim at the start of the day and let
  // resolveSlot pick the earliest gap that fits.
  actions.scheduleNode(item.goalId, item.id, today, 0);
  return true;
}
