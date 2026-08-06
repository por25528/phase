/**
 * The contract for `secrets.cjs`. Hand-written because the module is CommonJS
 * with no build step; `allowJs` is off deliberately.
 */

/** Injected so the store is testable with no filesystem and no Electron. */
export interface SecretStoreDeps {
  /** The raw encrypted blob, or null when the file does not exist. */
  readFile(): Buffer | null;
  writeFile(bytes: Buffer): void;
  removeFile(): void;
  /** In production these are Electron's `safeStorage`. */
  encrypt(plain: string): Buffer;
  decrypt(bytes: Buffer): string;
  isEncryptionAvailable(): boolean;
}

export interface SecretStore {
  /** False when the OS keychain is unavailable — writes will throw. */
  available(): boolean;
  /** `undefined` when the key is absent. Throws `CorruptSecretStoreError`. */
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  /** Delete the whole store. Works even when it cannot be read. */
  reset(): void;
}

/**
 * The stored blob exists but cannot be decrypted or parsed.
 *
 * Named rather than generic because it is RECOVERABLE and the recovery is
 * specific: the caller resets the store and asks the user to reconnect. A
 * generic parse error at boot would look like a crash.
 */
export declare class CorruptSecretStoreError extends Error {
  constructor(cause: unknown);
}

export declare function createSecretStore(deps: SecretStoreDeps): SecretStore;
