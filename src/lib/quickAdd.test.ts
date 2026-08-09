import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import { parseDateToken, parseQuickAdd, resolveGoalToken } from './quickAdd';

// 2026-08-12 is a Wednesday.
const TODAY = '2026-08-12';

const goal = (id: string, title: string, over: Partial<Goal> = {}): Goal =>
  ({ id, title, nodes: [], ...over });

const GOALS: Goal[] = [
  goal('g1', 'Physics Final'),
  goal('g2', 'Launch SaaS MVP'),
  goal('g3', 'Photography course'),
  goal('gz', 'Physics Lab', { completedAt: '2026-07-01' }),
];

const parse = (text: string) => parseQuickAdd(text, GOALS, TODAY);

describe('parseDateToken', () => {
  it.each([
    ['today', '2026-08-12'],
    ['tomorrow', '2026-08-13'],
    ['tmr', '2026-08-13'],
    ['+3d', '2026-08-15'],
    ['fri', '2026-08-14'],
    ['aug-24', '2026-08-24'],
    ['2026-09-01', '2026-09-01'],
  ])('reads %s as %s', (token, expected) => {
    expect(parseDateToken(token, TODAY)).toBe(expected);
  });

  it('reads a weekday that is today as today, not a week away', () => {
    expect(parseDateToken('wed', TODAY)).toBe(TODAY);
  });

  /**
   * The hyphen is standing in for a space, so the token reaches `parseDateInput`
   * and inherits its real-date check. Without it `@feb-30` would roll over to
   * March 2 and turn a typo into a commitment.
   */
  it('refuses a date that does not exist', () => {
    expect(parseDateToken('feb-30', TODAY)).toBeNull();
  });

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseDateToken('soonish', TODAY)).toBeNull();
  });
});

describe('resolveGoalToken', () => {
  it('matches on a unique prefix, ignoring case and punctuation', () => {
    expect(resolveGoalToken('launch', GOALS)?.id).toBe('g2');
    expect(resolveGoalToken('saasmvp', GOALS)?.id).toBe('g2');
  });

  /**
   * Filing a task under the wrong goal is a quiet mistake that stays wrong, so
   * an ambiguous token resolves to nothing and the text survives in the title.
   */
  it('refuses a token that matches two goals', () => {
    expect(resolveGoalToken('ph', GOALS)).toBeNull();
  });

  it('ignores completed goals, which cannot take new work', () => {
    // 'physicsl' would match only the archived "Physics Lab".
    expect(resolveGoalToken('physicsl', GOALS)).toBeNull();
  });
});

describe('parseQuickAdd', () => {
  it('takes a bare line as a title and schedules nothing', () => {
    expect(parse('Email the TA')).toMatchObject({
      title: 'Email the TA',
      goalId: null,
      date: null,
      estimateMin: null,
      tokens: [],
    });
  });

  it('pulls goal, date and estimate out of the sentence', () => {
    const r = parse('Problems 1–15 #physics @fri ~90m');
    expect(r).toMatchObject({
      title: 'Problems 1–15',
      goalId: 'g1',
      date: '2026-08-14',
      estimateMin: 90,
    });
    expect(r.tokens.map((t) => t.kind)).toEqual(['goal', 'date', 'estimate']);
    expect(r.tokens[0].label).toBe('Physics Final');
  });

  it('reads tokens wherever they appear, not only at the end', () => {
    expect(parse('~1h30 Draft the #launch spec @tomorrow')).toMatchObject({
      title: 'Draft the spec',
      goalId: 'g2',
      date: '2026-08-13',
      estimateMin: 90,
    });
  });

  /**
   * A capture tool that quietly drops part of what you typed is worse than one
   * that never parsed anything. An unresolvable sigil stays in the title AND is
   * reported, so the composer can say so before you commit.
   */
  it('leaves an unresolvable token in the title and reports it', () => {
    const r = parse('Read chapter 4 #quantum');
    expect(r.title).toBe('Read chapter 4 #quantum');
    expect(r.unresolved).toEqual(['#quantum']);
    expect(r.goalId).toBeNull();
  });

  it('leaves an unreadable date in the title too', () => {
    const r = parse('Ship it @soonish');
    expect(r.title).toBe('Ship it @soonish');
    expect(r.unresolved).toEqual(['@soonish']);
  });

  /**
   * Two dates on one task is not a thing the model can hold, and silently
   * picking one would make the other vanish from the line you typed.
   */
  it('takes only the first of each kind and treats the rest as text', () => {
    const r = parse('Thing @fri @mon');
    expect(r.date).toBe('2026-08-14');
    expect(r.title).toBe('Thing @mon');
  });

  it('collapses the whitespace the removed tokens leave behind', () => {
    expect(parse('Write   #launch   notes').title).toBe('Write notes');
  });

  it('is not confused by a bare sigil', () => {
    expect(parse('Cost is # or ~ or @').title).toBe('Cost is # or ~ or @');
  });

  it('leaves an out-of-range estimate as text rather than clamping it', () => {
    const r = parse('Marathon ~99h');
    expect(r.estimateMin).toBeNull();
    expect(r.unresolved).toEqual(['~99h']);
  });
});
