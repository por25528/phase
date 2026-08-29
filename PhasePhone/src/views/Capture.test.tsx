import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildStateFile, type SyncSlices } from '@app/lib/sync/stateFile';
import type { StateFileMeta } from '@app/lib/sync/ops';
import { todayStr } from '@app/lib/dates';
import { createPhoneStore } from '../state/phoneStore';
import { seededStore, type SeededStore } from '../test/seededStore';
import { Capture } from './Capture';

afterEach(cleanup);

function slices(): SyncSlices {
  return {
    goals: [
      { id: 'g1', title: 'Thesis', column: 0, nodes: [] },
      { id: 'g2', title: 'Someday reading', column: 3, nodes: [] },
      { id: 'g3', title: 'Shipped', column: 0, completedAt: '2026-07-01', nodes: [] },
    ],
    habits: [],
    tasks: [],
    sessions: [],
    lives: [],
  };
}

const META: StateFileMeta = {
  generation: 2,
  writtenAt: new Date().toISOString(),
  ingestedThroughOpId: null,
};

const ready = () => seededStore(buildStateFile(slices(), META));

/** The one op the journal holds. */
function onlyOp(store: SeededStore) {
  const ops = store.journalOps();
  expect(ops).toHaveLength(1);
  return ops[0];
}

describe('the project picker', () => {
  it('offers Now and Next projects, and "No project" first', async () => {
    render(<Capture store={await ready()} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['No project', 'Thesis']);
  });
});

describe('submitting', () => {
  it('with no project captures a loose task', async () => {
    const store = await ready();
    render(<Capture store={store} />);

    await userEvent.type(screen.getByLabelText('What needs doing?'), 'Buy stamps');
    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(onlyOp(store).request).toEqual({ tool: 'add_loose_task', title: 'Buy stamps' });
    expect(store.getState().projected!.tasks).toHaveLength(1);
  });

  it('with a project captures a step in its tree', async () => {
    const store = await ready();
    render(<Capture store={store} />);

    await userEvent.type(screen.getByLabelText('What needs doing?'), 'Draft chapter 2');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'g1');
    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(onlyOp(store).request).toEqual({
      tool: 'add_task',
      goalId: 'g1',
      title: 'Draft chapter 2',
    });
    expect(store.getState().projected!.goals[0].nodes[0].title).toBe('Draft chapter 2');
  });

  it('a day chip sets the date on a loose task', async () => {
    const store = await ready();
    render(<Capture store={store} />);

    await userEvent.type(screen.getByLabelText('What needs doing?'), 'Call the bank');
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(onlyOp(store).request).toEqual({
      tool: 'add_loose_task',
      title: 'Call the bank',
      date: todayStr(),
    });
  });

  it('withholds the day chips once a project is picked — add_task has nowhere to put a date', async () => {
    render(<Capture store={await ready()} />);
    expect(screen.getByRole('button', { name: 'Today' })).toBeDefined();
    await userEvent.selectOptions(screen.getByRole('combobox'), 'g1');
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('clears the field and says what it took', async () => {
    render(<Capture store={await ready()} />);
    const field = screen.getByLabelText('What needs doing?') as HTMLInputElement;

    await userEvent.type(field, 'Buy stamps');
    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(field.value).toBe('');
    expect(screen.getByRole('status').textContent).toContain('Buy stamps');
  });

  it('keeps the line and claims nothing when the journal write failed', async () => {
    const store = createPhoneStore({
      readStateFile: async () => buildStateFile(slices(), META),
      readJournal: async () => '',
      appendOp: async () => {
        throw new Error('the container is not writable');
      },
      rewriteJournal: async () => {
        throw new Error('the container is not writable');
      },
      onChange: () => () => {},
    });
    await store.refresh();
    render(<Capture store={store} />);
    const field = screen.getByLabelText('What needs doing?') as HTMLInputElement;

    await userEvent.type(field, 'Buy stamps');
    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    // The thought is still on screen — it is the only copy — and nothing
    // claims it was taken. The shell's SyncBar says why.
    expect(field.value).toBe('Buy stamps');
    expect(screen.queryByRole('status')).toBeNull();
    expect(store.getState().error).toMatchObject({ kind: 'write' });
  });

  it('refuses an empty line', async () => {
    const store = await ready();
    render(<Capture store={store} />);
    const submit = screen.getByRole('button', { name: 'Capture' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('What needs doing?'), '   ');
    expect(submit.disabled).toBe(true);
    expect(store.getState().pendingCount).toBe(0);
  });
});
