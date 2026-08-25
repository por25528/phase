import { useCallback, useSyncExternalStore } from 'react';
import type { WorkRef } from '@app/lib/expectedTime';
import { parseStateFile, type StateFile, type SyncSlices } from '@app/lib/sync/stateFile';
import {
  opsAfter,
  parseOpsJournal,
  serializeOp,
  type CompanionOp,
  type CompanionRequest,
} from '@app/lib/sync/ops';
import { replayOps } from '@app/lib/sync/replay';
import type { FileBridge } from '../bridge/FileBridge';

/**
 * The companion's whole state: a canonical file it did not write, and a
 * journal it did.
 *
 * There is no Dexie here and no merge. `projected` is `state.json` plus a
 * replay of the ops the Mac has not ingested, recomputed from scratch every
 * time either input moves — which is what makes the phone correct while
 * offline, correct while the Mac is asleep, and incapable of disagreeing with
 * the Mac about who owns state.
 */
export interface PhoneState {
  status: 'loading' | 'ready' | 'never-synced';
  /** Canonical + pending replay. `null` only before the first good read. */
  projected: SyncSlices | null;
  /** `meta.writtenAt` of the canonical file — what the "as of" stamp reads. */
  writtenAt: string | null;
  pendingCount: number;
}

export interface PhoneStore {
  usePhoneStore(): PhoneState;
  /** The snapshot outside React — for tests and for the ops' own bookkeeping. */
  getState(): PhoneState;
  refresh(): Promise<void>;
  ops: {
    completeTask(ref: WorkRef): Promise<void>;
    setStatus(nodeId: string, status: 'parked' | 'todo' | 'done'): Promise<void>;
    addStep(goalId: string, title: string, parentId?: string): Promise<void>;
    addLooseTask(title: string, date?: string): Promise<void>;
    logTime(ref: WorkRef, minutes: number): Promise<void>;
  };
  /** Stop listening to the bridge. */
  dispose(): void;
}

const LOADING: PhoneState = {
  status: 'loading',
  projected: null,
  writtenAt: null,
  pendingCount: 0,
};

/** The five entity arrays, without the `meta` block that rides beside them. */
function slicesOf(file: StateFile): SyncSlices {
  return {
    goals: file.goals,
    habits: file.habits,
    tasks: file.tasks,
    sessions: file.sessions,
    lives: file.lives,
  };
}

export function createPhoneStore(bridge: FileBridge): PhoneStore {
  /** The last file that PARSED. A corrupt read never replaces it — design §5. */
  let canonical: StateFile | null = null;
  /** The journal as last read, whole. */
  let journal: CompanionOp[] = [];
  /** The tail of `journal` the Mac has not ingested. */
  let pending: CompanionOp[] = [];

  let snapshot: PhoneState = LOADING;
  const listeners = new Set<() => void>();

  function publish(next: PhoneState): void {
    snapshot = next;
    listeners.forEach((l) => l());
  }

  function recompute(): void {
    if (!canonical) {
      journal = journal.slice();
      pending = journal;
      publish({ status: 'never-synced', projected: null, writtenAt: null, pendingCount: 0 });
      return;
    }
    // `ingestedThroughOpId` and never `baseGeneration` arithmetic: the Mac
    // exports for its OWN edits too, so a bumped generation proves nothing
    // about any particular op. An id the journal no longer carries — the
    // normal state after a compaction — means everything here is pending,
    // which `opsAfter` already answers.
    pending = opsAfter(journal, canonical.meta.ingestedThroughOpId);
    publish({
      status: 'ready',
      projected: replayOps(slicesOf(canonical), pending),
      writtenAt: canonical.meta.writtenAt,
      pendingCount: pending.length,
    });
  }

  async function refresh(): Promise<void> {
    const [stateText, journalText] = await Promise.all([
      bridge.readStateFile(),
      bridge.readJournal(),
    ]);
    journal = parseOpsJournal(journalText);
    // A file that is absent is a first run; one that is unparseable is iCloud
    // caught mid-write. Neither may discard the last good copy — the phone
    // would otherwise blank out mid-sync and read as data loss.
    const parsed = stateText === null ? null : parseStateFile(stateText);
    if (parsed) canonical = parsed;
    recompute();
  }

  async function push(request: CompanionRequest): Promise<void> {
    const op: CompanionOp = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      baseGeneration: canonical?.meta.generation ?? 0,
      request,
    };
    // Compaction rides on the write rather than on a timer: the ops before the
    // high-water mark are dead weight the Mac will skip forever, and the only
    // moment their removal is free is the moment the file is being written
    // anyway. The phone is the journal's ONLY writer, so rewriting from the
    // in-memory copy cannot lose somebody else's line.
    const stale = journal.length > pending.length;
    if (stale) {
      await bridge.rewriteJournal([...pending, op].map(serializeOp).map((l) => `${l}\n`).join(''));
      journal = [...pending, op];
    } else {
      await bridge.appendOp(serializeOp(op));
      journal = [...journal, op];
    }
    recompute();
  }

  const off = bridge.onChange(() => {
    void refresh();
  });

  return {
    getState: () => snapshot,

    usePhoneStore(): PhoneState {
      return useSyncExternalStore(
        useCallback((cb: () => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        }, []),
        () => snapshot,
        () => snapshot,
      );
    },

    refresh,

    ops: {
      completeTask: (ref) => push({ tool: 'complete_task', ref }),
      setStatus: (nodeId, status) => push({ tool: 'set_status', nodeId, status }),
      addStep: (goalId, title, parentId) =>
        push({ tool: 'add_task', goalId, title, ...(parentId === undefined ? {} : { parentId }) }),
      addLooseTask: (title, date) =>
        push({ tool: 'add_loose_task', title, ...(date === undefined ? {} : { date }) }),
      logTime: (ref, minutes) => push({ tool: 'log_time', ref, minutes }),
    },

    dispose: off,
  };
}
