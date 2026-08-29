import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildStateFile, type SyncSlices } from '@app/lib/sync/stateFile';
import type { StateFileMeta } from '@app/lib/sync/ops';
import { todayStr, weekDates } from '@app/lib/dates';
import { App } from './App';
import { createPhoneStore } from './state/phoneStore';
import { seededStore } from './test/seededStore';

afterEach(cleanup);

const TODAY = todayStr();
const THIS_WEEK = weekDates(TODAY)[0];

function slices(): SyncSlices {
  return {
    goals: [
      {
        id: 'g1',
        title: 'Thesis',
        column: 0,
        nodes: [
          {
            id: 'n1',
            title: 'Draft chapter 2',
            plannedWeek: THIS_WEEK,
            blocks: [{ id: 'b1', date: TODAY, startMin: 540, minutes: 60 }],
          },
        ],
      },
    ],
    habits: [],
    tasks: [{ id: 't1', title: 'Buy stamps', done: false, goalId: null, date: TODAY }],
    sessions: [],
    lives: [],
  };
}

const META: StateFileMeta = {
  generation: 5,
  writtenAt: new Date().toISOString(),
  ingestedThroughOpId: null,
};

const ready = () => seededStore(buildStateFile(slices(), META));

/**
 * The nav's own button. Scoped, because "Capture" is both a screen and the
 * submit button ON that screen — a bare role query would find two.
 */
const tab = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Screens' })).getByRole('button', { name });
/** Inside the scroller — the screen itself, never the nav under it. */
const onScreen = () => within(screen.getByRole('main'));
const syncBar = () => screen.queryByRole('status', { name: 'Sync' });

describe('the shell', () => {
  it('opens on Today — the screen you unlock the phone already asking about', async () => {
    render(<App store={await ready()} />);
    expect(screen.getByRole('heading', { name: 'Today' })).toBeDefined();
    expect(tab('Today').getAttribute('aria-current')).toBe('page');
  });

  it('moves between the three screens', async () => {
    render(<App store={await ready()} />);

    await userEvent.click(tab('Capture'));
    expect(screen.getByLabelText('What needs doing?')).toBeDefined();

    await userEvent.click(tab('Week'));
    expect(screen.getByText('Draft chapter 2')).toBeDefined();
    expect(screen.queryByLabelText('What needs doing?')).toBeNull();
  });
});

describe('the sync state across the whole shell', () => {
  it('follows you from the screen the op was made on to every other one', async () => {
    const store = await ready();
    render(<App store={store} />);
    expect(syncBar()).toBeNull();

    await userEvent.click(tab('Capture'));
    await userEvent.type(screen.getByLabelText('What needs doing?'), 'Call the bank');
    await userEvent.click(onScreen().getByRole('button', { name: 'Capture' }));

    expect(syncBar()!.textContent).toContain('1 change waiting for your Mac');

    // The op was made on Capture; the fact belongs to the phone, not to that
    // screen, which is the whole reason the bar sits in the shell.
    await userEvent.click(tab('Today'));
    expect(syncBar()!.textContent).toContain('1 change waiting for your Mac');
    await userEvent.click(tab('Week'));
    expect(syncBar()!.textContent).toContain('1 change waiting for your Mac');
  });

  it('reports a read that failed without blanking the screen', async () => {
    let fail = false;
    const store = createPhoneStore({
      readStateFile: async () => {
        if (fail) throw new Error('iCloud is not available');
        return buildStateFile(slices(), META);
      },
      readJournal: async () => {
        if (fail) throw new Error('iCloud is not available');
        return '';
      },
      appendOp: async () => {},
      rewriteJournal: async () => {},
      onChange: () => () => {},
    });
    await store.refresh();
    render(<App store={store} />);

    fail = true;
    await userEvent.click(screen.getByRole('checkbox', { name: /Buy stamps/ }));
    // Nothing to do with the tick — this is the refresh the shell's effect and
    // the bridge's change callback both spend. Drive it directly.
    await store.refresh();

    expect(syncBar()!.textContent).toContain('Can’t reach iCloud');
    // Still drawing the last good file. A companion that blanks on a failed
    // read reads as data loss.
    expect(screen.getByText('Draft chapter 2')).toBeDefined();
  });
});
