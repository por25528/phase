import { describe, it, expect } from 'vitest';
import {
  interpretAssistantInput,
  proposeAssistant,
  type AssistantIntent,
} from './assistantCommands';
import type { Goal, Task } from '../db/types';

const today = '2026-08-12'; // a Wednesday

const goals: Goal[] = [
  {
    id: 'g-alg', title: 'Algorithms',
    nodes: [
      { id: 'n-lab', title: 'Lab report' },
      { id: 'n-done', title: 'Problem set 1', status: 'done' },
    ],
  },
  { id: 'g-bio', title: 'Biology', nodes: [{ id: 'n-bio-lab', title: 'Lab report' }] },
  { id: 'g-old', title: 'Old course', completedAt: '2026-06-01', nodes: [{ id: 'n-old', title: 'Lab report' }] },
];

const tasks: Task[] = [
  { id: 't-milk', title: 'Buy milk', done: false, goalId: null },
  { id: 't-done', title: 'Return library book', done: true, goalId: null },
];

function interpret(text: string): AssistantIntent {
  return interpretAssistantInput(text, goals, today);
}

describe('interpretAssistantInput', () => {
  it('parses "What fits in 30m?" as a read-only fits question', () => {
    expect(interpret('What fits in 30m?')).toEqual({ kind: 'fits', minutes: 30 });
    expect(interpret('what fits in 1h')).toEqual({ kind: 'fits', minutes: 60 });
  });

  it('parses "Add lab report Friday" with a trailing natural date', () => {
    const intent = interpret('Add lab report Friday');
    expect(intent.kind).toBe('capture');
    if (intent.kind !== 'capture') return;
    expect(intent.draft.title).toBe('lab report');
    expect(intent.draft.date).toBe('2026-08-14');
  });

  it('parses "Add reading notes for Algorithms tomorrow" resolving the goal clause', () => {
    const intent = interpret('Add reading notes for Algorithms tomorrow');
    expect(intent.kind).toBe('capture');
    if (intent.kind !== 'capture') return;
    expect(intent.draft.title).toBe('reading notes');
    expect(intent.draft.goalId).toBe('g-alg');
    expect(intent.draft.date).toBe('2026-08-13');
  });

  it('leaves an ambiguous goal clause in the title instead of guessing', () => {
    const twins: Goal[] = [
      { id: 'g1', title: 'Algorithms I', nodes: [] },
      { id: 'g2', title: 'Algorithms II', nodes: [] },
    ];
    const intent = interpretAssistantInput('Add reading notes for Algorithms', twins, today);
    expect(intent.kind).toBe('capture');
    if (intent.kind !== 'capture') return;
    expect(intent.draft.title).toBe('reading notes for Algorithms');
    expect(intent.draft.goalId).toBeNull();
  });

  it('keeps a trailing word that is not a valid date in the title', () => {
    const intent = interpret('Add buy milk soonish');
    expect(intent.kind).toBe('capture');
    if (intent.kind !== 'capture') return;
    expect(intent.draft.title).toBe('buy milk soonish');
    expect(intent.draft.date).toBeNull();
  });

  it('parses "Complete lab report" as a completion query', () => {
    expect(interpret('Complete lab report')).toEqual({ kind: 'complete', query: 'lab report' });
  });

  it('parses "Move lab report to Saturday" as a schedule query', () => {
    expect(interpret('Move lab report to Saturday')).toEqual({
      kind: 'schedule', query: 'lab report', date: '2026-08-15',
    });
  });

  it('returns examples for an unknown verb instead of pretending to understand', () => {
    expect(interpret('Frobnicate the widget')).toEqual({ kind: 'examples' });
    expect(interpret('')).toEqual({ kind: 'examples' });
    expect(interpret('Move lab report to whenever')).toEqual({ kind: 'examples' });
  });

  it('never mutates its inputs', () => {
    const frozenGoals = goals.map((g) => Object.freeze(structuredClone(g)));
    Object.freeze(frozenGoals);
    expect(() => interpretAssistantInput('Add x for Algorithms Friday', frozenGoals, today)).not.toThrow();
  });
});

describe('proposeAssistant', () => {
  it('returns an explicit capture preview requiring confirmation', () => {
    const intent = interpret('Add lab notes Friday');
    const proposal = proposeAssistant(intent, goals, tasks);
    expect(proposal).toMatchObject({
      kind: 'capture', title: 'lab notes', goalId: null, date: '2026-08-14',
    });
    expect((proposal as { id: string }).id).toBeTruthy();
  });

  it('completes a unique open match', () => {
    const proposal = proposeAssistant(interpret('Complete buy milk'), goals, tasks);
    expect(proposal).toMatchObject({
      kind: 'complete',
      subject: { ref: { kind: 'task', id: 't-milk', goalId: null }, title: 'Buy milk' },
    });
  });

  it('returns choices instead of guessing between two open lab reports', () => {
    const proposal = proposeAssistant(interpret('Complete lab report'), goals, tasks);
    expect(proposal?.kind).toBe('choose-subject');
    if (proposal?.kind !== 'choose-subject') return;
    expect(proposal.verb).toBe('complete');
    const ids = proposal.choices.map((c) => c.ref.id).sort();
    // The archived course's copy is not offered.
    expect(ids).toEqual(['n-bio-lab', 'n-lab']);
  });

  it('ignores done work and archived projects when resolving a subject', () => {
    const proposal = proposeAssistant(interpret('Complete return library book'), goals, tasks);
    expect(proposal?.kind).toBe('choose-subject');
    if (proposal?.kind !== 'choose-subject') return;
    expect(proposal.choices).toEqual([]);
  });

  it('builds a schedule preview carrying the parsed date', () => {
    const proposal = proposeAssistant(interpret('Move buy milk to Saturday'), goals, tasks);
    expect(proposal).toMatchObject({
      kind: 'schedule',
      date: '2026-08-15',
      subject: { ref: { kind: 'task', id: 't-milk', goalId: null } },
    });
  });

  it('keeps the pending verb and date on an ambiguous schedule', () => {
    const proposal = proposeAssistant(interpret('Move lab report to Saturday'), goals, tasks);
    expect(proposal?.kind).toBe('choose-subject');
    if (proposal?.kind !== 'choose-subject') return;
    expect(proposal.verb).toBe('schedule');
    expect(proposal.date).toBe('2026-08-15');
  });

  it('produces no proposal for fits or examples — both are read-only', () => {
    expect(proposeAssistant({ kind: 'fits', minutes: 30 }, goals, tasks)).toBeNull();
    expect(proposeAssistant({ kind: 'examples' }, goals, tasks)).toBeNull();
  });
});
