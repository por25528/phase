import { describe, expect, it } from 'vitest';
import {
  COLUMN_FLOOR_PX, COLUMN_GAP_PX, EMPTY_TRACK_PX, columnTracks,
} from './boardTracks';

const still = { dragging: false };

describe('columnTracks', () => {
  it('gives an empty column a fixed slim track', () => {
    expect(columnTracks([0, 0, 0, 5], still))
      .toBe('88px 88px 88px minmax(200px, 5fr)');
  });

  it('weights populated columns by their card count', () => {
    expect(columnTracks([2, 1, 0, 2], still))
      .toBe('minmax(200px, 2fr) minmax(200px, 1fr) 88px minmax(200px, 2fr)');
  });

  it('equalises every column while something is in the air', () => {
    expect(columnTracks([0, 0, 0, 5], { dragging: true }))
      .toBe('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)');
    expect(columnTracks([2, 1, 0, 2], { dragging: true }))
      .toBe(columnTracks([0, 0, 0, 0], { dragging: true }));
  });

  it('handles an all-empty board without collapsing it', () => {
    expect(columnTracks([0, 0, 0, 0], still)).toBe('88px 88px 88px 88px');
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

  it('keeps the slim track wide enough for the longest horizon label', () => {
    // 'Someday' at text-ui plus its count and the column's own padding.
    expect(EMPTY_TRACK_PX).toBeGreaterThanOrEqual(88);
  });
});
