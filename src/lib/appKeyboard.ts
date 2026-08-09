export type AppKeyCommand =
  | 'capture-task'
  | 'open-palette'
  | 'undo'
  | 'blur-target'
  | 'close-drawer'
  | 'view-today'
  | 'view-plan'
  | 'view-goals'
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

  // ⌘K outranks the editable-target guard — search has to be reachable while a
  // field is focused. ⌘Z deliberately does NOT: inside a field it belongs to
  // the browser's text undo, which is what a half-typed rename needs.
  if (shouldConsumePaletteShortcut(event)) {
    return event.repeat ? null : 'open-palette';
  }

  if (isEditableTarget(event.target)) {
    return event.key === 'Escape' ? 'blur-target' : null;
  }
  if (isUndoShortcut(event)) {
    return event.repeat ? null : 'undo';
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === 'Escape') return 'close-drawer';
  if (event.key === '?') return 'toggle-shortcuts'; // Shift+/ — the cheat sheet
  // 1-3 are the three destinations, in nav order. They collide with the Plan
  // view's own 1-7 weekday placement, which wins: Plan registers a CAPTURE-phase
  // listener on `window` and calls stopPropagation, so a digit it consumes never
  // reaches App's bubble-phase handler. Plan only consumes the digit when a
  // backlog row is focused, so otherwise it falls through to here.
  //
  // 3 is Goals, not Timeline. Timeline stopped being a destination and became a
  // representation of Goals; a shortcut that jumped to a representation would be
  // the one navigation key that changes two things.
  if (event.key === '1') return 'view-today';
  if (event.key === '2') return 'view-plan';
  if (event.key === '3') return 'view-goals';
  // `t` is deliberately NOT mapped here. It belongs to the Plan view, which
  // handles it on its own capture-phase listener to jump the week back to
  // today. An app-level `t` could only call `actions.goToToday()`, and nothing
  // in `src` reads the `selDate` that sets — it looked like it worked only
  // because switching to Plan remounts it on the current week.
  return null;
}

/**
 * Whether Escape should leave the project page.
 *
 * Escape belongs to the topmost thing on screen. With a dialog open over the
 * page — the subtask modal is reachable straight from the Steps tab — the
 * dialog consumes it, and navigating away as well would throw the user off
 * the page they were working on for a keypress that meant "dismiss this".
 */
export function shouldLeaveProjectPage(
  command: AppKeyCommand | null,
  view: string,
  modalOpen: boolean,
  stepPanelOpen: boolean,
): boolean {
  return command === 'close-drawer' && view === 'project' && !modalOpen && !stepPanelOpen;
}

export function shouldCloseStepPanel(
  command: AppKeyCommand | null,
  view: string,
  modalOpen: boolean,
  stepPanelOpen: boolean,
): boolean {
  return command === 'close-drawer' && view === 'project' && !modalOpen && stepPanelOpen;
}

// ⌘K / Ctrl+K. Chromium binds Ctrl+K to the address bar, so the caller must
// preventDefault as it does for ⌘N.
export function shouldConsumePaletteShortcut(event: AppKeyEvent): boolean {
  return Boolean(
    (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === 'k'
  );
}

// ⌘Z / Ctrl+Z, but not ⇧⌘Z (redo, which Phase does not implement — leaving it
// unbound is better than silently doing an undo).
function isUndoShortcut(event: AppKeyEvent): boolean {
  return Boolean(
    (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === 'z'
  );
}

export function shouldConsumeTaskCaptureShortcut(event: AppKeyEvent): boolean {
  return Boolean(
    (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === 'n'
  );
}
