import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DailyWorkSections } from '../../lib/dailyWork';
import { WorthConsideringCard } from './WorthConsideringCard';

const emptySections: DailyWorkSections = {
  commitments: [],
  suggestions: [],
  carryOvers: [],
  completedToday: [],
};

describe('WorthConsideringCard', () => {
  it('states clearly when the bounded recommendation list is empty', () => {
    const html = renderToStaticMarkup(createElement(WorthConsideringCard, {
      sections: emptySections,
      today: '2026-07-23',
    }));

    expect(html).toContain('No additional recommendation right now.');
    expect(html).not.toContain('role="checkbox"');
  });

  it('renders recommendations as acceptance actions rather than completion controls', () => {
    const html = renderToStaticMarkup(createElement(WorthConsideringCard, {
      sections: {
        ...emptySections,
        suggestions: [{
          key: 'step:s1',
          kind: 'step',
          id: 's1',
          title: 'Draft launch email',
          goalId: 'g1',
          goalTitle: 'Launch',
          due: false,
          done: false,
          editable: true,
          source: 'suggested',
        }],
      },
      today: '2026-07-23',
    }));

    expect(html).toContain('Draft launch email');
    expect(html).toContain('aria-label="Plan &quot;Draft launch email&quot; for today"');
    expect(html).not.toContain('role="checkbox"');
  });
});
