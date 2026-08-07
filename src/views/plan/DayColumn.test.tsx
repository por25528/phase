// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { CanvasSpan } from '../../lib/canvasCreate';
import { DayColumn } from './DayColumn';

// jsdom implements neither pointer capture nor layout. Both are stubbed rather
// than worked around: the component is correct to use capture (see
// ResizeHandle), and a zero rect makes contentY equal clientY, which keeps the
// arithmetic in these tests readable.
beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => cleanup());

const WINDOW = { dow: 2, startMin: 540, endMin: 1080 };

function mount(onCreate: (span: CanvasSpan) => void) {
  render(createElement(DayColumn, {
    date: '2026-07-15',
    isToday: false,
    availabilityWindow: WINDOW,
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

describe('when the day refuses work', () => {
  it('renders no canvas on a day with no working hours', () => {
    render(createElement(DayColumn, {
      date: '2026-07-19', isToday: false, availabilityWindow: null,
      nowMinute: null, onCreate: vi.fn(), children: null,
    }));
    expect(screen.queryByTestId('day-canvas-2026-07-19')).toBeNull();
  });

  it('renders no canvas on a past week', () => {
    render(createElement(DayColumn, {
      date: '2026-07-15', isToday: false, availabilityWindow: WINDOW,
      nowMinute: null, readOnly: true, onCreate: vi.fn(), children: null,
    }));
    expect(screen.queryByTestId('day-canvas-2026-07-15')).toBeNull();
  });
});
