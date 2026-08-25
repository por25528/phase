import { describe, expect, it } from 'vitest';
import { ringState } from './sessionRing';

const HISTORY = { kind: 'history' as const, lowMin: 45, highMin: 60, confidence: 'medium' as const, sampleCount: 3 };
const ESTIMATE = { kind: 'estimate' as const, minutes: 30 };
const STARTER = { kind: 'starter' as const, minutes: 30 as const };

describe('ringState', () => {
  it('fills a history range against its HIGH end, the rule fitsWindow already uses', () => {
    expect(ringState(HISTORY, 30, 'medium')).toEqual({ kind: 'fill', fraction: 0.5, overflow: 0 });
  });

  it('fills an estimate against the number you typed', () => {
    expect(ringState(ESTIMATE, 15, 'medium')).toEqual({ kind: 'fill', fraction: 0.5, overflow: 0 });
  });

  it('completes and reports the overflow rather than stopping at full', () => {
    expect(ringState(ESTIMATE, 38, 'medium')).toEqual({
      kind: 'fill', fraction: 1, overflow: (38 - 30) / 30,
    });
  });

  it('never fills against a starter — a guess drawn as a target is a countdown', () => {
    expect(ringState(STARTER, 15, 'medium')).toEqual({ kind: 'turn' });
    expect(ringState(STARTER, 999, 'high')).toEqual({ kind: 'turn' });
  });

  it('turns at the lowest focus, because the text withholds the comparison there', () => {
    expect(ringState(ESTIMATE, 15, 'low')).toEqual({ kind: 'turn' });
    expect(ringState(HISTORY, 15, 'low')).toEqual({ kind: 'turn' });
  });

  it('caps overflow so a session left running overnight cannot draw a ring of any size', () => {
    const state = ringState(ESTIMATE, 60 * 24, 'medium');
    expect(state).toEqual({ kind: 'fill', fraction: 1, overflow: 1 });
  });

  it('is empty at zero rather than undefined', () => {
    expect(ringState(ESTIMATE, 0, 'medium')).toEqual({ kind: 'fill', fraction: 0, overflow: 0 });
  });
});
