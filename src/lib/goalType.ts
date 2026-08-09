import type { GoalNode } from '../db/types';
import { uid } from './tree';

/**
 * What kind of thing this goal is.
 *
 * A type is a TEMPLATE, not a second object model. Study, Project and General
 * share the same Areas, Tasks and schedule; what differs is what the empty
 * workspace offers on the first visit, which is exactly the moment a new goal
 * is hardest and least specific.
 *
 * Stored, and optional. Absent means the goal predates types or the user
 * declined one — nothing reads it except the empty-state suggestions, so a
 * missing value costs a starting point and never a behaviour.
 */
export type GoalType = 'study' | 'project' | 'general';

export const GOAL_TYPE_WORD: Record<GoalType, string> = {
  study: 'Study',
  project: 'Project',
  general: 'General',
};

/**
 * Guess the type from the title, so the composer can preselect one.
 *
 * The inference is deliberately shallow and always shown as a filled control
 * the user can change. A guess that hides is a guess that has to be right;
 * this one only has to be a reasonable default, which "exam" → Study is.
 */
const STUDY_WORDS = [
  'exam', 'midterm', 'final', 'finals', 'quiz', 'test', 'chapter', 'lecture',
  'revision', 'revise', 'study', 'course', 'module', 'pset', 'problem set',
  'homework', 'assignment', 'essay', 'thesis', 'dissertation', 'syllabus',
];
const PROJECT_WORDS = [
  'launch', 'ship', 'build', 'mvp', 'release', 'rewrite', 'migrate', 'redesign',
  'prototype', 'app', 'website', 'startup', 'feature',
];

/** A course code like `6.5840` or `CS50` — the strongest study signal there is. */
const COURSE_CODE = /\b([a-z]{2,4}\s?\d{2,4}|\d{1,2}\.\d{3,4})\b/i;

export function inferGoalType(title: string): GoalType {
  const t = title.toLowerCase();
  if (COURSE_CODE.test(title)) return 'study';
  if (STUDY_WORDS.some((w) => t.includes(w))) return 'study';
  if (PROJECT_WORDS.some((w) => t.includes(w))) return 'project';
  return 'general';
}

// ── Templates ─────────────────────────────────────────────────────────────────

/**
 * The Areas a type suggests, and nothing more.
 *
 * Deliberately small. The spec's own warning about the launch template applies
 * to all of them: a template that guesses at the tasks INSIDE each area is
 * inventing work, and the user then spends longer deleting it than they would
 * have spent typing. Areas are structure; tasks are content, and the content is
 * the part only the user has.
 *
 * Nothing is created until it is previewed and accepted — see `applyTemplate`'s
 * callers.
 */
export const TEMPLATES: Record<GoalType, { label: string; areas: string[] }> = {
  study: {
    label: 'Topics and practice',
    areas: ['Review', 'Practice', 'Mock exam'],
  },
  project: {
    label: 'Scope to release',
    areas: ['Scope', 'Design', 'Implementation', 'Verification', 'Release'],
  },
  general: {
    label: 'A simple split',
    areas: ['Prepare', 'Do', 'Wrap up'],
  },
};

/**
 * Turn a template into real nodes.
 *
 * Plain leaves, with no `children` key at all — NOT empty containers. An empty
 * `children` array is a legacy leaf everywhere else in this codebase, so
 * emitting one would be writing a shape the tree already reads as something
 * else. `addChild` promotes a leaf to a container the moment the user puts a
 * task under it, which is the correct moment: until then an area with nothing
 * in it is just a heading the user has agreed to.
 */
export function templateNodes(type: GoalType): GoalNode[] {
  return TEMPLATES[type].areas.map((title) => ({ id: uid(), title }));
}
