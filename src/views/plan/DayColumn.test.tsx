// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { CanvasSpan } from '../../lib/canvasCreate';
import { DayColumn } from './DayColumn';
import { EventBlock, type GridBlock } from './EventBlock';

// jsdom implements neither pointer capture nor layout. Both are stubbed rather
// than worked around: the component is correct to use capture (see
// ResizeHandle), and a zero rect makes contentY equal clientY, which keeps the
// arithmetic in these tests readable.
beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => cleanup());

function mount(onCreate: (span: CanvasSpan) => void) {
  render(createElement(DayColumn, {
    date: '2026-07-15',
    isToday: false,
    nowMinute: null,
    onCreate,
    children: null,
  }));
  return screen.getByTestId('day-canvas-2026-07-15');
}

describe('creating a block by gesture', () => {
  it('reports the dragged span, snapped to the grain', () => {
    const onCreate = vi.fn();
    const canvas = mount(onCreate);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientY: 540 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientY: 632 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientY: 632 });

    // 632 snaps to 630 — the 5-minute grain, not the raw pixel.
    expect(onCreate).toHaveBeenCalledWith({ startMin: 540, durationMin: 90 });
  });

  it('treats a gesture under the click threshold as a default-length block', () => {
    const onCreate = vi.fn();
    const canvas = mount(onCreate);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientY: 540 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientY: 542 });

    expect(onCreate).toHaveBeenCalledWith({ startMin: 540, durationMin: 60 });
  });

  it('draws a preview while the pointer is down, and clears it on release', () => {
    const canvas = mount(vi.fn());

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientY: 540 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientY: 660 });
    expect(screen.queryByTestId('canvas-preview')).not.toBeNull();

    fireEvent.pointerUp(canvas, { pointerId: 1, clientY: 660 });
    expect(screen.queryByTestId('canvas-preview')).toBeNull();
  });

  it('abandons the gesture on cancel without reporting anything', () => {
    const onCreate = vi.fn();
    const canvas = mount(onCreate);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientY: 540 });
    fireEvent.pointerCancel(canvas, { pointerId: 1 });

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-preview')).toBeNull();
  });

  it('ignores a non-primary button', () => {
    const onCreate = vi.fn();
    const canvas = mount(onCreate);

    fireEvent.pointerDown(canvas, { button: 2, pointerId: 1, clientY: 540 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientY: 700 });

    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('telling elapsed from available at a glance', () => {
  it('washes a past day column so it does not read as available', () => {
    render(createElement(DayColumn, {
      date: '2026-07-14', isToday: false,
      nowMinute: null, isPast: true, onCreate: vi.fn(), children: null,
    }));
    expect(screen.getByTestId('day-past-2026-07-14')).not.toBeNull();
  });

  it('leaves a current or future day undimmed', () => {
    render(createElement(DayColumn, {
      date: '2026-07-16', isToday: false,
      nowMinute: null, isPast: false, onCreate: vi.fn(), children: null,
    }));
    expect(screen.queryByTestId('day-past-2026-07-16')).toBeNull();
  });

  it('draws the now-line only on today, and only when the minute is known', () => {
    const { rerender } = render(createElement(DayColumn, {
      date: '2026-07-15', isToday: true,
      nowMinute: 600, onCreate: vi.fn(), children: null,
    }));
    expect(document.querySelector('[data-testid="now-line-2026-07-15"]')).not.toBeNull();

    // A day that is not today never carries the line, even if handed a minute.
    rerender(createElement(DayColumn, {
      date: '2026-07-15', isToday: false,
      nowMinute: null, onCreate: vi.fn(), children: null,
    }));
    expect(document.querySelector('[data-testid="now-line-2026-07-15"]')).toBeNull();
  });

  // `accent` means ACTION here — it is the drop-target tint and the colour of
  // every primary control — so a permanent accent rule across one column read
  // as something to click. `warn` is the clock's colour, and the indicator
  // stays a hairline precisely so it does not read as an error either.
  it('draws the now-line in warn, not accent', () => {
    render(createElement(DayColumn, {
      date: '2026-07-15', isToday: true,
      nowMinute: 600, onCreate: vi.fn(), children: null,
    }));
    const line = document.querySelector('[data-testid="now-line-2026-07-15"]');
    expect(line?.className).toContain('border-warn');
    expect(line?.className).not.toContain('border-accent');
  });
});

describe('when the day refuses work', () => {
  /*
   * This describe has now inverted twice, and the second inversion is the
   * bigger one. It began as "renders no canvas on a day with no working
   * hours", asserting a fence: a day off had its droppable disabled and its
   * canvas withheld. Then a day off became a MARKING — the `.hatch` — rather
   * than a lock. Now there is no such thing as a day off at all, so the
   * marking has nothing to mark and every day is simply a day.
   */
  it('renders the canvas on a Sunday like any other day', () => {
    render(createElement(DayColumn, {
      date: '2026-07-19', isToday: false,
      nowMinute: null, onCreate: vi.fn(), children: null,
    }));
    expect(screen.queryByTestId('day-canvas-2026-07-19')).toBeTruthy();
  });

  /*
   * `.hatch` still means "unclaimed space" on Today's frame and the Goals
   * board. A stray one here would be saying that about an ordinary afternoon.
   */
  it('draws no hatch — every hour of every day reads the same', () => {
    const { container } = render(createElement(DayColumn, {
      date: '2026-07-19', isToday: false,
      nowMinute: null, onCreate: vi.fn(), children: null,
    }));
    expect(container.querySelector('.hatch')).toBeNull();
  });

  it('names the day without an outside-working-hours caveat', () => {
    render(createElement(DayColumn, {
      date: '2026-07-19', isToday: false,
      nowMinute: null, onCreate: vi.fn(), children: null,
    }));
    expect(screen.getByRole('group').getAttribute('aria-label')).not.toMatch(/working hours/);
  });

  it('renders no canvas on a past week', () => {
    render(createElement(DayColumn, {
      date: '2026-07-15', isToday: false,
      nowMinute: null, readOnly: true, onCreate: vi.fn(), children: null,
    }));
    expect(screen.queryByTestId('day-canvas-2026-07-15')).toBeNull();
  });
});

const EVENT_BLOCK: GridBlock = {
  key: 'step:a',
  kind: 'step',
  title: 'Finished step',
  startMin: 540,
  endMin: 600,
  done: true,
  estimated: true,
};

describe('EventBlock completion control', () => {
  it('fades the completion control on a done block', () => {
    render(<EventBlock block={EVENT_BLOCK} lane={0} laneCount={1} onComplete={() => {}} />);

    const button = screen.getByRole('button', { name: 'Reopen Finished step' });
    expect(button.className).toContain('transition-opacity');
    expect(button.className).toContain('duration-150');
  });

  it('keeps the open completion control on the quiet-control path', () => {
    render(<EventBlock block={{ ...EVENT_BLOCK, done: false }} lane={0} laneCount={1} onComplete={() => {}} />);

    const button = screen.getByRole('button', { name: 'Complete Finished step' });
    expect(button.className).toContain('quiet-control');
    expect(button.className).not.toContain('transition-opacity');
  });
});
