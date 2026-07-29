import { describe, expect, it } from 'vitest';
import { goalPct } from './pct';
import { weekOf } from './plan';
import { sampleProject, SAMPLE_PROJECT_TITLE } from './sampleProject';

const TODAY = '2026-07-23';

function counter(): () => string {
  let n = 0;
  return () => `sample-${n++}`;
}

describe('sampleProject', () => {
  it('builds a confirmed, Now-column example with a valid span', () => {
    const g = sampleProject(TODAY, counter());
    expect(g.title).toBe(SAMPLE_PROJECT_TITLE);
    expect(g.column).toBe(0);
    expect(g.datesConfirmed).toBe(true);
    expect(g.start).toBe(TODAY);
    expect(g.deadline! > g.start!).toBe(true);
  });

  it('teaches decomposition: a container groups leaves, and the % is partial', () => {
    const g = sampleProject(TODAY, counter());
    const container = g.nodes.find((n) => n.children && n.children.length > 0);
    expect(container).toBeDefined();
    expect(container!.done).toBeUndefined(); // containers never carry completion
    const pct = goalPct(g);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
  });

  it('commits one open leaf to this week but leaves it in the backlog (no day, no start minute)', () => {
    const g = sampleProject(TODAY, counter());
    const backlog: string[] = [];
    const walk = (nodes: typeof g.nodes) => nodes.forEach((n) => {
      if (n.children) walk(n.children);
      else if (!n.done && n.plannedWeek === weekOf(TODAY) && n.plannedDay === undefined && n.plannedStartMin === undefined) {
        backlog.push(n.id);
      }
    });
    walk(g.nodes);
    expect(backlog.length).toBe(1);
  });

  it('gives every node a unique id', () => {
    const g = sampleProject(TODAY, counter());
    const ids: string[] = [g.id];
    const walk = (nodes: typeof g.nodes) => nodes.forEach((n) => {
      ids.push(n.id);
      if (n.children) walk(n.children);
    });
    walk(g.nodes);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
