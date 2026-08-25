import type { FileBridge } from './FileBridge';

/**
 * The browser implementation of `FileBridge` — the two files as two
 * localStorage keys.
 *
 * It is not a stub. It is what the companion runs on in a desktop browser
 * during development, and its semantics are the contract track C's Capacitor
 * plugin implements natively (same keys, same "absent means empty journal"
 * rule), so a screen written against one runs unchanged against the other.
 *
 * `onChange` rides the `storage` event, which fires only for OTHER documents.
 * That is exactly right: our own writes are already followed by a projection
 * recompute, and firing on them would re-read the file we just wrote.
 */
export const STATE_KEY = 'phase-sync-state';
export const JOURNAL_KEY = 'phase-sync-journal';

/** Put a `state.json` in place — dev seeding and tests, never the app itself. */
export function seedState(text: string): void {
  localStorage.setItem(STATE_KEY, text);
}

export function createLocalBridge(): FileBridge {
  return {
    async readStateFile() {
      return localStorage.getItem(STATE_KEY);
    },

    async readJournal() {
      return localStorage.getItem(JOURNAL_KEY) ?? '';
    },

    async appendOp(line) {
      const existing = localStorage.getItem(JOURNAL_KEY) ?? '';
      // A journal is newline-TERMINATED, not newline-separated: a truncated
      // tail line is what `parseOpsJournal` is built to skip, and terminating
      // every write means the only line that can ever be truncated is one
      // still being written.
      const base = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
      localStorage.setItem(JOURNAL_KEY, `${base}${line}\n`);
    },

    async rewriteJournal(text) {
      localStorage.setItem(JOURNAL_KEY, text);
    },

    onChange(cb) {
      const handler = (event: StorageEvent) => {
        if (event.key === STATE_KEY || event.key === JOURNAL_KEY) cb();
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
  };
}
