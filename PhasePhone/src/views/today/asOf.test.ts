import { describe, expect, it } from 'vitest';
import { asOfLabel } from './asOf';

const NOW = new Date(2026, 7, 25, 14, 30);

describe('asOfLabel', () => {
  it('says nothing when the canonical file is current', () => {
    const written = new Date(2026, 7, 25, 14, 25).toISOString();
    expect(asOfLabel(written, NOW)).toBeNull();
  });

  it('names the minute for a stamp from earlier today', () => {
    const written = new Date(2026, 7, 25, 9, 12).toISOString();
    expect(asOfLabel(written, NOW)).toMatch(/^as of /);
    expect(asOfLabel(written, NOW)).toContain('9');
  });

  it('names the DAY for a stamp from an earlier day', () => {
    const written = new Date(2026, 7, 23, 9, 12).toISOString();
    expect(asOfLabel(written, NOW)).toBe('as of Aug 23');
  });

  it('says nothing without a stamp, or with a stamp it cannot read', () => {
    expect(asOfLabel(null, NOW)).toBeNull();
    expect(asOfLabel('not a date', NOW)).toBeNull();
  });
});
