// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { MonthGrid } from './MonthGrid';
import { GRID_VIEWPORT_PX } from '../../lib/grid';

afterEach(() => cleanup());

function mount(ym = '2026-08') {
  // The cells register droppables, so the grid needs a DndContext ancestor.
  render(createElement(DndContext, null, createElement(MonthGrid, {
    ym, today: '2026-08-09', itemsByDay: new Map(), isPastDay: () => false,
    onCreate: vi.fn(), onOpenDay: vi.fn(),
  })));
}

describe('the month grid', () => {
  it('draws every day of the six-week window', () => {
    mount();
    expect(screen.getAllByTestId('month-cell')).toHaveLength(6 * 7);
  });

  /*
   * The regression this file exists for. The rows are `1fr`, which divides a
   * height — with none declared, the flex box took its children's height and
   * every cell shrank to its date number. A month of work drew as a table of
   * digits while the week grid beside it was 720px tall.
   */
  it('stands as tall as the week grid, so its 1fr rows have space to divide', () => {
    mount();
    expect(screen.getByTestId('month-grid').style.height).toBe(`${GRID_VIEWPORT_PX}px`);
  });
});
