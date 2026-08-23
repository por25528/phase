import { describe, it, expect } from 'vitest';
import { promoteWork, switchCandidates } from './pickWork';
import type { ExecutionAdvice, RecommendedWork } from './executionAdvisor';

const work = (id: string): RecommendedWork => ({
  key: `task:${id}`, ref: { kind: 'task', id, goalId: null }, title: id,
  reason: 'due', expected: { kind: 'starter', minutes: 30 },
});
const advice = (): ExecutionAdvice => ({
  kind: 'work', primary: work('a'), alternatives: [work('b'), work('c')],
}) as ExecutionAdvice;

describe('promoteWork', () => {
  it('moves the chosen alternative to primary and the old primary to the front of the rest', () => {
    const out = promoteWork(advice(), { kind: 'task', id: 'c', goalId: null });
    expect(out.kind === 'work' && out.primary.title).toBe('c');
    expect(out.kind === 'work' && out.alternatives.map((w) => w.title)).toEqual(['a', 'b']);
  });

  it('is the identity for no choice, the current primary, or a ref the advice does not hold', () => {
    const a = advice();
    expect(promoteWork(a, null)).toBe(a);
    expect(promoteWork(a, { kind: 'task', id: 'a', goalId: null })).toBe(a);
    expect(promoteWork(a, { kind: 'task', id: 'zz', goalId: null })).toBe(a);
    const clear = { kind: 'clear' } as ExecutionAdvice;
    expect(promoteWork(clear, { kind: 'task', id: 'a', goalId: null })).toBe(clear);
  });
});

describe('switchCandidates', () => {
  it('lists primary and alternatives minus the running work', () => {
    expect(switchCandidates(advice(), { kind: 'task', id: 'b', goalId: null }).map((w) => w.title))
      .toEqual(['a', 'c']);
  });
  it('includes the primary when something else is running', () => {
    expect(switchCandidates(advice(), { kind: 'step', id: 'x', goalId: 'g' }).map((w) => w.title))
      .toEqual(['a', 'b', 'c']);
  });
});
