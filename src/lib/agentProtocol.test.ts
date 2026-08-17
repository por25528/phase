import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validAgentRequest, okResponse, errorResponse, AGENT_TOOLS } from './agentProtocol';
import { HORIZON_LABELS } from './horizons';

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

  it('accepts the four horizon words, in either casing', () => {
    for (const horizon of ['now', 'next', 'later', 'someday']) {
      expect(validAgentRequest({ tool: 'set_horizon', goalId: 'g1', horizon })).toBe(true);
    }
    // `list_projects` answers CAPITALISED, so a read's own output must be
    // accepted on the way back in.
    expect(validAgentRequest({ tool: 'set_horizon', goalId: 'g1', horizon: 'Now' })).toBe(true);
    expect(validAgentRequest({ tool: 'set_horizon', goalId: 'g1', horizon: 'archived' })).toBe(false);
    // A column index is what this verb exists NOT to take: it appears in no
    // read, so a model would have to guess it.
    expect(validAgentRequest({ tool: 'set_horizon', goalId: 'g1', horizon: 3 })).toBe(false);
    expect(validAgentRequest({ tool: 'set_horizon', horizon: 'now' })).toBe(false);
  });
});

describe('response helpers', () => {
  it('wraps data and errors distinguishably', () => {
    expect(okResponse({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(errorResponse('nope')).toEqual({ ok: false, error: 'nope' });
  });
});

/*
 * AGENT_TOOLS has no runtime consumer — `mcp/server.js` declares its own copy
 * because the two processes cannot import from each other. Read it as TEXT and
 * pin both halves of the contract, so the copy cannot drift: every tool the
 * schema advertises stays in the protocol vocabulary, and the horizon enum
 * stays the labels, in both casings.
 */
describe('AGENT_TOOLS vs mcp/server.js', () => {
  const SERVER = readFileSync(new URL('../../mcp/server.js', import.meta.url), 'utf8');

  function declaredTools(): string[] {
    const tools: string[] = [];
    // READS' entries are `name: 'description'` — the key is the two-space
    // indented identifier followed by `: '`. WRITES' and ARGUMENT_READS' are
    // `name: [description, schema]`, so `: [`. READS used to be skipped
    // entirely, and a no-argument read added here but not to AGENT_TOOLS would
    // have passed the drift test — that gap is closed, not a fact of shape.
    const blocks: Array<[string, RegExp]> = [
      ['READS', /^\s{2}(\w+): '/gm],
      ['WRITES', /^\s{2}(\w+): \[/gm],
      ['ARGUMENT_READS', /^\s{2}(\w+): \[/gm],
    ];
    for (const [name, keyPattern] of blocks) {
      const match = SERVER.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`));
      if (!match) throw new Error(`could not locate const ${name} in mcp/server.js`);
      for (const key of match[1].matchAll(keyPattern)) {
        tools.push(key[1]);
      }
    }
    return tools;
  }

  function setHorizonEnumWords(): string[] {
    const entry = SERVER.match(/^\s{2}set_horizon: \[([\s\S]*?)^\s{2}\w+: \[/m);
    if (!entry) throw new Error('could not locate the set_horizon entry in mcp/server.js');
    const enumMatch = entry[1].match(/z\.enum\(\[([^\]]*)\]\)/s);
    if (!enumMatch) throw new Error('could not locate a z.enum inside the set_horizon entry');
    return enumMatch[1].split(',').map((w) => w.trim().replace(/^'|'$/g, ''));
  }

  it('every tool declared by mcp/server.js appears in AGENT_TOOLS', () => {
    const declared = declaredTools();
    const missing = declared.filter((t) => !(AGENT_TOOLS as readonly string[]).includes(t));
    expect(
      missing,
      `tools declared in mcp/server.js but missing from AGENT_TOOLS: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('set_horizon\'s z.enum in mcp/server.js is HORIZON_LABELS, in both casings', () => {
    const expected = [
      ...HORIZON_LABELS.map((l) => l.toLowerCase()),
      ...HORIZON_LABELS,
    ];
    const words = setHorizonEnumWords();
    expect(
      words,
      `set_horizon's z.enum in mcp/server.js is [${words.join(', ')}], expected [${expected.join(', ')}]`,
    ).toEqual(expected);
  });
});
