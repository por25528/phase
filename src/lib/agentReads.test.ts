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

  it('distinguishes "no hours set" from "no time left" on today', () => {
    const res = handleAgentRead({ tool: 'today' }, emptyState());
    expect(res?.ok).toBe(true);
    // `executionAdvisor` answers `needs-hours` when availability is unset —
    // the read must pass that verdict through, never flatten it to a zero.
    expect((res as { data: { advice: { kind: string } } }).data.advice.kind)
      .toBe('needs-hours');
  });
});
