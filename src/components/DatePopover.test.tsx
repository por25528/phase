// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePopover } from './DatePopover';

afterEach(cleanup);

function mount(props: Partial<Parameters<typeof DatePopover>[0]> = {}) {
  const onCommit = vi.fn<(next: string) => void>();
  render(
    createElement(DatePopover, {
      value: '',
      today: '2026-08-14',
      onCommit,
      ariaLabel: 'Deadline',
      placeholder: 'No deadline',
      ...props,
    }),
  );
  return { onCommit, user: userEvent.setup() };
}

const trigger = () => screen.getByRole('button', { name: /^Deadline:/ });

describe('the trigger', () => {
  it('states the fact rather than naming a field', async () => {
    mount();
    expect(trigger().textContent).toContain('No deadline');
    expect(trigger().getAttribute('aria-label')).toBe('Deadline: not set');
  });

  it('carries the date in its accessible name once one is set', () => {
    mount({ value: '2026-08-30' });
    expect(trigger().getAttribute('aria-label')).toBe('Deadline: Aug 30, 2026');
    expect(trigger().textContent).toContain('Aug 30');
  });

  it('prints a prefix in front of the date when asked', () => {
    mount({ value: '2026-08-30', prefix: 'Due · ' });
    expect(trigger().textContent).toContain('Due · Aug 30');
  });
});

describe('picking a day', () => {
  it('opens on the month holding today when nothing is set', async () => {
    const { user } = mount();
    await user.click(trigger());
    expect(screen.getByText('August 2026')).toBeTruthy();
  });

  it('opens on the month holding the value', async () => {
    const { user } = mount({ value: '2027-01-09' });
    await user.click(trigger());
    expect(screen.getByText('January 2027')).toBeTruthy();
  });

  it('commits the day that was clicked and closes', async () => {
    const { onCommit, user } = mount();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Aug 30, 2026' }));

    expect(onCommit).toHaveBeenCalledWith('2026-08-30');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('commits a preset', async () => {
    const { onCommit, user } = mount();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'End of year' }));

    expect(onCommit).toHaveBeenCalledWith('2026-12-31');
  });

  /**
   * An empty string, not `undefined`: the caller decides what "no date" means
   * in its own model, and a picker that invented `undefined` would be making
   * that decision for it.
   */
  it('clears with an empty string, and offers Clear only when set', async () => {
    const { onCommit, user } = mount({ value: '2026-08-30' });
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Clear deadline' }));
    expect(onCommit).toHaveBeenCalledWith('');

    cleanup();
    const second = mount();
    await second.user.click(trigger());
    expect(screen.queryByRole('button', { name: 'Clear deadline' })).toBeNull();
  });

  it('pages months without committing anything', async () => {
    const { onCommit, user } = mount();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('September 2026')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('July 2026')).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

/**
 * A calendar that cannot be driven from the keyboard is a REGRESSION from the
 * text input it replaced, not a polish item. Roving tabindex is what keeps the
 * grid one tab stop instead of forty-two.
 */
describe('the keyboard', () => {
  it('opens with exactly one cell focused, on the selected day', async () => {
    const { user } = mount({ value: '2026-08-30' });
    await user.click(trigger());

    const cell = screen.getByRole('button', { name: 'Aug 30, 2026' });
    expect(document.activeElement).toBe(cell);
    expect(
      screen.getAllByRole('gridcell').filter((c) => c.querySelector('[tabindex="0"]')),
    ).toHaveLength(1);
  });

  it('moves a day with the arrows and a week with up and down', async () => {
    const { onCommit, user } = mount({ value: '2026-08-14' });
    await user.click(trigger());

    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aug 22, 2026' }));

    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith('2026-08-22');
  });

  it('pages the month with PageUp and PageDown', async () => {
    const { user } = mount({ value: '2026-08-14' });
    await user.click(trigger());

    await user.keyboard('{PageDown}');
    expect(screen.getByText('September 2026')).toBeTruthy();
    await user.keyboard('{PageUp}{PageUp}');
    expect(screen.getByText('July 2026')).toBeTruthy();
  });

  it('goes to the ends of the week with Home and End', async () => {
    const { user } = mount({ value: '2026-08-13' }); // a Thursday
    await user.click(trigger());

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aug 10, 2026' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aug 16, 2026' }));
  });

  /**
   * Arrowing off the edge pages rather than dead-ending. The padded days of the
   * neighbouring month are visible and live, so the month only turns once the
   * cursor leaves the drawn grid entirely.
   */
  it('follows the cursor into the next month rather than stopping', async () => {
    const { user } = mount({ value: '2026-08-31' });
    await user.click(trigger());

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByText('September 2026')).toBeTruthy();
  });
});
