// The floating running-session pill, as a deep module — the menu-bar timer's
// sibling for people who hide the menu bar. Every Electron capability is
// injected from the main.cjs composition root, so show/hide policy, the text,
// the repaint, and the position rules are unit-testable without Electron.
//
// It observes and never writes: the snapshot arrives on a transition, the
// text is arithmetic at read time, and the page is dumb — main pushes a
// rendered model, the page paints it. An overlay is a nicety, never a
// requirement: any failure in creation is caught, the partial window
// destroyed, one log line emitted, and the Hub, shelf, and menu bar carry on.

// Same floor rule as trayTitle in menuBar.cjs: a timer that reads 1m after
// thirty seconds is claiming a minute that has not happened.
const MS_PER_MIN = 60_000;
const REPAINT_MS = 60_000;

// Fixed footprint: the title truncates with an ellipsis inside the page
// rather than resizing the window.
const OVERLAY_WIDTH = 240;
const OVERLAY_HEIGHT = 36;
const MARGIN = 16;

// A drag emits a stream of `moved` events; one write after the hand lifts.
const SAVE_DEBOUNCE_MS = 500;

/** Elapsed active milliseconds, clamped so a backwards clock reports nothing extra. */
function elapsedMs(status, nowMs) {
  const stretch = status.activeSinceMs === null
    ? 0
    : Math.max(0, nowMs - status.activeSinceMs);
  return status.accumulatedMs + stretch;
}

/**
 * What the pill shows, and when it shows nothing. Null means HIDDEN — outside
 * a session the pill's absence is the whole signal, and `confirming` belongs
 * to the shelf, exactly as trayTitle rules for the menu bar.
 */
function pillModel(status, nowMs) {
  if (!status) return null;
  if (status.phase === 'active') {
    return { glyph: '▶', text: `${Math.floor(elapsedMs(status, nowMs) / MS_PER_MIN)}m · ${status.title}` };
  }
  if (status.phase === 'break') return { glyph: '⏸', text: 'on break' };
  return null;
}

/** A stored point pulled back inside the given work area, so an unplugged monitor can never strand the pill. */
function clampToWorkArea(point, workArea) {
  return {
    x: Math.min(Math.max(point.x, workArea.x), workArea.x + workArea.width - OVERLAY_WIDTH),
    y: Math.min(Math.max(point.y, workArea.y), workArea.y + workArea.height - OVERLAY_HEIGHT),
  };
}

/** Top-right of the work area — nearest to where the hidden menu bar's clock would be. */
function defaultPosition(workArea) {
  return { x: workArea.x + workArea.width - OVERLAY_WIDTH - MARGIN, y: workArea.y + MARGIN };
}

function createOverlayWindow(deps) {
  // Task 2 fills this in.
  throw new Error('not implemented');
}

module.exports = {
  createOverlayWindow, pillModel, clampToWorkArea, defaultPosition,
  REPAINT_MS, OVERLAY_WIDTH, OVERLAY_HEIGHT,
};
