import { WebPlugin } from '@capacitor/core';

import type { PhaseICloudPlugin } from './definitions';

/** Same keys track B's `localBridge` uses, so the two are interchangeable. */
const STATE_KEY = 'phase-sync-state';
const JOURNAL_KEY = 'phase-sync-journal';

/**
 * Browser fallback. There is no iCloud on the web, so the two files live in
 * localStorage and `filesChanged` rides the `storage` event (which fires only
 * for OTHER tabs — exactly the "changed underneath us" semantics the native
 * side has).
 *
 * This keeps `npm run dev` runnable in a desktop browser during PhasePhone
 * development; it is not a sync path.
 */
export class PhaseICloudWeb extends WebPlugin implements PhaseICloudPlugin {
  constructor() {
    super();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key === null || event.key === STATE_KEY || event.key === JOURNAL_KEY) {
          this.notifyListeners('filesChanged', {});
        }
      });
    }
  }

  async readStateFile(): Promise<{ text: string | null }> {
    return { text: read(STATE_KEY) };
  }

  async readJournal(): Promise<{ text: string }> {
    return { text: read(JOURNAL_KEY) ?? '' };
  }

  async appendOp(options: { line: string }): Promise<void> {
    const previous = read(JOURNAL_KEY) ?? '';
    write(JOURNAL_KEY, previous + options.line.replace(/\n+$/, '') + '\n');
  }

  async rewriteJournal(options: { text: string }): Promise<void> {
    write(JOURNAL_KEY, options.text);
  }
}

function read(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(key);
}

function write(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}
