import { describe, it, expect } from 'vitest';
import {
  priorityToColumn,
  columnToPriority,
  defaultDeadline,
  buildNode,
  buildManualGoal,
  parseGoalImport,
  buildAiPrompt,
  sanitizeBackupGoal,
} from './goalImport';
import type { Goal, GoalNode } from '../db/types';

const TODAY = '2026-07-05';

// parseGoalImport returns { goals } on success; narrow for tests.
function ok(r: { goals: Goal[] } | { error: string }): Goal[] {
  if ('error' in r) throw new Error(`expected goals, got error: ${r.error}`);
  return r.goals;
}
function err(r: { goals: Goal[] } | { error: string }): string {
  if (!('error' in r)) throw new Error('expected error, got goals');
  return r.error;
}

describe('sanitizeBackupGoal', () => {
  const base: Goal = { id: 'g', title: 'G', start: '2026-01-01', deadline: '2026-12-31', nodes: [] };

  it('keeps a valid completedAt', () => {
    expect(sanitizeBackupGoal({ ...base, completedAt: '2026-07-10' }).completedAt).toBe('2026-07-10');
  });

  it('drops an invalid completedAt so a bad value cannot hide the project', () => {
    expect(sanitizeBackupGoal({ ...base, completedAt: 'nope' as unknown as string }).completedAt).toBeUndefined();
    expect(sanitizeBackupGoal({ ...base, completedAt: 20260710 as unknown as string }).completedAt).toBeUndefined();
  });

  it('leaves a goal without completedAt untouched', () => {
    expect('completedAt' in sanitizeBackupGoal(base)).toBe(false);
  });
});

// ---- priorityToColumn / columnToPriority ----

describe('priorityToColumn', () => {
  it('maps the horizon words to columns 0–3', () => {
    expect(priorityToColumn('now')).toBe(0);
    expect(priorityToColumn('next')).toBe(1);
    expect(priorityToColumn('later')).toBe(2);
    expect(priorityToColumn('someday')).toBe(3);
  });

  it('still accepts the legacy priority words', () => {
    expect(priorityToColumn('highest')).toBe(0);
    expect(priorityToColumn('high')).toBe(1);
    expect(priorityToColumn('medium')).toBe(2);
    // 'later' is shared — the horizon meaning (column 2) wins so fresh exports round-trip.
    expect(priorityToColumn('later')).toBe(2);
  });

  it('is case/whitespace insensitive', () => {
    expect(priorityToColumn('  HIGH ')).toBe(1);
    expect(priorityToColumn(' Someday ')).toBe(3);
  });

  it('defaults unknown / non-string to 0', () => {
    expect(priorityToColumn('urgent')).toBe(0);
    expect(priorityToColumn(undefined)).toBe(0);
    expect(priorityToColumn(3)).toBe(0);
  });

  it('columnToPriority is the inverse and clamps', () => {
    expect(columnToPriority(0)).toBe('now');
    expect(columnToPriority(2)).toBe('later');
    expect(columnToPriority(3)).toBe('someday');
    expect(columnToPriority(99)).toBe('someday');
    expect(columnToPriority(undefined)).toBe('now');
  });
});

describe('defaultDeadline', () => {
  it('is Dec 31 of the year in `today`', () => {
    expect(defaultDeadline('2026-07-05')).toBe('2026-12-31');
    expect(defaultDeadline('2030-01-01')).toBe('2030-12-31');
  });
});

// ---- buildNode ----

describe('buildNode', () => {
  it('turns a plain string into a leaf with done:false', () => {
    const n = buildNode('Pick one idea')!;
    expect(n.title).toBe('Pick one idea');
    expect(n.done).toBe(false);
    expect(n.children).toBeUndefined();
    expect(typeof n.id).toBe('string');
  });

  it('drops blank / untitled specs', () => {
    expect(buildNode('   ')).toBeNull();
    expect(buildNode({ title: '' })).toBeNull();
    expect(buildNode({ subgoals: ['x'] })).toBeNull(); // no title
  });

  it('an object with subgoals becomes a container (no done)', () => {
    const n = buildNode({ title: 'Build v1', subgoals: ['a', 'b'] })!;
    expect(n.children).toHaveLength(2);
    expect(n.done).toBeUndefined();
    expect(n.children!.every((c: GoalNode) => c.done === false)).toBe(true);
  });

  it('an object with empty subgoals stays a leaf', () => {
    const n = buildNode({ title: 'solo', subgoals: [] })!;
    expect(n.done).toBe(false);
    expect(n.children).toBeUndefined();
  });

  it('carries start/deadline on a leaf only when both are valid dates', () => {
    const both = buildNode({ title: 'x', start: '2026-11-01', deadline: '2026-11-15' })!;
    expect(both.start).toBe('2026-11-01');
    expect(both.deadline).toBe('2026-11-15');

    const one = buildNode({ title: 'x', start: '2026-11-01' })!;
    expect(one.start).toBeUndefined();
    expect(one.deadline).toBeUndefined();
  });

  it('clamps a reversed leaf span', () => {
    const n = buildNode({ title: 'x', start: '2026-11-15', deadline: '2026-11-01' })!;
    expect(n.start).toBe('2026-11-01');
    expect(n.deadline).toBe('2026-11-15');
  });

  it('nests recursively', () => {
    const n = buildNode({ title: 'a', subgoals: [{ title: 'b', subgoals: ['c'] }] })!;
    expect(n.children![0].children![0].title).toBe('c');
  });
});

// ---- buildManualGoal ----

describe('buildManualGoal', () => {
  it('builds leaf nodes from titles, dropping blanks', () => {
    const g = buildManualGoal({
      title: 'Launch',
      start: TODAY,
      deadline: '2026-12-31',
      column: 2,
      notes: '',
      subgoalTitles: ['step 1', '  ', 'step 2'],
    });
    expect(g.title).toBe('Launch');
    expect(g.column).toBe(2);
    expect(g.nodes.map((n) => n.title)).toEqual(['step 1', 'step 2']);
    expect(g.nodes.every((n) => n.done === false)).toBe(true);
  });

  it('omits notes when blank, keeps them when present', () => {
    expect(buildManualGoal({ title: 'a', start: TODAY, deadline: TODAY, column: 0, notes: '  ', subgoalTitles: [] }).notes)
      .toBeUndefined();
    expect(buildManualGoal({ title: 'a', start: TODAY, deadline: TODAY, column: 0, notes: 'hi', subgoalTitles: [] }).notes)
      .toBe('hi');
  });

  it('clamps a reversed goal span', () => {
    const g = buildManualGoal({
      title: 'a', start: '2026-12-31', deadline: TODAY, column: 0, notes: '', subgoalTitles: [],
    });
    expect(g.start).toBe(TODAY);
    expect(g.deadline).toBe('2026-12-31');
  });
});

// ---- parseGoalImport ----

describe('parseGoalImport', () => {
  it('parses a single goal object with defaults', () => {
    const [g] = ok(parseGoalImport('{ "title": "Solo" }', TODAY));
    expect(g.title).toBe('Solo');
    expect(g.start).toBe(TODAY);
    expect(g.deadline).toBe('2026-12-31');
    expect(g.column).toBe(0);
    expect(g.nodes).toEqual([]);
  });

  it('parses an array of goals', () => {
    const goals = ok(parseGoalImport('[{ "title": "A" }, { "title": "B" }]', TODAY));
    expect(goals.map((g) => g.title)).toEqual(['A', 'B']);
  });

  it('maps priority words and nested subgoals', () => {
    const json = JSON.stringify({
      title: 'Side project',
      priority: 'medium',
      subgoals: ['Pick idea', { title: 'Build', subgoals: ['Design', 'Backend'] }],
    });
    const [g] = ok(parseGoalImport(json, TODAY));
    expect(g.column).toBe(2);
    expect(g.nodes[0].done).toBe(false);
    expect(g.nodes[1].children!.map((c) => c.title)).toEqual(['Design', 'Backend']);
    expect(g.nodes[1].done).toBeUndefined();
  });

  it('keeps a scheduled leaf’s dates', () => {
    const json = JSON.stringify({
      title: 'g',
      subgoals: [{ title: 'ship', start: '2026-11-01', deadline: '2026-11-15' }],
    });
    const [g] = ok(parseGoalImport(json, TODAY));
    expect(g.nodes[0].start).toBe('2026-11-01');
    expect(g.nodes[0].deadline).toBe('2026-11-15');
  });

  it('rejects malformed JSON without touching anything', () => {
    expect(err(parseGoalImport('{ not json', TODAY))).toMatch(/valid JSON/i);
  });

  it('rejects empty input', () => {
    expect(err(parseGoalImport('   ', TODAY))).toMatch(/paste/i);
  });

  it('rejects (all-or-nothing) when any goal lacks a title, naming it', () => {
    const json = JSON.stringify([{ title: 'ok' }, { notes: 'oops' }]);
    expect(err(parseGoalImport(json, TODAY))).toMatch(/#2 is missing a title/);
  });

  it('rejects a non-object goal entry', () => {
    expect(err(parseGoalImport('["just a string"]', TODAY))).toMatch(/#1/);
  });

  it('clamps a reversed goal span on import', () => {
    const json = JSON.stringify({ title: 'g', start: '2026-12-31', deadline: '2026-01-01' });
    const [g] = ok(parseGoalImport(json, TODAY));
    expect(g.start).toBe('2026-01-01');
    expect(g.deadline).toBe('2026-12-31');
  });

  it('mints unique ids across goals and nodes', () => {
    const json = JSON.stringify([
      { title: 'A', subgoals: ['x', 'y'] },
      { title: 'B', subgoals: ['z'] },
    ]);
    const goals = ok(parseGoalImport(json, TODAY));
    const ids = [
      ...goals.map((g) => g.id),
      ...goals.flatMap((g) => g.nodes.map((n) => n.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---- buildAiPrompt ----

describe('buildAiPrompt', () => {
  it('embeds today’s date and the fill-in line', () => {
    const p = buildAiPrompt(TODAY);
    expect(p).toContain(`Today's date is ${TODAY}`);
    expect(p).toContain("Here's what I want to achieve:");
    expect(p).toContain('"subgoals"');
  });
});
