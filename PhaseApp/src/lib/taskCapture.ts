import type { Goal } from '../db/types';

/**
 * How the app tracks whether Quick add is up, and whether it has been asked to
 * take focus again.
 *
 * `focusRequest` is a counter rather than a boolean because ⌘N while the
 * composer is ALREADY open means "focus me", and a boolean cannot express the
 * same request twice.
 *
 * The draft model that used to live here — a title, a `today | tomorrow | pick`
 * choice, a picked date and a `chooseProject` toggle — went with the modal it
 * described. One line of text and `parseQuickAdd` replaced all of it.
 */
export interface TaskCaptureHostState {
  open: boolean;
  focusRequest: number;
}

export type TaskCaptureHydration = 'loading' | 'ready' | 'error';

type WithTaskCaptureHost<T extends TaskCaptureHostState> =
  Omit<T, keyof TaskCaptureHostState> & TaskCaptureHostState;

export function requestTaskCapture<T extends TaskCaptureHostState>(
  state: T,
): WithTaskCaptureHost<T> {
  return {
    ...state,
    open: true,
    focusRequest: state.focusRequest + 1,
  };
}

export function closeTaskCapture<T extends TaskCaptureHostState>(
  state: T,
): WithTaskCaptureHost<T> {
  return { ...state, open: false };
}

export function requestTaskCaptureForCommand(
  state: TaskCaptureHostState,
  hydration: TaskCaptureHydration,
  sharedModalOpen: boolean,
): TaskCaptureHostState {
  if (state.open) return requestTaskCapture(state);
  if (hydration !== 'ready' || sharedModalOpen) return state;
  return requestTaskCapture(state);
}

export function activeProjectOptions(goals: readonly Goal[]): { id: string; title: string }[] {
  return goals
    .filter((goal) => !goal.completedAt)
    .map(({ id, title }) => ({ id, title }));
}
