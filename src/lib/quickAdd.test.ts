import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import {
  applyDateSuggestion,
  detectBareTemporal,
  parseDateToken,
  parseQuickAdd,
  resolveGoalToken,
} from './quickAdd';

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

/**
 * A duration token carries a time unit and has no other meaning inside a task
 * title, so it is an estimate even without the `~` sigil. A BARE INTEGER is
 * NOT — "chapter 4", "problem 3", "6.006" are quantities, and eating one as a
 * minute count is the false positive this rule is written to avoid.
 */
describe('bare durations (no ~)', () => {
  it('reads a unit-bearing token as the estimate: "Read ch 4 2h"', () => {
    const r = parse('Read ch 4 2h');
    // "2h" is the duration; "4" is a chapter number and stays in the title.
    expect(r.estimateMin).toBe(120);
    expect(r.title).toBe('Read ch 4');
  });

  it('reads a minutes token: "Problem 3m" books 3 minutes', () => {
    const r = parse('Problem 3m');
    expect(r.estimateMin).toBe(3);
    expect(r.title).toBe('Problem');
  });

  it('reads 1h30 as ninety minutes', () => {
    const r = parse('Draft 1h30');
    expect(r.estimateMin).toBe(90);
    expect(r.title).toBe('Draft');
  });

  it('leaves a bare integer alone — a quantity is not a duration', () => {
    expect(parse('Reserve room 45').estimateMin).toBeNull();
    expect(parse('Reserve room 45').title).toBe('Reserve room 45');
  });

  it('does not touch a course number like 6.006', () => {
    const r = parse('6.006 Problem Set 4');
    expect(r.estimateMin).toBeNull();
    expect(r.title).toBe('6.006 Problem Set 4');
  });

  it('takes only the FIRST bare duration; a second is text', () => {
    const r = parse('Call 30m then 45m');
    expect(r.estimateMin).toBe(30);
    expect(r.title).toBe('Call then 45m');
  });

  it('yields to an explicit ~ token wherever it sits', () => {
    // The user said ~90m out loud; a stray "2h" must not override it.
    const r = parse('Task 2h ~90m');
    expect(r.estimateMin).toBe(90);
    expect(r.title).toBe('Task 2h');
  });
});

// 2026-08-12 is a Wednesday, so the nearest upcoming Monday is the 17th.
describe('detectBareTemporal', () => {
  it('spots "tomorrow" and offers the token that would have worked', () => {
    expect(detectBareTemporal('Finish the essay tomorrow', TODAY)).toEqual({
      match: 'tomorrow',
      sigil: '@tomorrow',
      date: '2026-08-13',
    });
  });

  it('spots "by <weekday>" as a deadline', () => {
    expect(detectBareTemporal('Ship it by thursday', TODAY)).toEqual({
      match: 'by thursday',
      sigil: '@thursday',
      date: '2026-08-13',
    });
  });

  it('spots "next <weekday>" and resolves the nearest upcoming one', () => {
    expect(detectBareTemporal('Write essay next monday', TODAY)).toEqual({
      match: 'next monday',
      sigil: '@monday',
      date: '2026-08-17',
    });
  });

  it('spots "next week" as seven days out', () => {
    expect(detectBareTemporal('Plan the trip next week', TODAY)).toEqual({
      match: 'next week',
      sigil: '@+7d',
      date: '2026-08-19',
    });
  });

  it('spots a bare weekday, abbreviated included', () => {
    expect(detectBareTemporal('Call mom sunday', TODAY)?.date).toBe('2026-08-16');
    expect(detectBareTemporal('Call mom sun', TODAY)?.date).toBe('2026-08-16');
  });

  it('reads "tonight" as today', () => {
    expect(detectBareTemporal('Submit tonight', TODAY)).toEqual({
      match: 'tonight',
      sigil: '@today',
      date: TODAY,
    });
  });

  it('keeps the original casing in the match so it can be replaced', () => {
    expect(detectBareTemporal('Do it TOMORROW', TODAY)?.match).toBe('TOMORROW');
  });

  it('does not fire on a word that merely contains a weekday', () => {
    expect(detectBareTemporal('Buy sunscreen', TODAY)).toBeNull();
    expect(detectBareTemporal('Wedding planning', TODAY)).toBeNull();
  });

  it('is silent when nothing temporal is present', () => {
    expect(detectBareTemporal('Email the TA', TODAY)).toBeNull();
    expect(detectBareTemporal('Read chapter 4', TODAY)).toBeNull();
  });
});

describe('applyDateSuggestion', () => {
  it('rewrites the bare phrase into its sigil form, in place', () => {
    const s = detectBareTemporal('Ship it by thursday', TODAY)!;
    expect(applyDateSuggestion('Ship it by thursday', s)).toBe('Ship it @thursday');
  });

  it('rewrites a two-word "next monday" to one sigil', () => {
    const s = detectBareTemporal('Write essay next monday', TODAY)!;
    expect(applyDateSuggestion('Write essay next monday', s)).toBe('Write essay @monday');
  });

  it('produces text that then parses to the promised date', () => {
    const s = detectBareTemporal('Ship it by thursday', TODAY)!;
    const rewritten = applyDateSuggestion('Ship it by thursday', s);
    const r = parseQuickAdd(rewritten, GOALS, TODAY);
    expect(r.date).toBe('2026-08-13');
    expect(r.title).toBe('Ship it');
  });
});

/**
 * Detection is a SUGGESTION, never an auto-date: capture and commitment are
 * different acts, so the word stays in the title and the date stays null until
 * the user accepts.
 */
describe('parseQuickAdd date suggestion', () => {
  it('surfaces the suggestion without applying it', () => {
    const r = parse('Finish essay tomorrow');
    expect(r.date).toBeNull();
    expect(r.title).toBe('Finish essay tomorrow');
    expect(r.dateSuggestion).toMatchObject({ sigil: '@tomorrow', date: '2026-08-13' });
  });

  it('stays quiet once a real @date resolved', () => {
    expect(parse('Finish essay @fri').dateSuggestion).toBeNull();
  });

  it('stays quiet when an @token was tried but failed — one date attempt at a time', () => {
    expect(parse('Ship it @soonish tomorrow').dateSuggestion).toBeNull();
  });

  it('is null on a line with no temporal word', () => {
    expect(parse('Email the TA').dateSuggestion).toBeNull();
  });
});
