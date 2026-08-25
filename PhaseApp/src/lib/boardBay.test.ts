import { describe, expect, it } from 'vitest';
import type { Goal, Life } from '../db/types';
import { bayFace, FULL_FACE } from './boardBay';

const LIVES: Life[] = [
  { id: 'cu', title: 'CU', order: 0 },
  { id: 'me', title: 'Personal', order: 1 },
];

function goal(title: string, lifeId?: string): Goal {
  return { id: title, title, column: 0, nodes: [], lifeId } as unknown as Goal;
}

describe('bayFace', () => {
  it('hides the life when every card in the bay carries the same one', () => {
    const bay = [goal('Midterm — 3404117 INTRO TO LAW', 'cu'), goal('Learn Discrete Mathematics', 'cu')];
    expect(bayFace(bay, LIVES).hideLife).toBe(true);
  });

  it('keeps it the moment one card belongs somewhere else', () => {
    // The screenshot's `Now`: three CU projects and one Personal. The tag is
    // the only thing telling them apart, so all four keep it.
    const bay = [goal('a', 'cu'), goal('b', 'cu'), goal('c', 'cu'), goal('d', 'me')];
    expect(bayFace(bay, LIVES).hideLife).toBe(false);
  });

  it('keeps it when a card is unassigned, because unassigned already prints nothing', () => {
    // Dropping `CU` here would ask the reader to tell two different facts
    // apart by the same absence.
    expect(bayFace([goal('a', 'cu'), goal('b')], LIVES).hideLife).toBe(false);
  });

  it('resolves a life that no longer exists to unassigned rather than to itself', () => {
    expect(bayFace([goal('a', 'gone'), goal('b', 'gone')], LIVES).hideLife).toBe(false);
  });

  it('drops the title head every card in the bay shares, cut to a token boundary', () => {
    const bay = [
      goal('Midterm — 2301265 DATA STRUC ALGOR', 'cu'),
      goal('Midterm — 2301230 DISCRETE CS', 'cu'),
      goal('Midterm — 2301274 COMP SYS', 'cu'),
    ];
    // Never `Midterm — 230`: the course numbers would stop being the numbers.
    expect(bayFace(bay, LIVES).titlePrefix).toBe('Midterm — ');
  });

  it('drops nothing when one card in the bay does not share the head', () => {
    // The real `Now` column, where `Boot.dev — Backend Developer Path` sits
    // beside three `Midterm — …` projects.
    const bay = [
      goal('Boot.dev — Backend Developer Path', 'me'),
      goal('Midterm — 2301265 DATA STRUC ALGOR', 'cu'),
      goal('Midterm — 2301230 DISCRETE CS', 'cu'),
    ];
    expect(bayFace(bay, LIVES).titlePrefix).toBe('');
  });

  it('hides nothing from a bay of one, which shares nothing with anybody', () => {
    expect(bayFace([goal('Midterm — 2301265 DATA STRUC ALGOR', 'cu')], LIVES)).toEqual(FULL_FACE);
  });

  it('hides nothing from an empty bay', () => {
    expect(bayFace([], LIVES)).toEqual(FULL_FACE);
  });
});
