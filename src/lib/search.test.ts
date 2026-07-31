import { describe, expect, it } from 'vitest';
import type { Goal, Habit, Task } from '../db/types';
import { buildSearchIndex, searchEntries, type SearchEntry } from './search';

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', title: 'Project', nodes: [], ...over };
}

const RAFT: Goal = goal({
  id: 'g-raft',
  title: '6.5840 Distributed Systems — Lab 2: Raft',
  column: 0,
  nodes: [
    {
      id: 'n-container',
      title: 'Part 2B',
      children: [
        { id: 'n-backup', title: 'Pass TestBackup2B', done: false },
        { id: 'n-cutlass', title: 'Bisect the CUTLASS pipeline regression', done: false },
        { id: 'n-done', title: 'Pass TestBasicAgree2B', done: true },
      ],
    },
  ],
});

const THEORY: Goal = goal({
  id: 'g-theory',
  title: '18.404 Theory of Computation — Pset 6',
  column: 1,
  nodes: [{ id: 'n-pump', title: 'Write the pumping-lemma proof', done: false }],
});

// Titled to collide with the active Raft project on purpose, so ranking has to
// choose between an archived prefix match and an active tail match.
const ARCHIVED: Goal = goal({
  id: 'g-old',
  title: 'Raft scratch experiments',
  completedAt: '2026-06-01',
  nodes: [{ id: 'n-old', title: 'Old leaf', done: false }],
});

const TASKS: Task[] = [
  { id: 't1', title: 'Email Kaashoek about late days', done: false, goalId: null, date: '2026-07-30' },
  { id: 't2', title: 'Finished errand', done: true, goalId: null, date: '2026-07-28' },
];

const HABITS: Habit[] = [
  { id: 'h1', title: 'Run 5k', cadence: 'daily', weeklyTarget: 0, goalId: null, checkins: [] },
];

function index(): SearchEntry[] {
  return buildSearchIndex([RAFT, THEORY, ARCHIVED], TASKS, HABITS);
}

describe('buildSearchIndex', () => {
  it('indexes projects, leaves, tasks and habits', () => {
    const kinds = new Set(index().map((e) => e.kind));
    expect(kinds).toEqual(new Set(['project', 'step', 'task', 'habit']));
  });

  it('gives every leaf its project title as context', () => {
    const leaf = index().find((e) => e.id === 'n-backup');
    expect(leaf).toMatchObject({
      kind: 'step',
      title: 'Pass TestBackup2B',
      context: '6.5840 Distributed Systems — Lab 2: Raft',
      goalId: 'g-raft',
    });
  });

  it('indexes containers as well as leaves, so a section is findable', () => {
    expect(index().find((e) => e.id === 'n-container')).toMatchObject({ title: 'Part 2B' });
  });

  it('flags done and archived entries rather than dropping them', () => {
    expect(index().find((e) => e.id === 'n-done')?.done).toBe(true);
    expect(index().find((e) => e.id === 't2')?.done).toBe(true);
    expect(index().find((e) => e.id === 'g-old')?.archived).toBe(true);
  });

  it('carries the goalId a project entry opens', () => {
    expect(index().find((e) => e.id === 'g-raft')).toMatchObject({ kind: 'project', goalId: 'g-raft' });
  });
});

describe('searchEntries', () => {
  it('returns nothing for an empty query', () => {
    expect(searchEntries(index(), '')).toEqual([]);
    expect(searchEntries(index(), '   ')).toEqual([]);
  });

  it('finds a leaf by a word from the middle of its title', () => {
    const hits = searchEntries(index(), 'cutlass');
    expect(hits[0].entry.id).toBe('n-cutlass');
  });

  it('is case-insensitive', () => {
    expect(searchEntries(index(), 'CUTLASS')[0].entry.id).toBe('n-cutlass');
    expect(searchEntries(index(), 'cUtLaSs')[0].entry.id).toBe('n-cutlass');
  });

  it('matches subsequences so abbreviations work', () => {
    // "pumping-lemma proof" — typed as an initialism.
    const hits = searchEntries(index(), 'pmpf');
    expect(hits.some((h) => h.entry.id === 'n-pump')).toBe(true);
  });

  it('ranks a prefix match above a mid-word match', () => {
    const hits = searchEntries(index(), 'pass');
    expect(hits[0].entry.title.startsWith('Pass')).toBe(true);
  });

  it('ranks a contiguous match above a scattered subsequence', () => {
    const hits = searchEntries(index(), 'raft');
    expect(hits[0].entry.id).toBe('g-raft');
  });

  it('ranks open work above done work', () => {
    const hits = searchEntries(index(), 'pass test');
    expect(hits[0].entry.done).not.toBe(true);
  });

  // The archived project matches 'raft' at position 0 and the active one only
  // at the tail, so demoting archived work has to outweigh the prefix bonus.
  it('ranks active projects above archived ones', () => {
    const hits = searchEntries(index(), 'raft');
    expect(hits[0].entry.archived).not.toBe(true);
    expect(hits.some((h) => h.entry.id === 'g-old')).toBe(true);
  });

  it('finds a step by its project name, so scoping to a course works', () => {
    const hits = searchEntries(index(), '18.404');
    expect(hits.some((h) => h.entry.id === 'n-pump')).toBe(true);
  });

  it('matches across a space-separated multi-term query in any order', () => {
    expect(searchEntries(index(), 'raft backup')[0].entry.id).toBe('n-backup');
    expect(searchEntries(index(), 'backup raft')[0].entry.id).toBe('n-backup');
  });

  it('returns no hits for a query that matches nothing', () => {
    expect(searchEntries(index(), 'zzzznotathing')).toEqual([]);
  });

  it('reports the matched character positions for highlighting', () => {
    const hit = searchEntries(index(), 'raft').find((h) => h.entry.id === 'g-raft');
    const title = hit!.entry.title;
    const matched = hit!.titleMatches.map((i) => title[i]).join('');
    expect(matched.toLowerCase()).toBe('raft');
  });

  it('caps the result count', () => {
    expect(searchEntries(index(), 'e', 3)).toHaveLength(3);
  });

  it('finds a habit', () => {
    expect(searchEntries(index(), 'run')[0].entry.kind).toBe('habit');
  });
});
