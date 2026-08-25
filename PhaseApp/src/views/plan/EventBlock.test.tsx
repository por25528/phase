// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { EventBlock, type GridBlock } from './EventBlock';
import { FOOTER_BLOCK_PX, COMPACT_BLOCK_PX } from './blockChrome';
import { PX_PER_MINUTE } from '../../lib/grid';

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

  it('renders BOTH readouts and lets the container query pick one', () => {
    /*
     * `9am – 10:30am` needs 86px of mono and `10:15am – 11:45am` needs 113. A
     * block on an ordinary window has ~119px inside it and one at the grid's
     * `min-w-[780px]` floor has 84 — so a fixed choice is wrong whichever way
     * you make it, and only the block knows its own width (two overlapping
     * bars halve it with no change to the column). Both forms are in the DOM;
     * `.blk-span` / `.blk-start` and the `@container` rule in index.css decide.
     *
     * jsdom applies no container queries, so this asserts the MECHANISM — that
     * both forms exist and carry the switch classes — rather than which one
     * paints, which only a real engine can answer. The Electron screenshot is
     * what checks that.
     */
    const { container } = render(createElement(EventBlock, {
      block: block(), lane: 0, laneCount: 1,
    } as never));
    expect(container.querySelector('.blk-span')!.textContent).toMatch(/9am\s*[–-]\s*10:30am/);
    expect(container.querySelector('.blk-start')!.textContent).toBe('9am');
    // The block itself has to BE the container, or the query has nothing to ask.
    expect(container.querySelector('.blk-cq')).toBeTruthy();
  });

  it('is withheld below the threshold, where it would sit on the title', () => {
    /*
     * 45 minutes, chosen to land between the two thresholds — and the
     * thresholds are PIXELS, so the fixture has to be converted before it can
     * be compared to them. This read `expect(45).toBeGreaterThan(...)` and held
     * only because `PX_PER_MINUTE` happens to be 1: change the grid's scale and
     * it either failed for a reason that had nothing to do with the footer, or
     * kept passing while the block quietly moved to a different layout branch.
     */
    const heightPx = 45 * PX_PER_MINUTE;
    mount({ startMin: 540, endMin: 585 });
    expect(heightPx).toBeGreaterThan(COMPACT_BLOCK_PX);
    expect(heightPx).toBeLessThan(FOOTER_BLOCK_PX);
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
    // One wrapper carries the voice for both forms.
    const readout = container.querySelector('.blk-span')!.parentElement!;
    expect(readout.className).toContain('font-mono');
    expect(readout.className).toContain('tabular-nums');
    // And it is aria-hidden, because the block's own aria-label already states
    // the span AND the length — otherwise BOTH forms would be announced, since
    // hiding one with CSS does not remove it from the accessible tree.
    expect(readout.getAttribute('aria-hidden')).toBe('true');
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

/**
 * Two sittings of one task, on one grid.
 *
 * `DayBlocks` already keys its React elements by the SITTING ("Two sittings of
 * one task on the same day are two bars"), but the draggable id was keyed by
 * the task — and dnd-kit keeps ONE `draggableNodes` map, so the two bars
 * registered under one key and only one entry survived it.
 */
function twoSittings(onDragStart?: (e: unknown) => void) {
  function Harness() {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    );
    return createElement(
      DndContext,
      { sensors, onDragStart },
      createElement(EventBlock, {
        block: block({ key: 'step:b1' }),
        lane: 0,
        laneCount: 1,
        drag: { kind: 'step', id: 'n1', goalId: 'g1', title: 'Problem set 4', durationMin: 90, blockId: 'b1' },
      } as never),
      createElement(EventBlock, {
        block: block({ key: 'step:b2', startMin: 780, endMin: 870 }),
        lane: 0,
        laneCount: 1,
        drag: { kind: 'step', id: 'n1', goalId: 'g1', title: 'Problem set 4', durationMin: 90, blockId: 'b2' },
      } as never),
    );
  }
  render(createElement(Harness));
  return screen.getAllByLabelText(/^Problem set 4, /);
}

async function lift(bar: HTMLElement) {
  fireEvent.pointerDown(bar, { button: 0, isPrimary: true, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 0, clientY: 40 });
}

describe('a draggable is a SITTING, not a task', () => {
  it('carries the sitting you grabbed, not whichever twin the map kept', async () => {
    /*
     * `active.data.current` is what `Plan.tsx`'s `handleDragEnd` reads its
     * `blockId` out of, and `active.rect` is what `aimFromDrag` resolves the
     * landing against. Under one shared id both came from the OTHER bar: the
     * drop moved the sitting you did not touch, and it aimed with the wrong
     * day's geometry. Reachable today — `scheduleNode(..., { mode: 'add' })`
     * from `SchedulePopover` and `TaskPage` is how a second sitting is made.
     */
    const onDragStart = vi.fn();
    const bars = twoSittings(onDragStart);
    await lift(bars[1]);
    await waitFor(() => expect(onDragStart).toHaveBeenCalled());

    const e = onDragStart.mock.calls[0][0] as {
      active: { id: string | number; data: { current?: { blockId?: string } } };
    };
    expect(String(e.active.id)).toContain('b2');
    expect(e.active.data.current?.blockId).toBe('b2');
  });

  it('opens the hole under ONE bar, because `isDragging` compares that id', async () => {
    /*
     * `isDragging` is `active?.id === id`, so a shared id made it true for
     * both — and the hole styling blanks its children, so lifting one bar left
     * two empty dashed outlines on the week.
     */
    const bars = twoSittings();
    await lift(bars[0]);
    await waitFor(() => expect(bars[0].className).toContain('bg-transparent'));
    expect(bars[1].className).not.toContain('bg-transparent');
  });
});

describe('the border colour is decided once', () => {
  /*
   * Tailwind emits `.border-line-2` BEFORE `.border-line-soft` (theme key
   * order, same specificity), so a `border-line-2` appended to a string that
   * already carries `border-line-soft` loses — whatever the order in the
   * className. Both the unestimated block and the dragging hole did that, and
   * both drew #F0EFEB where #D8D6D0 was meant.
   *
   * The fix is structural rather than an ordering rule: the branches decide
   * the value and one slot prints it. So these assert that only ONE border
   * colour class reaches the element — which order cannot break.
   */
  it('gives a guessed-hour block the line it meant, not the softer one', () => {
    const { container } = render(createElement(EventBlock, {
      block: block({ estimated: false }), lane: 0, laneCount: 1,
    } as never));
    const root = container.querySelector('.blk-cq')!;
    expect(root.className).toContain('border-dashed');
    expect(root.className).toContain('border-line-2');
    expect(root.className).not.toContain('border-line-soft');
  });

  it('leaves an ordinary block on the soft line, and only that', () => {
    const { container } = render(createElement(EventBlock, {
      block: block(), lane: 0, laneCount: 1,
    } as never));
    const root = container.querySelector('.blk-cq')!;
    expect(root.className).toContain('border-line-soft');
    expect(root.className).not.toContain('border-line-2');
  });

  it('gives the hole the visible line — the one thing it exists to draw', async () => {
    const bars = twoSittings();
    await lift(bars[0]);
    await waitFor(() => expect(bars[0].className).toContain('border-dashed'));
    expect(bars[0].className).toContain('border-line-2');
    expect(bars[0].className).not.toContain('border-line-soft');
  });
});

describe('the resize badge', () => {
  function grip() {
    render(createElement(EventBlock, {
      block: block(), lane: 0, laneCount: 1, onResize: vi.fn(),
    } as never));
    const handle = screen.getByTestId('resize-handle');
    // jsdom implements no pointer capture; the handler calls it unconditionally.
    (handle as unknown as { setPointerCapture: (id: number) => void })
      .setPointerCapture = () => {};
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 130 });
    return screen.getByTestId('resize-badge');
  }

  it('is drawn OUTSIDE the block, because the block clips its own contents', () => {
    /*
     * The badge hangs below the block's bottom edge (`bottom-[-2px]` plus a
     * full `translateY`), and the block root is `overflow-hidden` — which is
     * load-bearing: it clips the spine's caps to the corner radius and cuts a
     * long title off cleanly. So none of the badge landed inside the padding
     * box and none of it ever painted. jsdom clips nothing, which is exactly
     * why the original test saw a badge the real app never drew.
     *
     * Hoisting it one level would not help: `DayColumn` is `overflow-hidden`
     * too. It is portalled to `document.body` and positioned `fixed` from the
     * grip's measured corner, so no ancestor of it can clip it at all.
     */
    const badge = grip();
    const root = document.querySelector('.blk-cq')!;
    expect(root.className).toContain('overflow-hidden');
    expect(root.contains(badge)).toBe(false);
    expect(badge.parentElement).toBe(document.body);
    expect(badge.className).toContain('fixed');
    // Still the readout it was: the new END and the new LENGTH.
    expect(badge.textContent).toMatch(/11am/);
  });

  it('is a drawing, not an announcement', () => {
    /*
     * `role="status"` queued every intermediate figure a pointermove produced —
     * the thing `LandingOutline` refuses three files away, in those words. And
     * a region mounted in the same tick as its text is the announcement most
     * readers drop, so the one useful value was also the least likely to be
     * heard. The figure is stated on RELEASE, by the block's own `aria-label`.
     */
    const badge = grip();
    expect(badge.getAttribute('role')).toBeNull();
    expect(badge.getAttribute('aria-hidden')).toBe('true');
  });
});
