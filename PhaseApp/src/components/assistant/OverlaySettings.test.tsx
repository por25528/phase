// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlaySettings } from './OverlaySettings';
import { DEFAULT_PILL_PREFS, type PillPrefs } from '../../lib/pillPrefs';

const bridgeMock = vi.hoisted(() => ({ available: true, setPillPrefs: vi.fn() }));
vi.mock('../../lib/shellBridge', () => ({ shellBridge: () => bridgeMock }));

const dbMock = vi.hoisted(() => ({
  loadPillPrefs: vi.fn(async (): Promise<PillPrefs> => ({
    show: true, content: 'countdown', showTitle: true, showGlyph: true,
    size: 'medium', opacity: 0.92, theme: 'dark', corner: 'top-right',
    clickThrough: false,
  })),
  savePillPrefs: vi.fn(async () => {}),
}));
vi.mock('../../db/db', () => dbMock);

afterEach(() => {
  cleanup();
  bridgeMock.available = true;
  vi.clearAllMocks();
});

async function mounted() {
  render(<OverlaySettings />);
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Show floating timer' })).toBeTruthy());
}

describe('OverlaySettings', () => {
  it('renders nothing in the plain browser — there is no pill to configure', () => {
    bridgeMock.available = false;
    const { container } = render(<OverlaySettings />);
    expect(container.firstChild).toBeNull();
  });

  it('draws every control from the loaded row', async () => {
    await mounted();
    expect(screen.getByRole('radiogroup', { name: 'Pill size' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Pill theme' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'While a pomodoro runs' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Pill corner' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show the task title' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show the play glyph' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Click through the pill' })).toBeTruthy();
    expect(screen.getByLabelText('Opacity')).toHaveProperty('value', '92');
  });

  /**
   * The row is OURS — Dexie, not the OS — so the control moves at once and the
   * write is fire-and-forget. Both halves matter: the save is what survives a
   * relaunch, and the push is what the pill on screen actually obeys.
   */
  it('saves and pushes on every change', async () => {
    await mounted();
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }));

    const expected = { ...DEFAULT_PILL_PREFS, size: 'large' };
    expect(dbMock.savePillPrefs).toHaveBeenCalledWith(expected);
    expect(bridgeMock.setPillPrefs).toHaveBeenCalledWith(expected);
  });

  it('carries the opacity slider through as a fraction, never as a percent', async () => {
    await mounted();
    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '60' } });
    expect(bridgeMock.setPillPrefs).toHaveBeenCalledWith({ ...DEFAULT_PILL_PREFS, opacity: 0.6 });
  });

  /**
   * A pill with neither a title nor a glyph is a rectangle. The parser forces
   * the title back on, but a control that could be pressed into a state the
   * row then silently undoes is worse than one that cannot be pressed at all.
   */
  it('makes the both-off state unreachable by disabling the last one on', async () => {
    await mounted();
    const title = screen.getByRole('switch', { name: 'Show the task title' });
    const glyph = screen.getByRole('switch', { name: 'Show the play glyph' });
    expect(title).not.toHaveProperty('disabled', true);

    fireEvent.click(glyph);

    expect(screen.getByRole('switch', { name: 'Show the task title' }))
      .toHaveProperty('disabled', true);
  });

  it('says out loud that click-through costs the click', async () => {
    await mounted();
    expect(screen.getByText(/clicking through to Today is off while this is on/)).toBeTruthy();
  });
});
