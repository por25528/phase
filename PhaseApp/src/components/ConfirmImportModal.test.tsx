// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmImportModal } from './ConfirmImportModal';

/**
 * Import is the ONE destructive action in Phase with no undo — `importBackup`
 * clears the undo stack by design — so the gate in front of it is the only
 * thing standing between a mis-aimed click and the whole dataset. It replaced a
 * `window.confirm()`, which a stray Return key answered.
 *
 * The property worth pinning is not "a modal appeared". It is that `onConfirm`
 * is UNREACHABLE until the phrase is typed, by every route into it — the
 * button, the Enter key, and a reopen after a previous attempt.
 */

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof ConfirmImportModal>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    createElement(ConfirmImportModal, {
      open: true,
      fileName: 'phase-backup-2026-08-09.json',
      onCancel,
      onConfirm,
      ...overrides,
    }),
  );
  return { onConfirm, onCancel, ...utils };
}

const confirmBtn = () => screen.getByRole('button', { name: 'Import backup' });
const phraseField = () => screen.getByRole('textbox');

describe('ConfirmImportModal', () => {
  it('names the file being imported, so the phrase is not typed blind', () => {
    setup();
    expect(screen.getByText('phase-backup-2026-08-09.json')).toBeTruthy();
  });

  it('holds the confirm button disabled until the phrase is typed', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    expect(confirmBtn()).toHaveProperty('disabled', true);
    await user.click(confirmBtn());
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(phraseField(), 'REPLACE');
    expect(confirmBtn()).toHaveProperty('disabled', false);
    await user.click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('rejects a near-miss phrase', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(phraseField(), 'REPLAC');
    expect(confirmBtn()).toHaveProperty('disabled', true);
    await user.click(confirmBtn());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Case and surrounding space are typing noise, not intent — the gate is there
  // to force a read, not to grade a transcription.
  it('accepts the phrase in any case, with stray whitespace', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(phraseField(), '  replace  ');
    await user.click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not let Enter confirm before the phrase is typed', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(phraseField());
    await user.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(phraseField(), 'REPLACE{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  /**
   * Cancel then reopen must re-arm the gate. Without the reset the second
   * opening inherits the first attempt's text, so a user who typed the phrase,
   * thought better of it, and later picked a different file would find the
   * button already live — a confirmation in name only.
   */
  it('clears the typed phrase between openings', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const props = {
      fileName: 'a.json',
      onCancel: () => {},
      onConfirm,
    };

    const { rerender } = render(
      createElement(ConfirmImportModal, { open: true, ...props }),
    );
    await user.type(phraseField(), 'REPLACE');
    expect(confirmBtn()).toHaveProperty('disabled', false);

    rerender(createElement(ConfirmImportModal, { open: false, ...props }));
    rerender(createElement(ConfirmImportModal, { open: true, ...props }));

    expect(phraseField()).toHaveProperty('value', '');
    expect(confirmBtn()).toHaveProperty('disabled', true);
  });

  it('renders nothing while closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('button', { name: 'Import backup' })).toBeNull();
  });
});
