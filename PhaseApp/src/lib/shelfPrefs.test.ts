import { describe, expect, it } from 'vitest';
import { DEFAULT_SHELF_PREFS, parseShelfPrefs, serializeShelfPrefs } from './shelfPrefs';

describe('DEFAULT_SHELF_PREFS', () => {
  /**
   * The defaults are TODAY'S SHELF. A user who never opens the group must see
   * the panel they already had, or the settings are a redesign in disguise.
   */
  it('describes the shelf as it already looked', () => {
    expect(DEFAULT_SHELF_PREFS).toEqual({
      width: 'default',
      density: 'comfortable',
      position: 'center',
      sections: { alternatives: true, dials: true },
    });
  });
});

describe('parseShelfPrefs', () => {
  it('round-trips a full row', () => {
    const prefs = {
      width: 'wide' as const,
      density: 'compact' as const,
      position: 'top-center' as const,
      sections: { alternatives: false, dials: true },
    };
    expect(parseShelfPrefs(serializeShelfPrefs(prefs))).toEqual(prefs);
  });

  it('reads anything unusable as the defaults', () => {
    for (const bad of [undefined, 'not json', '[]', '7']) {
      expect(parseShelfPrefs(bad)).toEqual(DEFAULT_SHELF_PREFS);
    }
  });

  it('falls back per field, keeping every neighbour that parsed', () => {
    expect(parseShelfPrefs(JSON.stringify({ width: 'enormous', density: 'compact' })))
      .toEqual({ ...DEFAULT_SHELF_PREFS, density: 'compact' });
  });

  /**
   * `sections` is descended into rather than taken whole: a half-written
   * object must still yield both flags, or one bad key hides a band the user
   * never asked to lose.
   */
  it('descends into sections and defaults each flag on its own', () => {
    expect(parseShelfPrefs(JSON.stringify({ sections: { dials: false } })).sections)
      .toEqual({ alternatives: true, dials: false });
    expect(parseShelfPrefs(JSON.stringify({ sections: 'none' })).sections)
      .toEqual({ alternatives: true, dials: true });
  });

  it('never hands back a shared sections object', () => {
    const a = parseShelfPrefs(undefined);
    a.sections.dials = false;
    expect(parseShelfPrefs(undefined).sections.dials).toBe(true);
    expect(DEFAULT_SHELF_PREFS.sections.dials).toBe(true);
  });
});
