import { buildStateFile, type SyncSlices } from '../lib/sync/stateFile';
import type { SyncMeta } from '../db/db';

/**
 * The canonical export — the Mac's half of the sync contract.
 *
 * `state.json` is a TRANSPORT, not a backup: five entity arrays plus a meta
 * block, rebuilt in full on every write. It is debounced because a single tick
 * moves a number and a drag moves several, and a file the phone polls does not
 * want a write per keystroke; it is flushed rather than debounced right after
 * an ingest, because the phone is waiting to learn that its ops landed.
 *
 * `generation` bumps once per SUCCESSFUL write, and the meta is saved only
 * after `writeState` resolves. A generation banked against a write that never
 * reached the disk would leave the phone comparing its ops against a file that
 * does not exist, and the retry would then skip a number for no reason.
 * `ingestedThroughOpId` is carried through untouched: an export is not an
 * ingest, and only `syncIngest` may move that mark.
 *
 * A failure is WARNED and swallowed. Sync is a companion feature and must
 * never be able to break the app it rides in — the next `schedule()` retries,
 * and until then the phone reads the last good file and says how old it is.
 *
 * Slices are read at WRITE time through `getSlices`, never captured when the
 * write was scheduled: the whole point of coalescing a burst is that the file
 * states where the burst ENDED.
 */

export interface ExportDeps {
  getSlices(): SyncSlices;
  loadMeta(): Promise<SyncMeta>;
  saveMeta(meta: SyncMeta): Promise<void>;
  writeState(text: string): Promise<void>;
  /** Injected so a test can assert the stamp rather than tolerate it. */
  now(): string;
}

export interface SyncExporter {
  schedule(): void;
  flush(): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 1500;

export function createSyncExporter(deps: ExportDeps, debounceMs = DEFAULT_DEBOUNCE_MS): SyncExporter {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const write = async (): Promise<void> => {
    try {
      const previous = await deps.loadMeta();
      const meta: SyncMeta = {
        generation: previous.generation + 1,
        ingestedThroughOpId: previous.ingestedThroughOpId,
      };
      await deps.writeState(
        buildStateFile(deps.getSlices(), {
          generation: meta.generation,
          writtenAt: deps.now(),
          ingestedThroughOpId: meta.ingestedThroughOpId,
        }),
      );
      // Only after the bytes landed: an unbumped generation is a retry, a
      // bumped one against a failed write is a hole the phone cannot read.
      await deps.saveMeta(meta);
    } catch (err) {
      console.warn('[sync] state export failed', err);
    }
  };

  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        void write();
      }, debounceMs);
    },
    async flush() {
      cancel();
      await write();
    },
  };
}
