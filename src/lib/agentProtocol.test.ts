import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validAgentRequest, okResponse, errorResponse, AGENT_TOOLS, AGENT_RESOURCES, AGENT_PROMPTS,
} from './agentProtocol';
import { PLAN_MY_DAY, REVIEW_WEEK, logSessionPrompt } from './agentPrompts';
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
describe('note and ledger requests', () => {
  it('accepts a NoteRef of kind step or project, and nothing else', () => {
    expect(validAgentRequest({ tool: 'get_note', ref: { kind: 'step', id: 'n1' } })).toBe(true);
    expect(validAgentRequest({ tool: 'get_note', ref: { kind: 'project', id: 'g1' } })).toBe(true);
    expect(validAgentRequest({ tool: 'get_note', ref: { kind: 'task', id: 't1' } })).toBe(false);
  });

  it('set_note takes an empty string (that is how a note is cleared) but not a non-string', () => {
    expect(validAgentRequest({ tool: 'set_note', ref: { kind: 'step', id: 'n1' }, markdown: '' })).toBe(true);
    expect(validAgentRequest({ tool: 'set_note', ref: { kind: 'step', id: 'n1' }, markdown: null })).toBe(false);
    expect(validAgentRequest({ tool: 'append_note', ref: { kind: 'step', id: 'n1' } })).toBe(false);
  });

  it('log_time needs a positive whole-day-bounded minutes and an optional YYYY-MM-DD', () => {
    const ref = { kind: 'task', id: 't1', goalId: null };
    expect(validAgentRequest({ tool: 'log_time', ref, minutes: 30 })).toBe(true);
    expect(validAgentRequest({ tool: 'log_time', ref, minutes: 30, date: '2026-08-01' })).toBe(true);
    expect(validAgentRequest({ tool: 'log_time', ref, minutes: 0 })).toBe(false);
    expect(validAgentRequest({ tool: 'log_time', ref, minutes: 30, date: 'yesterday' })).toBe(false);
    expect(validAgentRequest({ tool: 'log_time', ref, minutes: 1441 })).toBe(false);
  });

  it('time_log and clear_time take a WorkRef', () => {
    expect(validAgentRequest({ tool: 'time_log', ref: { kind: 'step', id: 'n1', goalId: 'g1' } })).toBe(true);
    expect(validAgentRequest({ tool: 'clear_time', ref: { kind: 'step', id: 'n1' } })).toBe(false);
  });
});

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

  it('every resource URI in mcp/server.js forwards to the read AGENT_RESOURCES names', () => {
    const match = SERVER.match(/const RESOURCES = \{([\s\S]*?)\n\};/);
    if (!match) throw new Error('could not locate const RESOURCES in mcp/server.js');
    const declared = Object.fromEntries(
      [...match[1].matchAll(/'([^']+)': '(\w+)'/g)].map((m) => [m[1], m[2]]),
    );
    expect(declared).toEqual(AGENT_RESOURCES);
  });

  it('every prompt in mcp/server.js is in AGENT_PROMPTS, and its text is the lib copy', () => {
    const match = SERVER.match(/const PROMPTS = \{([\s\S]*?)\n\};/);
    if (!match) throw new Error('could not locate const PROMPTS in mcp/server.js');
    const names = [...match[1].matchAll(/^\s{2}'([\w-]+)': \[/gm)].map((m) => m[1]);
    expect(names).toEqual([...AGENT_PROMPTS]);
    // The server inlines the prompt bodies as arrays of single-quoted lines.
    // Reassembling them pins the COPY to the lib text, line for line.
    const bodies = [...match[1].matchAll(/\(\{?[^)]*\}?\) => \[\n([\s\S]*?)\n\s{4}\]\.join/g)]
      .map((m) => m[1].split('\n').map((line) => {
        const lit = line.trim().replace(/,$/, '');
        // eslint-disable-next-line no-new-func
        return new Function(`const task = 'T', minutes = 'M'; return ${lit};`)() as string;
      }).join('\n'));
    expect(bodies).toEqual([PLAN_MY_DAY, REVIEW_WEEK, logSessionPrompt('T', 'M')]);
  });
});
