import { describe, it, expect } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import { migrateNodeStatus } from './migrateNodeStatus';

const goal = (nodes: Goal['nodes']): Goal => ({ id: 'g', title: 'G', nodes });

// Simulates a raw stored/imported node from before the status migration —
// `done` is off the `GoalNode` interface now, but old JSON on disk still
// carries it, which is exactly what this module reads via `hasOwnProperty`.
const legacyNode = (n: Record<string, unknown>): GoalNode => n as unknown as GoalNode;

describe('migrateNodeStatus', () => {
  it('turns a ticked leaf into done, keeping doneAt', () => {
    const [g] = migrateNodeStatus([goal([legacyNode({ id: 'a', title: 'A', done: true, doneAt: '2026-07-01' })])]);
    expect(g.nodes[0].status).toBe('done');
    expect(g.nodes[0].doneAt).toBe('2026-07-01');
    expect('done' in g.nodes[0]).toBe(false);
  });

  it('turns an unticked leaf into an absent status', () => {
    const [g] = migrateNodeStatus([goal([legacyNode({ id: 'a', title: 'A', done: false })])]);
    expect(g.nodes[0].status).toBeUndefined();
    expect('done' in g.nodes[0]).toBe(false);
  });

  it('recurses into containers and leaves the container itself alone', () => {
    const [g] = migrateNodeStatus([goal([
      { id: 'p', title: 'P', children: [legacyNode({ id: 'c', title: 'C', done: true })] },
    ])]);
    expect(g.nodes[0].status).toBeUndefined();
    expect(g.nodes[0].children![0].status).toBe('done');
  });

  /**
   * A container can never carry `status` — it's derived from its children
   * (`containerStatus` in status.ts) — so a legacy `done` sitting directly on
   * a container (a shape that should never exist, but old JSON on disk is not
   * guaranteed to be well-formed) must be stripped without being turned into a
   * `status`. The test above never actually exercised this guard: its
   * container carried no `done` field at all, so its 'status is undefined'
   * assertion held trivially regardless of whether the guard existed.
   */
  it('strips a legacy done sitting directly on a container, without writing a status', () => {
    const [g] = migrateNodeStatus([goal([
      legacyNode({ id: 'p', title: 'P', done: true, children: [{ id: 'c', title: 'C' }] }),
    ])]);
    expect(g.nodes[0].status).toBeUndefined();
    expect('done' in g.nodes[0]).toBe(false);
  });

  it('never invents blockedOn', () => {
    const [g] = migrateNodeStatus([goal([legacyNode({ id: 'a', title: 'A', done: true })])]);
    expect(g.nodes[0].blockedOn).toBeUndefined();
  });

  // Re-running must be harmless: it is called on every load AND on every
  // import, and a backup written a year ago can be imported tomorrow.
  it('is idempotent', () => {
    const once = migrateNodeStatus([goal([legacyNode({ id: 'a', title: 'A', done: true })])]);
    const twice = migrateNodeStatus(once);
    expect(twice[0].nodes[0].status).toBe('done');
  });

  it('preserves object identity when there is nothing to do', () => {
    const input = [goal([{ id: 'a', title: 'A', status: 'doing' }])];
    expect(migrateNodeStatus(input)).toBe(input);
  });

  it('leaves an already-migrated status untouched', () => {
    const [g] = migrateNodeStatus([goal([{ id: 'a', title: 'A', status: 'blocked', blockedOn: 'grader' }])]);
    expect(g.nodes[0].status).toBe('blocked');
    expect(g.nodes[0].blockedOn).toBe('grader');
  });
});
