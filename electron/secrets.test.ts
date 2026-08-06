import { describe, it, expect } from 'vitest';
import { createSecretStore, CorruptSecretStoreError, type SecretStoreDeps } from './secrets.cjs';

/**
 * A fake `safeStorage` + file. `encrypt` reverses the string so a test can
 * tell "was this actually encrypted?" apart from "was it written in the
 * clear?" — a store that silently skipped encryption would otherwise pass
 * every round-trip assertion.
 */
function fakeDeps(overrides: Partial<SecretStoreDeps> = {}) {
  const state: { file: Buffer | null } = { file: null };
  const rev = (s: string) => [...s].reverse().join('');
  const deps: SecretStoreDeps = {
    readFile: () => state.file,
    writeFile: (bytes) => { state.file = bytes; },
    removeFile: () => { state.file = null; },
    encrypt: (plain) => Buffer.from(rev(plain), 'utf8'),
    decrypt: (bytes) => rev(bytes.toString('utf8')),
    isEncryptionAvailable: () => true,
    ...overrides,
  };
  return { deps, state };
}

describe('createSecretStore', () => {
  it('reports nothing before anything is written', () => {
    const { deps } = fakeDeps();
    expect(createSecretStore(deps).get('client')).toBeUndefined();
  });

  it('round-trips a structured value', () => {
    const { deps } = fakeDeps();
    const store = createSecretStore(deps);
    store.set('client', { clientId: 'abc.apps.googleusercontent.com', clientSecret: 's3cret' });
    expect(store.get('client')).toEqual({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 's3cret' });
  });

  it('keeps separate keys separate', () => {
    const { deps } = fakeDeps();
    const store = createSecretStore(deps);
    store.set('client', { clientId: 'a' });
    store.set('token', { refreshToken: 'r' });
    expect(store.get('client')).toEqual({ clientId: 'a' });
    expect(store.get('token')).toEqual({ refreshToken: 'r' });
  });

  // The whole point of the module. Plaintext on disk would pass every
  // round-trip test above.
  it('never writes a secret in the clear', () => {
    const { deps, state } = fakeDeps();
    createSecretStore(deps).set('token', { refreshToken: 'SUPERSECRET' });
    expect(state.file).not.toBeNull();
    expect(state.file!.toString('utf8')).not.toContain('SUPERSECRET');
  });

  it('removes one key without disturbing the others', () => {
    const { deps } = fakeDeps();
    const store = createSecretStore(deps);
    store.set('client', { clientId: 'a' });
    store.set('token', { refreshToken: 'r' });
    store.remove('token');
    expect(store.get('token')).toBeUndefined();
    expect(store.get('client')).toEqual({ clientId: 'a' });
  });

  it('reset deletes the file outright', () => {
    const { deps, state } = fakeDeps();
    const store = createSecretStore(deps);
    store.set('client', { clientId: 'a' });
    store.reset();
    expect(state.file).toBeNull();
    expect(store.get('client')).toBeUndefined();
  });

  it('reports whether the OS can encrypt at all', () => {
    expect(createSecretStore(fakeDeps().deps).available()).toBe(true);
    expect(createSecretStore(fakeDeps({ isEncryptionAvailable: () => false }).deps).available()).toBe(false);
  });

  it('refuses to write when the OS cannot encrypt', () => {
    const { deps, state } = fakeDeps({ isEncryptionAvailable: () => false });
    expect(() => createSecretStore(deps).set('client', { clientId: 'a' })).toThrow(/encryption/i);
    expect(state.file).toBeNull();
  });

  // An undecryptable blob can never become readable — a Keychain reset, a
  // restore onto a different machine. Throwing a NAMED error lets the caller
  // offer a reset instead of the app failing at boot with a parse error.
  it('throws a typed error when the stored blob cannot be decrypted', () => {
    const { deps } = fakeDeps({ decrypt: () => { throw new Error('bad key'); } });
    deps.writeFile(Buffer.from('whatever'));
    expect(() => createSecretStore(deps).get('client')).toThrow(CorruptSecretStoreError);
  });

  it('throws the same typed error when the decrypted text is not JSON', () => {
    const { deps } = fakeDeps({ decrypt: () => 'not json at all' });
    deps.writeFile(Buffer.from('whatever'));
    expect(() => createSecretStore(deps).get('client')).toThrow(CorruptSecretStoreError);
  });

  // Recovery path: reset must work even when the store cannot be read.
  it('can reset a corrupt store', () => {
    const { deps, state } = fakeDeps({ decrypt: () => { throw new Error('bad key'); } });
    deps.writeFile(Buffer.from('whatever'));
    const store = createSecretStore(deps);
    store.reset();
    expect(state.file).toBeNull();
    expect(store.get('client')).toBeUndefined();
  });

  it('re-reads the file each time rather than caching a stale copy', () => {
    const { deps } = fakeDeps();
    const a = createSecretStore(deps);
    const b = createSecretStore(deps);
    a.set('client', { clientId: 'written-by-a' });
    expect(b.get('client')).toEqual({ clientId: 'written-by-a' });
  });
});
