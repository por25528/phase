// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { BoardCard } from './BoardCard';
import type { Goal } from '../../db/types';

afterEach(cleanup);

function renderCard(over: Partial<Goal> = {}) {
  const onSetDeadline = vi.fn();
  const goal: Goal = {
    id: 'g', title: 'Finish CS:APP', nodes: [], datesConfirmed: true, ...over,
  };
  render(
    createElement(DndContext, null,
      createElement(BoardCard, {
        goal,
        today: '2026-08-14',
        onOpen: vi.fn(),
        onMove: vi.fn(),
        onRank: vi.fn(),
        onDelete: vi.fn(),
        onRename: vi.fn(),
        onSetDeadline,
        reducedMotion: false,
        dimmed: false,
        matched: false,
        lives: [],
        onSetLife: vi.fn(),
      }),
    ),
  );
  return { onSetDeadline, user: userEvent.setup() };
}

describe('the deadline chip', () => {
  /**
   * Direct manipulation is the whole point: the chip already STATES the
   * deadline, so it should be the control that sets it. A menu item opening a
   * picker somewhere else is a longer route to the same place.
   */
  it('is the control that sets the date it prints', async () => {
    const { onSetDeadline, user } = renderCard({ deadline: '2026-08-30' });

    const chip = screen.getByRole('button', { name: 'Deadline: Aug 30, 2026' });
    expect(chip.textContent).toContain('Due · Aug 30');

    await user.click(chip);
    await user.click(screen.getByRole('button', { name: 'Aug 20, 2026' }));

    expect(onSetDeadline).toHaveBeenCalledWith('g', '2026-08-20');
  });

  it('clears with undefined, not an empty string', async () => {
    const { onSetDeadline, user } = renderCard({ deadline: '2026-08-30' });

    await user.click(screen.getByRole('button', { name: 'Deadline: Aug 30, 2026' }));
    await user.click(screen.getByRole('button', { name: 'Clear deadline' }));

    expect(onSetDeadline).toHaveBeenCalledWith('g', undefined);
  });

  it('offers a quiet control when there is no deadline yet', () => {
    renderCard();
    const control = screen.getByRole('button', { name: 'Deadline: not set' });
    expect(control.textContent).toContain('Due');
    expect(control.className).toContain('quiet-control');
  });

  it('reaches the same popover from the menu, for the keyboard', async () => {
    const { onSetDeadline, user } = renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Deadline…' }));
    await user.click(screen.getByRole('button', { name: 'Aug 20, 2026' }));

    expect(onSetDeadline).toHaveBeenCalledWith('g', '2026-08-20');
  });

  /**
   * `nearestMeaningfulDate` returns a checkpoint when one falls before the
   * deadline, so the chip does not always name the deadline. Wiring a chip
   * reading `Milestone · Sep 3` to a control that writes `goal.deadline` would
   * be the card lying about what the click does.
   */
  it('leaves a Milestone chip inert and shows the deadline control beside it', () => {
    // `checkpoint?: boolean` on the node — NOT a `kind` discriminator. The
    // `kind: 'checkpoint'` in this test's sibling assertions is
    // `nearestMeaningfulDate`'s return shape, which is a different type.
    renderCard({
      deadline: '2026-12-31',
      nodes: [{ id: 'n', title: 'Draft done', checkpoint: true, deadline: '2026-09-03' }],
    });

    expect(screen.getByText(/Milestone · Sep 3/).closest('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Deadline: Dec 31, 2026' })).toBeTruthy();
  });
});
