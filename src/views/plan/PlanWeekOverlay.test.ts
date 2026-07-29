import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DndContext } from '@dnd-kit/core';
import { describe, expect, it, vi } from 'vitest';
import type { PlannedLeaf } from '../../lib/plan';
import type { Task } from '../../db/types';
import { DayContent, TaskChip } from './PlanWeekOverlay';

function task(
  id: string,
  done = false,
  goalId: string | null = null,
): Task {
  return {
    id,
    title: `Task ${id}`,
    date: '2026-07-23',
    done,
    goalId,
  };
}

const leaf: PlannedLeaf = {
  goalId: 'g1',
  goalTitle: 'Launch',
  nodeId: 'n1',
  title: 'Draft brief',
  done: false,
  plannedWeek: '2026-07-20',
  plannedDay: '2026-07-23',
};

describe('planner task markup', () => {
  it('renders a distinct Tasks group before project steps and keeps completed tasks visible', () => {
    const html = renderToStaticMarkup(createElement(
      DndContext,
      null,
      createElement(DayContent, {
        leaves: [leaf],
        tasks: [task('open', false, 'g1'), task('done', true, 'missing')],
        goalTitleById: new Map([['g1', 'Launch']]),
        onRemove: vi.fn(),
        onToggleTask: vi.fn(),
        onEstimateNode: vi.fn(),
        onEstimateTask: vi.fn(),
      }),
    ));

    expect(html).toContain('>Tasks<');
    expect(html).toContain('Task open');
    expect(html).toContain('Task done');
    expect(html).toContain('line-through');
    expect(html.indexOf('>Tasks<')).toBeLessThan(html.indexOf('>Launch<'));
    expect(html).toMatch(/data-task-context="true"[^>]*>Launch/);
    expect(html).not.toMatch(/data-task-context="true"[^>]*>missing/);
  });

  it('exposes an accessible checkbox and disables completed-task dragging', () => {
    const open = renderToStaticMarkup(createElement(
      DndContext,
      null,
      createElement(TaskChip, {
        task: task('open'),
        onToggle: vi.fn(),
        onEstimate: vi.fn(),
      }),
    ));
    const done = renderToStaticMarkup(createElement(
      DndContext,
      null,
      createElement(TaskChip, {
        task: task('done', true),
        onToggle: vi.fn(),
        onEstimate: vi.fn(),
      }),
    ));

    expect(open).toContain('aria-label="Mark &quot;Task open&quot; complete"');
    expect(open).toContain('aria-label="Drag &quot;Task open&quot;"');
    expect(open).not.toContain('disabled=""');
    expect(done).toContain('aria-label="Mark &quot;Task done&quot; incomplete"');
    expect(done).toContain('aria-label="Drag &quot;Task done&quot;"');
    expect(done).toContain('disabled=""');
    expect(done).toContain('checked=""');
  });
});
