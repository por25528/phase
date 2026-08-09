import { describe, it, expect } from 'vitest';
import {
  priorityToColumn,
  columnToPriority,
  buildNode,
  buildManualGoal,
  sanitizeBackupHabit,
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
      nodes: [{ id: 'n', title: 'Done before timestamps', status: 'done' }],
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
  it('turns a plain string into a leaf with status absent (todo)', () => {
    const n = buildNode('Pick one idea')!;
    expect(n.title).toBe('Pick one idea');
    expect(n.status).toBeUndefined();
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
    expect(n.status).toBeUndefined();
    expect(n.children!.every((c: GoalNode) => c.status === undefined)).toBe(true);
  });

  it('an object with empty subgoals stays a leaf', () => {
    const n = buildNode({ title: 'solo', subgoals: [] })!;
    expect(n.status).toBeUndefined();
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
    expect(g.nodes.every((n) => n.status === undefined)).toBe(true);
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
    expect(g.nodes[0].status).toBeUndefined();
    expect(g.nodes[1].children!.map((c) => c.title)).toEqual(['Design', 'Backend']);
    expect(g.nodes[1].status).toBeUndefined();
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

/**
 * The parser rejected a goal missing its own title and silently swallowed every
 * problem one level down. For someone pasting LLM output — the format's whole
 * reason to exist — that meant "Imported 1 project" could be true while half
 * the psets were missing, with nothing on screen to notice it by.
 */
describe('parseGoalImport rejects what it used to swallow', () => {
  const TODAY = '2026-07-15';

  it('refuses a group that lost its title, instead of dropping its subtree', () => {
    const raw = JSON.stringify({
      title: '6.1200',
      subgoals: [{ subgoals: ['Pset 1', 'Pset 2', 'Pset 3'] }],
    });
    const out = parseGoalImport(raw, TODAY);
    expect('error' in out).toBe(true);
    expect('error' in out && out.error).toContain('group of 3 tasks');
  });

  it('refuses a `subgoals` that is a string — the classic LLM slip', () => {
    const raw = JSON.stringify({ title: '6.031', subgoals: 'Pset 1, Pset 2' });
    const out = parseGoalImport(raw, TODAY);
    expect('error' in out).toBe(true);
    expect('error' in out && out.error).toContain('not a list');
  });

  it('refuses an unknown horizon rather than quietly filing it under Now', () => {
    const raw = JSON.stringify({ title: 'Startup', priority: 'urgent' });
    const out = parseGoalImport(raw, TODAY);
    expect('error' in out).toBe(true);
    expect('error' in out && out.error).toContain('urgent');
  });

  it('still accepts an absent priority, and the legacy words', () => {
    expect('goals' in parseGoalImport(JSON.stringify({ title: 'A' }), TODAY)).toBe(true);
    const legacy = parseGoalImport(JSON.stringify({ title: 'A', priority: 'highest' }), TODAY);
    expect('goals' in legacy && legacy.goals[0].column).toBe(0);
  });

  it('counts every problem so the message can say there are more', () => {
    const raw = JSON.stringify({ title: 'A', subgoals: [{ subgoals: ['x'] }, { subgoals: ['y'] }] });
    const out = parseGoalImport(raw, TODAY);
    expect('error' in out && out.error).toContain('+1 more');
  });

  /**
   * The strictness is about data LOSS — a titleless group takes its whole
   * subtree with it. A blank string in a list is a trailing-comma artifact, and
   * failing the entire paste over one would be a worse bug than the silent
   * dropping it replaced.
   */
  it('skips a blank string in a list without failing the paste', () => {
    const out = parseGoalImport(JSON.stringify({ title: 'A', subgoals: ['Pset 1', '', 'Pset 2'] }), TODAY);
    expect('goals' in out).toBe(true);
    expect('goals' in out && out.goals[0].nodes.map((n) => n.title)).toEqual(['Pset 1', 'Pset 2']);
  });

  /**
   * The strictness above must reject data LOSS, not JSON idiom. `null` is the
   * ordinary way to write "none", and a blank `priority` is a field the model
   * left unset — turning either into a failed paste would be a worse bug than
   * the silent dropping it replaced.
   */
  it('treats null subgoals as "no steps", not as malformed', () => {
    const flat = parseGoalImport(JSON.stringify({ title: 'P', subgoals: null }), TODAY);
    expect('goals' in flat && flat.goals[0].nodes).toEqual([]);

    const nested = parseGoalImport(
      JSON.stringify({ title: 'P', subgoals: [{ title: 'Step', subgoals: null }] }),
      TODAY,
    );
    expect('goals' in nested && nested.goals[0].nodes.map((n) => n.title)).toEqual(['Step']);
  });

  it('treats a blank priority as unset, which means Now', () => {
    const out = parseGoalImport(JSON.stringify({ title: 'P', priority: '   ' }), TODAY);
    expect('goals' in out && out.goals[0].column).toBe(0);
  });

  it('is case-insensitive about a horizon word', () => {
    const out = parseGoalImport(JSON.stringify({ title: 'P', priority: 'Someday' }), TODAY);
    expect('goals' in out && out.goals[0].column).toBe(3);
  });

  it('leaves a well-formed nested paste completely alone', () => {
    const raw = JSON.stringify({
      title: '6.1200',
      priority: 'now',
      subgoals: ['Pset 1', { title: 'Exam prep', subgoals: ['Review notes', 'Practice set'] }],
    });
    const out = parseGoalImport(raw, TODAY);
    expect('goals' in out).toBe(true);
    if (!('goals' in out)) return;
    expect(out.goals[0].nodes).toHaveLength(2);
    expect(out.goals[0].nodes[1].children).toHaveLength(2);
  });
});

/**
 * Goals go through `sanitizeBackupGoal` on import; habits were passed straight
 * through untouched. `toggleHabitOn` removes ONE matching index, so a duplicated
 * date made clearing that day take two clicks — dot still filled, streak still
 * counting it, no reason visible.
 */
describe('sanitizeBackupHabit', () => {
  const base = { id: 'h', title: 'Gym', cadence: 'daily' as const, weeklyTarget: 7, goalId: null };

  it('de-duplicates repeated check-ins', () => {
    const out = sanitizeBackupHabit({ ...base, checkins: ['2026-07-29', '2026-07-29', '2026-07-30'] });
    expect(out.checkins).toEqual(['2026-07-29', '2026-07-30']);
  });

  it('drops values that are not local dates at all', () => {
    const out = sanitizeBackupHabit({ ...base, checkins: ['2026-07-29', 'yesterday', '', '2026-13-45'] });
    expect(out.checkins).toEqual(['2026-07-29']);
  });

  it('sorts, since streak and the weekly count both read this list', () => {
    const out = sanitizeBackupHabit({ ...base, checkins: ['2026-07-30', '2026-07-28', '2026-07-29'] });
    expect(out.checkins).toEqual(['2026-07-28', '2026-07-29', '2026-07-30']);
  });

  it('returns the original object untouched when it is already clean', () => {
    const habit = { ...base, checkins: ['2026-07-28', '2026-07-29'] };
    expect(sanitizeBackupHabit(habit)).toBe(habit);
  });

  it('survives a checkins field that is not an array', () => {
    const out = sanitizeBackupHabit({ ...base, checkins: undefined as unknown as string[] });
    expect(out.checkins).toEqual([]);
  });
});

/**
 * What a chat reply actually looks like.
 *
 * Both import surfaces are fed by pasting one, and a reply is almost never a
 * bare JSON literal — it arrives fenced, wrapped in "Sure! Here is your
 * project:", smart-quoted by a rich-text field, or with a trailing comma. The
 * subtask importer tolerated all of it from the start; the PROJECT importer,
 * which exists to be pasted into and even ships a copy-the-prompt button,
 * called `JSON.parse` on the raw paste and answered every one of these with
 * "check for a missing comma, quote, or bracket" — a refusal and a wrong
 * diagnosis at once.
 */
describe('parseGoalImport accepts a real AI reply', () => {
  const TODAY = '2026-07-15';
  const titleOf = (raw: string): string | undefined => {
    const out = parseGoalImport(raw, TODAY);
    return 'goals' in out ? out.goals[0]?.title : undefined;
  };

  it('unwraps a ```json fence', () => {
    expect(titleOf('```json\n{"title":"6.1200","subgoals":["Pset 1"]}\n```')).toBe('6.1200');
  });

  it('unwraps a bare fence', () => {
    expect(titleOf('```\n{"title":"6.1200"}\n```')).toBe('6.1200');
  });

  it('ignores prose on either side', () => {
    expect(titleOf('Sure! Here it is:\n\n{"title":"6.1200"}\n\nLet me know!')).toBe('6.1200');
  });

  it('repairs smart quotes from a rich-text paste', () => {
    expect(titleOf('{“title”:“6.1200”}')).toBe('6.1200');
  });

  it('tolerates a trailing comma', () => {
    const out = parseGoalImport('{"title":"6.1200","subgoals":["a","b",]}', TODAY);
    expect('goals' in out && out.goals[0].nodes.map((n) => n.title)).toEqual(['a', 'b']);
  });

  it('handles all of it at once, for an array of projects', () => {
    const raw = 'Here you go:\n```json\n[{“title”:"6.1200"},{"title":"18.06",}]\n```\nGood luck!';
    const out = parseGoalImport(raw, TODAY);
    expect('goals' in out && out.goals.map((g) => g.title)).toEqual(['6.1200', '18.06']);
  });

  /**
   * Forgiving about WRAPPING, never about the JSON itself — a genuinely broken
   * paste must still fail, and now the syntax message is accurate when it does.
   */
  it('still rejects JSON that is actually malformed', () => {
    const out = parseGoalImport('```json\n{"title": "6.1200", "subgoals": [\n```', TODAY);
    expect('error' in out && out.error).toContain('not valid JSON');
  });

  it('still rejects a reply with no JSON in it at all', () => {
    const out = parseGoalImport('I can help you plan that! What is the deadline?', TODAY);
    expect('error' in out).toBe(true);
  });
});
