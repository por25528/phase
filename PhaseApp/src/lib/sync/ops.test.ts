import { afterEach, describe, it, expect } from 'vitest';
import { parseOpsJournal, serializeOp, opsAfter, opDay, type CompanionOp } from './ops';
import { todayStr } from '../dates';

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

/**
 * `opDay` is the ONE answer to "which day does this op belong to", spent by
 * the phone's projection and by the Mac's ingest alike. They read it at
 * different moments — the phone the instant the tap happened, the Mac whenever
 * it next opens — and the whole point is that both get the same string.
 */
describe('opDay', () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('is the day the phone recorded, whatever the reader’s clock says', () => {
    process.env.TZ = 'America/Los_Angeles';
    // The instant lands on a different day in this zone than the phone's.
    expect(opDay({ ...op('a'), day: '2026-08-29', ts: '2026-08-30T04:30:00.000Z' })).toBe('2026-08-29');
  });

  it('falls back to the local day of the timestamp for an op with no day', () => {
    process.env.TZ = 'Asia/Bangkok';
    // 00:30 on the 30th there; the 29th in UTC.
    expect(opDay({ ...op('a'), ts: '2026-08-29T17:30:00.000Z' })).toBe('2026-08-30');
  });

  it('ignores a day that is not a date, rather than stamping nonsense', () => {
    // Pinned: the fallback reads the instant in the READER's zone, and
    // `10:00Z` on the 25th is already the 26th at UTC+14.
    process.env.TZ = 'UTC';
    expect(opDay({ ...op('a'), day: 'yesterday', ts: '2026-08-25T10:00:00.000Z' })).toBe('2026-08-25');
  });

  it('falls back to today when neither field is readable', () => {
    process.env.TZ = 'UTC';
    expect(opDay({ ...op('a'), ts: 'not-a-timestamp' })).toBe(todayStr());
  });

  it('rides through the journal — it is a protocol field, not a derivation', () => {
    const dated: CompanionOp = { ...op('a'), day: '2026-08-29' };
    expect(parseOpsJournal(`${serializeOp(dated)}\n`)).toEqual([dated]);
  });

  it('accepts an op without one — an older phone’s journal still ingests', () => {
    expect(parseOpsJournal(`${serializeOp(op('a'))}\n`)).toEqual([op('a')]);
  });
});
