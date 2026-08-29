import { describe, it, expect, vi } from 'vitest';
import { ingestJournal, type IngestDeps } from './syncIngest';
import { serializeOp, type CompanionOp, type CompanionRequest } from '../lib/sync/ops';
import type { Goal, Task } from '../db/types';
import type { FullState } from '../state/store';

/**
 * The same fake-deps discipline `agentWrites.test.ts` uses, plus the two
 * high-water accessors: the point of most of these cases is WHERE the mark
 * ends up, so it is held in a plain closure and read back.
 */
function harness(opts: { goals?: Goal[]; tasks?: Task[]; ingestedThrough?: string | null } = {}) {
  let current = {
    goals: opts.goals ?? [],
    tasks: opts.tasks ?? [],
    habits: [],
    sessions: [],
    lives: [],
    availability: [],
    allDayBlocks: false,
    hydration: 'ready',
    persistFailed: false,
    pendingUndo: null,
    toast: null,
  } as unknown as FullState;

  let ingestedThrough: string | null = opts.ingestedThrough ?? null;

  const spies = {
    toggleTask: vi.fn((taskId: string) => {
      current = {
        ...current,
        tasks: current.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)),
      } as FullState;
    }),
    toggleLeaf: vi.fn(),
    setNodeStatus: vi.fn(() => true),
    addTask: vi.fn(),
    logSession: vi.fn(() => true),
    setNodeNotes: vi.fn(),
    setGoalNotes: vi.fn(),
    addRootNode: vi.fn(),
    addChild: vi.fn(),
  };

  const deps: IngestDeps = {
    actions: spies as never,
    getState: () => current,
    getIngestedThrough: () => ingestedThrough,
    setIngestedThrough: (id: string) => {
      ingestedThrough = id;
    },
  };

  return { deps, spies, mark: () => ingestedThrough };
}

let n = 0;
/**
 * The day `op()` CARRIES. A literal on the op rather than a day derived from
 * its timestamp, so every `toHaveBeenCalledWith(id, OP_DAY)` below is exact in
 * whatever zone the suite is run in — `09:00Z` is the 24th in Honolulu and the
 * 25th in Kiritimati, and neither is a fact about ingest. The undated fallback
 * is exercised on purpose, in a pinned zone, at the bottom of this file.
 */
const OP_DAY = '2026-08-25';
function op(request: CompanionRequest, id = `op-${++n}`): CompanionOp {
  return { id, ts: '2026-08-25T09:00:00.000Z', day: OP_DAY, baseGeneration: 1, request };
}

/** The same op, carrying a different day — the phone's, when it differs. */
function opOn(day: string, request: CompanionRequest, id = `op-${++n}`): CompanionOp {
  return { ...op(request, id), day };
}

/** An op from a journal written before `day` existed. */
function undated(request: CompanionRequest, id = `op-${++n}`): CompanionOp {
  const older = op(request, id);
  delete older.day;
  return older;
}

function journal(...ops: CompanionOp[]): string {
  return ops.map(serializeOp).join('\n') + '\n';
}

function task(id: string, done = false): Task {
  return { id, title: id, done, goalId: null };
}

describe('ingestJournal', () => {
  it('applies a complete_task op through handleAgentWrite', () => {
    const h = harness({ tasks: [task('t1')] });
    const result = ingestJournal(
      journal(op({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } })),
      h.deps,
    );
    expect(result).toEqual({ applied: 1, skipped: 0 });
    expect(h.spies.toggleTask).toHaveBeenCalledWith('t1', OP_DAY);
  });

  it('maps add_loose_task onto actions.addTask — the one verb the agent protocol lacks', () => {
    const h = harness();
    const result = ingestJournal(
      journal(op({ tool: 'add_loose_task', title: 'Buy milk', date: '2026-08-26' })),
      h.deps,
    );
    expect(result).toEqual({ applied: 1, skipped: 0 });
    expect(h.spies.addTask).toHaveBeenCalledWith('Buy milk', '2026-08-26', null);
  });

  it('passes a dateless capture through as null rather than today', () => {
    const h = harness();
    ingestJournal(journal(op({ tool: 'add_loose_task', title: 'Someday' })), h.deps);
    expect(h.spies.addTask).toHaveBeenCalledWith('Someday', null, null);
  });

  it('skips an op whose target is gone, keeps going, and still advances the mark', () => {
    const h = harness({ tasks: [task('t2')] });
    const result = ingestJournal(
      journal(
        op({ tool: 'complete_task', ref: { kind: 'task', id: 'ghost', goalId: null } }, 'op-a'),
        op({ tool: 'complete_task', ref: { kind: 'task', id: 't2', goalId: null } }, 'op-b'),
      ),
      h.deps,
    );
    expect(result).toEqual({ applied: 1, skipped: 1 });
    expect(h.spies.toggleTask).toHaveBeenCalledWith('t2', OP_DAY);
    expect(h.mark()).toBe('op-b');
  });

  it('advances the mark after EACH op, so a crash mid-journal never replays', () => {
    const marks: (string | null)[] = [];
    const h = harness({ tasks: [task('t1'), task('t2')] });
    const spy = h.deps.setIngestedThrough;
    const deps: IngestDeps = {
      ...h.deps,
      setIngestedThrough: (id) => {
        marks.push(id);
        spy(id);
      },
    };
    ingestJournal(
      journal(
        op({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } }, 'op-1'),
        op({ tool: 'complete_task', ref: { kind: 'task', id: 't2', goalId: null } }, 'op-2'),
      ),
      deps,
    );
    expect(marks).toEqual(['op-1', 'op-2']);
  });

  it('ignores ops at or before the high-water mark', () => {
    const h = harness({ tasks: [task('t1'), task('t2')], ingestedThrough: 'op-1' });
    const result = ingestJournal(
      journal(
        op({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } }, 'op-1'),
        op({ tool: 'complete_task', ref: { kind: 'task', id: 't2', goalId: null } }, 'op-2'),
      ),
      h.deps,
    );
    expect(result).toEqual({ applied: 1, skipped: 0 });
    expect(h.spies.toggleTask).toHaveBeenCalledTimes(1);
    expect(h.spies.toggleTask).toHaveBeenCalledWith('t2', OP_DAY);
  });

  it('reads an empty or garbage journal as nothing to do, never a throw', () => {
    const h = harness();
    expect(ingestJournal('', h.deps)).toEqual({ applied: 0, skipped: 0 });
    expect(ingestJournal('{"half":', h.deps)).toEqual({ applied: 0, skipped: 0 });
    expect(h.mark()).toBeNull();
  });

  it('ingests the good lines around a truncated one', () => {
    const h = harness({ tasks: [task('t1')] });
    const text = `${serializeOp(op({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } }, 'op-x'))}\n{"id":"op-y","ts":`;
    expect(ingestJournal(text, h.deps)).toEqual({ applied: 1, skipped: 0 });
    expect(h.mark()).toBe('op-x');
  });

  it('counts a handler throw as skipped and still ingests the ops after it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ tasks: [task('t1')] });
    // Right verb, wrong payload: `parseOpsJournal` checks the envelope, and
    // nothing checks what is inside the request.
    const text = journal(
      op({ tool: 'complete_task' } as never, 'op-bad'),
      op({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } }, 'op-good'),
    );
    expect(ingestJournal(text, h.deps)).toEqual({ applied: 1, skipped: 1 });
    expect(h.spies.toggleTask).toHaveBeenCalledWith('t1', OP_DAY);
    expect(h.mark()).toBe('op-good');
    expect(warn).toHaveBeenCalled();
  });

  it('counts an already-done tick as skipped rather than un-ticking it', () => {
    const h = harness({ tasks: [task('t1', true)] });
    const result = ingestJournal(
      journal(op({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } })),
      h.deps,
    );
    expect(result).toEqual({ applied: 0, skipped: 1 });
    expect(h.spies.toggleTask).not.toHaveBeenCalled();
  });
});

/**
 * The cross-midnight case, which is the whole reason `day` is on the wire.
 *
 * The phone ticks something at 23:50 and projects it under the 29th. The Mac
 * is asleep and ingests at 00:10 — a moment at which `todayStr()` on this side
 * reads the 30th. Stamping the ingest's own clock would move the row to a day
 * the person was asleep for, and would silently disagree with the projection
 * the phone had ALREADY drawn and shown them.
 */
describe('the day an ingested op is stamped with', () => {
  it('is the op’s day, not the moment the Mac happened to read it', () => {
    const h = harness({ tasks: [task('t1')] });
    ingestJournal(
      journal(opOn('2026-08-29', { tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } })),
      h.deps,
    );
    expect(h.spies.toggleTask).toHaveBeenCalledWith('t1', '2026-08-29');
  });

  it('reaches a step completion too', () => {
    const h = harness({
      goals: [{ id: 'g1', title: 'Ship it', nodes: [{ id: 'n1', title: 'Step one' }] }] as Goal[],
    });
    ingestJournal(
      journal(opOn('2026-08-29', { tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' } })),
      h.deps,
    );
    expect(h.spies.toggleLeaf).toHaveBeenCalledWith('n1', '2026-08-29');
  });

  it('reaches a `done` status change, which routes through toggleLeaf', () => {
    const h = harness({
      goals: [{ id: 'g1', title: 'Ship it', nodes: [{ id: 'n1', title: 'Step one' }] }] as Goal[],
    });
    ingestJournal(
      journal(opOn('2026-08-29', { tool: 'set_status', nodeId: 'n1', status: 'done' })),
      h.deps,
    );
    expect(h.spies.toggleLeaf).toHaveBeenCalledWith('n1', '2026-08-29');
  });

  it('reaches every other status change through setNodeStatus', () => {
    const h = harness({
      goals: [{ id: 'g1', title: 'Ship it', nodes: [{ id: 'n1', title: 'Step one' }] }] as Goal[],
    });
    ingestJournal(
      journal(opOn('2026-08-29', { tool: 'set_status', nodeId: 'n1', status: 'parked' })),
      h.deps,
    );
    expect(h.spies.setNodeStatus).toHaveBeenCalledWith('n1', 'parked', undefined, '2026-08-29');
  });

  it('dates an unstated log_time session with it', () => {
    const h = harness({ tasks: [task('t1')] });
    ingestJournal(
      journal(opOn('2026-08-29', {
        tool: 'log_time',
        ref: { kind: 'task', id: 't1', goalId: null },
        minutes: 25,
      })),
      h.deps,
    );
    expect(h.spies.logSession).toHaveBeenCalledWith('task', 't1', 25, '2026-08-29');
  });

  it('leaves a stated log_time date alone — the op asked for that day', () => {
    const h = harness({ tasks: [task('t1')] });
    ingestJournal(
      journal(opOn('2026-08-29', {
        tool: 'log_time',
        ref: { kind: 'task', id: 't1', goalId: null },
        minutes: 25,
        date: '2026-08-27',
      })),
      h.deps,
    );
    expect(h.spies.logSession).toHaveBeenCalledWith('task', 't1', 25, '2026-08-27');
  });

  it('falls back to the op’s timestamp when an older journal carries no day', () => {
    const ORIGINAL_TZ = process.env.TZ;
    try {
      // Pinned, because the whole claim is about how a bare instant is read:
      // 09:00Z on the 25th is 23:00 on the 24th here, and that is the answer
      // an undated op has to produce.
      process.env.TZ = 'Pacific/Honolulu';
      const h = harness({ tasks: [task('t1')] });
      ingestJournal(
        journal(undated({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } })),
        h.deps,
      );
      expect(h.spies.toggleTask).toHaveBeenCalledWith('t1', '2026-08-24');
    } finally {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    }
  });
});
