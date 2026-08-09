// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover, PopoverItem, PopoverSeparator } from './Popover';

/**
 * The anchored-panel primitive, driven through the real DOM.
 *
 * Three surfaces hand-rolled this before it existed, and the thing they each
 * got subtly right — a CAPTURE-phase Escape listener that calls
 * `stopPropagation` — is the thing a fourth copy would have got wrong. So the
 * containment test here is not decoration: `App.tsx` listens for Escape on the
 * bubble phase to close the step panel and leave the goal page, and a popover
 * that let the key through would dismiss itself AND the page behind it in one
 * press.
 */

afterEach(cleanup);

function mount(props: Partial<Parameters<typeof Popover>[0]> = {}) {
  return render(
    createElement(Popover, {
      label: 'Estimate',
      trigger: '45m',
      children: (close: () => void) =>
        createElement('button', { type: 'button', onClick: close }, 'Pick 1h'),
      ...props,
    }),
  );
}

describe('Popover', () => {
  it('starts closed and opens on the trigger', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Estimate' }));
    expect(screen.getByRole('dialog', { name: 'Estimate' })).toBeTruthy();
  });

  it('reports open state through aria-expanded', async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole('button', { name: 'Estimate' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes when the trigger is clicked again', async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole('button', { name: 'Estimate' });

    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on an outside pointerdown', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    await user.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open when the panel itself is clicked', async () => {
    const user = userEvent.setup();
    mount({
      children: () => createElement('span', null, 'inert panel content'),
    });
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    await user.click(screen.getByText('inert panel content'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes on Escape WITHOUT letting the key reach the page behind it', async () => {
    const user = userEvent.setup();
    // Exactly what App.tsx does: a bubble-phase window listener that would
    // otherwise close the step panel and leave the goal page.
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    try {
      mount();
      await user.click(screen.getByRole('button', { name: 'Estimate' }));

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(behind).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', behind);
    }
  });

  it('returns focus to the trigger when it closes', async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole('button', { name: 'Estimate' });

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });

  it('hands `close` to its children so a pick can commit and dismiss', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    await user.click(screen.getByRole('button', { name: 'Pick 1h' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    mount({ disabled: true });

    await user.click(screen.getByRole('button', { name: 'Estimate' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('announces a verb list as a menu rather than a dialog', async () => {
    const user = userEvent.setup();
    mount({ role: 'menu', label: 'Task actions' });

    await user.click(screen.getByRole('button', { name: 'Task actions' }));
    expect(screen.getByRole('menu', { name: 'Task actions' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('notifies the host on both edges of the open state', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    mount({ onOpenChange });
    const trigger = screen.getByRole('button', { name: 'Estimate' });

    await user.click(trigger);
    await user.click(trigger);
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false]);
  });
});

describe('PopoverItem', () => {
  it('runs its verb and closes the menu', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      createElement(Popover, {
        label: 'Task actions',
        role: 'menu' as const,
        trigger: 'more',
        children: (close: () => void) =>
          createElement(PopoverItem, { onSelect, close, children: 'Duplicate' }),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Task actions' }));

    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes BEFORE running, so a verb that navigates leaves no orphan panel', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    render(
      createElement(Popover, {
        label: 'Task actions',
        role: 'menu' as const,
        trigger: 'more',
        onOpenChange: (open: boolean) => order.push(open ? 'open' : 'close'),
        children: (close: () => void) =>
          createElement(PopoverItem, {
            onSelect: () => { order.push('select'); },
            close,
            children: 'Open',
          }),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Task actions' }));

    await user.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(order).toEqual(['open', 'close', 'select']);
  });

  it('does not run when disabled', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      createElement(Popover, {
        label: 'Task actions',
        role: 'menu' as const,
        trigger: 'more',
        children: (close: () => void) =>
          createElement(PopoverItem, {
            onSelect,
            close,
            disabled: true,
            children: 'Schedule',
          }),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Task actions' }));

    await user.click(screen.getByRole('menuitem', { name: 'Schedule' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a keyboard hint beside the verb it belongs to', async () => {
    const user = userEvent.setup();
    render(
      createElement(Popover, {
        label: 'Task actions',
        role: 'menu' as const,
        trigger: 'more',
        children: (close: () => void) =>
          createElement(PopoverItem, {
            onSelect: () => {},
            close,
            hint: 'E',
            children: 'Estimate',
          }),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Task actions' }));

    expect(screen.getByRole('menuitem', { name: /Estimate/ }).textContent).toContain('E');
  });
});

describe('PopoverSeparator', () => {
  it('is announced as a separator', () => {
    render(createElement(PopoverSeparator));
    expect(screen.getByRole('separator')).toBeTruthy();
  });
});
