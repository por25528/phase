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

// Three fixed footprints, and the text scales WITH the frame rather than
// inside it: the page cannot grow past the window it is painted in, so a size
// is a `setBounds` as much as it is a font. The title still truncates with an
// ellipsis at whatever width it lands on — the pill never sizes to its content.
const PILL_SIZES = {
  small: { width: 200, height: 28, font: 11, radius: 14, padX: 10 },
  medium: { width: 240, height: 36, font: 13, radius: 18, padX: 14 },
  large: { width: 300, height: 44, font: 15, radius: 22, padX: 18 },
};

// The medium footprint, kept under its old names because the window's default
// geometry and the position clamp are both measured against it.
const OVERLAY_WIDTH = PILL_SIZES.medium.width;
const OVERLAY_HEIGHT = PILL_SIZES.medium.height;
const MARGIN = 16;

/**
 * Everything the pill may be told about how to look — the structural mirror of
 * `parsePillPrefs` in `src/lib/pillPrefs.ts`.
 *
 * Mirrored and not imported, because `electron/*` imports nothing from `src/`
 * (see the header). The DEFAULTS are the load-bearing half: they are today's
 * pill, so a renderer that never pushes, or one built before this row existed,
 * paints exactly the pill that shipped before the settings group did.
 */
const DEFAULT_PILL_PREFS = {
  show: true,
  content: 'countdown',
  showTitle: true,
  showGlyph: true,
  size: 'medium',
  opacity: 0.92,
  theme: 'dark',
  corner: 'top-right',
  clickThrough: false,
};

const CONTENTS = ['countdown', 'elapsed'];
const THEMES = ['system', 'dark', 'light'];
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const OPACITY_MIN = 0.5;
const OPACITY_MAX = 1;

function pickBoolean(raw, fallback) {
  return typeof raw === 'boolean' ? raw : fallback;
}

function pickFrom(raw, allowed, fallback) {
  return typeof raw === 'string' && allowed.includes(raw) ? raw : fallback;
}

/**
 * Total and FIELD BY FIELD, exactly as the renderer's own parser is: one odd
 * value must not cost the user the eight settings they did choose, and a
 * payload that is not an object at all is simply the default pill.
 */
function normalizePillPrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PILL_PREFS };
  const showTitle = pickBoolean(raw.showTitle, DEFAULT_PILL_PREFS.showTitle);
  const showGlyph = pickBoolean(raw.showGlyph, DEFAULT_PILL_PREFS.showGlyph);
  const opacity = typeof raw.opacity === 'number' && Number.isFinite(raw.opacity)
    ? Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, raw.opacity))
    : DEFAULT_PILL_PREFS.opacity;
  return {
    show: pickBoolean(raw.show, DEFAULT_PILL_PREFS.show),
    content: pickFrom(raw.content, CONTENTS, DEFAULT_PILL_PREFS.content),
    // A pill with neither is a rectangle; the title is the half that comes back.
    showTitle: showTitle || !showGlyph,
    showGlyph,
    size: pickFrom(raw.size, Object.keys(PILL_SIZES), DEFAULT_PILL_PREFS.size),
    opacity,
    theme: pickFrom(raw.theme, THEMES, DEFAULT_PILL_PREFS.theme),
    corner: pickFrom(raw.corner, CORNERS, DEFAULT_PILL_PREFS.corner),
    clickThrough: pickBoolean(raw.clickThrough, DEFAULT_PILL_PREFS.clickThrough),
  };
}

/**
 * The two skins, as the page's own custom properties.
 *
 * The opacity is spent on the BACKGROUND and never on the ink: a translucent
 * pill has to stay readable, and fading the text with the panel would make the
 * one thing it exists to say the first thing to go.
 */
function skinFor(prefs, isSystemDark) {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && isSystemDark);
  return dark
    ? { bg: `rgba(28,27,26,${prefs.opacity})`, ink: '#f5f2ec' }
    : { bg: `rgba(250,248,244,${prefs.opacity})`, ink: '#1c1b1a' };
}

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
 * The countdown's own arithmetic, over the SAME banked numbers the elapsed
 * figure reads — structurally `workRemainingMs`/`breakRemainingMs` from
 * `src/lib/focusCycle.ts`, mirrored rather than imported for the reason every
 * shape at this seam is. Null means there is nothing to count down.
 */
function workRemainingMs(status, nowMs) {
  const c = status.cycle;
  if (!c || status.phase !== 'active') return null;
  const progress = Math.max(0, elapsedMs(status, nowMs) - c.completed * c.workMin * MS_PER_MIN);
  return Math.max(0, c.workMin * MS_PER_MIN - progress);
}

/**
 * Milliseconds left in a break the CYCLE started, or null.
 *
 * Null covers a manual break: one the user pressed carries no `breakStartedMs`,
 * and a timer over that would be the app deciding when they come back. A break
 * already spent returns a non-positive number, which reads as "say it in
 * words" — work never auto-starts, and a countdown pinned at zero would read
 * as a stuck clock.
 */
function breakRemainingMs(status, nowMs) {
  const c = status.cycle;
  if (!c || status.phase !== 'break' || c.breakStartedMs === undefined) return null;
  const len = (c.breakKind === 'long' ? c.longBreakMin : c.breakMin) * MS_PER_MIN;
  return c.breakStartedMs + len - nowMs;
}

/**
 * CEIL, where the elapsed figure floors. A stopwatch may not claim a minute
 * nobody worked; a countdown reading 17m with 17m30s left throws away a minute
 * that is still there.
 */
function remainingMin(ms) {
  return Math.max(0, Math.ceil(ms / MS_PER_MIN));
}

/**
 * Whether this status paints a figure that CHANGES — the only thing a repaint
 * is for. An active session always does; a break does only while the cycle is
 * still counting it down.
 */
function isCountdown(status, nowMs) {
  if (!status) return false;
  if (status.phase === 'active') return true;
  const brk = breakRemainingMs(status, nowMs);
  return brk !== null && brk > 0;
}

/**
 * What the pill shows, and when it shows nothing. Null means HIDDEN — outside
 * a session the pill's absence is the whole signal, and `confirming` belongs
 * to the shelf, exactly as trayTitle rules for the menu bar.
 */
function pillModel(status, nowMs, prefs, isSystemDark) {
  if (!status) return null;
  // `elapsed` asks for the CALM reading of a pomodoro — how long you have
  // worked rather than how long is left — so it simply withholds the cycle
  // from the arithmetic. On a calm session it changes nothing, because there
  // was never a countdown to choose against.
  const countdown = prefs.content === 'countdown';
  let glyph = null;
  let text = null;
  if (status.phase === 'active') {
    const left = countdown ? workRemainingMs(status, nowMs) : null;
    const time = left !== null
      ? `${remainingMin(left)}m left`
      : `${Math.floor(elapsedMs(status, nowMs) / MS_PER_MIN)}m`;
    glyph = '▶';
    text = prefs.showTitle ? `${time} · ${status.title}` : time;
  } else if (status.phase === 'break') {
    const brk = countdown ? breakRemainingMs(status, nowMs) : null;
    glyph = '⏸';
    text = brk !== null && brk > 0 ? `break · ${remainingMin(brk)}m` : 'on break';
  } else {
    // `confirming` belongs to the shelf, which is already asking the question.
    return null;
  }
  const size = PILL_SIZES[prefs.size];
  return {
    ...(prefs.showGlyph ? { glyph } : {}),
    text,
    font: size.font,
    height: size.height,
    radius: size.radius,
    padX: size.padX,
    ...skinFor(prefs, isSystemDark),
  };
}

/** A stored point pulled back inside the given work area, so an unplugged monitor can never strand the pill. */
function clampToWorkArea(point, workArea, footprint = PILL_SIZES.medium) {
  return {
    x: Math.min(Math.max(point.x, workArea.x), workArea.x + workArea.width - footprint.width),
    y: Math.min(Math.max(point.y, workArea.y), workArea.y + workArea.height - footprint.height),
  };
}

/**
 * Where the pill starts when it has no saved position, 16px in from the corner
 * it was told. Only ever a STARTING point: a dragged position is stored and
 * wins, and changing the corner does not walk a placed pill back to it.
 */
function defaultPosition(workArea, corner = 'top-right', footprint = PILL_SIZES.medium) {
  const left = corner === 'top-left' || corner === 'bottom-left';
  const top = corner === 'top-left' || corner === 'top-right';
  return {
    x: left ? workArea.x + MARGIN : workArea.x + workArea.width - footprint.width - MARGIN,
    y: top ? workArea.y + MARGIN : workArea.y + workArea.height - footprint.height - MARGIN,
  };
}

function createOverlayWindow(deps) {
  const {
    createWindow, htmlPath, preloadPath,
    getPrimaryWorkArea, workAreaNearest,
    readPosition, writePosition,
    now, isSystemDark, setTimer, logError,
  } = deps;

  let win = null;
  /** The last snapshot the renderer published, or null for "no session". */
  let status = null;
  /**
   * How the pill is told to look. Defaults until the renderer's startup push
   * arrives, and those defaults are today's pill — so the window that comes up
   * before Dexie has been read is the right one, not a placeholder.
   */
  let prefs = { ...DEFAULT_PILL_PREFS };
  let stopRepaint = null;
  let stopSaveDebounce = null;

  function cancel(stop) {
    if (!stop) return null;
    try { stop(); } catch { /* timer already gone */ }
    return null;
  }

  function live() {
    return win && !win.isDestroyed() ? win : null;
  }

  /** Tear down after a failure; the overlay is a nicety, never a requirement. */
  function teardown(error) {
    if (win) {
      try { win.destroy(); } catch { /* already gone */ }
      win = null;
    }
    stopRepaint = cancel(stopRepaint);
    stopSaveDebounce = cancel(stopSaveDebounce);
    logError('[phase-shell] overlay unavailable', error);
  }

  /**
   * One place decides visibility and text. Hidden is a real answer: outside a
   * session, and while the shelf asks its question, the pill's absence is the
   * signal — same rule as trayTitle.
   */
  function paint() {
    const w = live();
    if (!w) return;
    const model = prefs.show ? pillModel(status, now(), prefs, isSystemDark()) : null;
    stopRepaint = cancel(stopRepaint);
    if (!model) {
      w.hide();
      return;
    }
    w.webContents.send('phase-overlay:model', model);
    w.showInactive();
    // Re-armed for anything that COUNTS — an elapsed figure, a work interval
    // running down, a break still being timed — and for nothing that does not.
    if (isCountdown(status, now())) {
      stopRepaint = setTimer(() => {
        stopRepaint = null;
        paint();
      }, REPAINT_MS);
    }
  }

  function scheduleSave() {
    stopSaveDebounce = cancel(stopSaveDebounce);
    stopSaveDebounce = setTimer(() => {
      stopSaveDebounce = null;
      const w = live();
      if (!w) return;
      const [x, y] = w.getPosition();
      writePosition({ x, y });
    }, SAVE_DEBOUNCE_MS);
  }

  function create() {
    if (win) return;
    try {
      const footprint = PILL_SIZES[prefs.size];
      const stored = readPosition();
      const position = stored
        ? clampToWorkArea(stored, workAreaNearest(stored), footprint)
        : defaultPosition(getPrimaryWorkArea(), prefs.corner, footprint);
      const w = createWindow({
        x: position.x, y: position.y,
        width: footprint.width, height: footprint.height,
        frame: false, transparent: true, resizable: false, hasShadow: false,
        focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
        webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true },
      });
      win = w;
      w.setAlwaysOnTop(true, 'status');
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      w.setIgnoreMouseEvents(prefs.clickThrough);
      w.on('moved', scheduleSave);
      // A snapshot can arrive while the page still loads; repaint on load so
      // the first thing the page hears is the current truth.
      w.webContents.on('did-finish-load', paint);
      w.loadFile(htmlPath).catch((error) => teardown(error));
    } catch (error) {
      teardown(error);
    }
  }

  function setFocusStatus(next) {
    if (!live()) return;
    status = next ?? null;
    paint();
  }

  /**
   * Adopt a new row: normalize it, apply what the WINDOW owns, repaint the
   * rest.
   *
   * Two of the nine settings are not text. A size is a footprint — the page
   * cannot grow past the frame it is painted in, so a larger pill that never
   * reached `setBounds` would just be a medium one with clipped text — and it
   * is applied at the CURRENT position, clamped, because a resize must not
   * walk a placed pill back to its starting corner. Click-through is the
   * window's own flag and nothing the page can express at all.
   */
  function setPrefs(raw) {
    const next = normalizePillPrefs(raw);
    const resized = next.size !== prefs.size;
    prefs = next;
    const w = live();
    if (!w) return;
    if (resized) {
      const footprint = PILL_SIZES[prefs.size];
      const [x, y] = w.getPosition();
      const at = clampToWorkArea({ x, y }, workAreaNearest({ x, y }), footprint);
      w.setBounds({ x: at.x, y: at.y, width: footprint.width, height: footprint.height });
    }
    w.setIgnoreMouseEvents(prefs.clickThrough);
    paint();
  }

  /**
   * Repaint against whatever the injected clock and OS palette say now.
   *
   * `system` is the one theme that can change with nobody touching Phase, so
   * main subscribes to `nativeTheme` and asks for this. It takes no argument
   * because there is nothing to hand it: every input is already injected.
   */
  function repaint() {
    if (live()) paint();
  }

  function isSender(webContentsId) {
    const w = live();
    return !!w && w.webContents.id === webContentsId;
  }

  function dispose() {
    stopRepaint = cancel(stopRepaint);
    stopSaveDebounce = cancel(stopSaveDebounce);
    if (win) {
      try { win.destroy(); } catch { /* already gone */ }
      win = null;
    }
  }

  return { create, dispose, setFocusStatus, setPrefs, repaint, isSender };
}

module.exports = {
  createOverlayWindow, pillModel, normalizePillPrefs,
  clampToWorkArea, defaultPosition,
  DEFAULT_PILL_PREFS, PILL_SIZES,
  REPAINT_MS, OVERLAY_WIDTH, OVERLAY_HEIGHT,
};
