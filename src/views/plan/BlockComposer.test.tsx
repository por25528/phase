// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockComposer } from './BlockComposer';

afterEach(() => cleanup());

function mount() {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(createElement(BlockComposer, {
    startMin: 600, durationMin: 90, onCommit, onCancel,
  }));
  return { onCommit, onCancel, user: userEvent.setup(), field: screen.getByRole('textbox') };
}

describe('naming a new block', () => {
  it('focuses the field so the gesture flows straight into typing', () => {
    const { field } = mount();
    expect(document.activeElement).toBe(field);
  });

  it('commits the trimmed title on Enter', async () => {
    const { onCommit, onCancel, user } = mount();
    await user.keyboard('  Office hours  {Enter}');
    expect(onCommit).toHaveBeenCalledWith('Office hours');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on Escape without committing', async () => {
    const { onCommit, onCancel, user } = mount();
    await user.keyboard('Office hours{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('cancels rather than creating "Untitled" when the title is empty', async () => {
    const { onCommit, onCancel, user } = mount();
    await user.keyboard('   {Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('cancels on blur', () => {
    const { onCommit, onCancel, field } = mount();
    field.blur();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('resolves exactly once — a commit does not also fire the blur cancel', async () => {
    const { onCommit, onCancel, user, field } = mount();
    await user.keyboard('Office hours{Enter}');
    field.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows the START it is about to create, not the span', () => {
    /*
     * It used to print `10am–11:30am`. A week column is ~105px, which leaves
     * 84px inside the composer, and that span needs 86 — so it clipped, and an
     * afternoon one (`12:45pm – 2:15pm`, 113px) clipped badly. The bar this
     * becomes prints its start for the same measured reason, and the extent is
     * DRAWN: the composer's own height is the span you just dragged out.
     */
    mount();
    // clockLabel honours the locale's hour cycle, so match on the digits
    // rather than pinning a 12h/24h rendering.
    expect(screen.getByTestId('composer-span').textContent).toMatch(/10/);
    expect(screen.getByTestId('composer-span').textContent).not.toMatch(/11/);
  });
});

/**
 * The composer IS the block it is about to become.
 *
 * Every failure below was invisible in isolation and obvious the moment the
 * composer sat on the grid beside the bars it turns into.
 */
describe('the composer measures like the grid', () => {
  it('sets the title size on the INPUT, because a base rule beats inheritance', () => {
    // index.css sets `input, select { font-size: 14px }` in @layer base. The
    // wrapper's `text-badge` (12px) is inherited, and inheritance loses to any
    // rule that matches the element — so the title being typed rendered 14px
    // while the bar it became rendered 12px, and the field was the one thing on
    // the calendar that did not measure like the calendar.
    const { field } = mount();
    expect(field.className).toContain('text-badge');
  });

  it('states both exits, which it never did', () => {
    // Enter and Escape both worked and neither was ever mentioned, on a
    // surface with ~130px of blank body to say it in.
    mount();
    expect(screen.getByText('↵ add · esc')).toBeTruthy();
  });

  it('withholds the hint where there is no room for a rule', () => {
    render(createElement(BlockComposer, {
      startMin: 600, durationMin: 25, onCommit: vi.fn(), onCancel: vi.fn(),
    }));
    // 25px is below FOOTER_BLOCK_PX: field and span share one row, and a hint
    // crowding a 34px bar is worse than no hint.
    expect(screen.queryByText('↵ add · esc')).toBeNull();
  });

  it('puts the span in the block\'s own mono voice', () => {
    mount();
    expect(screen.getByTestId('composer-span').className).toContain('font-mono');
  });
});

describe('the composer\'s own body is not "somewhere else"', () => {
  it('does not cancel when you press its empty space', async () => {
    // The wrapper stopped propagation but never called preventDefault, so a
    // press on the composer's own body moved focus off the field, `onBlur`
    // fired, and everything typed was discarded. On a two-hour block that was
    // most of the composer's surface.
    const { onCancel, onCommit, user, field } = mount();
    await user.type(field, 'Office hours');
    await user.click(screen.getByTestId('composer-span'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
  });

  it('still cancels on a genuine blur elsewhere', async () => {
    // The one-click-no-confirmation gesture depends on this and it is correct.
    const { onCancel, field } = mount();
    field.blur();
    expect(onCancel).toHaveBeenCalled();
  });
});
