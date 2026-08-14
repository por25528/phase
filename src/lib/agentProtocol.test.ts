import { describe, it, expect } from 'vitest';
import { validAgentRequest, okResponse, errorResponse } from './agentProtocol';

describe('validAgentRequest', () => {
  it('accepts a no-argument read', () => {
    expect(validAgentRequest({ tool: 'today' })).toBe(true);
  });

  it('rejects an unknown tool', () => {
    expect(validAgentRequest({ tool: 'drop_database' })).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(validAgentRequest('today')).toBe(false);
    expect(validAgentRequest(null)).toBe(false);
  });

  it('requires goalId on get_project', () => {
    expect(validAgentRequest({ tool: 'get_project', goalId: 'g1' })).toBe(true);
    expect(validAgentRequest({ tool: 'get_project' })).toBe(false);
    expect(validAgentRequest({ tool: 'get_project', goalId: 42 })).toBe(false);
  });

  it('validates a WorkRef on complete_task', () => {
    expect(validAgentRequest({
      tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    })).toBe(true);
    expect(validAgentRequest({
      tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null },
    })).toBe(true);
    expect(validAgentRequest({
      tool: 'complete_task', ref: { kind: 'habit', id: 'h1', goalId: null },
    })).toBe(false);
    expect(validAgentRequest({ tool: 'complete_task' })).toBe(false);
  });

  it('accepts only the four statuses on set_status', () => {
    for (const status of ['todo', 'doing', 'blocked', 'done']) {
      expect(validAgentRequest({ tool: 'set_status', nodeId: 'n1', status })).toBe(true);
    }
    expect(validAgentRequest({ tool: 'set_status', nodeId: 'n1', status: 'maybe' })).toBe(false);
  });

  it('rejects a negative or absurd estimate', () => {
    expect(validAgentRequest({ tool: 'estimate', nodeId: 'n1', minutes: 30 })).toBe(true);
    expect(validAgentRequest({ tool: 'estimate', nodeId: 'n1', minutes: null })).toBe(true);
    expect(validAgentRequest({ tool: 'estimate', nodeId: 'n1', minutes: -5 })).toBe(false);
    expect(validAgentRequest({ tool: 'estimate', nodeId: 'n1', minutes: 99_999 })).toBe(false);
  });

  it('requires a YYYY-MM-DD day on schedule', () => {
    const ref = { kind: 'step', id: 'n1', goalId: 'g1' };
    expect(validAgentRequest({ tool: 'schedule', ref, day: '2026-08-14' })).toBe(true);
    expect(validAgentRequest({ tool: 'schedule', ref, day: 'friday' })).toBe(false);
  });
});

describe('response helpers', () => {
  it('wraps data and errors distinguishably', () => {
    expect(okResponse({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(errorResponse('nope')).toEqual({ ok: false, error: 'nope' });
  });
});
