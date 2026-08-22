// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { EventBlock, type GridBlock } from './EventBlock';
import { FOOTER_BLOCK_PX, COMPACT_BLOCK_PX } from './blockChrome';

afterEach(() => cleanup());

/**
 * The block is the app's one drawing of a measured span, and the three things
 * pinned here are the three that made it read as a card instead.
 *
 * These are DRAWING tests, deliberately. `assignLanes`, `resolveSlot` and the
 * scheduling rules are covered by their own siblings and none of them changed.
 */

function block(over: Partial<GridBlock> = {}): GridBlock {
  return {
    key: 'k1',
    kind: 'step',
    title: 'Problem set 4',
    startMin: 540,
    endMin: 630, // 90m — comfortably above FOOTER_BLOCK_PX
    done: false,
    estimated: true,
    goalId: 'g1',
    ...over,
  };
}

function mount(over: Partial<GridBlock> = {}, props: Record<string, unknown> = {}) {
  render(createElement(EventBlock, {
    block: block(over), lane: 0, laneCount: 1, ...props,
  } as never));
}

describe('the footer rule', () => {
  it('does NOT print the length, because the column has no room for it', () => {
    /*
     * The design called for a second cell stating `1h 30m` on the reading edge.
     * A week column is ~105px, which leaves 85px inside the block, and that
     * cell takes 46 of them — the span was then clipped to `9am – 10:…` on
     * EVERY block, to state a figure the block's own height already draws at
     * one pixel per minute. Measured, then dropped.
     */
    mount();
    expect(screen.queryByText('1h 30m')).toBeNull();
  });

  it('states the length where there IS room — the name and the tooltip', () => {
    mount();
    expect(screen.getByLabelText(/Problem set 4, 9am–10:30am, 1h 30m/)).toBeTruthy();
    expect(screen.getByTitle(/Problem set 4 · 9am–10:30am · 1h 30m/)).toBeTruthy();
  });

  it('states the START, and the end is drawn rather than written', () => {
    /*
     * `9am – 10:30am` needs 86px and a block in a real week column has 84.
     * A start alone needs 46 at its widest and never clips — and the end is
     * where the bar's bottom edge meets the hour axis, which is what a
     * calendar is FOR.
     */
    mount();
    expect(screen.getByText('9am')).toBeTruthy();
    expect(screen.queryByText(/10:30am/)).toBeNull();
  });

  it('is withheld below the threshold, where it would sit on the title', () => {
    // 45 minutes: past COMPACT_BLOCK_PX, short of FOOTER_BLOCK_PX.
    mount({ startMin: 540, endMin: 585 });
    expect(45).toBeGreaterThan(COMPACT_BLOCK_PX);
    expect(45).toBeLessThan(FOOTER_BLOCK_PX);
    // The start survives on its own line, which is the same thing the tall
    // block prints — the block reads one way at every height.
    expect(screen.getByText('9am')).toBeTruthy();
    expect(screen.queryByText('45m')).toBeNull();
  });

  it('collapses to one line below the compact threshold', () => {
    mount({ startMin: 540, endMin: 565 }); // 25m
    // `9am Title` — the start alone, and no end. Unchanged by this work: the
    // taller layouts moved TO this vocabulary rather than away from it.
    expect(screen.getByText('9am')).toBeTruthy();
    expect(screen.queryByText(/9am\s*[–-]/)).toBeNull();
  });
});

describe('every time on a block is mono', () => {
  it('because a start and an end are measured figures', () => {
    const { container } = render(createElement(EventBlock, {
      block: block(), lane: 0, laneCount: 1,
    } as never));
    const start = screen.getByText('9am');
    expect(start.className).toContain('font-mono');
    expect(start.className).toContain('tabular-nums');
    expect(container).toBeTruthy();
  });
});

describe('the spine', () => {
  it('is a drawn element carrying the project fill, not a left border', () => {
    const { container } = render(createElement(EventBlock, {
      block: block({ goalId: 'g1' }), lane: 0, laneCount: 1,
    } as never));
    // A border cannot carry end caps; a painted spine can, and does.
    const fills = container.querySelectorAll('[class*="bg-proj-"]');
    expect(fills.length).toBeGreaterThanOrEqual(3); // body + two caps
    // The old form is gone: nothing on the block is a 3px left border any more.
    expect(container.innerHTML).not.toContain('border-l-[3px]');
  });

  it('is withheld from a busy block, which states no identity of yours', () => {
    const { container } = render(createElement(EventBlock, {
      block: block({ kind: 'busy', goalId: null }), lane: 0, laneCount: 1,
    } as never));
    expect(container.querySelectorAll('[class*="bg-proj-"]').length).toBe(0);
  });
});

describe('what the drawing change did NOT touch', () => {
  it('keeps the block its own accessible name', () => {
    mount();
    // Without this the name fell back to the concatenation of its children.
    expect(screen.getByLabelText(/Problem set 4, 9am–10:30am, 1h 30m/)).toBeTruthy();
  });

  it('keeps ✓ and ✕ and their toggle-aware labels', () => {
    const onComplete = vi.fn();
    const onRemove = vi.fn();
    mount({ done: true }, { onComplete, onRemove });
    expect(screen.getByLabelText('Reopen Problem set 4')).toBeTruthy();
    expect(screen.getByLabelText('Unschedule Problem set 4')).toBeTruthy();
  });
});

describe('the press does not eat the drag', () => {
  it("composes with dnd-kit's activator rather than replacing it", async () => {
    /*
     * `onPointerDown` sits AFTER the `{...listeners}` spread and later JSX
     * props win, so a bare handler here silently overwrites the sensor's
     * activator: dragging stops working entirely, with no error anywhere and
     * no test failure from any assertion about the block's drawing.
     *
     * So this asserts the BEHAVIOUR, not the presence of a prop — a real
     * pointerdown plus a move past the 5px activation distance has to reach
     * `onDragStart`. Written against the same sensor configuration Plan.tsx
     * uses, because the threshold is what makes the press worth having.
     */
    const onDragStart = vi.fn();
    function Harness() {
      const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      );
      return createElement(
        DndContext,
        { sensors, onDragStart },
        createElement(EventBlock, {
          block: block(),
          lane: 0,
          laneCount: 1,
          drag: { kind: 'step', id: 'n1', goalId: 'g1', title: 'Problem set 4', durationMin: 90 },
        } as never),
      );
    }
    render(createElement(Harness));

    const bar = screen.getByLabelText(/Problem set 4, /);
    fireEvent.pointerDown(bar, { button: 0, isPrimary: true, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 0, clientY: 40 });

    await waitFor(() => expect(onDragStart).toHaveBeenCalled());
  });
});
