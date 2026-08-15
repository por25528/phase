import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIME_LEVEL, TIME_CAP, TIME_LEVELS, TIME_WORD, admits, fitsWindow, timeLevelFor,
  isCommitment, isTimeLevel, parseStoredTimeLevel, serializeTimeLevel,
} from './timeLens';
import type { AdviceReason } from './executionAdvisor';
import type { ExpectedTime } from './expectedTime';

const history = (lowMin: number, highMin: number): ExpectedTime =>
  ({ kind: 'history', lowMin, highMin, confidence: 'medium', sampleCount: 2 });
const estimate = (minutes: number): ExpectedTime => ({ kind: 'estimate', minutes });
const starter: ExpectedTime = { kind: 'starter', minutes: 30 };

describe('the caps', () => {
  it('are monotone: every level admits what the level below it admits', () => {
    const samples: ExpectedTime[] = [
      history(5, 12), history(40, 50), history(120, 150), estimate(20), estimate(90), starter,
    ];
    for (const expected of samples) {
      if (fitsWindow('low', expected)) expect(fitsWindow('medium', expected)).toBe(true);
      if (fitsWindow('medium', expected)) expect(fitsWindow('high', expected)).toBe(true);
    }
  });

  it('caps low at 30 and medium at 60, and leaves high uncapped', () => {
    expect(TIME_CAP.low).toBe(30);
    expect(TIME_CAP.medium).toBe(60);
    expect(TIME_CAP.high).toBe(Infinity);
  });
});

describe('fitsWindow', () => {
  it('judges a history range on its HIGH end, never its low one', () => {
    // "probably 20 to 45 minutes" does not claim to fit half an hour.
    expect(fitsWindow('low', history(10, 45))).toBe(false);
    expect(fitsWindow('medium', history(10, 45))).toBe(true);
  });

  it('takes a planned estimate at face value', () => {
    expect(fitsWindow('low', estimate(20))).toBe(true);
    expect(fitsWindow('low', estimate(31))).toBe(false);
  });

  it('refuses a starter at low, because unknown length is not short', () => {
    expect(fitsWindow('low', starter)).toBe(false);
  });

  it('admits a starter at medium and high, where the cap is not tight', () => {
    expect(fitsWindow('medium', starter)).toBe(true);
    expect(fitsWindow('high', starter)).toBe(true);
  });

  it('admits everything at high, including work no cap could hold', () => {
    expect(fitsWindow('high', history(120, 150))).toBe(true);
    expect(fitsWindow('high', estimate(600))).toBe(true);
  });
});

describe('isCommitment', () => {
  it('names every reason exhaustively, so a new one cannot default silently', () => {
    const all: AdviceReason[] = [
      'scheduled-now', 'scheduled-next', 'due', 'committed-today',
      'committed-week', 'carried-over', 'free-time',
    ];
    expect(all.filter(isCommitment)).toEqual([
      'scheduled-now', 'scheduled-next', 'due', 'committed-today',
    ]);
  });
});

describe('admits', () => {
  it('never filters a fact about today, however long it is', () => {
    expect(admits('low', 'scheduled-now', estimate(90))).toBe(true);
    expect(admits('low', 'due', history(120, 150))).toBe(true);
  });

  it('does filter the discretionary tail', () => {
    expect(admits('low', 'free-time', estimate(90))).toBe(false);
    expect(admits('low', 'carried-over', history(120, 150))).toBe(false);
    expect(admits('low', 'committed-week', estimate(45))).toBe(false);
  });

  it('lets short discretionary work through at low', () => {
    expect(admits('low', 'free-time', history(8, 12))).toBe(true);
  });
});

describe('timeLevelFor', () => {
  it('holds the level within the day it was set', () => {
    expect(timeLevelFor({ level: 'low', date: '2026-08-14' }, '2026-08-14')).toBe('low');
  });

  it('resets to medium once the date has turned over', () => {
    expect(timeLevelFor({ level: 'low', date: '2026-08-13' }, '2026-08-14')).toBe('medium');
    expect(DEFAULT_TIME_LEVEL).toBe('medium');
  });

  it('reads nothing stored as the default rather than throwing', () => {
    expect(timeLevelFor(null, '2026-08-14')).toBe('medium');
  });
});

describe('parseStoredTimeLevel', () => {
  it('round-trips what serializeTimeLevel wrote', () => {
    const stored = { level: 'high' as const, date: '2026-08-14' };
    expect(parseStoredTimeLevel(serializeTimeLevel(stored))).toEqual(stored);
  });

  it('is total: every malformed shape reads as null, never as an exception', () => {
    expect(parseStoredTimeLevel(undefined)).toBeNull();
    expect(parseStoredTimeLevel('')).toBeNull();
    expect(parseStoredTimeLevel('{oops')).toBeNull();
    expect(parseStoredTimeLevel(JSON.stringify({ level: 'sideways', date: '2026-08-14' }))).toBeNull();
    expect(parseStoredTimeLevel(JSON.stringify({ level: 'low', date: 'yesterday' }))).toBeNull();
    expect(parseStoredTimeLevel(JSON.stringify({ level: 'low' }))).toBeNull();
    expect(parseStoredTimeLevel(42)).toBeNull();
  });
});

describe('isTimeLevel', () => {
  it('accepts exactly the three levels', () => {
    expect(TIME_LEVELS.every(isTimeLevel)).toBe(true);
    expect(isTimeLevel('none')).toBe(false);
    expect(isTimeLevel(2)).toBe(false);
  });
});

describe('the dial says what it filters', () => {
  it('caps the narrowest level at the round number its chip shows', () => {
    expect(TIME_CAP.low).toBe(30);
    expect(TIME_WORD.low).toBe('30m');
  });

  it('admits a 30-minute estimate at the narrowest level', () => {
    expect(fitsWindow('low', estimate(30))).toBe(true);
  });

  it('still refuses a starter at the narrowest level, as a rule and not arithmetic', () => {
    expect(fitsWindow('low', starter)).toBe(false);
  });

  it('still judges a history range on its high end', () => {
    expect(fitsWindow('low', history(10, 45))).toBe(false);
    expect(fitsWindow('low', history(10, 30))).toBe(true);
  });
});
