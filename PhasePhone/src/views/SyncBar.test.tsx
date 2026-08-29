import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildStateFile, type SyncSlices } from '@app/lib/sync/stateFile';
import type { StateFileMeta } from '@app/lib/sync/ops';
import type { FileBridge } from '../bridge/FileBridge';
import { createPhoneStore, type PhoneStore } from '../state/phoneStore';
import { seededStore } from '../test/seededStore';
import { SyncBar } from './SyncBar';

afterEach(cleanup);

function slices(): SyncSlices {
  return {
    goals: [],
    habits: [],
    tasks: [{ id: 't1', title: 'Buy stamps', done: false, goalId: null }],
    sessions: [],
    lives: [],
  };
}

const META: StateFileMeta = {
  generation: 4,
  writtenAt: new Date().toISOString(),
  ingestedThroughOpId: null,
};

const ready = () => seededStore(buildStateFile(slices(), META));

/** A store whose bridge fails in the named direction, already refreshed. */
async function failing(kind: 'read' | 'write'): Promise<PhoneStore> {
  const fails = () => {
    throw new Error(kind === 'read' ? 'iCloud is not available' : 'the file is locked');
  };
  const bridge: FileBridge = {
    readStateFile: async () => (kind === 'read' ? fails() : buildStateFile(slices(), META)),
    readJournal: async () => (kind === 'read' ? fails() : ''),
    appendOp: async () => fails(),
    rewriteJournal: async () => fails(),
    onChange: () => () => {},
  };
  const store = createPhoneStore(bridge);
  await store.refresh();
  if (kind === 'write') await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null });
  return store;
}

/** The bar's own live region, told apart from any other status on the page. */
const bar = () => screen.queryByRole('status', { name: 'Sync' });

describe('a healthy sync', () => {
  it('says nothing at all', async () => {
    render(<SyncBar store={await ready()} />);
    expect(bar()).toBeNull();
  });
});

describe('work the Mac has not taken yet', () => {
  it('counts it, and counts one in the singular', async () => {
    const store = await ready();
    render(<SyncBar store={store} />);
    await store.ops.completeTask({ kind: 'task', id: 't1', goalId: null });
    expect(bar()!.textContent).toContain('1 change waiting for your Mac');
  });

  it('is plural above one', async () => {
    const store = await ready();
    render(<SyncBar store={store} />);
    await store.ops.addLooseTask('one');
    await store.ops.addLooseTask('two');
    expect(bar()!.textContent).toContain('2 changes waiting for your Mac');
  });
});

describe('a read that failed', () => {
  it('says the screen is stale rather than wrong, and carries the reason', async () => {
    render(<SyncBar store={await failing('read')} />);
    expect(bar()!.textContent).toContain('Can’t reach iCloud');
    expect(bar()!.textContent).toContain('iCloud is not available');
  });

  it('offers a retry, and the retry re-reads', async () => {
    let reads = 0;
    const bridge: FileBridge = {
      readStateFile: async () => {
        reads += 1;
        throw new Error('offline');
      },
      readJournal: async () => '',
      appendOp: async () => {},
      rewriteJournal: async () => {},
      onChange: () => () => {},
    };
    const store = createPhoneStore(bridge);
    await store.refresh();
    render(<SyncBar store={store} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reads).toBe(2);
  });
});

describe('a write that failed', () => {
  it('says the change did not happen — and offers no retry, because there is nothing to retry', async () => {
    render(<SyncBar store={await failing('write')} />);
    expect(bar()!.textContent).toContain('didn’t save');
    expect(bar()!.textContent).toContain('the file is locked');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('before the first read has landed', () => {
  it('says it is looking, rather than leaving a blank screen unexplained', () => {
    const store = createPhoneStore({
      readStateFile: () => new Promise(() => {}),
      readJournal: () => new Promise(() => {}),
      appendOp: async () => {},
      rewriteJournal: async () => {},
      onChange: () => () => {},
    });
    void store.refresh();
    render(<SyncBar store={store} />);
    expect(bar()!.textContent).toContain('Looking for your Mac');
  });
});
