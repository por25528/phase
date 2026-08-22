import { describe, expect, it } from 'vitest';
import {
  CARDS_ABREAST_MAX, CARD_GAP_PX, CARD_MAX_PX,
  COLUMN_FLOOR_PX, COLUMN_GAP_PX, EMPTY_TRACK_PX, columnTracks,
} from './boardTracks';

const still = { dragging: false };

describe('columnTracks', () => {
  it('gives an empty column a fixed slim track', () => {
    expect(columnTracks([0, 0, 0, 5], still))
      .toBe('88px 88px 88px minmax(200px, 742px) minmax(0, 1fr)');
  });

  it('weights populated columns by their card count', () => {
    expect(columnTracks([2, 1, 0, 2], still))
      .toBe('minmax(200px, 491px) minmax(200px, 240px) 88px minmax(200px, 491px) minmax(0, 1fr)');
  });

  /*
   * The bug this file's cap exists to close.
   *
   * `{n}fr` took every leftover pixel, so the one populated column of a sparse
   * board claimed ~714px of 1100 and then drew a single 188px card in it. A
   * track now stops at what one, two or three cards abreast can fill, and the
   * remainder goes to ONE trailing spacer — never to a column that would leave
   * it empty.
   */
  it('caps a populated track at what its cards can actually draw', () => {
    expect(columnTracks([1, 0, 0, 0], still))
      .toBe('minmax(200px, 240px) 88px 88px 88px minmax(0, 1fr)');
  });

  it('stops widening the cap past three cards abreast', () => {
    const three = columnTracks([CARDS_ABREAST_MAX, 0, 0, 0], still);
    expect(columnTracks([CARDS_ABREAST_MAX + 4, 0, 0, 0], still)).toBe(three);
  });

  it('builds the cap out of card widths and the gaps between them', () => {
    const cap = CARDS_ABREAST_MAX * CARD_MAX_PX + (CARDS_ABREAST_MAX - 1) * CARD_GAP_PX;
    expect(columnTracks([9, 0, 0, 0], still)).toContain(`minmax(200px, ${cap}px)`);
  });

  /*
   * The spacer is a track, and the board renders a child for it — but only at
   * rest. A fifth child against the dragging branch's four equal tracks would
   * fall into an implicit second row, which is why `Goals.tsx` gates it on
   * `activeId === null` and why this asserts the dragging branch emits none.
   */
  it('emits one trailing spacer at rest and none mid-drag', () => {
    expect(columnTracks([2, 1, 0, 2], still).split(' minmax(0, 1fr)')).toHaveLength(2);
    expect(columnTracks([2, 1, 0, 2], { dragging: true }).split(/\s(?=minmax)/)).toHaveLength(4);
  });

  it('equalises every column while something is in the air', () => {
    expect(columnTracks([0, 0, 0, 5], { dragging: true }))
      .toBe('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)');
    expect(columnTracks([2, 1, 0, 2], { dragging: true }))
      .toBe(columnTracks([0, 0, 0, 0], { dragging: true }));
  });

  it('handles an all-empty board without collapsing it', () => {
    expect(columnTracks([0, 0, 0, 0], still)).toBe('88px 88px 88px 88px minmax(0, 1fr)');
  });

  /*
   * The floor is the whole reason a one-card column is not crushed beside a
   * five-card one, so it is worth pinning that four of them still fit the
   * breakpoint where the wide board begins.
   */
  it('fits four populated columns inside the 920px wide-board breakpoint', () => {
    const width = 4 * COLUMN_FLOOR_PX + 3 * COLUMN_GAP_PX;
    expect(width).toBeLessThanOrEqual(920);
  });

  /*
   * The cap is a `minmax` MAX, never a fixed width, so a track still shrinks
   * when the board cannot afford it: grid sizes such a track at its min and
   * only then grows it into free space. Four populated columns at the
   * breakpoint therefore land above the floor and under the cap rather than
   * overflowing the page.
   */
  it('leaves a capped track room to shrink back to the floor', () => {
    const cap = CARD_MAX_PX + 0 * CARD_GAP_PX;
    expect(cap).toBeGreaterThan(COLUMN_FLOOR_PX);
    expect(4 * COLUMN_FLOOR_PX + 3 * COLUMN_GAP_PX).toBeLessThanOrEqual(920);
  });

  it('keeps the slim track wide enough for the longest horizon label', () => {
    // 'Someday' at text-ui plus its count and the column's own padding.
    expect(EMPTY_TRACK_PX).toBeGreaterThanOrEqual(88);
  });
});
