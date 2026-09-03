import { describe, expect, it } from 'vitest';
import { GOAL_TYPE_WORD, TEMPLATES, inferGoalType, templateNodes } from './goalType';

describe('inferGoalType', () => {
  it.each([
    ['Physics Final', 'study'],
    ['6.5840 pset 3', 'study'],
    ['CS50 problem set', 'study'],
    ['Revise mechanics', 'study'],
    ['Launch SaaS MVP', 'project'],
    ['Ship the new website', 'project'],
    ['Repaint the kitchen', 'general'],
    ['', 'general'],
  ])('reads %s as a %s goal', (title, expected) => {
    expect(inferGoalType(title)).toBe(expected);
  });

  /**
   * A course code is the strongest study signal there is, and it has to beat a
   * word that would otherwise pull the other way.
   */
  it('lets a course code win over a project word', () => {
    expect(inferGoalType('6.1200 build a parser')).toBe('study');
  });

  it('is a default, not a claim — every type has a word for the control', () => {
    expect(Object.keys(GOAL_TYPE_WORD).sort()).toEqual(['general', 'project', 'study']);
  });
});

describe('the study template', () => {
  it('names a Topics area and flags it; the other templates flag nothing', () => {
    expect(TEMPLATES.study.areas).toEqual(['Topics', 'Practice', 'Mock exam']);
    expect(TEMPLATES.study.flags).toEqual([{ topics: true }, undefined, undefined]);
    expect(templateNodes('study')[0]).toMatchObject({ title: 'Topics', topics: true });
    expect(templateNodes('study').slice(1).every((n) => n.topics === undefined)).toBe(true);
    expect(templateNodes('project').every((n) => n.topics === undefined)).toBe(true);
    expect(templateNodes('general').every((n) => n.topics === undefined)).toBe(true);
  });
  it('keeps one flag slot per area, so the two lists cannot drift', () => {
    for (const t of Object.values(TEMPLATES)) expect(t.flags).toHaveLength(t.areas.length);
  });
});

describe('templateNodes', () => {
  it('creates one node per area, and no tasks inside them', () => {
    const nodes = templateNodes('project');
    expect(nodes.map((n) => n.title)).toEqual(TEMPLATES.project.areas);
    expect(nodes.every((n) => n.children === undefined)).toBe(true);
  });

  /**
   * An empty `children` array is a legacy LEAF everywhere else in this
   * codebase, so emitting one would write a shape the tree reads as something
   * other than what was meant.
   */
  it('never emits an empty children array', () => {
    for (const type of ['study', 'project', 'general'] as const) {
      expect(templateNodes(type).some((n) => Array.isArray(n.children))).toBe(false);
    }
  });

  it('gives every node its own id', () => {
    const ids = templateNodes('study').map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * A template that guesses at the tasks inside each area is inventing work,
   * and the user spends longer deleting it than they would have spent typing.
   */
  it('stays small enough to read at a glance', () => {
    for (const type of ['study', 'project', 'general'] as const) {
      expect(TEMPLATES[type].areas.length).toBeLessThanOrEqual(5);
    }
  });
});
