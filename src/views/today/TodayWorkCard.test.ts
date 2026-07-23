import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TodayWorkCard } from './TodayWorkCard';

describe('TodayWorkCard', () => {
  it('keeps planning available when there are no daily commitments', () => {
    const html = renderToStaticMarkup(createElement(TodayWorkCard));

    expect(html).toContain('Today&#x27;s work');
    expect(html).toContain('Plan week');
    expect(html).toContain('Nothing committed for today.');
  });
});
