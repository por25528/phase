import type { Goal } from '../db/types';
import {
  buildTaskCaptureSubmission,
  type TaskCaptureDraft,
} from '../lib/taskCapture';

interface TaskCaptureActions {
  addTask: (title: string, date: string, goalId: string | null) => void;
  showToast: (message: string) => void;
}

export function dispatchTaskCapture(input: {
  enabled: boolean;
  draft: TaskCaptureDraft;
  goals: readonly Goal[];
  today: string;
  actions: TaskCaptureActions;
}): boolean {
  if (!input.enabled) return false;
  const submission = buildTaskCaptureSubmission(input.draft, input.goals, input.today);
  if (!submission) return false;
  input.actions.addTask(submission.title, submission.date, submission.goalId);
  input.actions.showToast('Task added');
  return true;
}
