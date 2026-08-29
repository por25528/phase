import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { API_KEY_BASE64_ENV, decodeApiKey, writeApiKey } =
  nativeRequire('./appleApiKey.cjs') as typeof import('./appleApiKey.cjs');

/** A real P-256 PKCS#8 key — the shape App Store Connect hands out as .p8. */
const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const PEM = privateKey as unknown as string;
const BASE64 = Buffer.from(PEM, 'utf8').toString('base64');

const made: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'phase-apikey-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe('decodeApiKey', () => {
  it('returns the key material for a well-formed secret', () => {
    expect(decodeApiKey(BASE64).toString('utf8')).toBe(PEM);
  });

  it('tolerates the line wrapping `base64 -i` and a pasted secret introduce', () => {
    const wrapped = (BASE64.match(/.{1,64}/g) ?? []).join('\n') + '\n';
    expect(decodeApiKey(wrapped).toString('utf8')).toBe(PEM);
  });

  it('refuses a secret that is not base64 at all', () => {
    expect(() => decodeApiKey('not base64 !!!')).toThrow(/not valid base64/i);
  });

  it('refuses base64 that decodes to something other than a PKCS#8 key', () => {
    const notAKey = Buffer.from('the wrong file entirely', 'utf8').toString('base64');
    expect(() => decodeApiKey(notAKey)).toThrow(/BEGIN PRIVATE KEY/);
  });

  it('refuses an empty secret', () => {
    expect(() => decodeApiKey('')).toThrow(new RegExp(API_KEY_BASE64_ENV));
  });

  it('names the variable and never the material, on every failure', () => {
    const secret = Buffer.from('a-secret-that-must-not-leak', 'utf8').toString('base64');
    // The empty secret is checked separately: `not.toContain('')` is vacuous,
    // and an empty secret has no material to leak in the first place.
    for (const input of ['not base64 !!!', secret]) {
      let message = '';
      try {
        decodeApiKey(input);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain(API_KEY_BASE64_ENV);
      expect(message).not.toContain(input);
      expect(message).not.toContain('a-secret-that-must-not-leak');
    }
  });

  it('never puts the key material in the message when the key IS well-formed but rejected later', () => {
    // A trailing byte makes the base64 malformed while the payload is real.
    let message = '';
    try {
      decodeApiKey(`${BASE64}%`);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain('BEGIN PRIVATE KEY-----\nM');
    expect(message).not.toContain(BASE64.slice(0, 32));
  });
});

describe('writeApiKey', () => {
  it('writes the decoded key, readable by nobody else', () => {
    const dest = path.join(scratch(), 'apple-api-key.p8');
    writeApiKey(BASE64, dest);
    expect(readFileSync(dest, 'utf8')).toBe(PEM);
    expect(statSync(dest).mode & 0o777).toBe(0o600);
  });

  it('writes nothing at all when the secret is malformed', () => {
    const dest = path.join(scratch(), 'apple-api-key.p8');
    expect(() => writeApiKey('not base64 !!!', dest)).toThrow(/not valid base64/i);
    expect(existsSync(dest)).toBe(false);
  });

  it('returns the path it wrote, so a caller need not rebuild it', () => {
    const dest = path.join(scratch(), 'apple-api-key.p8');
    expect(writeApiKey(BASE64, dest)).toBe(dest);
  });
});
