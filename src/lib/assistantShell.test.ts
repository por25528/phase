import { describe, it, expect } from 'vitest';
import { shelfSizing } from './assistantShell';

describe('shelfSizing', () => {
  it('hugs on macOS, where the window behind the card is transparent', () => {
    expect(shelfSizing('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('hug');
  });

  it('fills everywhere else, where the window paints a background', () => {
    expect(shelfSizing('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('fill');
    expect(shelfSizing('Mozilla/5.0 (X11; Linux x86_64)')).toBe('fill');
  });

  it('fills when it cannot tell, because a painted notch is worse than dead space', () => {
    expect(shelfSizing('')).toBe('fill');
  });
});
