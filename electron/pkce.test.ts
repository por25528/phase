import { describe, it, expect } from 'vitest';
import { createHash, randomBytes as realRandomBytes } from 'node:crypto';
import { createPkce, base64url } from './pkce.cjs';

describe('base64url', () => {
  it('uses the URL-safe alphabet and strips padding', () => {
    // 0xfb 0xff encodes to "+/8=" in standard base64.
    const encoded = base64url(Buffer.from([0xfb, 0xff, 0xfe]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('round-trips through Node’s base64url decoder', () => {
    const bytes = Buffer.from([1, 2, 3, 250, 251, 255]);
    expect(Buffer.from(base64url(bytes), 'base64url')).toEqual(bytes);
  });
});

describe('createPkce', () => {
  it('derives the challenge as base64url(SHA-256(verifier))', () => {
    const { verifier, challenge } = createPkce();
    const expected = createHash('sha256').update(verifier).digest();
    expect(challenge).toBe(base64url(expected));
  });

  // S256 is what makes an intercepted code useless. A plain challenge — the
  // verifier echoed back — would pass a naive "challenge exists" assertion.
  it('does not send the verifier as the challenge', () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).not.toBe(verifier);
  });

  it('produces a verifier in the RFC 7636 length range', () => {
    const { verifier } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('produces URL-safe verifier, challenge and state', () => {
    const { verifier, challenge, state } = createPkce();
    for (const [name, value] of Object.entries({ verifier, challenge, state })) {
      expect(value, name).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('draws fresh randomness on every call', () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.state).not.toBe(b.state);
  });

  it('uses the injected randomness source', () => {
    const calls: number[] = [];
    const fake = (n: number) => { calls.push(n); return Buffer.alloc(n, 7); };
    const { verifier } = createPkce(fake);
    expect(calls.length).toBeGreaterThan(0);
    expect(verifier).toBe(base64url(Buffer.alloc(calls[0], 7)));
  });

  it('asks for at least 32 bytes of entropy for the verifier and 16 for the state', () => {
    const sizes: number[] = [];
    createPkce((n) => { sizes.push(n); return realRandomBytes(n); });
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(32);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
  });
});
