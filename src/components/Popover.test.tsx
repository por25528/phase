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

/**
 * A panel that opens downward off the bottom of the window is unreachable, and
 * `BoardCard` worked around it with `MENU_HEIGHT_PX = 210` — a hardcoded guess
 * at its own height, in the one file whose menu was about to grow. Measuring is
 * what lets the guess be deleted.
 */
describe('flip', () => {
  function stubLayout({ triggerTop, panelHeight, viewport }: {
    triggerTop: number; panelHeight: number; viewport: number;
  }) {
    /*
     * Captured and put BACK, never deleted.
     *
     * `delete Element.prototype.getBoundingClientRect` removes jsdom's OWN
     * implementation rather than the stub on top of it, so every test declared
     * after this block ran against a prototype with no such method. The next
     * one added died on `getBoundingClientRect is not a function` raised from
     * inside the flip effect — pointing at the component, not at the helper
     * that had broken it.
     */
    const rect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!;
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: triggerTop, bottom: triggerTop + 24, left: 0, right: 0, width: 0, height: 24 }),
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => panelHeight,
    });
    const prev = window.innerHeight;
    // `innerHeight` is `readonly` in lib.dom, so it is redefined rather than
    // assigned — the same route the two prototype stubs above already take.
    const setViewport = (px: number) =>
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: px });
    setViewport(viewport);
    return () => {
      Object.defineProperty(Element.prototype, 'getBoundingClientRect', rect);
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
      setViewport(prev);
    };
  }

  const panelClasses = () =>
    (screen.getByRole('dialog').getAttribute('class') ?? '');

  it('opens above when there is no room below and room above', async () => {
    const restore = stubLayout({ triggerTop: 700, panelHeight: 210, viewport: 768 });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(panelClasses()).toContain('bottom-[calc(100%+4px)]');
    expect(panelClasses()).not.toContain('top-[calc(100%+4px)]');
    restore();
  });

  it('stays below when the panel fits there', async () => {
    const restore = stubLayout({ triggerTop: 40, panelHeight: 210, viewport: 768 });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(panelClasses()).toContain('top-[calc(100%+4px)]');
    restore();
  });

  /**
   * Flipping a panel taller than the space above it trades one clipped edge for
   * another. When neither side fits, below is still the right answer — it is
   * where the reading eye already is.
   */
  it('stays below when neither side has room', async () => {
    const restore = stubLayout({ triggerTop: 120, panelHeight: 400, viewport: 300 });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(panelClasses()).toContain('top-[calc(100%+4px)]');
    restore();
  });
});

/**
 * Elevation is a PROP, not a class the caller appends.
 *
 * `panelClassName` is concatenated, and Tailwind has no last-one-wins rule, so
 * `shadow-card shadow-today` would leave which shadow applies to the order the
 * stylesheet happened to emit them in. Swapping the class is what makes the
 * choice real — the same reason `DateField` takes a `size`.
 */
describe('elevation', () => {
  const panelClass = () => screen.getByRole('dialog').getAttribute('class') ?? '';

  it('matches the surface it opens over by default', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(panelClass()).toContain('shadow-card');
    expect(panelClass()).not.toContain('shadow-today');
  });

  it('floats above it when the panel will overhang', async () => {
    const user = userEvent.setup();
    mount({ elevation: 'overlay' });
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(panelClass()).toContain('shadow-today');
    expect(panelClass()).not.toContain('shadow-card');
  });
});
