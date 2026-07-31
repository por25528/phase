import { describe, it, expect } from 'vitest';
import {
  priorityToColumn,
  columnToPriority,
  buildNode,
  buildManualGoal,
  parseGoalImport,
  buildAiPrompt,
  buildSubtaskPrompt,
  parseSubtasks,
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

  it('does not promote legacy backup dates or completion timestamps', () => {
    const legacy: Goal = {
      ...base,
      nodes: [{ id: 'n', title: 'Done before timestamps', done: true }],
    };

    const sanitized = sanitizeBackupGoal(legacy);

    expect(sanitized.datesConfirmed).toBeUndefined();
    expect(sanitized.nodes[0].doneAt).toBeUndefined();
    expect(sanitized).not.toHaveProperty('datesConfirmed');
    expect(sanitized.nodes[0]).not.toHaveProperty('doneAt');
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

  it('keeps each optional project date independently and marks it confirmed', () => {
    const g = buildManualGoal({
      title: 'a', deadline: TODAY, column: 0, notes: '', subgoalTitles: [],
    });
    expect(g.start).toBeUndefined();
    expect(g.deadline).toBe(TODAY);
    expect(g.datesConfirmed).toBe(true);
  });

  it('rejects a reversed explicit project span', () => {
    expect(() => buildManualGoal({
      title: 'a', start: '2026-12-31', deadline: TODAY, column: 0, notes: '', subgoalTitles: [],
    })).toThrow(/start must be/i);
  });
});

// ---- parseGoalImport ----

describe('parseGoalImport', () => {
  it('marks pasted goals confirmed without changing the legacy backup path', () => {
    const [pasted] = ok(parseGoalImport('{ "title": "Pasted", "deadline": "2026-09-01" }', TODAY));
    const backup = sanitizeBackupGoal({
      id: 'legacy',
      title: 'Legacy backup',
      deadline: '2026-09-01',
      nodes: [],
    });

    expect(pasted.datesConfirmed).toBe(true);
    expect(backup.datesConfirmed).toBeUndefined();
    expect(backup).not.toHaveProperty('datesConfirmed');
  });

  it('keeps omitted project dates omitted and marks the choice confirmed', () => {
    const [g] = ok(parseGoalImport('{ "title": "Solo" }', TODAY));
    expect(g.title).toBe('Solo');
    expect(g.start).toBeUndefined();
    expect(g.deadline).toBeUndefined();
    expect(g.datesConfirmed).toBe(true);
    expect(g.column).toBe(0);
    expect(g.nodes).toEqual([]);
  });

  it('preserves a deadline-only import without inventing a start', () => {
    const [g] = ok(parseGoalImport('{ "title": "Solo", "deadline": "2026-09-01" }', TODAY));
    expect(g.start).toBeUndefined();
    expect(g.deadline).toBe('2026-09-01');
    expect(g.datesConfirmed).toBe(true);
  });

  it('rejects a reversed explicit project span without swapping it', () => {
    const raw = '{ "title": "Solo", "start": "2026-10-01", "deadline": "2026-09-01" }';
    expect(err(parseGoalImport(raw, TODAY))).toMatch(/Goal #1: Start must be/i);
  });

  it('rejects explicit malformed and calendar-invalid project dates instead of omitting them', () => {
    expect(err(parseGoalImport('{ "title": "Solo", "start": "tomorrow" }', TODAY)))
      .toBe('Goal #1: Start must be a valid date.');
    expect(err(parseGoalImport('{ "title": "Solo", "deadline": "2026-02-30" }', TODAY)))
      .toBe('Goal #1: Deadline must be a valid date.');
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

describe('buildSubtaskPrompt', () => {
  it('names the project, the step, today, and asks for one-day subtasks', () => {
    const p = buildSubtaskPrompt('Launch website', 'Draft the hero', TODAY);
    expect(p).toContain('"Launch website"');
    expect(p).toContain('"Draft the hero"');
    expect(p).toContain(`Today's date is ${TODAY}`);
    expect(p).toContain('single focused day');
  });
});

describe('parseSubtasks', () => {
  it('parses a JSON array of strings, trimming and dropping blanks', () => {
    expect(parseSubtasks('["  A ", "B", "", "  "]')).toEqual({ titles: ['A', 'B'] });
  });

  it('accepts an array of {title} objects', () => {
    expect(parseSubtasks('[{"title":"A"},{"title":"B"}]')).toEqual({ titles: ['A', 'B'] });
  });

  it('rejects empty input, JSON objects, and empty results', () => {
    expect(parseSubtasks('   ')).toEqual({ error: expect.stringContaining('Paste') });
    expect(parseSubtasks('{"title":"A"}')).toEqual({ error: expect.stringContaining('list') });
    expect(parseSubtasks('[]')).toEqual({ error: expect.stringContaining('No subtasks') });
    expect(parseSubtasks('[1, 2, {}]')).toEqual({ error: expect.stringContaining('No subtasks') });
  });

  // Bare prose now reads as a one-line list rather than being rejected — the
  // modal previews the parse before committing, so a wrong read is visible
  // rather than fatal.
  it('reads a single bare line as a one-item list', () => {
    expect(parseSubtasks('not json')).toEqual({ titles: ['not json'] });
  });
});

// C-17: the parser accepted strict JSON only, so it failed on the single most
// common LLM output shape — a fenced code block — and told the user their AI
// was wrong rather than that the parser was strict.
describe('parseSubtasks tolerance', () => {
  function titles(raw: string): string[] {
    const out = parseSubtasks(raw);
    if ('error' in out) throw new Error(`expected titles, got: ${out.error}`);
    return out.titles;
  }

  it('accepts a fenced JSON array', () => {
    expect(titles('```json\n["Read the paper", "Write notes"]\n```'))
      .toEqual(['Read the paper', 'Write notes']);
  });

  it('accepts a bare fence with no language', () => {
    expect(titles('```\n["A", "B"]\n```')).toEqual(['A', 'B']);
  });

  it('accepts prose wrapped around the array', () => {
    expect(titles('Sure! Here you go:\n\n```json\n["A"]\n```\n\nHope that helps.'))
      .toEqual(['A']);
  });

  it('accepts a plain newline-separated list', () => {
    expect(titles('Read the paper\nWrite notes\nSubmit')).toEqual([
      'Read the paper', 'Write notes', 'Submit',
    ]);
  });

  it('strips bullets and numbering from a list', () => {
    expect(titles('- Read the paper\n* Write notes\n1. Submit\n2) Celebrate')).toEqual([
      'Read the paper', 'Write notes', 'Submit', 'Celebrate',
    ]);
  });

  it('normalises curly quotes so a smart-quoted array still parses', () => {
    expect(titles('[“Read”, “Write”]')).toEqual(['Read', 'Write']);
  });

  it('tolerates a trailing comma', () => {
    expect(titles('["A", "B",]')).toEqual(['A', 'B']);
  });

  it('still rejects empty input', () => {
    expect(parseSubtasks('   ')).toHaveProperty('error');
  });

  it('does not treat a JSON object as a list of lines', () => {
    expect(parseSubtasks('{"nope": 1}')).toHaveProperty('error');
  });
});
