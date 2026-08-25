import { describe, it, expect } from 'vitest';
import { parseOpsJournal, serializeOp, opsAfter, type CompanionOp } from './ops';

const op = (id: string): CompanionOp => ({
  id,
  ts: '2026-08-25T10:00:00.000Z',
  baseGeneration: 3,
  request: { tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } },
});

describe('serializeOp / parseOpsJournal', () => {
  it('round-trips ops through JSONL', () => {
    const text = [serializeOp(op('a')), serializeOp(op('b'))].join('\n') + '\n';
    expect(parseOpsJournal(text)).toEqual([op('a'), op('b')]);
  });

  it('skips blank, truncated and unknown-verb lines without dropping the rest', () => {
    const text = [
      serializeOp(op('a')),
      '',
      '{"id":"half","ts":"2026-08-25T10:00:00.000Z","baseGen', // truncated mid-append
      JSON.stringify({ ...op('x'), request: { tool: 'delete', ref: { kind: 'task', id: 't1', goalId: null } } }),
      serializeOp(op('b')),
    ].join('\n');
    expect(parseOpsJournal(text).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('accepts the loose-task verb the agent protocol lacks', () => {
    const loose: CompanionOp = {
      id: 'c',
      ts: '2026-08-25T10:00:00.000Z',
      baseGeneration: 0,
      request: { tool: 'add_loose_task', title: 'Buy stamps' },
    };
    expect(parseOpsJournal(serializeOp(loose))).toEqual([loose]);
  });
});

describe('opsAfter', () => {
  const journal = [op('a'), op('b'), op('c')];

  it('slices strictly after the ingested id', () => {
    expect(opsAfter(journal, 'b').map((o) => o.id)).toEqual(['c']);
  });

  it('returns everything for null', () => {
    expect(opsAfter(journal, null)).toHaveLength(3);
  });

  it('returns everything when the id is not in the journal', () => {
    expect(opsAfter(journal, 'gone')).toHaveLength(3);
  });

  it('returns empty when the last op is the ingested one', () => {
    expect(opsAfter(journal, 'c')).toEqual([]);
  });
});
