import type { Goal, GoalNode, Session, Task } from '../db/types';
import { normalizeEstimate } from './capacity';
import { walkLeaves } from './plan';
import { isDone } from './status';
import { loggedForNode, loggedForTask } from './actuals';

/**
 * Expected time for one specific piece of work, learned from the student's own
 * confirmed history.
 *
 * Every stored `Session` is treated as confirmed — every producer (the manual
 * log, the focus session's completion) is an explicit user action, which is why
 * no `confirmed` field is added. Evidence is only drawn from COMPLETED leaf
 * steps and COMPLETED tasks that shared the target's goal and a comparable
 * title; a half-finished step has not yet revealed how long it takes, and an
 * estimate from work nobody timed would be invented.
 *
 * A range appears only when there is enough comparable history: 2–4 samples use
 * the observed min/max rounded outward to five minutes (medium confidence),
 * 5+ use the 25th/75th percentiles rounded outward (high confidence). Below
 * that the honest answer is the target's own estimate, or a 30-minute starter
 * when even that is missing — never a bogus "prediction" resting on nothing.
 *
 * This deliberately does NOT reuse `projectCalibration`, which measures the
 * estimate-to-actual ratio across a whole project and answers a different
 * question ("how far does my planning run short?"), not "how long does this
 * kind of task usually take?".
 */

export type WorkRef =
  | { kind: 'step'; id: string; goalId: string }
  | { kind: 'task'; id: string; goalId: string | null };

export type ExpectedTime =
  | {
      kind: 'history';
      lowMin: number;
      highMin: number;
      confidence: 'medium' | 'high';
      sampleCount: number;
    }
  | { kind: 'estimate'; minutes: number }
  | { kind: 'starter'; minutes: 30 };

export interface ExpectedTimeInput {
  goals: Goal[];
  tasks: Task[];
  sessions: Session[];
}

/** The small, stable vocabulary of repeated assignment shapes. */
const WORK_KINDS = ['problem set', 'reading', 'lab', 'essay', 'review'] as const;

type WorkKind = (typeof WORK_KINDS)[number];

/**
 * A repeated title made comparable to itself: lower-cased, punctuation removed,
 * digit runs collapsed to one token, whitespace collapsed. `Problem set 3` and
 * `Problem set 4` both become `problem set #`.
 */
function normalizeTitle(title: string): string {
  const lower = title.toLowerCase();
  const depunctuated = lower.replace(/[^\p{L}\p{N}]/gu, ' ');
  const digitsReplaced = depunctuated.replace(/\d+/g, '#');
  return digitsReplaced.replace(/\s+/g, ' ').trim();
}

/** The work kind a normalized title belongs to, or null for a generic title. */
function workKindOf(norm: string): WorkKind | null {
  for (const kind of WORK_KINDS) {
    if (norm === kind || norm.startsWith(`${kind} `)) return kind;
  }
  return null;
}

/**
 * Whether one completed item is evidence for the target.
 *
 * Recognized kinds compare by kind — `Lab 2` informs `Lab 7` within a goal —
 * while generic titles must match their exact normalized title: `Write
 * conclusion` must never become evidence for every generic item in the goal.
 */
function comparable(targetTitle: string, sampleTitle: string): boolean {
  const target = normalizeTitle(targetTitle);
  const sample = normalizeTitle(sampleTitle);
  const targetKind = workKindOf(target);
  const sampleKind = workKindOf(sample);
  if (targetKind !== null && targetKind === sampleKind) return true;
  return target === sample;
}

/** Round a low bound down and a high bound up to the same five-minute grid. */
function roundOutward(low: number, high: number): { lowMin: number; highMin: number } {
  return {
    lowMin: Math.floor(low / 5) * 5,
    highMin: Math.ceil(high / 5) * 5,
  };
}

/**
 * The 25th/75th percentile by linear interpolation between closest ranks (the
 * convention shared by `numpy.percentile(..., 'linear')`). Stable for the five
 * sample minimum this is reached under; rounded outward afterwards.
 */
function percentile(sorted: number[], p: number): number {
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

interface ResolvedTarget {
  kind: 'step' | 'task';
  goalId: string | null;
  title: string;
  estimateMin?: number;
}

/**
 * Resolve the ref against the LIVE goal/task arrays. A ref that names nothing
 * (a deleted step, a goal id that no longer exists) resolves to null — expected
 * time for a phantom is the starter, and nothing else about it can be trusted.
 */
function resolveTarget(ref: WorkRef, input: ExpectedTimeInput): ResolvedTarget | null {
  if (ref.kind === 'task') {
    const task = input.tasks.find((t) => t.id === ref.id);
    if (!task) return null;
    return { kind: 'task', goalId: task.goalId, title: task.title, estimateMin: task.estimateMin };
  }

  const goal = input.goals.find((g) => g.id === ref.goalId);
  if (!goal) return null;
  let leaf: GoalNode | undefined;
  walkLeaves(goal, (n) => {
    if (n.id === ref.id) leaf = n;
  });
  if (!leaf) return null;
  return { kind: 'step', goalId: goal.id, title: leaf.title, estimateMin: leaf.estimateMin };
}

/** Every completed, timed item in the target's goal group. */
function gatherSamples(target: ResolvedTarget, input: ExpectedTimeInput): Array<{ title: string; minutes: number }> {
  const samples: Array<{ title: string; minutes: number }> = [];
  if (target.kind === 'step') {
    for (const goal of input.goals) {
      if (goal.id !== target.goalId) continue;
      walkLeaves(goal, (n) => {
        if (!isDone(n)) return;
        const minutes = loggedForNode(input.sessions, n.id);
        if (minutes > 0) samples.push({ title: n.title, minutes });
      });
    }
  } else {
    for (const task of input.tasks) {
      if (task.goalId !== target.goalId) continue;
      if (!task.done) continue;
      const minutes = loggedForTask(input.sessions, task.id);
      if (minutes > 0) samples.push({ title: task.title, minutes });
    }
  }
  return samples;
}

export function expectedTimeFor(ref: WorkRef, input: ExpectedTimeInput): ExpectedTime {
  const target = resolveTarget(ref, input);
  if (!target) return { kind: 'starter', minutes: 30 };

  const totals = gatherSamples(target, input)
    .filter((s) => comparable(target.title, s.title))
    .map((s) => s.minutes);
  const n = totals.length;

  if (n >= 5) {
    const sorted = [...totals].sort((a, b) => a - b);
    const lo = percentile(sorted, 0.25);
    const hi = percentile(sorted, 0.75);
    return { kind: 'history', ...roundOutward(lo, hi), confidence: 'high', sampleCount: n };
  }
  if (n >= 2) {
    return {
      kind: 'history',
      ...roundOutward(Math.min(...totals), Math.max(...totals)),
      confidence: 'medium',
      sampleCount: n,
    };
  }

  const est = normalizeEstimate(target.estimateMin);
  return est !== undefined
    ? { kind: 'estimate', minutes: est }
    : { kind: 'starter', minutes: 30 };
}