import { describe, expect, it } from 'vitest';
import { closestCorners, type ClientRect, type CollisionDetection } from '@dnd-kit/core';
import { boardCollision } from './boardCollision';

/**
 * The geometry below is MEASURED, not invented: it is what Chromium reports for
 * the wide Goals board at 1280px with four cards in `Now`, six in `Someday`, and
 * `Next`/`Later` empty — the exact state in the bug report. The numbers matter,
 * because the defect is a distance comparison and a plausible-looking rect would
 * prove nothing.
 */
function rect(left: number, right: number, top: number, bottom: number): ClientRect {
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

// Four bays, each stretched to the height of the tallest one (`items-stretch` +
// `flex-1`), and the cards inside them — compact, and only ever in a bay that
// holds some.
const RECTS: Array<[string, ClientRect]> = [
  ['a', rect(12, 307, 30, 150)],
  ['b', rect(12, 307, 161, 281)],
  ['c', rect(12, 307, 292, 412)],
  ['d', rect(12, 307, 423, 543)],
  ['col-0', rect(0, 319, 18, 817)],
  ['col-1', rect(320, 639, 18, 817)],
  ['col-2', rect(640, 959, 18, 817)],
  ['e', rect(972, 1267, 30, 150)],
  ['col-3', rect(960, 1279, 18, 817)],
];

function args(pointer: { x: number; y: number }, collisionRect: ClientRect) {
  const droppableRects = new Map(RECTS);
  return {
    active: { id: 'a', data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    collisionRect,
    droppableRects,
    droppableContainers: RECTS.map(([id]) => ({ id })),
    pointerCoordinates: pointer,
  } as unknown as Parameters<CollisionDetection>[0];
}

// The card is dragged from `Now` to the middle of the empty `Next` bay.
const OVER_EMPTY_NEXT = args({ x: 480, y: 90 }, rect(355, 595, 30, 150));

describe('boardCollision', () => {
  it('answers the empty bay the pointer is inside', () => {
    expect(boardCollision(OVER_EMPTY_NEXT)[0]?.id).toBe('col-1');
  });

  it('is the fix for closestCorners, which answers the dragged card itself', () => {
    // Why the board could not accept a drop into `Next` or `Later`: a bay is as
    // tall as the whole sheet, so two of its four corners are ~670px below the
    // card being dragged, and `closestCorners` averages all four. A compact card
    // rect in the column the drag STARTED in scores better than the bay the
    // pointer is actually inside — and `Now`'s own card wins, so the drag ends
    // where it began. A bay with cards in it was never affected: one of those
    // cards is a droppable in the target column, which is why `Someday` worked.
    expect(closestCorners(OVER_EMPTY_NEXT)[0]?.id).toBe('a');
  });

  it('prefers the card under the pointer to the bay holding it, so a reorder still lands', () => {
    const overCardC = args({ x: 160, y: 350 }, rect(12, 307, 292, 412));
    expect(boardCollision(overCardC)[0]?.id).toBe('c');
  });

  it('answers the bay when the pointer is on its hatched tail, below the last card', () => {
    const overTail = args({ x: 160, y: 700 }, rect(12, 307, 640, 760));
    expect(boardCollision(overTail)[0]?.id).toBe('col-0');
  });

  it('falls back to rect intersection when there are no pointer coordinates', () => {
    // The keyboard sensor supplies none. Without the fallback every keyboard
    // drag would be inert — the trap `views/Plan.tsx` documents at its own
    // collision detector.
    const keyboard = { ...OVER_EMPTY_NEXT, pointerCoordinates: null } as Parameters<CollisionDetection>[0];
    expect(boardCollision(keyboard)[0]?.id).toBe('col-1');
  });
});
