import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const {
  createOverlayWindow, pillModel, clampToWorkArea, defaultPosition,
  REPAINT_MS, OVERLAY_WIDTH, OVERLAY_HEIGHT,
} = nativeRequire('./overlayWindow.cjs') as typeof import('./overlayWindow.cjs');

type FocusStatus = Parameters<ReturnType<typeof createOverlayWindow>['setFocusStatus']>[0];

const MIN = 60_000;
const T0 = 1_700_000_000_000;

const active = (over: Partial<NonNullable<FocusStatus>> = {}): NonNullable<FocusStatus> => ({
  phase: 'active', activeSinceMs: T0, accumulatedMs: 0, title: 'Problem set 4', ...over,
});

describe('pillModel', () => {
  it('floors active minutes and carries the title', () => {
    expect(pillModel(active(), T0 + 90_000)).toEqual({ glyph: '▶', text: '1m · Problem set 4' });
  });

  it('banks accumulated time on top of the live stretch', () => {
    expect(pillModel(active({ accumulatedMs: 10 * MIN }), T0 + MIN))
      .toEqual({ glyph: '▶', text: '11m · Problem set 4' });
  });

  it('reads a backwards clock as zero extra', () => {
    expect(pillModel(active(), T0 - MIN)).toEqual({ glyph: '▶', text: '0m · Problem set 4' });
  });

  it('says on break without a clock', () => {
    expect(pillModel(active({ phase: 'break', activeSinceMs: null }), T0))
      .toEqual({ glyph: '⏸', text: 'on break' });
  });

  it('is null while confirming and null with no session', () => {
    expect(pillModel(active({ phase: 'confirming', activeSinceMs: null }), T0)).toBeNull();
    expect(pillModel(null, T0)).toBeNull();
  });
});

describe('position math', () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };

  it('defaults to the top-right corner with a 16px margin', () => {
    expect(defaultPosition(workArea)).toEqual({ x: 1440 - OVERLAY_WIDTH - 16, y: 25 + 16 });
  });

  it('clamps a stored point back inside the work area', () => {
    expect(clampToWorkArea({ x: 5000, y: -50 }, workArea))
      .toEqual({ x: 1440 - OVERLAY_WIDTH, y: 25 });
    expect(clampToWorkArea({ x: -300, y: 9000 }, workArea))
      .toEqual({ x: 0, y: 25 + 875 - OVERLAY_HEIGHT });
  });

  it('passes an in-bounds point through untouched', () => {
    expect(clampToWorkArea({ x: 100, y: 100 }, workArea)).toEqual({ x: 100, y: 100 });
  });
});
