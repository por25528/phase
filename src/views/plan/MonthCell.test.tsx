// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import { MonthCell, MONTH_CHIP_CAP } from './MonthCell';
import type { ScheduledItem } from '../../lib/scheduled';

afterEach(() => cleanup());

function item(over: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    kind: 'task', id: 't1', goalId: null, goalTitle: '', title: 'Pset',
    done: false, date: '2026-08-05', startMin: 600, endMin: 660, estimated: true,
    ...over,
  };
}

function mount(items: ScheduledItem[], over: Record<string, unknown> = {}) {
  const onCreate = vi.fn();
  const onOpenDay = vi.fn();
  // MonthCell registers a droppable, so it needs a DndContext ancestor.
  render(createElement(DndContext, null, createElement(MonthCell, {
    date: '2026-08-05', items, inMonth: true, isToday: false,
    onCreate, onOpenDay, ...over,
  })));
  return { onCreate, onOpenDay, user: userEvent.setup() };
}

describe('a day in the month grid', () => {
  it('shows its date number', () => {
    mount([]);
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('lists its work as chips', () => {
    mount([item({ title: 'Read Raft' })]);
    expect(screen.getByText('Read Raft')).toBeTruthy();
  });

  it('caps the chips and offers the rest as one row', () => {
    const many = Array.from({ length: MONTH_CHIP_CAP + 2 }, (_, i) =>
      item({ id: `t${i}`, title: `Item ${i}` }));
    mount(many);

    expect(screen.getAllByTestId('month-chip')).toHaveLength(MONTH_CHIP_CAP);
    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('shows no overflow row when everything fits', () => {
    mount([item()]);
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it('opens the day when the overflow row is used', async () => {
    const many = Array.from({ length: MONTH_CHIP_CAP + 1 }, (_, i) =>
      item({ id: `t${i}`, title: `Item ${i}` }));
    const { onOpenDay, user } = mount(many);

    await user.click(screen.getByText('+1 more'));
    expect(onOpenDay).toHaveBeenCalledWith('2026-08-05');
  });

  it('creates when the empty space is clicked', async () => {
    const { onCreate, user } = mount([]);
    await user.click(screen.getByTestId('month-cell-canvas'));
    expect(onCreate).toHaveBeenCalledWith('2026-08-05');
  });

  it('does not create on a past day', async () => {
    const { onCreate, user } = mount([], { readOnly: true });
    await user.click(screen.getByTestId('month-cell-canvas'));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('dims a day belonging to a neighbouring month', () => {
    mount([], { inMonth: false });
    // Still rendered and still live — a leading/trailing day is a real day you
    // can plan into; it is only quieter.
    expect(screen.getByTestId('month-cell').className).toContain('text-faint');
  });

  it('marks a done chip without hiding it', () => {
    mount([item({ done: true, title: 'Finished' })]);
    const chip = screen.getByTestId('month-chip');
    expect(chip.textContent).toContain('Finished');
    expect(chip.className).toContain('line-through');
  });
});
