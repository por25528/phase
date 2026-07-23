import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuickAdd } from './QuickAdd';

describe('QuickAdd', () => {
  it('offers tasks as a visible quick-add type', () => {
    const html = renderToStaticMarkup(createElement(QuickAdd, {
      type: 'goal',
      onType: () => {},
      inputRef: createRef<HTMLInputElement>(),
    }));

    expect(html).toContain('>Task</button>');
  });
});
