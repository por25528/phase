import { describe, it, expect } from 'vitest';
import type { Goal } from '../db/types';
import { roadmapWarnings, focusOverlap, fitRoadmapRange } from './roadmap';
import { PX_PER_DAY } from './timeline';

const TODAY = '2026-07-15';
const WEEK = '2026-07-13'; // Monday of TODAY's week

function goal(over: Partial<Goal>): Goal {
  return { id: 'g', title: 'G', start: '2026-01-01', deadline: '2026-12-31', nodes: [], column: 0, ...over };
}

const kinds = (g: Goal) => roadmapWarnings(g, TODAY).map((w) => w.kind);

// ── roadmapWarnings ───────────────────────────────────────────────────────────

describe('roadmapWarnings', () => {
  it('project-overdue when an active project deadline has passed', () => {
    expect(kinds(goal({ column: 1, deadline: '2026-07-01' }))).toContain('project-overdue');
    expect(kinds(goal({ column: 1, deadline: '2026-08-01' }))).not.toContain('project-overdue');
  });

  it('is silent for a completed project', () => {
    expect(roadmapWarnings(goal({ deadline: '2026-07-01', completedAt: '2026-07-10' }), TODAY)).toEqual([]);
  });

  it('phase-overdue for a scheduled first-level phase past due with an incomplete subtree', () => {
    const g = goal({ column: 1, nodes: [{ id: 'p', title: 'P', start: '2026-06-01', deadline: '2026-07-01', done: false }] });
    const w = roadmapWarnings(g, TODAY).find((x) => x.kind === 'phase-overdue');
    expect(w?.nodeIds).toEqual(['p']);
    // a completed phase does not warn
    const done = goal({ column: 1, nodes: [{ id: 'p', title: 'P', start: '2026-06-01', deadline: '2026-07-01', done: true }] });
    expect(kinds(done)).not.toContain('phase-overdue');
  });

  it('phase-outside-project when a scheduled phase starts before or ends after the project', () => {
    const g = goal({ column: 1, start: '2026-06-01', deadline: '2026-08-01',
      nodes: [{ id: 'p', title: 'P', start: '2026-05-01', deadline: '2026-07-20', done: false }] });
    const w = roadmapWarnings(g, TODAY).find((x) => x.kind === 'phase-outside-project');
    expect(w?.nodeIds).toEqual(['p']);
  });

  it('unscheduled-phases only for a Now project with undated first-level nodes', () => {
    const nodes = [{ id: 'a', title: 'A', done: false }, { id: 'b', title: 'B', done: false }];
    const now = roadmapWarnings(goal({ column: 0, nodes }), TODAY).find((x) => x.kind === 'unscheduled-phases');
    expect(now?.nodeIds).toEqual(['a', 'b']);
    expect(kinds(goal({ column: 1, nodes }))).not.toContain('unscheduled-phases');
  });

  it('milestone-unplanned reuses the milestone window + unplanned-this-week predicate', () => {
    const base = { column: 1 as const, milestones: [{ id: 'm', title: 'M', date: '2026-07-20' }] };
    const unplanned = goal({ ...base, nodes: [{ id: 'a', title: 'A', done: false }] });
    expect(kinds(unplanned)).toContain('milestone-unplanned');
    // planned this week → silent
    const planned = goal({ ...base, nodes: [{ id: 'a', title: 'A', done: false, plannedWeek: WEEK }] });
    expect(kinds(planned)).not.toContain('milestone-unplanned');
    // milestone too far out → silent
    const far = goal({ column: 1, milestones: [{ id: 'm', title: 'M', date: '2026-09-01' }], nodes: [{ id: 'a', title: 'A', done: false }] });
    expect(kinds(far)).not.toContain('milestone-unplanned');
  });

  it('stacks independent warnings (Now project both overdue and unscheduled)', () => {
    const g = goal({ column: 0, deadline: '2026-07-01', nodes: [{ id: 'a', title: 'A', done: false }] });
    expect(kinds(g)).toEqual(expect.arrayContaining(['project-overdue', 'unscheduled-phases']));
  });
});

// ── focusOverlap ──────────────────────────────────────────────────────────────

const span = (id: string, start: string, deadline: string): Goal => ({ id, title: id, start, deadline, nodes: [], column: 0 });

describe('focusOverlap', () => {
  it('is null with three or fewer overlapping spans', () => {
    expect(focusOverlap([span('a', '2026-07-01', '2026-07-31'), span('b', '2026-07-01', '2026-07-31'), span('c', '2026-07-01', '2026-07-31')])).toBeNull();
  });

  it('fires when more than three spans overlap for at least seven days', () => {
    const gs = ['a', 'b', 'c', 'd'].map((id) => span(id, '2026-07-01', '2026-07-31'));
    const o = focusOverlap(gs);
    expect(o?.window).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(o?.goalIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('respects the seven-day boundary (7 fires, 6 does not)', () => {
    const seven = ['a', 'b', 'c', 'd'].map((id) => span(id, '2026-07-01', '2026-07-07'));
    expect(focusOverlap(seven)?.window).toEqual({ start: '2026-07-01', end: '2026-07-07' });
    const six = ['a', 'b', 'c', 'd'].map((id) => span(id, '2026-07-01', '2026-07-06'));
    expect(focusOverlap(six)).toBeNull();
  });

  it('merges a touching run and includes every span intersecting the window', () => {
    const gs = [
      span('a', '2026-07-01', '2026-07-31'), span('b', '2026-07-01', '2026-07-31'),
      span('c', '2026-07-01', '2026-07-31'), span('d', '2026-07-01', '2026-07-31'),
      span('e', '2026-07-20', '2026-07-25'), // bumps the count mid-window
    ];
    const o = focusOverlap(gs);
    expect(o?.window).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(o?.goalIds).toContain('e');
  });

  it('returns the earliest qualifying window across disjoint crowds', () => {
    const early = ['a', 'b', 'c', 'd'].map((id) => span(id, '2026-07-01', '2026-07-10'));
    const late = ['e', 'f', 'g', 'h'].map((id) => span(id, '2026-09-01', '2026-09-15'));
    const o = focusOverlap([...late, ...early]); // order shouldn't matter
    expect(o?.window.start).toBe('2026-07-01');
    expect(o?.goalIds).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ── fitRoadmapRange ───────────────────────────────────────────────────────────

describe('fitRoadmapRange', () => {
  it('is null for an empty selection or an unmeasured plot', () => {
    expect(fitRoadmapRange([], 800)).toBeNull();
    expect(fitRoadmapRange([goal({})], 0)).toBeNull();
  });

  it('uses the Week preset centered when all dates coincide', () => {
    expect(fitRoadmapRange([goal({ start: '2026-07-15', deadline: '2026-07-15' })], 800))
      .toEqual({ scale: PX_PER_DAY.week, scrollToCenterDate: '2026-07-15' });
  });

  it('frames a normal range at plotWidth / padded days, centered on the midpoint', () => {
    const r = fitRoadmapRange([goal({ start: '2026-07-01', deadline: '2026-07-31' })], 600)!;
    // span 30d, pad max(7, round(1.5))=7, padded inclusive = 30 + 14 + 1 = 45
    expect(r.scale).toBeCloseTo(600 / 45, 5);
    expect(r.scrollToCenterDate).toBe('2026-07-16');
  });

  it('clamps a too-wide selection to the minimum zoom', () => {
    const r = fitRoadmapRange([goal({ start: '2026-01-01', deadline: '2031-12-31' })], 600)!;
    expect(r.scale).toBe(3);
  });

  it('considers milestone dates when framing', () => {
    const r = fitRoadmapRange([goal({ start: '2026-07-01', deadline: '2026-07-10', milestones: [{ id: 'm', title: 'M', date: '2026-09-01' }] })], 4000)!;
    expect(r.scrollToCenterDate).toBe('2026-08-01'); // midpoint of 07-01…09-01
  });
});
