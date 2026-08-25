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
  const onRename = vi.fn();
  const onOpen = vi.fn();
  const goal: Goal = { id: 'g', title: 'Finish CS:APP', nodes: [], ...over };
  render(
    createElement(DndContext, null,
      createElement(BoardCard, {
        goal,
        today: '2026-08-14',
        onOpen,
        onMove: vi.fn(),
        onRank: vi.fn(),
        onDelete: vi.fn(),
        onRename,
        onSetDeadline: vi.fn(),
        reducedMotion: false,
        dimmed: false,
        matched: false,
        lives: [],
        onSetLife: vi.fn(),
      }),
    ),
  );
  return { onRename, onOpen, user: userEvent.setup() };
}

async function openRename(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
}

describe('renaming from the board', () => {
  it('turns the title into a field and commits on Enter', async () => {
    const { onRename, user } = renderCard();
    await openRename(user);

    const field = screen.getByRole('textbox');
    await user.clear(field);
    await user.type(field, 'Finish CS:APP labs{Enter}');

    expect(onRename).toHaveBeenCalledWith('g', 'Finish CS:APP labs');
  });

  it('abandons the edit on Escape without writing', async () => {
    const { onRename, user } = renderCard();
    await openRename(user);

    await user.type(screen.getByRole('textbox'), ' more{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  /**
   * The card root opens the goal on click and carries dnd-kit's drag listeners.
   * A text field that let either through would open the project on the first
   * click into the word you meant to fix.
   */
  it('does not open the goal when you click into the field', async () => {
    const { onOpen, user } = renderCard();
    await openRename(user);

    await user.click(screen.getByRole('textbox'));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
