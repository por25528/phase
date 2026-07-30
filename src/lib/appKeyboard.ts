export type AppKeyCommand =
  | 'capture-task'
  | 'blur-target'
  | 'close-drawer'
  | 'view-plan'
  | 'view-goals'
  | 'view-timeline'
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

export function isEditableTarget(target: unknown): boolean {
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
  // 1-3 are the three views, in nav order. They collide with the Plan view's
  // own 1-7 weekday placement, which wins: Plan registers a CAPTURE-phase
  // listener on `window` and calls stopPropagation, so a digit it consumes
  // never reaches App's bubble-phase handler. Plan only consumes the digit
  // when a backlog row is focused, so otherwise it falls through to here.
  if (event.key === '1') return 'view-plan';
  if (event.key === '2') return 'view-goals';
  if (event.key === '3') return 'view-timeline';
  // `t` is deliberately NOT mapped here. It belongs to the Plan view, which
  // handles it on its own capture-phase listener to jump the week back to
  // today. An app-level `t` could only call `actions.goToToday()`, and nothing
  // in `src` reads the `selDate` that sets — it looked like it worked only
  // because switching to Plan remounts it on the current week.
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
