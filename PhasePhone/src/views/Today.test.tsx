import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildStateFile, type SyncSlices } from '@app/lib/sync/stateFile';
import type { StateFileMeta } from '@app/lib/sync/ops';
import { todayStr } from '@app/lib/dates';
import { addDays } from '@app/lib/dates';
import { weekDates } from '@app/lib/dates';
import { createPhoneStore, type PhoneStore } from '../state/phoneStore';
import { seededStore } from '../test/seededStore';
import { Today } from './Today';

afterEach(cleanup);

const TODAY = todayStr();
const THIS_WEEK = weekDates(TODAY)[0];
const LAST_WEEK = addDays(THIS_WEEK, -7);

function slices(): SyncSlices {
  return {
    goals: [
      {
        id: 'g1',
        title: 'Thesis',
        nodes: [
          // Committed to this week with a sitting today.
          {
            id: 'n1',
            title: 'Draft chapter 2',
            plannedWeek: THIS_WEEK,
            blocks: [{ id: 'b1', date: TODAY, startMin: 540, minutes: 60 }],
          },
          // Committed to a week that has passed — a carry-over.
          { id: 'n2', title: 'Read the Tanaka paper', plannedWeek: LAST_WEEK },
          // Finished today.
          { id: 'n3', title: 'Email the supervisor', status: 'done', doneAt: TODAY },
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
  generation: 3,
  writtenAt: new Date().toISOString(),
  ingestedThroughOpId: null,
};

async function ready(): Promise<PhoneStore> {
  return seededStore(buildStateFile(slices(), META));
}

function section(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement;
}

describe('the three sections', () => {
  it('renders today, what slipped, and what was finished', async () => {
    render(<Today store={await ready()} />);

    expect(screen.getByRole('heading', { name: 'Today' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Carried over' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Done today' })).toBeDefined();

    expect(screen.getByText('Draft chapter 2')).toBeDefined();
    expect(screen.getByText('Buy stamps')).toBeDefined();
    expect(screen.getByText('Read the Tanaka paper')).toBeDefined();
    expect(screen.getByText('Email the supervisor')).toBeDefined();
  });

  it('puts the finished row last', async () => {
    const { container } = render(<Today store={await ready()} />);
    const text = container.textContent ?? '';
    expect(text.indexOf('Email the supervisor')).toBeGreaterThan(text.indexOf('Draft chapter 2'));
    expect(text.indexOf('Email the supervisor')).toBeGreaterThan(
      text.indexOf('Read the Tanaka paper'),
    );
  });

  it('a finished row offers no way back — the companion cannot un-tick', async () => {
    render(<Today store={await ready()} />);
    const box = screen.getByRole('checkbox', { name: /Email the supervisor/ });
    expect(box.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('ticking', () => {
  it('marks the row done through the store, optimistically', async () => {
    const store = await ready();
    render(<Today store={store} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /Buy stamps/ }));

    expect(store.getState().projected!.tasks[0].done).toBe(true);
    expect(store.getState().pendingCount).toBe(1);
    // And the page follows the store rather than its own copy of the fact.
    expect(
      within(section('Done today')).getByText('Buy stamps'),
    ).toBeDefined();
  });
});

describe('parking', () => {
  it('parks a step and offers the way back', async () => {
    const store = await ready();
    render(<Today store={store} />);

    await userEvent.click(screen.getByRole('button', { name: /^Park “Draft chapter 2”$/ }));

    expect(store.getState().projected!.goals[0].nodes[0].status).toBe('parked');
    expect(screen.getByRole('button', { name: /^Unpark “Draft chapter 2”$/ })).toBeDefined();
  });

  it('is withheld from a loose task, which carries no status', async () => {
    render(<Today store={await ready()} />);
    expect(screen.queryByRole('button', { name: /Park “Buy stamps”/ })).toBeNull();
  });
});

describe('the sync stamp', () => {
  it('is silent on a current file and speaks on a stale one', async () => {
    const fresh = await ready();
    const { unmount } = render(<Today store={fresh} />);
    expect(screen.queryByText(/^as of /)).toBeNull();
    unmount();

    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const stale = await seededStore(buildStateFile(slices(), { ...META, writtenAt: old }));
    render(<Today store={stale} />);
    expect(screen.getByText(/^as of /)).toBeDefined();
  });
});

describe('before the Mac has ever exported', () => {
  it('says so rather than drawing an empty day', async () => {
    const store = createPhoneStore({
      readStateFile: async () => null,
      readJournal: async () => '',
      appendOp: async () => {},
      rewriteJournal: async () => {},
      onChange: () => () => {},
    });
    await store.refresh();
    render(<Today store={store} />);
    expect(screen.getByText(/Nothing synced yet/)).toBeDefined();
  });
});
