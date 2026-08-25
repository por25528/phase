import { describe, expect, it } from 'vitest';
import { SENDOFFS, sendoffFor } from './sendoff';

describe('sendoff quotes', () => {
  it('sources every quote, because misattribution is the default state of a quote', () => {
    for (const quote of SENDOFFS) {
      expect(quote.text.length).toBeGreaterThan(0);
      expect(quote.who.length).toBeGreaterThan(0);
      expect(quote.source.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a given moment, so a test can pin it', () => {
    expect(sendoffFor(1_700_000_000_000)).toEqual(sendoffFor(1_700_000_000_000));
  });

  it('varies across sessions', () => {
    const seen = new Set(
      Array.from({ length: SENDOFFS.length }, (_, i) => sendoffFor(i * 60_000).text),
    );
    expect(seen.size).toBe(SENDOFFS.length);
  });

  it('holds a real list rather than one line', () => {
    expect(SENDOFFS.length).toBeGreaterThanOrEqual(6);
  });
});
