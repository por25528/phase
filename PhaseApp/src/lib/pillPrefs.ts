/**
 * Everything the floating pill is allowed to be told.
 *
 * The pill is an OBSERVER: main computes a rendered model and the page paints
 * it. This row is the other half of that arrangement — the only input the
 * model takes besides the session snapshot — which is why it lives in `src/`
 * as a plain, total parser and is mirrored structurally in
 * `overlayWindow.cjs`. `electron/*` imports nothing from here.
 *
 * Every default IS TODAY'S PILL. A user who never opens the settings group
 * must see exactly the pill they had before it existed; a group whose defaults
 * quietly restyled the thing would be a redesign wearing a preference.
 */
export interface PillPrefs {
  /** The one field that predates the group: the old `showOverlay` switch. */
  show: boolean;
  /**
   * What the time reads on a POMODORO session. A calm session has no
   * countdown to choose between, so this changes nothing for it.
   */
  content: 'countdown' | 'elapsed';
  showTitle: boolean;
  showGlyph: boolean;
  /** Footprint and text scale together; the window resizes on change. */
  size: 'small' | 'medium' | 'large';
  /** 0.5–1.0. Below a half the pill stops being readable over a bright window. */
  opacity: number;
  theme: 'system' | 'dark' | 'light';
  /** Where the pill starts when it has no saved position. A dragged one still wins. */
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** The pill ignores the mouse entirely — and with it, click-to-Today. */
  clickThrough: boolean;
}

export const DEFAULT_PILL_PREFS: PillPrefs = {
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
const SIZES = ['small', 'medium', 'large'];
const THEMES = ['system', 'dark', 'light'];
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const OPACITY_MIN = 0.5;
const OPACITY_MAX = 1;

function pickBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function pickFrom<T extends string>(raw: unknown, allowed: string[], fallback: T): T {
  return typeof raw === 'string' && allowed.includes(raw) ? (raw as T) : fallback;
}

function pickOpacity(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_PILL_PREFS.opacity;
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, raw));
}

/**
 * Total, and FIELD BY FIELD rather than all-or-nothing.
 *
 * A row written by a future build carries fields this one has never heard of,
 * and a hand-edited one carries whatever was typed; either way, one odd value
 * must not cost the user the eight settings they did choose. Unknown fields
 * are ignored, missing ones defaulted, out-of-range ones clamped.
 *
 * The one CROSS-field rule is enforced here rather than only in the UI: the
 * Settings group disables the last-on switch, but a row on disk never meets
 * that switch, so `showTitle` is forced back on when both would be off.
 */
export function parsePillPrefs(raw: unknown): PillPrefs {
  let parsed: unknown;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_PILL_PREFS };
  }
  const p = parsed as Record<string, unknown>;
  const showTitle = pickBoolean(p.showTitle, DEFAULT_PILL_PREFS.showTitle);
  const showGlyph = pickBoolean(p.showGlyph, DEFAULT_PILL_PREFS.showGlyph);
  return {
    show: pickBoolean(p.show, DEFAULT_PILL_PREFS.show),
    content: pickFrom(p.content, CONTENTS, DEFAULT_PILL_PREFS.content),
    showTitle: showTitle || !showGlyph,
    showGlyph,
    size: pickFrom(p.size, SIZES, DEFAULT_PILL_PREFS.size),
    opacity: pickOpacity(p.opacity),
    theme: pickFrom(p.theme, THEMES, DEFAULT_PILL_PREFS.theme),
    corner: pickFrom(p.corner, CORNERS, DEFAULT_PILL_PREFS.corner),
    clickThrough: pickBoolean(p.clickThrough, DEFAULT_PILL_PREFS.clickThrough),
  };
}

export function serializePillPrefs(prefs: PillPrefs): string {
  return JSON.stringify(prefs);
}
