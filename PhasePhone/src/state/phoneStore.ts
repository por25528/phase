import { useCallback, useSyncExternalStore } from 'react';
import type { WorkRef } from '@app/lib/expectedTime';
import { parseStateFile, type StateFile, type SyncSlices } from '@app/lib/sync/stateFile';
import { todayStr } from '@app/lib/dates';
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
/**
 * The last thing the bridge refused to do.
 *
 * The KIND is the whole point, because the two failures mean opposite things
 * to the person holding the phone: a `read` that failed leaves what is on
 * screen stale but true, while a `write` that failed means the gesture they
 * just made did not happen at all. One asks for patience, the other asks them
 * to do it again.
 */
export interface SyncError {
  kind: 'read' | 'write';
  message: string;
}

export interface PhoneState {
  status: 'loading' | 'ready' | 'never-synced';
  /** Canonical + pending replay. `null` only before the first good read. */
  projected: SyncSlices | null;
  /** `meta.writtenAt` of the canonical file — what the "as of" stamp reads. */
  writtenAt: string | null;
  pendingCount: number;
  /** The last failure, or `null`. Any success on the same path clears it. */
  error: SyncError | null;
}

export interface PhoneStore {
  usePhoneStore(): PhoneState;
  /** The snapshot outside React — for tests and for the ops' own bookkeeping. */
  getState(): PhoneState;
  refresh(): Promise<void>;
  /**
   * Every op answers the one question a companion has to answer: did that
   * reach the journal? `false` means the file write failed and NOTHING
   * happened — no projection change, no pending op. A screen that says
   * "captured" regardless is the bug this return value exists to prevent.
   */
  ops: {
    completeTask(ref: WorkRef): Promise<boolean>;
    setStatus(nodeId: string, status: 'parked' | 'todo' | 'done'): Promise<boolean>;
    addStep(goalId: string, title: string, parentId?: string): Promise<boolean>;
    addLooseTask(title: string, date?: string): Promise<boolean>;
    logTime(ref: WorkRef, minutes: number): Promise<boolean>;
  };
  /** Stop listening to the bridge. */
  dispose(): void;
}

const LOADING: PhoneState = {
  status: 'loading',
  projected: null,
  writtenAt: null,
  pendingCount: 0,
  error: null,
};

/** What to show a person about a failure they did not cause and cannot read. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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

  /** The last failure, held outside the snapshot so `recompute` can carry it. */
  let error: SyncError | null = null;

  let snapshot: PhoneState = LOADING;
  const listeners = new Set<() => void>();

  function publish(next: PhoneState): void {
    snapshot = next;
    listeners.forEach((l) => l());
  }

  function recompute(): void {
    if (!canonical) {
      // With no state file there is no `ingestedThroughOpId` that could have
      // named any of these ops, so EVERYTHING in the journal is pending. It is
      // counted, not silently zeroed: somebody who captured all week before
      // first opening the Mac is owed the number, and "never synced" plus
      // nothing waiting reads as "nothing was kept".
      pending = journal.slice();
      publish({
        status: 'never-synced',
        projected: null,
        writtenAt: null,
        pendingCount: pending.length,
        error,
      });
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
      error,
    });
  }

  async function refresh(): Promise<void> {
    let stateText: string | null;
    let journalText: string;
    try {
      [stateText, journalText] = await Promise.all([
        bridge.readStateFile(),
        bridge.readJournal(),
      ]);
    } catch (err) {
      // A read that THREW is iCloud unreachable, not a file that is absent —
      // and it says nothing about whether the work is still there. So the last
      // good projection stands untouched and only the error is published. This
      // never rethrows: the callers are an effect and the bridge's own change
      // callback, neither of which can catch.
      error = { kind: 'read', message: messageOf(err) };
      publish({ ...snapshot, error });
      return;
    }
    journal = parseOpsJournal(journalText);
    // A file that is absent is a first run; one that is unparseable is iCloud
    // caught mid-write. Neither may discard the last good copy — the phone
    // would otherwise blank out mid-sync and read as data loss.
    const parsed = stateText === null ? null : parseStateFile(stateText);
    if (parsed) canonical = parsed;
    // A read that worked clears a READ error and nothing else. A tick that
    // failed to reach the journal is still a tick that did not happen, and
    // this refresh is very often one nobody asked for — `onChange` fires
    // whenever iCloud lands any file at all. Letting it clear the write notice
    // would make the failure vanish on a timer the person does not control,
    // leaving them looking at a screen that never mentions their tap again.
    if (error?.kind === 'read') error = null;
    recompute();
  }

  async function push(request: CompanionRequest): Promise<boolean> {
    const op: CompanionOp = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      // The local day, recorded HERE, because this is the only moment anything
      // knows it. The Mac ingests whenever it is next opened — possibly after
      // a midnight, possibly in another timezone — and `opDay` is what makes
      // its stamp agree with the projection this phone has already drawn.
      day: todayStr(),
      baseGeneration: canonical?.meta.generation ?? 0,
      request,
    };
    // Compaction rides on the write rather than on a timer: the ops before the
    // high-water mark are dead weight the Mac will skip forever, and the only
    // moment their removal is free is the moment the file is being written
    // anyway. The phone is the journal's ONLY writer, so rewriting from the
    // in-memory copy cannot lose somebody else's line.
    const stale = journal.length > pending.length;
    try {
      if (stale) {
        await bridge.rewriteJournal([...pending, op].map(serializeOp).map((l) => `${l}\n`).join(''));
        journal = [...pending, op];
      } else {
        await bridge.appendOp(serializeOp(op));
        journal = [...journal, op];
      }
    } catch (err) {
      // The in-memory journal is assigned only AFTER the write resolves, so a
      // failure leaves it agreeing with the file — which is what lets the next
      // append still compact correctly. Nothing is recomputed: an op that
      // never reached the file is not pending, and rendering it as done would
      // be a promise the next refresh silently breaks.
      error = { kind: 'write', message: messageOf(err) };
      publish({ ...snapshot, error });
      return false;
    }
    // Symmetrically: a write that landed clears a WRITE error and leaves a
    // read error standing. Appending to the journal proves the container is
    // writable; it says nothing about whether the projection on screen is
    // current, and the stamp may still be hours old.
    if (error?.kind === 'write') error = null;
    recompute();
    return true;
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
