// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { BoardCard } from './BoardCard';
import type { Goal, Life } from '../../db/types';

const LIVES: Life[] = [
  { id: 'l1', title: 'MIT', order: 0 },
  { id: 'l2', title: 'Startup', order: 1 },
];

// BoardCard is a sortable, so it needs a DndContext above it even when rendered
// in isolation (useSortable reads the nearest context).
function renderCard({
  goal,
  lives,
  onSetLife,
}: {
  goal: Goal;
  lives: Life[];
  onSetLife?: (goalId: string, lifeId: string | null) => void;
}) {
  render(
    createElement(DndContext, null,
      createElement(BoardCard, {
        goal,
        today: '2026-07-15',
        onOpen: vi.fn(),
        onMove: vi.fn(),
        onRank: vi.fn(),
        onDelete: vi.fn(),
        onRename: vi.fn(),
        onSetDeadline: vi.fn(),
        reducedMotion: false,
        dimmed: false,
        matched: false,
        lives,
        onSetLife: onSetLife ?? vi.fn(),
      }),
    ),
  );
}

afterEach(() => cleanup());

describe('BoardCard — life', () => {
  it('names the life a goal belongs to', () => {
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [], lifeId: 'l1' }, lives: LIVES });
    expect(screen.getByText('MIT')).toBeTruthy();
  });

  it('says nothing at all when the goal is unassigned', () => {
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [] }, lives: LIVES });
    expect(screen.queryByText('MIT')).toBeNull();
    expect(screen.queryByText('Unassigned')).toBeNull();
  });

  // A life deleted out from under a goal must not render its stale id.
  it('says nothing when the goal points at a life that no longer exists', () => {
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [], lifeId: 'gone' }, lives: LIVES });
    expect(screen.queryByText('gone')).toBeNull();
  });

  it('offers every life plus None, and assigns the one clicked', () => {
    const onSetLife = vi.fn();
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [] }, lives: LIVES, onSetLife });

    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Startup' }));

    expect(onSetLife).toHaveBeenCalledWith('g1', 'l2');
  });

  it('clears the life with None', () => {
    const onSetLife = vi.fn();
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [], lifeId: 'l1' }, lives: LIVES, onSetLife });

    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'None' }));

    expect(onSetLife).toHaveBeenCalledWith('g1', null);
  });

  // With no lives created, the section is chrome explaining a concept the
  // person has not opted into.
  it('omits the whole section when no lives exist', () => {
    renderCard({ goal: { id: 'g1', title: 'Psets', nodes: [] }, lives: [] });
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.queryByText('Life')).toBeNull();
  });
});
