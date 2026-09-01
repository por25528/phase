// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShelfSettings } from './ShelfSettings';
import { DEFAULT_SHELF_PREFS, type ShelfPrefs } from '../lib/shelfPrefs';

// Spelled out rather than spread from DEFAULT_SHELF_PREFS: `vi.hoisted` runs
// before the imports it would read.
const storeMock = vi.hoisted(() => ({
  shelfPrefs: {
    width: 'default', density: 'comfortable', position: 'center',
    sections: { alternatives: true, dials: true },
  } as ShelfPrefs,
  setShelfPrefs: vi.fn(),
}));

vi.mock('../state/store', () => ({
  useAppStore: () => ({
    shelfPrefs: storeMock.shelfPrefs,
    actions: { setShelfPrefs: storeMock.setShelfPrefs },
  }),
}));

afterEach(() => {
  cleanup();
  storeMock.shelfPrefs = { ...DEFAULT_SHELF_PREFS, sections: { alternatives: true, dials: true } };
  vi.clearAllMocks();
});

describe('ShelfSettings', () => {
  it('draws a control for every field of the row', () => {
    render(<ShelfSettings />);
    expect(screen.getByRole('radiogroup', { name: 'Shelf width' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Shelf density' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Shelf position' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show other options' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show the time and focus dials' })).toBeTruthy();
  });

  it('dispatches the whole row on a change', () => {
    render(<ShelfSettings />);
    fireEvent.click(screen.getByRole('radio', { name: 'Wide' }));
    expect(storeMock.setShelfPrefs).toHaveBeenCalledWith({ ...DEFAULT_SHELF_PREFS, width: 'wide' });
  });

  it('toggles a section without touching its neighbour', () => {
    render(<ShelfSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'Show the time and focus dials' }));
    expect(storeMock.setShelfPrefs).toHaveBeenCalledWith({
      ...DEFAULT_SHELF_PREFS,
      sections: { alternatives: true, dials: false },
    });
  });

  /**
   * A width change only lands on the next summon, and a control that looked
   * like it did nothing is how a preference gets pressed four times.
   */
  it('says that a width or a place lands on the next summon', () => {
    render(<ShelfSettings />);
    expect(screen.getByText(/next time you summon it/)).toBeTruthy();
  });
});
