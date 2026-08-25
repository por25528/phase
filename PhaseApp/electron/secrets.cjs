// Encrypted key/value persistence for the main process.
//
// One file holds one JSON object, encrypted as a whole. Every dependency is
// injected, so this is fully testable with no filesystem and no Electron; see
// secrets.test.ts. Contract in secrets.d.cts.

class CorruptSecretStoreError extends Error {
  constructor(cause) {
    super('The stored credentials could not be read. Reset and reconnect.');
    this.name = 'CorruptSecretStoreError';
    this.cause = cause;
  }
}

function createSecretStore(deps) {
  const { readFile, writeFile, removeFile, encrypt, decrypt, isEncryptionAvailable } = deps;

  // Read on every call rather than caching. The store is tiny, and a cache
  // would let two store instances — or a reset — leave a stale copy live.
  function readAll() {
    const raw = readFile();
    if (!raw) return {};
    let text;
    try {
      text = decrypt(raw);
    } catch (err) {
      throw new CorruptSecretStoreError(err);
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return parsed;
    } catch (err) {
      throw new CorruptSecretStoreError(err);
    }
  }

  function writeAll(all) {
    // Checked here rather than at construction: availability is an OS state
    // that can differ between app start and the moment of writing.
    if (!isEncryptionAvailable()) {
      throw new Error('OS encryption is unavailable, refusing to store a secret in the clear');
    }
    writeFile(encrypt(JSON.stringify(all)));
  }

  return {
    available: () => isEncryptionAvailable(),
    get(key) {
      return readAll()[key];
    },
    set(key, value) {
      const all = readAll();
      all[key] = value;
      writeAll(all);
    },
    remove(key) {
      const all = readAll();
      delete all[key];
      writeAll(all);
    },
    // Deliberately does NOT read first: reset is the recovery path for a store
    // that cannot be read at all.
    reset() {
      removeFile();
    },
  };
}

module.exports = { createSecretStore, CorruptSecretStoreError };
