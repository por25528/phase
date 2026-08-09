import { describe, expect, it } from 'vitest';
import type { SearchEntry } from './search';
import {
  COMMANDS,
  DEFAULT_COMMAND_IDS,
  actionsFor,
  commandModeQuery,
  matchCommands,
} from './commands';

const ids = (q: string) => matchCommands(q).map((c) => c.id);

describe('matchCommands', () => {
  it('offers a short, high-frequency set before anything is typed', () => {
    expect(ids('')).toEqual(DEFAULT_COMMAND_IDS);
  });

  it('ranks a label prefix above a label that merely contains the letters', () => {
    const order = ids('go');
    expect(order.indexOf('nav-plan')).toBeLessThan(order.indexOf('new-goal'));
  });

  /**
   * Nobody types "Reclaim space" looking for storage cleanup. A label is one
   * guess at how a thing is named, so the registry carries the others.
   */
  it('finds a command by a word that is not in its label', () => {
    expect(ids('unused')).toContain('reclaim');
    expect(ids('dark')).toContain('theme');
    expect(ids('restore')).toContain('import');
  });

  it('returns nothing rather than everything for a query that matches nothing', () => {
    expect(ids('zzzz')).toEqual([]);
  });

  it('keeps registry order within a tier, so the list does not shuffle', () => {
    expect(ids('go to')).toEqual(['nav-plan', 'nav-goals', 'nav-timeline']);
  });

  it('gives every command a unique id', () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
  });
});

describe('commandModeQuery', () => {
  it('strips the > that puts the palette in command mode', () => {
    expect(commandModeQuery('>sched')).toBe('sched');
    expect(commandModeQuery('>')).toBe('');
  });

  it('leaves an ordinary search alone', () => {
    expect(commandModeQuery('raft')).toBeNull();
  });
});

describe('actionsFor', () => {
  const entry = (over: Partial<SearchEntry>): SearchEntry =>
    ({ kind: 'step', id: 'n', title: 'n', goalId: 'g', ...over });

  it('offers the full verb set on an open task', () => {
    expect(actionsFor(entry({})).map((a) => a.id)).toEqual([
      'open', 'complete', 'schedule-today', 'schedule-tomorrow', 'unschedule',
    ]);
  });

  /**
   * A finished task has nothing left to schedule. Offering "Schedule today"
   * beside a ticked box is a verb that would either do nothing or quietly
   * reopen the thing.
   */
  it('offers only reopening on a task that is already done', () => {
    expect(actionsFor(entry({ done: true })).map((a) => a.id)).toEqual(['open', 'reopen']);
  });

  it('has only one honest verb for a goal', () => {
    expect(actionsFor(entry({ kind: 'project' })).map((a) => a.id)).toEqual(['open']);
  });

  it('sends a habit to the day it is checked off on', () => {
    expect(actionsFor(entry({ kind: 'habit' }))).toEqual([{ id: 'open', label: 'Show in Plan' }]);
  });

  it('names the destination differently for a goal task and a loose one', () => {
    expect(actionsFor(entry({ kind: 'step' }))[0].label).toBe('Open in its goal');
    expect(actionsFor(entry({ kind: 'task' }))[0].label).toBe('Show in Plan');
  });
});
