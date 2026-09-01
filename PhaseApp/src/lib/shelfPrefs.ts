/**
 * How the Cmd+Space shelf is shaped.
 *
 * Unlike `pillPrefs`, this row lives in the STORE as well as on disk: the
 * shelf renderer does not own the store, so anything the shelf must know rides
 * the relay model built in `AssistantHost` — and the relay's model is built
 * from store state. The geometry half goes the other way, straight to main.
 *
 * The width is named rather than measured here on purpose. Three pixel widths
 * live with the WINDOW (`assistantWindow.cjs`), because the panel's height
 * budget is measured against a width and the two must not drift apart in two
 * files.
 */
export interface ShelfPrefs {
  /** Named, never pixels: `assistantWindow.cjs` owns the mapping. */
  width: 'narrow' | 'default' | 'wide';
  density: 'compact' | 'comfortable';
  position: 'center' | 'top-center';
  /**
   * Which optional bands the shelf draws.
   *
   * The work band is deliberately NOT here. A shelf that cannot control a
   * running session is broken, not customized — and the two bands that are
   * here are both lists you may already know you do not want.
   */
  sections: { alternatives: boolean; dials: boolean };
}

export const DEFAULT_SHELF_PREFS: ShelfPrefs = {
  width: 'default',
  density: 'comfortable',
  position: 'center',
  sections: { alternatives: true, dials: true },
};

const WIDTHS = ['narrow', 'default', 'wide'];
const DENSITIES = ['compact', 'comfortable'];
const POSITIONS = ['center', 'top-center'];

function pickFrom<T extends string>(raw: unknown, allowed: string[], fallback: T): T {
  return typeof raw === 'string' && allowed.includes(raw) ? (raw as T) : fallback;
}

function pickBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

/**
 * Total, and FIELD BY FIELD — the same rule `parsePillPrefs` follows, and for
 * the same reason: one odd value in a row written by a future build must not
 * cost the user the settings they did choose. `sections` is descended into
 * rather than taken whole, so a half-written object still yields both flags.
 */
export function parseShelfPrefs(raw: unknown): ShelfPrefs {
  let parsed: unknown;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_SHELF_PREFS, sections: { ...DEFAULT_SHELF_PREFS.sections } };
  }
  const p = parsed as Record<string, unknown>;
  const sections = (p.sections && typeof p.sections === 'object' && !Array.isArray(p.sections))
    ? p.sections as Record<string, unknown>
    : {};
  return {
    width: pickFrom(p.width, WIDTHS, DEFAULT_SHELF_PREFS.width),
    density: pickFrom(p.density, DENSITIES, DEFAULT_SHELF_PREFS.density),
    position: pickFrom(p.position, POSITIONS, DEFAULT_SHELF_PREFS.position),
    sections: {
      alternatives: pickBoolean(sections.alternatives, true),
      dials: pickBoolean(sections.dials, true),
    },
  };
}

export function serializeShelfPrefs(prefs: ShelfPrefs): string {
  return JSON.stringify(prefs);
}
