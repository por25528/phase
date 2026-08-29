// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { MonthGrid } from './MonthGrid';
import { GRID_VIEWPORT_PX } from '../../lib/grid';
import { monthCapacity } from './monthCapacity';

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

const cap = monthCapacity({
  ym: '2026-08',
  goals: [], tasks: [], blocks: [],
  now: { date: '2026-08-16', minute: 600 },
  allDayBlocks: false, hasData: false,
});

describe('MonthGrid gutter', () => {
  it('renders one gutter button per week row', () => {
    render(createElement(DndContext, null, createElement(MonthGrid, {
      ym: '2026-08', today: '2026-08-16', itemsByDay: new Map(),
      isPastDay: () => false, onCreate: vi.fn(), onOpenDay: vi.fn(),
      capacity: cap, onOpenWeek: vi.fn(),
    })));
    expect(screen.getAllByTestId('month-gutter-row').length).toBe(cap.rows.length);
  });

  it('routes a gutter click to that row’s week', () => {
    const opened: string[] = [];
    render(createElement(DndContext, null, createElement(MonthGrid, {
      ym: '2026-08', today: '2026-08-16', itemsByDay: new Map(),
      isPastDay: () => false, onCreate: vi.fn(), onOpenDay: vi.fn(),
      capacity: cap, onOpenWeek: (w: string) => opened.push(w),
    })));
    fireEvent.click(screen.getAllByTestId('month-gutter-row')[1]);
    expect(opened).toEqual([cap.rows[1].week]);
  });

  it('names each gutter button so it is reachable without a pointer', () => {
    render(createElement(DndContext, null, createElement(MonthGrid, {
      ym: '2026-08', today: '2026-08-16', itemsByDay: new Map(),
      isPastDay: () => false, onCreate: vi.fn(), onOpenDay: vi.fn(),
      capacity: cap, onOpenWeek: vi.fn(),
    })));
    // `getAllByRole`, not `getByRole`: a six-week month draws six gutter
    // buttons, and the brief's `getByRole` is ambiguous by construction — every
    // row's name matches this same pattern. The intent (each button carries a
    // real, role-reachable name) is unchanged; only the query cardinality is.
    const buttons = screen.getAllByRole('button', { name: /^Open week W\d+/ });
    expect(buttons.length).toBe(cap.rows.length);
  });

  it('draws no gutter when it has no figures', () => {
    render(createElement(DndContext, null, createElement(MonthGrid, {
      ym: '2026-08', today: '2026-08-16', itemsByDay: new Map(),
      isPastDay: () => false, onCreate: vi.fn(), onOpenDay: vi.fn(),
    })));
    expect(screen.queryAllByTestId('month-gutter-row').length).toBe(0);
  });
});
