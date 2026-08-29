import { afterEach, describe, it, expect } from 'vitest';
import { replayOps } from './replay';
import { todayStr } from '../dates';
import type { CompanionOp, CompanionRequest } from './ops';
import type { SyncSlices } from './stateFile';

const TS = '2026-08-25T09:30:00.000Z';
const DAY = '2026-08-25';

function slices(): SyncSlices {
  return {
    goals: [
      {
        id: 'g1',
        title: 'Ship it',
        notes: 'first',
        nodes: [
          { id: 'n1', title: 'Step one' },
          { id: 'n2', title: 'Stuck', status: 'blocked', blockedOn: 'waiting on Ana' },
          { id: 'n4', title: 'Finished', status: 'done', doneAt: '2026-08-01' },
          { id: 'c1', title: 'Area', children: [{ id: 'n3', title: 'Nested' }] },
        ],
      },
      { id: 'g2', title: 'Archived', completedAt: '2026-07-01', nodes: [{ id: 'm1', title: 'Old' }] },
    ],
    habits: [],
    tasks: [{ id: 't1', title: 'Buy stamps', done: false, goalId: null }],
    sessions: [],
    lives: [],
  };
}

function op(request: CompanionRequest, over: Partial<CompanionOp> = {}): CompanionOp {
  return { id: 'op-1', ts: TS, baseGeneration: 3, request, ...over };
}

/** The node with `id` in the projection's first goal, wherever it sits. */
function node(out: SyncSlices, id: string, goalId = 'g1') {
  const goal = out.goals.find((g) => g.id === goalId)!;
  const walk = (nodes: typeof goal.nodes): typeof goal.nodes[number] | undefined => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const hit = n.children ? walk(n.children) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(goal.nodes);
}

describe('complete_task', () => {
  it('ticks a step leaf and stamps the op day', () => {
    const out = replayOps(slices(), [op({ tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' } })]);
    expect(node(out, 'n1')).toMatchObject({ status: 'done', doneAt: DAY });
  });

  it('drops blockedOn when a blocked step is ticked', () => {
    const out = replayOps(slices(), [op({ tool: 'complete_task', ref: { kind: 'step', id: 'n2', goalId: 'g1' } })]);
    expect(node(out, 'n2')!.status).toBe('done');
    expect(node(out, 'n2')).not.toHaveProperty('blockedOn');
  });

  it('ticks a loose task', () => {
    const out = replayOps(slices(), [op({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } })]);
    expect(out.tasks[0]).toMatchObject({ done: true, doneAt: DAY });
  });

  it('skips a container — a group is ticked through its leaves', () => {
    const out = replayOps(slices(), [op({ tool: 'complete_task', ref: { kind: 'step', id: 'c1', goalId: 'g1' } })]);
    expect(node(out, 'c1')).not.toHaveProperty('status');
  });
});

describe('set_status', () => {
  it('parks a leaf and carries no doneAt', () => {
    const out = replayOps(slices(), [op({ tool: 'set_status', nodeId: 'n1', status: 'parked' })]);
    expect(node(out, 'n1')!.status).toBe('parked');
    expect(node(out, 'n1')).not.toHaveProperty('doneAt');
  });

  it("'todo' removes the field and the reason with it", () => {
    const out = replayOps(slices(), [op({ tool: 'set_status', nodeId: 'n2', status: 'todo' })]);
    expect(node(out, 'n2')).not.toHaveProperty('status');
    expect(node(out, 'n2')).not.toHaveProperty('blockedOn');
  });

  it("'blocked' carries the reason", () => {
    const out = replayOps(slices(), [
      op({ tool: 'set_status', nodeId: 'n1', status: 'blocked', blockedOn: 'no key' }),
    ]);
    expect(node(out, 'n1')).toMatchObject({ status: 'blocked', blockedOn: 'no key' });
  });

  it('leaving done clears doneAt', () => {
    const out = replayOps(slices(), [op({ tool: 'set_status', nodeId: 'n4', status: 'todo' })]);
    expect(node(out, 'n4')).not.toHaveProperty('doneAt');
  });

  it('a reason attached to a non-blocked status is refused, as the Mac refuses it', () => {
    const out = replayOps(slices(), [
      op({ tool: 'set_status', nodeId: 'n1', status: 'parked', blockedOn: 'nope' }),
    ]);
    expect(node(out, 'n1')).not.toHaveProperty('status');
  });

  it('skips a container', () => {
    const out = replayOps(slices(), [op({ tool: 'set_status', nodeId: 'c1', status: 'parked' })]);
    expect(node(out, 'c1')).not.toHaveProperty('status');
  });
});

describe('add_task', () => {
  it('appends a root leaf carrying the op id', () => {
    const out = replayOps(slices(), [op({ tool: 'add_task', goalId: 'g1', title: 'From the phone' })]);
    const goal = out.goals[0];
    expect(goal.nodes[goal.nodes.length - 1]).toEqual({ id: 'op-1', title: 'From the phone' });
  });

  it('appends under a container parent', () => {
    const out = replayOps(slices(), [
      op({ tool: 'add_task', goalId: 'g1', parentId: 'c1', title: 'Deeper' }),
    ]);
    expect(node(out, 'c1')!.children).toHaveLength(2);
    expect(node(out, 'op-1')).toEqual({ id: 'op-1', title: 'Deeper' });
  });

  it('skips a completed project — the Mac refuses one too', () => {
    const out = replayOps(slices(), [op({ tool: 'add_task', goalId: 'g2', title: 'Nope' })]);
    expect(out.goals[1].nodes).toHaveLength(1);
  });

  it('skips an unknown goal', () => {
    const out = replayOps(slices(), [op({ tool: 'add_task', goalId: 'nope', title: 'Nope' })]);
    expect(out.goals).toEqual(slices().goals);
  });
});

describe('add_loose_task', () => {
  it('appends a task keyed by the op id', () => {
    const out = replayOps(slices(), [op({ tool: 'add_loose_task', title: 'Call the bank' })]);
    expect(out.tasks[1]).toEqual({ id: 'op-1', title: 'Call the bank', done: false, goalId: null });
  });

  it('carries a date when one was given', () => {
    const out = replayOps(slices(), [op({ tool: 'add_loose_task', title: 'Call', date: '2026-08-26' })]);
    expect(out.tasks[1].date).toBe('2026-08-26');
  });
});

describe('log_time', () => {
  it('appends a session against a step', () => {
    const out = replayOps(slices(), [
      op({ tool: 'log_time', ref: { kind: 'step', id: 'n1', goalId: 'g1' }, minutes: 25 }),
    ]);
    expect(out.sessions).toEqual([
      { id: 'op-1', goalId: 'g1', date: DAY, minutes: 25, note: '', nodeId: 'n1' },
    ]);
  });

  it('appends a session against a task, on the date the op names', () => {
    const out = replayOps(slices(), [
      op({ tool: 'log_time', ref: { kind: 'task', id: 't1', goalId: null }, minutes: 40, date: '2026-08-24' }),
    ]);
    expect(out.sessions).toEqual([
      { id: 'op-1', goalId: null, date: '2026-08-24', minutes: 40, note: '', taskId: 't1' },
    ]);
  });

  it('skips work that is not there', () => {
    const out = replayOps(slices(), [
      op({ tool: 'log_time', ref: { kind: 'step', id: 'gone', goalId: 'g1' }, minutes: 25 }),
    ]);
    expect(out.sessions).toEqual([]);
  });
});

describe('append_note', () => {
  it('separates two paragraphs with a blank line', () => {
    const out = replayOps(slices(), [
      op({ tool: 'append_note', ref: { kind: 'project', id: 'g1' }, markdown: 'second' }),
    ]);
    expect(out.goals[0].notes).toBe('first\n\nsecond');
  });

  it('appending to nothing is setting', () => {
    const out = replayOps(slices(), [
      op({ tool: 'append_note', ref: { kind: 'step', id: 'n1' }, markdown: 'a thought' }),
    ]);
    expect(node(out, 'n1')!.notes).toBe('a thought');
  });

  it('skips a note ref that names nothing', () => {
    const out = replayOps(slices(), [
      op({ tool: 'append_note', ref: { kind: 'step', id: 'gone' }, markdown: 'lost' }),
    ]);
    expect(out.goals).toEqual(slices().goals);
  });
});

/**
 * The day a stamp names is the LOCAL calendar day, because that is the day
 * `todayStr()` hands `toggleTask` and `applyStatus` when the Mac ingests the
 * same op. `op.ts` is a UTC instant: its first ten characters name a DIFFERENT
 * day for everyone east of Greenwich between midnight and their offset, and
 * west of it after their evening. A row ticked at 00:30 in Bangkok would be
 * stamped yesterday, and `buildDailyWork` — which matches `doneAt` against
 * today — would drop it out of "Done today" the instant it was ticked.
 */
describe('the day an op is stamped with', () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  /** Node re-reads `TZ` per `Date` call, so a zone can be pinned per case. */
  function inZone<T>(tz: string, fn: () => T): T {
    process.env.TZ = tz;
    return fn();
  }

  it('is the local day east of Greenwich, where UTC is still yesterday', () => {
    // 00:30 on the 30th in Bangkok; 17:30 on the 29th in UTC.
    const out = inZone('Asia/Bangkok', () => replayOps(slices(), [
      op({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } }, { ts: '2026-08-29T17:30:00.000Z' }),
    ]));
    expect(out.tasks[0].doneAt).toBe('2026-08-30');
  });

  it('is the local day west of Greenwich, where UTC is already tomorrow', () => {
    // 21:30 on the 29th in Los Angeles; 04:30 on the 30th in UTC.
    const out = inZone('America/Los_Angeles', () => replayOps(slices(), [
      op({ tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' } }, { ts: '2026-08-30T04:30:00.000Z' }),
    ]));
    expect(node(out, 'n1')).toMatchObject({ status: 'done', doneAt: '2026-08-29' });
  });

  it('dates an unstated log_time session the same way', () => {
    const out = inZone('Asia/Bangkok', () => replayOps(slices(), [
      op({ tool: 'log_time', ref: { kind: 'task', id: 't1', goalId: null }, minutes: 30 }, { ts: '2026-08-29T17:30:00.000Z' }),
    ]));
    expect(out.sessions[0].date).toBe('2026-08-30');
  });

  it('is the day the OP carries, when it carries one', () => {
    // The phone recorded the 29th; this reader's zone would make the same
    // instant the 30th. The phone is where the tap happened, so it wins.
    const out = inZone('Asia/Bangkok', () => replayOps(slices(), [
      op(
        { tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } },
        { ts: '2026-08-29T17:30:00.000Z', day: '2026-08-29' },
      ),
    ]));
    expect(out.tasks[0].doneAt).toBe('2026-08-29');
  });

  it('falls back to today when the timestamp is unreadable, rather than stamping NaN', () => {
    const out = replayOps(slices(), [
      op({ tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } }, { ts: 'not-a-timestamp' }),
    ]);
    expect(out.tasks[0].doneAt).toBe(todayStr());
  });
});

describe('the projection as a whole', () => {
  it('never mutates its input', () => {
    const input = slices();
    const before = JSON.stringify(input);
    replayOps(input, [
      op({ tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' } }),
      op({ tool: 'add_loose_task', title: 'x' }, { id: 'op-2' }),
      op({ tool: 'append_note', ref: { kind: 'project', id: 'g1' }, markdown: 'more' }, { id: 'op-3' }),
    ]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('an op against a deleted node is skipped and the ops after it still land', () => {
    const out = replayOps(slices(), [
      op({ tool: 'complete_task', ref: { kind: 'step', id: 'gone', goalId: 'g1' } }),
      op({ tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' } }, { id: 'op-2' }),
    ]);
    expect(node(out, 'n1')!.status).toBe('done');
  });

  it('replaying nothing returns an equal projection', () => {
    expect(replayOps(slices(), [])).toEqual(slices());
  });
});
