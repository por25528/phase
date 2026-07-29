export type AppKeyCommand =
  | 'capture-task'
  | 'blur-target'
  | 'close-drawer'
  | 'view-today'
  | 'view-goals'
  | 'view-timeline'
  | 'view-plan'
  | 'open-plan'
  | 'go-today'
  | 'toggle-shortcuts';

interface AppKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: unknown;
}

function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown };
  const tagName = typeof candidate.tagName === 'string' ? candidate.tagName.toUpperCase() : '';
  return tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT'
    || candidate.isContentEditable === true;
}

export function resolveAppKeyCommand(event: AppKeyEvent): AppKeyCommand | null {
  if (shouldConsumeTaskCaptureShortcut(event)) {
    return event.repeat ? null : 'capture-task';
  }

  if (isEditableTarget(event.target)) {
    return event.key === 'Escape' ? 'blur-target' : null;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === 'Escape') return 'close-drawer';
  if (event.key === '?') return 'toggle-shortcuts'; // Shift+/ — the cheat sheet
  if (event.key === '1') return 'view-today';
  if (event.key === '2') return 'view-goals';
  if (event.key === '3') return 'view-timeline';
  if (event.key === '4') return 'open-plan';
  if (event.key === '5') return 'view-plan';
  if (event.key === 't') return 'go-today';
  return null;
}

export function shouldConsumeTaskCaptureShortcut(event: AppKeyEvent): boolean {
  return Boolean(
    (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === 'n'
  );
}
