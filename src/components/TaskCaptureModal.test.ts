import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaskCaptureModal } from './TaskCaptureModal';

describe('TaskCaptureModal', () => {
  it('renders a fresh, visible Today capture form when open', () => {
    const html = renderToStaticMarkup(createElement(TaskCaptureModal, {
      open: true,
      onClose: () => {},
      enabled: true,
    }));

    expect(html).toContain('aria-label="Task title"');
    expect(html).toContain('>Today</button>');
    expect(html).toContain('>Tomorrow</button>');
    expect(html).toContain('>Pick day</button>');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Today<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Choose project<\/button>/);
    expect(html).toContain('<form');
    expect(html).toContain('type="submit"');
    expect(html).toMatch(/type="submit" disabled=""[^>]*>Add task<\/button>/);
  });

  it('owns conditional date and project controls instead of showing them by default', () => {
    const html = renderToStaticMarkup(createElement(TaskCaptureModal, {
      open: true,
      onClose: () => {},
      enabled: true,
    }));

    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('<select');
  });

  it('renders nothing while closed', () => {
    expect(renderToStaticMarkup(createElement(TaskCaptureModal, {
      open: false,
      onClose: () => {},
      enabled: true,
    }))).toBe('');
  });
});
