// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { BoardCard } from './BoardCard';
import type { Goal, GoalNode } from '../../db/types';

const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

// BoardCard is a sortable, so it needs a DndContext above it even in isolation.
function renderCard(nodes: GoalNode[]) {
  const goal: Goal = { id: 'g', title: 'Finish CS:APP', nodes };
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
        reducedMotion: false,
        dimmed: false,
        matched: false,
        lives: [],
        onSetLife: vi.fn(),
      }),
    ),
  );
}

/** The filled `<i>` inside the meter, or null when no meter was drawn. */
function meterWidth(): string | null {
  const fill = document.querySelector('.bg-fill') as HTMLElement | null;
  return fill ? fill.style.width : null;
}

afterEach(() => cleanup());

describe('BoardCard progress meter', () => {
  it('draws the fraction it prints', () => {
    renderCard([
      leaf('a', { status: 'done' }),
      leaf('b'),
      leaf('c'),
      leaf('d'),
    ]);

    expect(meterWidth()).toBe('25%');
    expect(screen.getByText('1/4')).toBeTruthy();
  });

  /**
   * The whole licence for the meter: it restates the count, so the two can
   * never disagree. A bar reading 60% beside the text "1/4" is the failure this
   * card deleted its previous progress bar over.
   */
  it('agrees with its own count when the estimates are lopsided', () => {
    renderCard([
      leaf('a', { estimateMin: 600, status: 'done' }),
      leaf('b', { estimateMin: 10 }),
      leaf('c', { estimateMin: 10 }),
      leaf('d', { estimateMin: 10 }),
    ]);

    // Weighted by estimate this goal is 95% done; by task it is 25%.
    expect(meterWidth()).toBe('25%');
    expect(screen.getByText('1/4')).toBeTruthy();
  });

  it('keeps the estimate caveats off the meter row, on their own line', () => {
    renderCard([
      leaf('a', { estimateMin: 55, status: 'done' }),
      leaf('b', { estimateMin: 55 }),
      leaf('c'),
    ]);

    const count = screen.getByText('1/3');
    const caption = screen.getByText('55m left · 1 unestimated');
    expect(count.parentElement).not.toBe(caption.parentElement);
  });

  it('renders no caption line at all when there is nothing to qualify', () => {
    renderCard([leaf('a', { estimateMin: 30, status: 'done' }), leaf('b', { estimateMin: 30, status: 'done' })]);

    expect(meterWidth()).toBe('100%');
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByText(/left|unestimated/)).toBeNull();
  });

  it('draws no meter for a goal with no tasks rather than an empty one', () => {
    renderCard([]);

    expect(meterWidth()).toBeNull();
    expect(screen.queryByText('0/0')).toBeNull();
  });
});
