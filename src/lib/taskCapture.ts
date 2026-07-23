import type { Goal } from '../db/types';
import { addDays } from './dates';
import { isValidLocalDate } from './schedule';

export type TaskCaptureDateChoice = 'today' | 'tomorrow' | 'pick';

export interface TaskCaptureDraft {
  title: string;
  dateChoice: TaskCaptureDateChoice;
  pickedDate: string;
  chooseProject: boolean;
  goalId: string;
}

export interface TaskCaptureSubmission {
  title: string;
  date: string;
  goalId: string | null;
}

export function createTaskCaptureDraft(today: string): TaskCaptureDraft {
  return {
    title: '',
    dateChoice: 'today',
    pickedDate: today,
    chooseProject: false,
    goalId: '',
  };
}

export function resolveTaskCaptureDate(
  draft: TaskCaptureDraft,
  today: string,
): string | null {
  if (!isValidLocalDate(today)) return null;
  if (draft.dateChoice === 'today') return today;
  if (draft.dateChoice === 'tomorrow') return addDays(today, 1);
  return isValidLocalDate(draft.pickedDate) ? draft.pickedDate : null;
}

export function activeProjectOptions(goals: readonly Goal[]): { id: string; title: string }[] {
  return goals
    .filter((goal) => !goal.completedAt)
    .map(({ id, title }) => ({ id, title }));
}

export function buildTaskCaptureSubmission(
  draft: TaskCaptureDraft,
  goals: readonly Goal[],
  today: string,
): TaskCaptureSubmission | null {
  const title = draft.title.trim();
  const date = resolveTaskCaptureDate(draft, today);
  if (!title || !date) return null;
  const goalId = draft.chooseProject
    && goals.some((goal) => !goal.completedAt && goal.id === draft.goalId)
    ? draft.goalId
    : null;
  return { title, date, goalId };
}
