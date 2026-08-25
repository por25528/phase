// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockGhost } from './BlockGhost';
import { FOOTER_BLOCK_PX } from './blockChrome';

/**
 * The ghost prints ONE readout, and the footer threshold only decides what it
 * sits in.
 *
 * The two heights used to carry their own copy of the children, so a change to
 * what the ghost says could land at one height and not the other — the drift
 * `blockChrome` was written to keep out from between the three block surfaces,
 * reappearing inside one of them. These tests read both heights and compare.
 */

afterEach(() => cleanup());

/** `PX_PER_MINUTE` is 1, so minutes ARE the height. */
const TALL = FOOTER_BLOCK_PX + 30;
const SHORT = FOOTER_BLOCK_PX - 10;

function ghost(durationMin: number, startMin: number | null) {
  const { container } = render(createElement(BlockGhost, {
    title: 'Draft the literature review', durationMin, goalId: 'g1', startMin,
  }));
  return container.firstElementChild as HTMLElement;
}

/** The last child of the flex column — the wrapper holding the time. */
function timeCell(root: HTMLElement): HTMLElement {
  const col = root.querySelector('.flex-col') as HTMLElement;
  expect(col).toBeTruthy();
  return col.lastElementChild as HTMLElement;
}

describe('BlockGhost — one readout at both heights', () => {
  /*
   * Duration drives the HEIGHT as well as the label, so the two heights cannot
   * print the same string. What they must share is the drawing: the same
   * component, dressed the same way, under a different wrapper.
   */
  it('renders the same span readout above and below the footer rule', () => {
    const tall = timeCell(ghost(TALL, 9 * 60));
    const short = timeCell(ghost(SHORT, 9 * 60));
    // `BlockTime` — both forms rendered, CSS picks one by container width.
    for (const cell of [tall, short]) {
      expect(cell.querySelector('.blk-span')).toBeTruthy();
      expect(cell.querySelector('.blk-start')).toBeTruthy();
    }
    expect(tall.firstElementChild!.className).toBe(short.firstElementChild!.className);
    expect(tall.textContent).toContain('9am');
  });

  it('renders the same length readout at both heights when the drop has nowhere to land', () => {
    const tall = timeCell(ghost(TALL, null));
    const short = timeCell(ghost(SHORT, null));
    // No resolved time, so no span form at either height — the length alone.
    for (const cell of [tall, short]) {
      expect(cell.querySelector('.blk-span')).toBeNull();
      expect(cell.children).toHaveLength(1);
    }
    expect(tall.firstElementChild!.className).toBe(short.firstElementChild!.className);
    expect(tall.textContent).toBe('1h 26m');
    expect(short.textContent).toBe('46m');
  });

  it('draws the footer rule only above the threshold, which is the whole difference', () => {
    expect(timeCell(ghost(TALL, 9 * 60)).className).toContain('border-t');
    expect(timeCell(ghost(SHORT, 9 * 60)).className).toBe('flex-none');
  });

  /*
   * `overflow`/`text-overflow` do not apply to an inline box, so a bare
   * `<span class="truncate">` truncates nothing. Under the footer rule the
   * parent is a flex container and blockifies it; under `flex-none` nothing
   * does, and a long time ran to the block's edge to be hard-clipped with no
   * ellipsis. Both spans carry `block` for that reason — the shared one inside
   * `BlockTime`, and the length-only one here.
   */
  it('gives the time a block box, so truncate has something to cut', () => {
    for (const [duration, start] of [[TALL, 9 * 60], [SHORT, 9 * 60], [TALL, null], [SHORT, null]] as const) {
      const span = timeCell(ghost(duration, start)).querySelector('span') as HTMLElement;
      expect(span.className).toContain('block');
      expect(span.className).toContain('truncate');
    }
  });
});
