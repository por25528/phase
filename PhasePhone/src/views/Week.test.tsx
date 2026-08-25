import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { buildStateFile, type SyncSlices } from '@app/lib/sync/stateFile';
import type { StateFileMeta } from '@app/lib/sync/ops';
import { todayStr, weekDates, parseD } from '@app/lib/dates';
import { seededStore } from '../test/seededStore';
import { Week } from './Week';

afterEach(cleanup);

const TODAY = todayStr();
const DAYS = weekDates(TODAY);
/** Two days of this week that are not the same day, whatever today is. */
const [FIRST, SECOND] = DAYS[0] === TODAY ? [DAYS[0], DAYS[2]] : [DAYS[0], DAYS[1]];

function heading(date: string): string {
  const d = parseD(date);
  return `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${d.getDate()}`;
}

function slices(): SyncSlices {
  return {
    goals: [
      {
        id: 'g1',
        title: 'Thesis',
        nodes: [
          {
            id: 'n1',
            title: 'Draft chapter 2',
            blocks: [{ id: 'b1', date: FIRST, startMin: 9 * 60, minutes: 90 }],
          },
          {
            id: 'n2',
            title: 'Next week, not this one',
            blocks: [{ id: 'b3', date: '2030-01-07', startMin: 600, minutes: 30 }],
          },
        ],
      },
    ],
    habits: [],
    tasks: [
      {
        id: 't1',
        title: 'Dentist',
        done: false,
        goalId: null,
        blocks: [{ id: 'b2', date: SECOND, startMin: 14 * 60, minutes: 45 }],
      },
    ],
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

describe('the week glance', () => {
  it('files each sitting under its own day', async () => {
    render(<Week store={await ready()} />);

    const first = screen.getByRole('heading', { name: heading(FIRST) }).closest('section')!;
    expect(within(first).getByText('Draft chapter 2')).toBeDefined();

    const second = screen.getByRole('heading', { name: heading(SECOND) }).closest('section')!;
    expect(within(second).getByText('Dentist')).toBeDefined();
  });

  it('states the span, start and end', async () => {
    render(<Week store={await ready()} />);
    const row = screen.getByText('Draft chapter 2').closest('li')!;
    // 09:00 for 90 minutes ends at 10:30, in whichever hour cycle the locale uses.
    expect(row.textContent).toMatch(/9(:00)?\s*(am)?\s*–\s*10:30/);
  });

  it('leaves out a week that is not this one', async () => {
    render(<Week store={await ready()} />);
    expect(screen.queryByText('Next week, not this one')).toBeNull();
  });

  it('names today as today rather than tinting it', async () => {
    const withToday = slices();
    withToday.goals[0].nodes[0].blocks = [{ id: 'b1', date: TODAY, startMin: 540, minutes: 60 }];
    render(<Week store={await seededStore(buildStateFile(withToday, META))} />);
    const section = screen.getByRole('heading', { name: heading(TODAY) }).closest('section')!;
    expect(within(section).getByText('Today')).toBeDefined();
  });

  it('says so when nothing is placed', async () => {
    const empty: SyncSlices = { goals: [], habits: [], tasks: [], sessions: [], lives: [] };
    render(<Week store={await seededStore(buildStateFile(empty, META))} />);
    expect(screen.getByText(/Nothing placed on the calendar/)).toBeDefined();
  });

  it('offers no control — every gesture that would move a sitting stays on the Mac', async () => {
    render(<Week store={await ready()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
