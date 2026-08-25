import { describe, expect, it, vi } from 'vitest';
import { buildStateFile, type SyncSlices } from '@app/lib/sync/stateFile';
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
}

function fakeBridge(stateText: string | null, journal = ''): FakeBridge {
  const listeners = new Set<() => void>();
  const bridge: FakeBridge = {
    stateText,
    journal,
    rewrites: 0,
    appends: 0,
    async readStateFile() {
      return bridge.stateText;
    },
    async readJournal() {
      return bridge.journal;
    },
    async appendOp(line) {
      bridge.appends++;
      bridge.journal += `${line}\n`;
    },
    async rewriteJournal(text) {
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
