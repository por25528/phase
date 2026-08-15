import { describe, it, expect } from 'vitest';
import { DEMANDS, DEMAND_RANK, DEMAND_WORD, demandIndex, isDemand, taskDemand } from './demand';
import type { Goal, GoalNode, Task } from '../db/types';

describe('the vocabulary', () => {
  it('ranks light below moderate below deep', () => {
    expect(DEMAND_RANK.light).toBeLessThan(DEMAND_RANK.moderate);
    expect(DEMAND_RANK.moderate).toBeLessThan(DEMAND_RANK.deep);
  });

  it('names every value exactly once, in ascending order', () => {
    expect(DEMANDS).toEqual(['light', 'moderate', 'deep']);
    expect(DEMANDS.map((d) => DEMAND_WORD[d])).toEqual(['Light', 'Moderate', 'Deep']);
  });

  it('does not reuse the dial words, which mean the opposite pole', () => {
    const words = Object.values(DEMAND_WORD);
    expect(words).not.toContain('Low');
    expect(words).not.toContain('High');
  });
});

describe('isDemand', () => {
  it('accepts the three values', () => {
    expect(isDemand('light')).toBe(true);
    expect(isDemand('moderate')).toBe(true);
    expect(isDemand('deep')).toBe(true);
  });

  it('is total: anything else is not a demand', () => {
    for (const raw of ['Light', 'low', '', null, undefined, 3, {}, []]) {
      expect(isDemand(raw)).toBe(false);
    }
  });
});

const node = (id: string, extra: Partial<GoalNode> = {}): GoalNode =>
  ({ id, title: id, ...extra });

const goal = (id: string, nodes: GoalNode[], extra: Partial<Goal> = {}): Goal =>
  ({ id, title: id, nodes, ...extra });

describe('demandIndex', () => {
  it('gives an untagged tree nothing, so today is unchanged', () => {
    const g = goal('g', [node('a'), node('b', { children: [node('c')] })]);
    expect(demandIndex([g]).size).toBe(0);
  });

  it("inherits a goal's demand by every descendant", () => {
    const g = goal('g', [node('a', { children: [node('b')] })], { demand: 'deep' });
    const index = demandIndex([g]);
    expect(index.get('a')).toEqual({ level: 'deep', source: 'inherited' });
    expect(index.get('b')).toEqual({ level: 'deep', source: 'inherited' });
  });

  it("prefers a node's own tag over an ancestor's", () => {
    const g = goal('g', [node('a', { demand: 'light' })], { demand: 'deep' });
    expect(demandIndex([g]).get('a')).toEqual({ level: 'light', source: 'own' });
  });

  it('lets the NEAREST tagged ancestor win over a farther one', () => {
    const g = goal(
      'g',
      [node('outer', { demand: 'deep', children: [node('mid', { demand: 'light', children: [node('leaf')] })] })],
      { demand: 'moderate' },
    );
    const index = demandIndex([g]);
    expect(index.get('outer')).toEqual({ level: 'deep', source: 'own' });
    expect(index.get('mid')).toEqual({ level: 'light', source: 'own' });
    expect(index.get('leaf')).toEqual({ level: 'light', source: 'inherited' });
  });

  it('indexes containers as well as leaves — a container is taggable', () => {
    const g = goal('g', [node('parent', { demand: 'deep', children: [node('kid')] })]);
    expect(demandIndex([g]).has('parent')).toBe(true);
  });

  it('keeps goals separate', () => {
    const a = goal('a', [node('x')], { demand: 'deep' });
    const b = goal('b', [node('y')]);
    const index = demandIndex([a, b]);
    expect(index.get('x')).toEqual({ level: 'deep', source: 'inherited' });
    expect(index.has('y')).toBe(false);
  });
});

describe('taskDemand', () => {
  const task = (extra: Partial<Task> = {}): Task =>
    ({ id: 't', title: 't', done: false, goalId: null, ...extra });

  it('reads a task\'s own tag', () => {
    expect(taskDemand(task({ demand: 'light' }))).toEqual({ level: 'light', source: 'own' });
  });

  it('is undefined when untagged', () => {
    expect(taskDemand(task())).toBeUndefined();
  });

  it('NEVER inherits through goalId — that is a context tag, not a parent', () => {
    expect(taskDemand(task({ goalId: 'g' }))).toBeUndefined();
  });
});
