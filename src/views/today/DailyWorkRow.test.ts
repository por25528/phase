import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DailyWorkItem } from '../../lib/dailyWork';
import { DailyWorkRow } from './DailyWorkRow';

function item(overrides: Partial<DailyWorkItem> = {}): DailyWorkItem {
  return {
    key: 'task:t1',
    kind: 'task',
    id: 't1',
    title: 'Send the draft',
    goalId: 'g1',
    goalTitle: 'Launch',
    due: false,
    done: true,
    editable: true,
    source: 'task-today',
    scheduledDate: '2026-07-23',
    ...overrides,
  };
}

describe('DailyWorkRow', () => {
  it('renders the real completion state, source, and project context', () => {
    const html = renderToStaticMarkup(createElement(DailyWorkRow, {
      item: item(),
      onToggle: vi.fn(),
    }));

    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Mark &quot;Send the draft&quot; not done"');
    expect(html).toContain('TODAY');
    expect(html).toContain('Launch');
  });

  it('labels due and weekly work with the shared work source', () => {
    const due = renderToStaticMarkup(createElement(DailyWorkRow, {
      item: item({ done: false, source: 'due', due: true }),
      onToggle: vi.fn(),
    }));
    const weekly = renderToStaticMarkup(createElement(DailyWorkRow, {
      item: item({ done: false, source: 'this-week' }),
      onToggle: vi.fn(),
    }));

    expect(due).toContain('DUE');
    expect(weekly).toContain('THIS WEEK');
  });

  it('keeps optional action controls beside the completion control', () => {
    const html = renderToStaticMarkup(createElement(DailyWorkRow, {
      item: item({ done: false }),
      onToggle: vi.fn(),
      action: createElement('button', { type: 'button' }, 'Tomorrow'),
    }));

    expect(html).toContain('Tomorrow');
    expect(html).toContain('aria-label="Complete &quot;Send the draft&quot;"');
  });

  it('renders archived project completion as disabled read-only evidence', () => {
    const html = renderToStaticMarkup(createElement(DailyWorkRow, {
      item: item({ kind: 'step', editable: false }),
      onToggle: vi.fn(),
    }));

    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Completed in archived project');
  });
});
