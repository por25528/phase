import { describe, it, expect } from 'vitest';
import { handleAgentRead } from './agentReads';
import type { FullState } from '../state/store';

/** The smallest state a read can be asked about: nothing planned, nothing due. */
function emptyState(): FullState {
  return {
    goals: [], tasks: [], habits: [], sessions: [], lives: [],
    availability: [], hydration: 'ready', persistFailed: false,
    pendingUndo: null,
  } as unknown as FullState;
}

describe('handleAgentRead', () => {
  it('returns null for a write, so the dispatcher falls through', () => {
    expect(handleAgentRead({ tool: 'undo_last' }, emptyState())).toBeNull();
  });

  it('answers list_projects with an empty list rather than an error', () => {
    const res = handleAgentRead({ tool: 'list_projects' }, emptyState());
    expect(res).toEqual({ ok: true, data: { projects: [] } });
  });

  it('names a missing project instead of returning empty data', () => {
    const res = handleAgentRead({ tool: 'get_project', goalId: 'nope' }, emptyState());
    expect(res).toEqual({ ok: false, error: 'No project with id "nope".' });
  });

  /*
   * `needs-hours` used to be a distinct verdict here — the read had to pass it
   * through rather than flatten it to a zero. Nothing asks when you work now,
   * so the state is unreachable and an empty database answers `clear`, which
   * is the true thing to say about it.
   */
  it('answers clear on an empty database, with no hours verdict left to pass through', () => {
    const res = handleAgentRead({ tool: 'today' }, emptyState());
    expect(res?.ok).toBe(true);
    expect((res as { data: { advice: { kind: string } } }).data.advice.kind).toBe('clear');
  });
});

describe('get_note / time_log', () => {
  const state = (): FullState => ({
    ...emptyState(),
    goals: [{
      id: 'g1', title: 'Thesis', notes: 'project note',
      nodes: [{ id: 'n1', title: 'Draft' }, { id: 'n2', title: 'Edit', notes: '# plan' }],
    }],
    tasks: [{ id: 't1', title: 'Taxes' }],
    sessions: [
      { id: 's1', goalId: 'g1', date: '2026-08-20', minutes: 30, note: '', nodeId: 'n1' },
      { id: 's2', goalId: 'g1', date: '2026-08-21', minutes: 15, note: 'late', nodeId: 'n1' },
      { id: 's3', goalId: null, date: '2026-08-21', minutes: 10, note: '', taskId: 't1' },
      // Both ids: counted for the NODE only, the rule loggedForTask states.
      { id: 's4', goalId: null, date: '2026-08-21', minutes: 99, note: '', taskId: 't1', nodeId: 'n2' },
    ],
  } as unknown as FullState);

  it('answers an empty string for a step with no note, and the note when there is one', () => {
    expect(handleAgentRead({ tool: 'get_note', ref: { kind: 'step', id: 'n1' } }, state()))
      .toEqual({ ok: true, data: { title: 'Draft', markdown: '' } });
    expect(handleAgentRead({ tool: 'get_note', ref: { kind: 'step', id: 'n2' } }, state()))
      .toEqual({ ok: true, data: { title: 'Edit', markdown: '# plan' } });
  });

  it('reads a project note', () => {
    expect(handleAgentRead({ tool: 'get_note', ref: { kind: 'project', id: 'g1' } }, state()))
      .toEqual({ ok: true, data: { title: 'Thesis', markdown: 'project note' } });
  });

  it('names a missing ref', () => {
    expect(handleAgentRead({ tool: 'get_note', ref: { kind: 'step', id: 'x' } }, state()))
      .toEqual({ ok: false, error: 'No task with id "x".' });
  });

  it('sums a step\'s ledger the way TaskPage does and lists the entries', () => {
    expect(handleAgentRead({ tool: 'time_log', ref: { kind: 'step', id: 'n1', goalId: 'g1' } }, state()))
      .toEqual({ ok: true, data: { loggedMin: 45, sessions: [
        { id: 's1', date: '2026-08-20', minutes: 30, note: '' },
        { id: 's2', date: '2026-08-21', minutes: 15, note: 'late' },
      ] } });
  });

  it('a session carrying both ids is charged to the node, never the task', () => {
    expect(handleAgentRead({ tool: 'time_log', ref: { kind: 'task', id: 't1', goalId: null } }, state()))
      .toEqual({ ok: true, data: { loggedMin: 10, sessions: [
        { id: 's3', date: '2026-08-21', minutes: 10, note: '' },
      ] } });
  });

  it('names a task it cannot find rather than answering zero', () => {
    expect(handleAgentRead({ tool: 'time_log', ref: { kind: 'task', id: 'zz', goalId: null } }, state()))
      .toEqual({ ok: false, error: 'No task with id "zz".' });
  });
});

describe('propose_replan', () => {
  it('answers the proposal shape, empty when nothing slipped', () => {
    expect(handleAgentRead({ tool: 'propose_replan' }, emptyState()))
      .toEqual({ ok: true, data: { moves: [], unplaceable: [] } });
  });

  it('proposes a forward day for a sitting placed in the past', () => {
    const state = {
      ...emptyState(),
      goals: [{ id: 'g1', title: 'Thesis', nodes: [
        { id: 'n1', title: 'Draft', blocks: [{ id: 'b1', date: '2000-01-03', startMin: 540, minutes: 60 }] },
      ] }],
    } as unknown as FullState;
    const res = handleAgentRead({ tool: 'propose_replan' }, state);
    const data = (res as { data: { moves: Array<{ blockId: string; to: string; from: string }> } }).data;
    expect(data.moves).toHaveLength(1);
    expect(data.moves[0]).toMatchObject({ blockId: 'b1', from: '2000-01-03' });
    expect(data.moves[0].to > '2000-01-03').toBe(true);
  });
});
