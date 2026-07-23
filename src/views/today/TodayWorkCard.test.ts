import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DailyWorkItem, DailyWorkSections } from '../../lib/dailyWork';
import { TodayWorkCard } from './TodayWorkCard';

function item(overrides: Partial<DailyWorkItem> = {}): DailyWorkItem {
  return {
    key: 'task:t1',
    kind: 'task',
    id: 't1',
    title: 'Call supplier',
    goalId: null,
    due: false,
    done: false,
    editable: true,
    source: 'carry-over',
    scheduledDate: '2026-07-22',
    ...overrides,
  };
}

function sections(overrides: Partial<DailyWorkSections> = {}): DailyWorkSections {
  return {
    commitments: [],
    suggestions: [],
    carryOvers: [],
    completedToday: [],
    ...overrides,
  };
}

describe('TodayWorkCard', () => {
  it('keeps planning available when there are no daily commitments', () => {
    const html = renderToStaticMarkup(createElement(TodayWorkCard, {
      sections: sections(),
      today: '2026-07-23',
    }));

    expect(html).toContain('Today&#x27;s work');
    expect(html).toContain('Plan week');
    expect(html).toContain('Nothing committed for today.');
  });

  it('renders title-specific task decisions and keeps done work collapsed', () => {
    const html = renderToStaticMarkup(createElement(TodayWorkCard, {
      sections: sections({
        carryOvers: [item()],
        completedToday: [item({
          key: 'step:done',
          kind: 'step',
          id: 'done',
          title: 'Finished draft',
          goalId: 'g1',
          goalTitle: 'Launch',
          done: true,
          source: 'completed-today',
        })],
      }),
      today: '2026-07-23',
    }));

    expect(html).toContain('aria-label="Move &quot;Call supplier&quot; to today"');
    expect(html).toContain('aria-label="Move &quot;Call supplier&quot; to tomorrow"');
    expect(html).toContain('aria-label="Pick a date for &quot;Call supplier&quot;"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('aria-label="Delete &quot;Call supplier&quot;"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Done today (1)');
    expect(html).not.toContain('Finished draft');
  });
});
