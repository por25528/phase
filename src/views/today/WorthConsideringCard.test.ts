import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorthConsideringCard } from './WorthConsideringCard';

describe('WorthConsideringCard', () => {
  it('states clearly when the bounded recommendation list is empty', () => {
    const html = renderToStaticMarkup(createElement(WorthConsideringCard));

    expect(html).toContain('No additional recommendation right now.');
    expect(html).not.toContain('role="checkbox"');
  });
});
