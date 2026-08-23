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
