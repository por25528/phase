import { describe, it, expect } from 'vitest';
import { buildStateFile, parseStateFile, type SyncSlices } from './stateFile';
import type { StateFileMeta } from './ops';

const slices: SyncSlices = {
  goals: [{ id: 'g1', title: 'Ship it', nodes: [{ id: 'n1', title: 'Step one' }] }],
  habits: [],
  tasks: [{ id: 't1', title: 'Buy stamps', done: false, goalId: null }],
  sessions: [],
  lives: [],
};
const meta: StateFileMeta = { generation: 4, writtenAt: '2026-08-25T10:00:00.000Z', ingestedThroughOpId: 'op-9' };

describe('state file round-trip', () => {
  it('parses what it builds', () => {
    const parsed = parseStateFile(buildStateFile(slices, meta));
    expect(parsed).not.toBeNull();
    expect(parsed!.meta).toEqual(meta);
    expect(parsed!.goals[0].nodes[0].id).toBe('n1');
    expect(parsed!.tasks[0].title).toBe('Buy stamps');
  });

  it('accepts a null ingestedThroughOpId', () => {
    const parsed = parseStateFile(buildStateFile(slices, { ...meta, ingestedThroughOpId: null }));
    expect(parsed!.meta.ingestedThroughOpId).toBeNull();
  });
});

describe('corrupt input → null, never partial salvage', () => {
  it.each([
    ['truncated JSON', buildStateFile(slices, meta).slice(0, 40)],
    ['not an object', '"hello"'],
    ['missing meta', JSON.stringify({ ...slices })],
    ['generation not a number', JSON.stringify({ ...slices, meta: { ...meta, generation: '4' } })],
    ['missing an entity array', JSON.stringify({ ...slices, tasks: undefined, meta })],
    ['entity without id', JSON.stringify({ ...slices, tasks: [{ title: 'no id' }], meta })],
  ])('%s', (_name, text) => {
    expect(parseStateFile(text)).toBeNull();
  });
});
