import { describe, expect, it } from 'vitest';
import { closestCorners, type ClientRect, type CollisionDetection } from '@dnd-kit/core';
import { boardCollision } from './boardCollision';

/**
 * The geometry below is MEASURED, not invented: it is what Chromium reports for
 * the wide Goals board at 1280px with four cards in `Now`, six in `Someday`, and
 * `Next`/`Later` empty — the exact state in the bug report. The numbers matter,
 * because the defect is a distance comparison and a plausible-looking rect would
 * prove nothing.
 *
 * The last block covers the OTHER callers. `views/Plan.tsx` used to carry its
 * own byte-for-byte copy of this function, so the keyboard-drag guarantee had
 * two homes and a fix to one would silently leave the other inert. There is one
 * home now, and the calendar's contract is asserted here rather than assumed —
 * a day column is a different shape from a bay (tall, narrow, seven of them in
 * a row), and it is the day column, not a block inside it, that the drop
 * handlers read off `e.over`.
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
    // drag would be inert — on this board and on the calendar both, which is
    // the point of there being one function. See the calendar's own case below.
    const keyboard = { ...OVER_EMPTY_NEXT, pointerCoordinates: null } as Parameters<CollisionDetection>[0];
    expect(boardCollision(keyboard)[0]?.id).toBe('col-1');
  });
});

/**
 * The week calendar at 1280px: the 56px hour axis, then seven day columns, each
 * the full 1440px day. `EventBlock`s are droppable-free — only the columns are
 * registered — so the pointer answering "which column" is the whole job, and
 * `handleDragMove`/`handleDragEnd` resolve the minute themselves from the
 * ghost's rect.
 */
const DAY_RECTS: Array<[string, ClientRect]> = [
  ['day:2026-08-24', rect(56, 231, 120, 1560)],
  ['day:2026-08-25', rect(231, 406, 120, 1560)],
  ['day:2026-08-26', rect(406, 581, 120, 1560)],
];

function dayArgs(pointer: { x: number; y: number } | null, collisionRect: ClientRect) {
  return {
    active: { id: 't1', data: { current: undefined }, rect: { current: { initial: null, translated: collisionRect } } },
    collisionRect,
    droppableRects: new Map(DAY_RECTS),
    droppableContainers: DAY_RECTS.map(([id]) => ({ id })),
    pointerCoordinates: pointer,
  } as unknown as Parameters<CollisionDetection>[0];
}

describe('boardCollision, spent by the week calendar', () => {
  it('answers the day column under the pointer', () => {
    const overTuesday = dayArgs({ x: 300, y: 640 }, rect(240, 397, 600, 690));
    expect(boardCollision(overTuesday)[0]?.id).toBe('day:2026-08-25');
  });

  it('still answers a day column with no pointer, so a keyboard drag is not inert', () => {
    // The same guarantee the board needs, asserted from the caller that used to
    // own a second copy of it. `Plan.tsx` registers a `KeyboardSensor` and its
    // `handleDragEnd` bails on `!e.over` — with a bare `pointerWithin` every
    // keyboard placement would do nothing at all, and say nothing about it.
    const keyboard = dayArgs(null, rect(240, 397, 600, 690));
    expect(boardCollision(keyboard)[0]?.id).toBe('day:2026-08-25');
  });

  it('answers nothing when the ghost is off the calendar entirely', () => {
    // No third `closestCorners` step, so a release in the sidebar resolves to
    // no `over` at all and `handleDragEnd`'s guard is what the user gets — not
    // a drop onto whichever day happened to be nearest.
    const offGrid = dayArgs({ x: 20, y: 640 }, rect(-200, -25, 600, 690));
    expect(boardCollision(offGrid)).toHaveLength(0);
  });
});

/**
 * The rule is only one rule while nobody re-rolls it. This is a source scan in
 * the shape `designScale.test.ts` already uses: three surfaces had drifted into
 * three copies of the same three lines — the week calendar's was byte-for-byte,
 * the goal calendar's was an inline arrow at its `DndContext` that also handed
 * dnd-kit a new function identity on every render — and each copy carried the
 * keyboard fix with none of the reasoning that explains why it cannot be
 * trimmed. Nothing above can catch a FOURTH copy, because a copy passes every
 * assertion in this file by construction.
 */
describe('nobody re-rolls the collision rule', () => {
  it('is the only module in src/ that reaches for pointerWithin', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
        return /\.tsx?$/.test(e.name) ? [full] : [];
      });

    // The rule itself, and this file — which names the symbol in its own prose
    // and in the pattern two lines down.
    const mine = [join('lib', 'boardCollision.ts'), join('lib', 'boardCollision.test.ts')];
    const offenders = walk('src')
      .filter((f) => !mine.some((m) => f.endsWith(m)))
      .filter((f) => /\bpointerWithin\b/.test(readFileSync(f, 'utf8')));

    expect(offenders).toEqual([]);
  });
});
