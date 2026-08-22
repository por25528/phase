// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { BoardCard } from './BoardCard';
import { bayFace } from '../../lib/boardBay';
import type { Goal, Life } from '../../db/types';

const LIVES: Life[] = [{ id: 'cu', title: 'CU', order: 0 }];

/** A goal with one open task, priced, so the card has something to state. */
function goal(over: Partial<Goal>): Goal {
  return {
    id: 'g1',
    title: 'Midterm — 2301265 DATA STRUC ALGOR',
    lifeId: 'cu',
    nodes: [{ id: 'n1', title: 'Pull slides and labs 1–5', estimateMin: 90 }],
    ...over,
  } as unknown as Goal;
}

function renderCard(g: Goal, bay?: ReturnType<typeof bayFace>) {
  render(
    createElement(DndContext, null,
      createElement(BoardCard, {
        goal: g,
        today: '2026-08-23',
        onOpen: vi.fn(), onMove: vi.fn(), onRank: vi.fn(), onDelete: vi.fn(),
        onRename: vi.fn(), onSetDeadline: vi.fn(),
        reducedMotion: false, dimmed: false, matched: false,
        lives: LIVES, onSetLife: vi.fn(),
        ...(bay ? { bay } : {}),
      }),
    ),
  );
}

afterEach(() => cleanup());

describe('BoardCard — what a bay stops repeating', () => {
  it('drops the life when every card in the horizon carries it', () => {
    const bay = bayFace([goal({ id: 'a' }), goal({ id: 'b', title: 'Learn Discrete Mathematics' })], LIVES);
    renderCard(goal({}), bay);
    expect(screen.queryByText('CU')).toBeNull();
  });

  it('keeps it when the horizon is mixed', () => {
    const bay = bayFace([goal({ id: 'a' }), goal({ id: 'b', lifeId: undefined })], LIVES);
    renderCard(goal({}), bay);
    expect(screen.getByText('CU')).toBeTruthy();
  });

  it('drops the title head the horizon shares, and keeps the full name on hover', () => {
    const bay = bayFace([
      goal({ id: 'a' }),
      goal({ id: 'b', title: 'Midterm — 2301230 DISCRETE CS' }),
    ], LIVES);
    renderCard(goal({}), bay);
    expect(screen.getByText('2301265 DATA STRUC ALGOR')).toBeTruthy();
    expect(screen.getByTitle('Midterm — 2301265 DATA STRUC ALGOR')).toBeTruthy();
  });

  it('states the card in full with no bay — the drag overlay, and a bay of one', () => {
    renderCard(goal({}));
    expect(screen.getByText('Midterm — 2301265 DATA STRUC ALGOR')).toBeTruthy();
    expect(screen.getByText('CU')).toBeTruthy();
  });
});

describe('BoardCard — a parked project goes quiet', () => {
  it('offers the next task and the remaining effort inside the planning horizon', () => {
    renderCard(goal({ column: 1 }));
    expect(screen.getByText(/Pull slides and labs/)).toBeTruthy();
    expect(screen.getByText(/left/)).toBeTruthy();
  });

  it('states neither past it, where the rail already refuses to list the work', () => {
    renderCard(goal({ column: 3 }));
    expect(screen.queryByText(/Pull slides and labs/)).toBeNull();
    expect(screen.queryByText(/left/)).toBeNull();
  });

  it('still states what the project IS — its name and its progress', () => {
    renderCard(goal({ column: 3 }));
    expect(screen.getByText('Midterm — 2301265 DATA STRUC ALGOR')).toBeTruthy();
    // `effortCount` — the fraction beside the meter, which is what the meter
    // draws. Progress is not a plan figure and is stated at every horizon.
    expect(screen.getByText('0/1')).toBeTruthy();
  });
});
