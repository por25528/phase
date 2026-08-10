// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PropertyChip,
  PropertyChipToggle,
  PropertyOption,
  PropertyRow,
  PropertyStatic,
} from './PropertyRow';

/**
 * The compact inspector's building blocks.
 *
 * The claim worth testing here is the one the remaster is FOR: an unset
 * property states which property is unset, and never prints a zero. The panel
 * these replace rendered `0m left` beside a task nobody had estimated, which
 * reads as a measurement rather than as its absence — so `does not print a
 * zero` below is a product rule, not a formatting preference.
 */

afterEach(cleanup);

const icon = createElement('svg');

describe('PropertyRow', () => {
  it('shows the value when the property is set', () => {
    render(
      createElement(PropertyRow, {
        label: 'Estimate',
        icon,
        value: '45m',
        placeholder: 'No estimate',
        children: () => null,
      }),
    );
    expect(screen.getByRole('button').textContent).toContain('45m');
  });

  it('names the missing property rather than printing a zero', () => {
    render(
      createElement(PropertyRow, {
        label: 'Estimate',
        icon,
        value: null,
        placeholder: 'No estimate',
        children: () => null,
      }),
    );
    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toContain('No estimate');
    expect(trigger.textContent).not.toMatch(/\b0m?\b/);
  });

  it('states property and value together for assistive tech', () => {
    render(
      createElement(PropertyRow, {
        label: 'Deadline',
        icon,
        value: 'Aug 12',
        placeholder: 'No deadline',
        children: () => null,
      }),
    );
    expect(screen.getByRole('button', { name: 'Deadline: Aug 12' })).toBeTruthy();
  });

  it('opens a menu of choices', async () => {
    const user = userEvent.setup();
    render(
      createElement(PropertyRow, {
        label: 'Status',
        icon,
        value: 'Todo',
        placeholder: 'No status',
        children: () => createElement('span', null, 'picker'),
      }),
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('opens a dialog instead when the panel holds a textbox', async () => {
    const user = userEvent.setup();
    render(
      createElement(PropertyRow, {
        label: 'Estimate',
        icon,
        value: null,
        placeholder: 'No estimate',
        panelRole: 'dialog' as const,
        children: () => createElement('input', { 'aria-label': 'Minutes' }),
      }),
    );
    await user.click(screen.getByRole('button'));
    // A `menu` may not contain a textbox; this is why the role is a prop.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Minutes' })).toBeTruthy();
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(
      createElement(PropertyRow, {
        label: 'Estimate',
        icon,
        value: null,
        placeholder: 'No estimate',
        disabled: true,
        children: () => createElement('span', null, 'picker'),
      }),
    );
    await user.click(screen.getByRole('button'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('PropertyStatic', () => {
  it('renders a value with nothing to press', () => {
    render(createElement(PropertyStatic, { icon, children: 'In progress' }));
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PropertyOption', () => {
  it('marks the current choice as checked', () => {
    render(
      createElement(PropertyOption, {
        onSelect: () => {},
        close: () => {},
        current: true,
        children: 'Doing',
      }),
    );
    expect(screen.getByRole('menuitemradio', { name: 'Doing' }).getAttribute('aria-checked')).toBe('true');
  });

  it('commits and dismisses in one gesture', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const close = vi.fn();
    render(
      createElement(PropertyOption, { onSelect, close, children: 'Blocked' }),
    );
    await user.click(screen.getByRole('menuitemradio'));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('PropertyChip', () => {
  it('names the property when it has no value, and never prints a zero', () => {
    render(
      createElement(PropertyChip, {
        label: 'Estimate',
        icon: null,
        value: null,
        placeholder: 'No estimate',
        children: () => null,
      }),
    );
    expect(screen.getByRole('button', { name: 'Estimate: No estimate' })).toBeTruthy();
    expect(screen.queryByText('0m')).toBeNull();
  });

  it('opens the same popover children a PropertyRow would', async () => {
    const user = userEvent.setup();
    render(
      createElement(PropertyChip, {
        label: 'Status',
        icon: null,
        value: 'Doing',
        placeholder: 'Todo',
        children: () => createElement('button', { type: 'button' }, 'Blocked'),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Status: Doing' }));
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  it('renders a toggle as a switch that reports its state', () => {
    render(
      createElement(PropertyChipToggle, {
        label: 'Make a milestone',
        icon: null,
        on: true,
        onToggle: () => {},
        children: 'Milestone',
      }),
    );
    const chip = screen.getByRole('switch', { name: 'Make a milestone' });
    expect(chip.getAttribute('aria-checked')).toBe('true');
  });
});
