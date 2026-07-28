import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AVAILABILITY, parseAvailability, windowForDate, serializeAvailability,
} from './availability';

describe('parseAvailability', () => {
  const good = [{ dow: 0, startMin: 540, endMin: 1080 }];

  it('accepts a valid list', () => {
    expect(parseAvailability(good)).toEqual(good);
  });

  it('accepts a JSON string', () => {
    expect(parseAvailability(JSON.stringify(good))).toEqual(good);
  });

  it.each([
    ['not an array', { dow: 0, startMin: 0, endMin: 60 }],
    ['malformed JSON', '{nope'],
    ['duplicate dow', [{ dow: 0, startMin: 0, endMin: 60 }, { dow: 0, startMin: 120, endMin: 180 }]],
    ['non-integer dow', [{ dow: 1.5, startMin: 0, endMin: 60 }]],
    ['dow below range', [{ dow: -1, startMin: 0, endMin: 60 }]],
    ['dow above range', [{ dow: 7, startMin: 0, endMin: 60 }]],
    ['startMin equals endMin', [{ dow: 0, startMin: 60, endMin: 60 }]],
    ['startMin after endMin', [{ dow: 0, startMin: 120, endMin: 60 }]],
    ['negative startMin', [{ dow: 0, startMin: -1, endMin: 60 }]],
    ['endMin over 1440', [{ dow: 0, startMin: 0, endMin: 1441 }]],
    ['non-integer minutes', [{ dow: 0, startMin: 0.5, endMin: 60 }]],
    ['missing field', [{ dow: 0, startMin: 0 }]],
    ['null', null],
  ])('falls back to the default on %s', (_label, input) => {
    expect(parseAvailability(input)).toEqual(DEFAULT_AVAILABILITY);
  });

  it('round-trips through serializeAvailability', () => {
    expect(parseAvailability(serializeAvailability(good))).toEqual(good);
  });
});

describe('windowForDate', () => {
  // 2026-07-27 is a Monday.
  it('finds Monday as dow 0', () => {
    expect(windowForDate('2026-07-27', DEFAULT_AVAILABILITY))
      .toEqual({ dow: 0, startMin: 540, endMin: 1080 });
  });

  it('finds Friday as dow 4', () => {
    expect(windowForDate('2026-07-31', DEFAULT_AVAILABILITY)?.dow).toBe(4);
  });

  it('returns null for a day off (Saturday)', () => {
    expect(windowForDate('2026-08-01', DEFAULT_AVAILABILITY)).toBeNull();
  });

  it('returns null for Sunday', () => {
    expect(windowForDate('2026-08-02', DEFAULT_AVAILABILITY)).toBeNull();
  });
});
