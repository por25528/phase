import { describe, expect, it } from 'vitest';
import { DEFAULT_PILL_PREFS, parsePillPrefs, serializePillPrefs } from './pillPrefs';

describe('DEFAULT_PILL_PREFS', () => {
  /**
   * The defaults are TODAY'S PILL, stated as a row. A user who never opens
   * this group must see exactly the pill they had before it existed, or the
   * settings group is a redesign wearing a preference.
   */
  it('describes the pill as it already looked', () => {
    expect(DEFAULT_PILL_PREFS).toEqual({
      show: true,
      content: 'countdown',
      showTitle: true,
      showGlyph: true,
      size: 'medium',
      opacity: 0.92,
      theme: 'dark',
      corner: 'top-right',
      clickThrough: false,
    });
  });
});

describe('parsePillPrefs', () => {
  it('round-trips a full row', () => {
    const prefs = {
      show: false,
      content: 'elapsed' as const,
      showTitle: false,
      showGlyph: true,
      size: 'large' as const,
      opacity: 0.6,
      theme: 'system' as const,
      corner: 'bottom-left' as const,
      clickThrough: true,
    };
    expect(parsePillPrefs(serializePillPrefs(prefs))).toEqual(prefs);
  });

  it('reads anything unparseable as the defaults', () => {
    expect(parsePillPrefs(undefined)).toEqual(DEFAULT_PILL_PREFS);
    expect(parsePillPrefs('not json')).toEqual(DEFAULT_PILL_PREFS);
    expect(parsePillPrefs('[]')).toEqual(DEFAULT_PILL_PREFS);
  });

  /**
   * Field by field, never all-or-nothing: a row written by a future build
   * carries fields this one has never heard of, and one of them being odd must
   * not cost the user the eight settings they did choose.
   */
  it('falls back per field, keeping every neighbour that parsed', () => {
    expect(parsePillPrefs(JSON.stringify({ size: 'huge', theme: 'light', opacity: 'a lot' })))
      .toEqual({ ...DEFAULT_PILL_PREFS, theme: 'light' });
  });

  it('clamps opacity into the legible range', () => {
    expect(parsePillPrefs(JSON.stringify({ opacity: 0 })).opacity).toBe(0.5);
    expect(parsePillPrefs(JSON.stringify({ opacity: 9 })).opacity).toBe(1);
  });

  /**
   * A pill with neither a time nor a title is a rectangle. The Settings UI
   * disables the last-on switch, but the ROW is what a future build and a hand
   * edit both meet, so the rule is enforced where it cannot be walked around.
   */
  it('refuses to leave the pill with nothing to say', () => {
    const both = parsePillPrefs(JSON.stringify({ showTitle: false, showGlyph: false }));
    expect(both.showTitle).toBe(true);
    // Only one off is a real choice and is kept.
    expect(parsePillPrefs(JSON.stringify({ showTitle: false })).showTitle).toBe(false);
    expect(parsePillPrefs(JSON.stringify({ showGlyph: false })).showGlyph).toBe(false);
  });
});
