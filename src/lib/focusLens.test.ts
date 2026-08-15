import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FOCUS_LEVEL, FOCUS_LEVELS, FOCUS_WORD, admitsDemand, admitsWork,
  focusLevelFor, isFocusLevel, parseStoredFocusLevel, serializeFocusLevel,
} from './focusLens';
import type { ResolvedDemand } from './demand';
import type { AdviceReason } from './executionAdvisor';

const own = (level: ResolvedDemand['level']): ResolvedDemand => ({ level, source: 'own' });

describe('the caps', () => {
  it('are monotone: every level admits what the level below admits', () => {
    const samples = [own('light'), own('moderate'), own('deep'), undefined];
    for (const d of samples) {
      if (admitsDemand('low', d)) expect(admitsDemand('medium', d)).toBe(true);
      if (admitsDemand('medium', d)) expect(admitsDemand('high', d)).toBe(true);
    }
  });

  it('lets Low take light only', () => {
    expect(admitsDemand('low', own('light'))).toBe(true);
    expect(admitsDemand('low', own('moderate'))).toBe(false);
    expect(admitsDemand('low', own('deep'))).toBe(false);
  });

  it('lets High take everything', () => {
    for (const d of [own('light'), own('moderate'), own('deep')]) {
      expect(admitsDemand('high', d)).toBe(true);
    }
  });
});

describe('an untagged item', () => {
  it('is admitted at EVERY level — absence is no claim, not a guess', () => {
    for (const level of FOCUS_LEVELS) expect(admitsDemand(level, undefined)).toBe(true);
  });
});

describe('admitsWork', () => {
  const commitments: AdviceReason[] = ['scheduled-now', 'scheduled-next', 'due', 'committed-today'];

  it('never filters a fact about today, however deep', () => {
    for (const reason of commitments) {
      expect(admitsWork('low', reason, own('deep'))).toBe(true);
    }
  });

  it('does filter discretionary work', () => {
    expect(admitsWork('low', 'free-time', own('deep'))).toBe(false);
    expect(admitsWork('low', 'free-time', own('light'))).toBe(true);
  });
});

describe('the stored form', () => {
  it('round-trips', () => {
    const stored = { level: 'low' as const, date: '2026-08-15' };
    expect(parseStoredFocusLevel(serializeFocusLevel(stored))).toEqual(stored);
  });

  it('is total: junk reads as nothing stored', () => {
    for (const raw of ['', '{', '{}', '{"level":"nope","date":"2026-08-15"}',
      '{"level":"low","date":"nope"}', null, 7]) {
      expect(parseStoredFocusLevel(raw)).toBeNull();
    }
  });
});

describe('focusLevelFor', () => {
  it('keeps what was set today', () => {
    expect(focusLevelFor({ level: 'low', date: '2026-08-15' }, '2026-08-15')).toBe('low');
  });

  it('resets to the default on a new day, without anything running at midnight', () => {
    expect(focusLevelFor({ level: 'low', date: '2026-08-14' }, '2026-08-15')).toBe(DEFAULT_FOCUS_LEVEL);
    expect(focusLevelFor(null, '2026-08-15')).toBe(DEFAULT_FOCUS_LEVEL);
  });
});

describe('isFocusLevel', () => {
  it('is total', () => {
    expect(isFocusLevel('low')).toBe(true);
    for (const raw of ['Low', 'light', '', null, 2, {}]) expect(isFocusLevel(raw)).toBe(false);
  });
});

describe('the words', () => {
  it('are the dial\'s words, not the tag\'s', () => {
    expect(FOCUS_LEVELS.map((l) => FOCUS_WORD[l])).toEqual(['Low', 'Medium', 'High']);
  });
});
