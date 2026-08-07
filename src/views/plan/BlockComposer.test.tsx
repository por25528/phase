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

  it('shows the span it is about to create', () => {
    mount();
    // 600 → 690. clockLabel honours the locale's hour cycle, so match loosely
    // on the digits rather than pinning a 12h/24h rendering.
    expect(screen.getByTestId('composer-span').textContent).toMatch(/10.*11/);
  });
});
