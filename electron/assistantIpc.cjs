// The renderer-to-overlay relay for the assistant, as a deep module.
//
// Two renderers talk through here and neither is trusted: the MAIN window is
// the only sender allowed to publish a snapshot, the OVERLAY is the only
// sender allowed to act or close, and every payload is validated structurally
// — shape, union membership, string lengths, array counts — before it is
// cached or forwarded. Store state never crosses wholesale; only the
// `AssistantSnapshot` projection defined in src/lib/assistantProtocol.ts does.

const ASSISTANT_CHANNEL_PREFIX = 'phase-assistant';

// Generous for real titles, hostile to payload smuggling.
const MAX_TEXT = 500;
const MAX_ALTERNATIVES = 2;
const MAX_MINUTES = 24 * 60 * 7; // a week of minutes bounds every duration

function shortString(value, max = MAX_TEXT) {
  return typeof value === 'string' && value.length <= max;
}

function optionalShortString(value) {
  return value === undefined || shortString(value);
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function boundedMinutes(value) {
  return finiteNonNegative(value) && value <= MAX_MINUTES;
}

function validRef(ref) {
  if (!ref || typeof ref !== 'object') return false;
  if (!shortString(ref.id) || ref.id.length === 0) return false;
  if (ref.kind === 'step') return shortString(ref.goalId) && ref.goalId.length > 0;
  if (ref.kind === 'task') return ref.goalId === null || shortString(ref.goalId);
  return false;
}

function validExpected(expected) {
  if (!expected || typeof expected !== 'object') return false;
  if (expected.kind === 'history') {
    return boundedMinutes(expected.lowMin)
      && boundedMinutes(expected.highMin)
      && (expected.confidence === 'medium' || expected.confidence === 'high')
      && finiteNonNegative(expected.sampleCount);
  }
  if (expected.kind === 'estimate') return boundedMinutes(expected.minutes);
  if (expected.kind === 'starter') return expected.minutes === 30;
  return false;
}

const REASONS = new Set([
  'scheduled-now', 'scheduled-next', 'due', 'committed-today',
  'committed-week', 'carried-over', 'free-time',
]);

function validWork(work) {
  return !!work
    && typeof work === 'object'
    && shortString(work.key)
    && validRef(work.ref)
    && shortString(work.title)
    && optionalShortString(work.goalTitle)
    && optionalShortString(work.lifeId)
    && REASONS.has(work.reason)
    && validExpected(work.expected);
}

function validAdvice(advice) {
  if (!advice || typeof advice !== 'object') return false;
  if (advice.kind === 'needs-hours' || advice.kind === 'clear') return true;
  if (advice.kind !== 'work') return false;
  if (!validWork(advice.primary)) return false;
  if (!Array.isArray(advice.alternatives) || advice.alternatives.length > MAX_ALTERNATIVES) return false;
  return advice.alternatives.every(validWork);
}

function validFocus(focus) {
  if (focus === null) return true;
  return !!focus
    && typeof focus === 'object'
    && validRef(focus.ref)
    && shortString(focus.title)
    && optionalShortString(focus.goalTitle)
    && (focus.phase === 'active' || focus.phase === 'break' || focus.phase === 'confirming')
    && boundedMinutes(focus.elapsedMin)
    && validExpected(focus.expected)
    && (focus.proposedMinutes === undefined || boundedMinutes(focus.proposedMinutes));
}

function validNotice(notice) {
  if (notice === undefined) return true;
  return !!notice
    && typeof notice === 'object'
    && (notice.tone === 'neutral' || notice.tone === 'warning')
    && shortString(notice.text);
}

function validLevel(level) {
  return level === 'low' || level === 'medium' || level === 'high';
}

function validSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (snapshot.status === 'loading') return true;
  if (snapshot.status !== 'ready') return false;
  return validAdvice(snapshot.advice)
    && validFocus(snapshot.activeFocus)
    && validLevel(snapshot.timeLevel)
    && validLevel(snapshot.detailLevel)
    && validNotice(snapshot.notice);
}

function validAction(action) {
  if (!action || typeof action !== 'object') return false;
  switch (action.type) {
    case 'start-focus':
    case 'switch-focus':
      return validRef(action.ref);
    case 'pause-focus':
    case 'resume-focus':
    case 'complete-focus':
    case 'close':
      return true;
    case 'confirm-focus':
      return action.minutes === null || (boundedMinutes(action.minutes) && action.minutes > 0);
    case 'set-time-level':
    case 'set-detail-level':
      return validLevel(action.level);
    default:
      return false;
  }
}

/**
 * The relay. Window getters are injected so this module never touches
 * BrowserWindow itself — the same seam `createCalendarHandlers` uses — and the
 * cached snapshot only ever holds a payload that already passed validation.
 */
function createAssistantIpc(deps) {
  const { getMainWindow, getAssistantWindow, hideAssistant, setShortcut } = deps;
  let latestSnapshot = null;

  function live(win) {
    return win && !win.isDestroyed() ? win : null;
  }

  function isSender(event, win) {
    return !!win && event.sender.id === win.webContents.id;
  }

  function onPublish(event, snapshot) {
    if (!isSender(event, live(getMainWindow()))) return;
    if (!validSnapshot(snapshot)) return;
    latestSnapshot = snapshot;
    const overlay = live(getAssistantWindow());
    if (overlay) overlay.webContents.send(`${ASSISTANT_CHANNEL_PREFIX}:snapshot`, snapshot);
  }

  function onReady(event) {
    if (!isSender(event, live(getAssistantWindow()))) return { status: 'loading' };
    // The cache may be stale (the overlay was hidden); ask the owner for a
    // fresh one, and serve the cache meanwhile so the window never blanks.
    const main = live(getMainWindow());
    if (main) main.webContents.send(`${ASSISTANT_CHANNEL_PREFIX}:request-snapshot`);
    return latestSnapshot ?? { status: 'loading' };
  }

  function onAct(event, action) {
    if (!isSender(event, live(getAssistantWindow()))) return;
    if (!validAction(action)) return;
    const main = live(getMainWindow());
    if (main) main.webContents.send(`${ASSISTANT_CHANNEL_PREFIX}:action`, action);
  }

  function onClose(event) {
    if (!isSender(event, live(getAssistantWindow()))) return;
    hideAssistant();
  }

  function onSetShortcut(event, requested) {
    // The accelerator preference lives in the main renderer's Dexie; only that
    // renderer may push it. The overlay has no business rebinding the OS.
    if (!isSender(event, live(getMainWindow()))) return null;
    if (typeof requested !== 'string' || requested.length === 0 || requested.length > 64) return null;
    if (!setShortcut) return null;
    return setShortcut(requested);
  }

  return {
    register(ipcMain) {
      ipcMain.on(`${ASSISTANT_CHANNEL_PREFIX}:publish`, onPublish);
      ipcMain.handle(`${ASSISTANT_CHANNEL_PREFIX}:ready`, onReady);
      ipcMain.on(`${ASSISTANT_CHANNEL_PREFIX}:act`, onAct);
      ipcMain.on(`${ASSISTANT_CHANNEL_PREFIX}:close`, onClose);
      ipcMain.handle(`${ASSISTANT_CHANNEL_PREFIX}:set-shortcut`, onSetShortcut);
    },
    dispose(ipcMain) {
      ipcMain.removeAllListeners(`${ASSISTANT_CHANNEL_PREFIX}:publish`);
      ipcMain.removeHandler(`${ASSISTANT_CHANNEL_PREFIX}:ready`);
      ipcMain.removeAllListeners(`${ASSISTANT_CHANNEL_PREFIX}:act`);
      ipcMain.removeAllListeners(`${ASSISTANT_CHANNEL_PREFIX}:close`);
      ipcMain.removeHandler(`${ASSISTANT_CHANNEL_PREFIX}:set-shortcut`);
      latestSnapshot = null;
    },
    /** Ask the main renderer to publish afresh — used when the overlay is shown. */
    requestSnapshot() {
      const main = live(getMainWindow());
      if (main) main.webContents.send(`${ASSISTANT_CHANNEL_PREFIX}:request-snapshot`);
    },
    /** The last validated snapshot, for tests and for show-time reuse. */
    latest() {
      return latestSnapshot;
    },
  };
}

module.exports = { ASSISTANT_CHANNEL_PREFIX, createAssistantIpc };
