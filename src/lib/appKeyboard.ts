export type AppKeyCommand =
  | 'capture-task'
  | 'blur-target'
  | 'close-drawer'
  | 'view-today'
  | 'view-goals'
  | 'view-timeline'
  | 'go-today';

interface AppKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
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
  if (
    (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.repeat
    && event.key.toLowerCase() === 'n'
  ) {
    return 'capture-task';
  }

  if (isEditableTarget(event.target)) {
    return event.key === 'Escape' ? 'blur-target' : null;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === 'Escape') return 'close-drawer';
  if (event.key === '1') return 'view-today';
  if (event.key === '2') return 'view-goals';
  if (event.key === '3') return 'view-timeline';
  if (event.key === 't') return 'go-today';
  return null;
}
