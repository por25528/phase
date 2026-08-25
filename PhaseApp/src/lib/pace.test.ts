import { describe, expect, it } from 'vitest';
import { behindPaceHint, behindPaceLabel } from './pace';

describe('behind-pace wording', () => {
  it('reads as points, never as a percentage', () => {
    expect(behindPaceLabel(44)).toBe('44 pts behind pace');
    expect(behindPaceLabel(44)).not.toContain('%');
  });

  it('explains the arithmetic in the hint', () => {
    expect(behindPaceHint(33, 77)).toBe('33% done, 77% expected by today');
  });
});
