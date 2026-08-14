import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FOCUS_LEVEL, FOCUS_CAP, FOCUS_LEVELS, admits, fitsFocus, focusLevelFor,
  isCommitment, isFocusLevel, parseStoredFocusLevel, serializeFocusLevel,
} from './focusLens';
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
      if (fitsFocus('low', expected)) expect(fitsFocus('medium', expected)).toBe(true);
      if (fitsFocus('medium', expected)) expect(fitsFocus('high', expected)).toBe(true);
    }
  });

  it('caps low at 25 and medium at 60, and leaves high uncapped', () => {
    expect(FOCUS_CAP.low).toBe(25);
    expect(FOCUS_CAP.medium).toBe(60);
    expect(FOCUS_CAP.high).toBe(Infinity);
  });
});

describe('fitsFocus', () => {
  it('judges a history range on its HIGH end, never its low one', () => {
    // "probably 20 to 45 minutes" does not claim to fit half an hour.
    expect(fitsFocus('low', history(10, 45))).toBe(false);
    expect(fitsFocus('medium', history(10, 45))).toBe(true);
  });

  it('takes a planned estimate at face value', () => {
    expect(fitsFocus('low', estimate(20))).toBe(true);
    expect(fitsFocus('low', estimate(26))).toBe(false);
  });

  it('refuses a starter at low, because unknown length is not short', () => {
    expect(fitsFocus('low', starter)).toBe(false);
  });

  it('admits a starter at medium and high, where the cap is not tight', () => {
    expect(fitsFocus('medium', starter)).toBe(true);
    expect(fitsFocus('high', starter)).toBe(true);
  });

  it('admits everything at high, including work no cap could hold', () => {
    expect(fitsFocus('high', history(120, 150))).toBe(true);
    expect(fitsFocus('high', estimate(600))).toBe(true);
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

describe('focusLevelFor', () => {
  it('holds the level within the day it was set', () => {
    expect(focusLevelFor({ level: 'low', date: '2026-08-14' }, '2026-08-14')).toBe('low');
  });

  it('resets to medium once the date has turned over', () => {
    expect(focusLevelFor({ level: 'low', date: '2026-08-13' }, '2026-08-14')).toBe('medium');
    expect(DEFAULT_FOCUS_LEVEL).toBe('medium');
  });

  it('reads nothing stored as the default rather than throwing', () => {
    expect(focusLevelFor(null, '2026-08-14')).toBe('medium');
  });
});

describe('parseStoredFocusLevel', () => {
  it('round-trips what serializeFocusLevel wrote', () => {
    const stored = { level: 'high' as const, date: '2026-08-14' };
    expect(parseStoredFocusLevel(serializeFocusLevel(stored))).toEqual(stored);
  });

  it('is total: every malformed shape reads as null, never as an exception', () => {
    expect(parseStoredFocusLevel(undefined)).toBeNull();
    expect(parseStoredFocusLevel('')).toBeNull();
    expect(parseStoredFocusLevel('{oops')).toBeNull();
    expect(parseStoredFocusLevel(JSON.stringify({ level: 'sideways', date: '2026-08-14' }))).toBeNull();
    expect(parseStoredFocusLevel(JSON.stringify({ level: 'low', date: 'yesterday' }))).toBeNull();
    expect(parseStoredFocusLevel(JSON.stringify({ level: 'low' }))).toBeNull();
    expect(parseStoredFocusLevel(42)).toBeNull();
  });
});

describe('isFocusLevel', () => {
  it('accepts exactly the three levels', () => {
    expect(FOCUS_LEVELS.every(isFocusLevel)).toBe(true);
    expect(isFocusLevel('none')).toBe(false);
    expect(isFocusLevel(2)).toBe(false);
  });
});
