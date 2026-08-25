/**
 * `localStorage` for the test environment, and why it needs one.
 *
 * Node ≥22 declares `globalThis.localStorage` as its own experimental getter,
 * which resolves to `undefined` unless the process was started with
 * `--localstorage-file`. Vitest's jsdom environment copies jsdom's window
 * properties onto `globalThis`, and that pre-existing global getter wins — so
 * `localStorage` reads as undefined inside a jsdom test even though jsdom
 * implements it fully. The browser this project actually ships to has the real
 * thing; only the runner is short one.
 *
 * So: a minimal in-memory `Storage`, installed only when the global is
 * missing. It deliberately does NOT emit `storage` events — that event fires
 * for OTHER documents, which is precisely what `localBridge.onChange` listens
 * for and what a test has to dispatch by hand anyway.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
