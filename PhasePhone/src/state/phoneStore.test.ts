import { describe, expect, it, vi } from 'vitest';
import { buildStateFile, type SyncSlices } from '@app/lib/sync/stateFile';
import { addDays, todayStr } from '@app/lib/dates';
import { parseOpsJournal, serializeOp, type CompanionOp, type StateFileMeta } from '@app/lib/sync/ops';
import type { FileBridge } from '../bridge/FileBridge';
import { createPhoneStore } from './phoneStore';

function slices(): SyncSlices {
  return {
    goals: [{ id: 'g1', title: 'Ship it', nodes: [{ id: 'n1', title: 'Step one' }] }],
    habits: [],
    tasks: [{ id: 't1', title: 'Buy stamps', done: false, goalId: null }],
    sessions: [],
    lives: [],
  };
}

const META: StateFileMeta = {
  generation: 7,
  writtenAt: '2026-08-25T10:00:00.000Z',
  ingestedThroughOpId: null,
};

interface FakeBridge extends FileBridge {
  stateText: string | null;
  journal: string;
  fire(): void;
  rewrites: number;
  appends: number;
  /** Set to make the next read reject, the way a real iCloud read can. */
  readFails: string | null;
  /** Set to make the next append or rewrite reject. */
  writeFails: string | null;
}

function fakeBridge(stateText: string | null, journal = ''): FakeBridge {
  const listeners = new Set<() => void>();
  const bridge: FakeBridge = {
    stateText,
    journal,
    rewrites: 0,
    appends: 0,
    readFails: null,
    writeFails: null,
    async readStateFile() {
      if (bridge.readFails) throw new Error(bridge.readFails);
      return bridge.stateText;
    },
    async readJournal() {
      if (bridge.readFails) throw new Error(bridge.readFails);
      return bridge.journal;
    },
    async appendOp(line) {
      if (bridge.writeFails) throw new Error(bridge.writeFails);
      bridge.appends++;
      bridge.journal += `${line}\n`;
    },
    async rewriteJournal(text) {
      if (bridge.writeFails) throw new Error(bridge.writeFails);
      bridge.rewrites++;
      bridge.journal = text;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    fire() {
      listeners.forEach((l) => l());
    },
  };
  return bridge;
}

/** The op the journal's last line carries. */
function lastOp(bridge: FakeBridge): CompanionOp {
  const ops = parseOpsJournal(bridge.journal);
  return ops[ops.length - 1];
}

describe('refresh', () => {
  it('is never-synced with no state file, whatever the journal says', async () => {
    const store = createPhoneStore(fakeBridge(null));
    await store.refresh();
    expect(store.getState()).toMatchObject({ status: 'never-synced', projected: null, writtenAt: null });
  });

  it('projects the canonical file and stamps its writtenAt', async () => {
    const store = createPhoneStore(fakeBridge(buildStateFile(slices(), META)));
    await store.refresh();
    const state = store.getState();
    expect(state.status).toBe('ready');
    expect(state.writtenAt).toBe(META.writtenAt);
    expect(state.pendingCount).toBe(0);
    // The projection is the five entity arrays and nothing else — `meta` rides
    // on the file, not on the state the screens read.
    expect(state.projected).toEqual(slices());
  });

  it('replays the ops the Mac has not ingested', async () => {
    const op: CompanionOp = {
      id: 'op-1',
      ts: '2026-08-25T11:00:00.000Z',
      baseGeneration: 7,
      request: { tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } },
    };
    const store = createPhoneStore(fakeBridge(buildStateFile(slices(), META), `${serializeOp(op)}\n`));
    await store.refresh();
    expect(store.getState().pendingCount).toBe(1);
    expect(store.getState().projected!.tasks[0].done).toBe(true);
  });

  it('drops an op the state file says was already ingested', async () => {
    const op: CompanionOp = {
      id: 'op-1',
      ts: '2026-08-25T11:00:00.000Z',
      baseGeneration: 7,
      request: { tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } },
    };
    const meta = { ...META, ingestedThroughOpId: 'op-1' };
    const store = createPhoneStore(fakeBridge(buildStateFile(slices(), meta), `${serializeOp(op)}\n`));
    await store.refresh();
    expect(store.getState().pendingCount).toBe(0);
    // Not replayed — the canonical file already carries whatever the Mac made
    // of it, and replaying an ingested op would double it.
    expect(store.getState().projected!.tasks[0].done).toBe(false);
  });

  it('a corrupt state file keeps the previous good projection', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    const good = store.getState().projected;

    bridge.stateText = '{ half a file';
    await store.refresh();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().projected).toEqual(good);
    expect(store.getState().writtenAt).toBe(META.writtenAt);
  });

  it('re-reads when the bridge says the files moved', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();

    const next = slices();
    next.tasks.push({ id: 't2', title: 'Second', done: false, goalId: null });
    bridge.stateText = buildStateFile(next, { ...META, generation: 8 });
    bridge.fire();
    await vi.waitFor(() => expect(store.getState().projected!.tasks).toHaveLength(2));
  });
});

describe('writing ops', () => {
  it('ticks a task optimistically and journals one line', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();

    await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null });

    expect(store.getState().projected!.tasks[0].done).toBe(true);
    expect(store.getState().pendingCount).toBe(1);
    expect(parseOpsJournal(bridge.journal)).toHaveLength(1);
    expect(lastOp(bridge).request).toEqual({
      tool: 'complete_task',
      ref: { kind: 'task', id: 't1', goalId: null },
    });
  });

  it('stamps the generation the phone was rendering', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    await store.ops.addLooseTask('Call the bank');
    expect(lastOp(bridge).baseGeneration).toBe(7);
  });

  it('parks a step', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    await store.ops.setStatus('n1', 'parked');
    expect(store.getState().projected!.goals[0].nodes[0].status).toBe('parked');
    expect(lastOp(bridge).request).toEqual({ tool: 'set_status', nodeId: 'n1', status: 'parked' });
  });

  it('captures a step under a project and a loose task without one', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();

    await store.ops.addStep('g1', 'From the phone');
    expect(lastOp(bridge).request).toEqual({ tool: 'add_task', goalId: 'g1', title: 'From the phone' });

    await store.ops.addLooseTask('Errand', '2026-08-26');
    expect(lastOp(bridge).request).toEqual({ tool: 'add_loose_task', title: 'Errand', date: '2026-08-26' });
    expect(store.getState().projected!.tasks).toHaveLength(2);
  });

  it('logs time against a step', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    await store.ops.logTime({ kind: 'step', id: 'n1', goalId: 'g1' }, 25);
    expect(store.getState().projected!.sessions).toHaveLength(1);
    expect(lastOp(bridge).request).toMatchObject({ tool: 'log_time', minutes: 25 });
  });

  it('every op gets its own id', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    await store.ops.addLooseTask('one');
    await store.ops.addLooseTask('two');
    const ids = parseOpsJournal(bridge.journal).map((op) => op.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('compacts the ops the Mac has ingested out of the journal on the next append', async () => {
    const ingested: CompanionOp = {
      id: 'op-old',
      ts: '2026-08-24T11:00:00.000Z',
      baseGeneration: 6,
      request: { tool: 'add_loose_task', title: 'Already landed' },
    };
    const bridge = fakeBridge(
      buildStateFile(slices(), { ...META, ingestedThroughOpId: 'op-old' }),
      `${serializeOp(ingested)}\n`,
    );
    const store = createPhoneStore(bridge);
    await store.refresh();

    await store.ops.addLooseTask('New one');

    const left = parseOpsJournal(bridge.journal);
    expect(left).toHaveLength(1);
    expect(left[0].request).toEqual({ tool: 'add_loose_task', title: 'New one' });
    expect(bridge.rewrites).toBe(1);
    expect(bridge.appends).toBe(0);
  });

  it('appends rather than rewriting when there is nothing to compact', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    await store.ops.addLooseTask('one');
    await store.ops.addLooseTask('two');
    expect(bridge.rewrites).toBe(0);
    expect(bridge.appends).toBe(2);
  });

  it('keeps the pending op through a later refresh', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null });
    await store.refresh();
    expect(store.getState().projected!.tasks[0].done).toBe(true);
    expect(store.getState().pendingCount).toBe(1);
  });
});

/**
 * Failure is a STATE here, never a thrown promise.
 *
 * Both entry points are spent by callers that cannot catch — `refresh` by the
 * bridge's own change callback and by an effect, the ops by an `onClick` that
 * fires and forgets. A rejection from either would be an unhandled rejection
 * and a screen that silently did nothing, which is the one outcome a companion
 * whose whole job is "did that land?" may not have.
 */
describe('when the bridge fails', () => {
  it('a failed read keeps the last good projection and says so', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    const good = store.getState().projected;

    bridge.readFails = 'iCloud is not available';
    await store.refresh();

    const state = store.getState();
    expect(state.error).toEqual({ kind: 'read', message: 'iCloud is not available' });
    // Stale, not blank: a read that failed is not evidence the work is gone.
    expect(state.status).toBe('ready');
    expect(state.projected).toEqual(good);
  });

  it('a read that succeeds again clears the error', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    bridge.readFails = 'offline';
    await store.refresh();
    expect(store.getState().error).not.toBeNull();

    bridge.readFails = null;
    await store.refresh();
    expect(store.getState().error).toBeNull();
    expect(store.getState().status).toBe('ready');
  });

  it('a failed write reports false and does not pretend the op happened', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();

    bridge.writeFails = 'the container is read-only';
    const landed = await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null });

    expect(landed).toBe(false);
    expect(store.getState().error).toEqual({ kind: 'write', message: 'the container is read-only' });
    // The projection is `state.json` + the DURABLE journal. An op that never
    // reached the file is not pending, and drawing it as done would be a lie
    // the next refresh would take back.
    expect(store.getState().pendingCount).toBe(0);
    expect(store.getState().projected!.tasks[0].done).toBe(false);
    expect(parseOpsJournal(bridge.journal)).toHaveLength(0);
  });

  it('a write that succeeds again clears the error', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();

    bridge.writeFails = 'no space';
    expect(await store.ops.addLooseTask('one')).toBe(false);

    bridge.writeFails = null;
    expect(await store.ops.addLooseTask('two')).toBe(true);
    expect(store.getState().error).toBeNull();
  });

  it('reports true when the op reached the journal', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    expect(await store.ops.setStatus('n1', 'parked')).toBe(true);
    expect(await store.ops.logTime({ kind: 'step', id: 'n1', goalId: 'g1' }, 10)).toBe(true);
    expect(await store.ops.addStep('g1', 'From the phone')).toBe(true);
  });

  it('a write error survives a refresh — only another write may clear it', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();

    bridge.writeFails = 'the container is read-only';
    await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null });
    bridge.writeFails = null;

    // The Mac exporting, or iCloud landing any file at all, fires `onChange`
    // and refreshes. That says NOTHING about whether the tick that failed
    // would land now, and letting it clear the notice would make the failure
    // disappear on a timer nobody controls — leaving a person who ticked
    // something looking at a screen that never mentions it again.
    await store.refresh();
    expect(store.getState().error).toEqual({ kind: 'write', message: 'the container is read-only' });

    // The op itself is what clears it.
    expect(await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null })).toBe(true);
    expect(store.getState().error).toBeNull();
  });

  it('a read error survives a write — only another read may clear it', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();

    bridge.readFails = 'iCloud is not available';
    await store.refresh();

    // Appending to the journal proves the container is writable, not that the
    // projection on screen is current. The stamp is still stale and the bar
    // still has to say so.
    expect(await store.ops.addLooseTask('one')).toBe(true);
    expect(store.getState().error).toEqual({ kind: 'read', message: 'iCloud is not available' });

    bridge.readFails = null;
    await store.refresh();
    expect(store.getState().error).toBeNull();
  });

  it('a read that fails does not demote an outstanding write error', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();

    bridge.writeFails = 'the container is read-only';
    await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null });

    bridge.readFails = 'iCloud is not available';
    await store.refresh();

    // Work that is GONE outranks work that may merely be stale — the same
    // severity order `SyncBar` draws in. A tick that never landed is the
    // person's own lost gesture; a stale read is the screen still being true,
    // just old. Overwriting the first with the second loses the only notice
    // that anything was lost.
    expect(store.getState().error).toEqual({ kind: 'write', message: 'the container is read-only' });

    // Reads recovering does not clear it either; a write still has to land.
    bridge.readFails = null;
    await store.refresh();
    expect(store.getState().error).toEqual({ kind: 'write', message: 'the container is read-only' });

    bridge.writeFails = null;
    expect(await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null })).toBe(true);
    expect(store.getState().error).toBeNull();
  });

  it('survives the refresh the bridge fires on its own', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();

    bridge.writeFails = 'the container is read-only';
    await store.ops.addLooseTask('Call the bank');

    // `onChange` is not a refresh anybody asked for — iCloud landing anything
    // at all fires it — and here it fires while the container is still
    // failing. Neither the success path nor the failure path may take the
    // write notice away.
    bridge.readFails = 'iCloud is not available';
    bridge.fire();
    await vi.waitFor(() =>
      expect(store.getState().error).toEqual({ kind: 'write', message: 'the container is read-only' }),
    );

    bridge.readFails = null;
    bridge.fire();
    await vi.waitFor(() => expect(store.getState().projected).not.toBeNull());
    expect(store.getState().error).toEqual({ kind: 'write', message: 'the container is read-only' });
  });

  it('a failed compaction leaves the journal exactly as it was', async () => {
    const ingested: CompanionOp = {
      id: 'op-old',
      ts: '2026-08-24T11:00:00.000Z',
      baseGeneration: 6,
      request: { tool: 'add_loose_task', title: 'Already landed' },
    };
    const bridge = fakeBridge(
      buildStateFile(slices(), { ...META, ingestedThroughOpId: 'op-old' }),
      `${serializeOp(ingested)}\n`,
    );
    const store = createPhoneStore(bridge);
    await store.refresh();

    bridge.writeFails = 'interrupted';
    expect(await store.ops.addLooseTask('New one')).toBe(false);

    // The rewrite is the compaction: if it did not land, the old line is still
    // in the file and the in-memory copy must still agree with the file.
    expect(parseOpsJournal(bridge.journal).map((o) => o.id)).toEqual(['op-old']);
  });
});

/**
 * Before the Mac has ever exported, the phone is a pure capture device — and
 * everything it has captured is waiting.
 */
describe('never synced', () => {
  it('counts the journal it is holding for the Mac', async () => {
    const bridge = fakeBridge(null);
    const store = createPhoneStore(bridge);
    await store.refresh();
    expect(store.getState()).toMatchObject({ status: 'never-synced', pendingCount: 0 });

    await store.ops.addLooseTask('Call the bank');
    await store.ops.addLooseTask('Buy stamps');

    // Two ops are in the file and NONE of them can have been ingested — there
    // is no state file, so there is no `ingestedThroughOpId` to have named
    // one. Reporting zero would tell somebody who has captured all week that
    // there is nothing to sync.
    expect(store.getState()).toMatchObject({ status: 'never-synced', pendingCount: 2 });
  });

  it('carries the journal across the first export', async () => {
    const bridge = fakeBridge(null);
    const store = createPhoneStore(bridge);
    await store.refresh();
    await store.ops.addLooseTask('Call the bank');

    bridge.stateText = buildStateFile(slices(), META);
    await store.refresh();

    expect(store.getState().status).toBe('ready');
    expect(store.getState().pendingCount).toBe(1);
    expect(store.getState().projected!.tasks.map((t) => t.title)).toContain('Call the bank');
  });
});

/**
 * The day an op is stamped with travels WITH the op, because the Mac reads it
 * at a moment the phone has no say over — see `opDay` in `@app/lib/sync/ops`.
 */
describe('the day an op carries', () => {
  it('is the local day it was made on', async () => {
    const bridge = fakeBridge(buildStateFile(slices(), META));
    const store = createPhoneStore(bridge);
    await store.refresh();
    await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null });
    expect(lastOp(bridge).day).toBe(todayStr());
  });

  it('is what the projection replays, not the clock the projection is drawn at', async () => {
    // An op made yesterday and never ingested — the offline case: the phone
    // ticked something last night and the Mac has not been opened since.
    const yesterday = addDays(todayStr(), -1);
    const op: CompanionOp = {
      id: 'op-1',
      ts: `${yesterday}T23:50:00.000Z`,
      day: yesterday,
      baseGeneration: 7,
      request: { tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } },
    };
    const store = createPhoneStore(
      fakeBridge(buildStateFile(slices(), META), `${serializeOp(op)}\n`),
    );
    await store.refresh();

    // Yesterday's tick stays yesterday's. Restamping it with today would move
    // it into today's `Done today` every morning until the Mac ingested it.
    expect(store.getState().projected!.tasks[0].doneAt).toBe(yesterday);
  });
});
