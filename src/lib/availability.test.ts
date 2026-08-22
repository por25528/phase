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

/*
 * The default covers all seven days, 08:00–20:00.
 *
 * Seven days because a planner is installed ON a Saturday as often as any
 * other day — that is exactly when people decide to get organised — and a
 * default that excluded the weekend met that person with "No time left today"
 * and an empty Today. Nothing on first run asks, so the default has to be the
 * one that can help on the day it is met. A user who wants their weekends back
 * sets working hours in Settings; the reverse — a weekday-only default
 * silently hiding Saturday — cannot be discovered at all.
 *
 * 08:00–20:00 rather than 09:00–18:00 because these windows stopped being a
 * GATE. As a gate, narrow was safe: it only refused, and a refusal is visible
 * and fixable. As the denominator behind every capacity figure in the app it
 * is a claim about the person, and 63 hours a week is a claim that calls an
 * ordinary evening's work over-committed.
 */
describe('DEFAULT_AVAILABILITY', () => {
  it('covers all seven days, 08:00–20:00', () => {
    expect(DEFAULT_AVAILABILITY).toEqual([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, startMin: 480, endMin: 1200 })));
  });
});

describe('windowForDate', () => {
  // 2026-07-27 is a Monday.
  it('finds Monday as dow 0', () => {
    expect(windowForDate('2026-07-27', DEFAULT_AVAILABILITY))
      .toEqual({ dow: 0, startMin: 480, endMin: 1200 });
  });

  it('finds Friday as dow 4', () => {
    expect(windowForDate('2026-07-31', DEFAULT_AVAILABILITY)?.dow).toBe(4);
  });

  it('now finds Saturday (dow 5) and Sunday (dow 6) in the default', () => {
    expect(windowForDate('2026-08-01', DEFAULT_AVAILABILITY)?.dow).toBe(5);
    expect(windowForDate('2026-08-02', DEFAULT_AVAILABILITY)?.dow).toBe(6);
  });

  it('returns null for a day the window set genuinely omits', () => {
    // A user who kept a weekday-only week: no dow 5 window, so Saturday is off.
    const weekdays = DEFAULT_AVAILABILITY.filter((w) => w.dow <= 4);
    expect(windowForDate('2026-08-01', weekdays)).toBeNull();
  });
});
