// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ShortcutsOverlay } from './ShortcutsOverlay';

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

const open = () =>
  render(createElement(ShortcutsOverlay, { open: true, onClose: vi.fn() }));

describe('Shortcuts overlay — capture syntax', () => {
  /**
   * The `#goal @date ~45m` grammar lived only in the input placeholder, which
   * vanishes the moment anyone types. The cheat sheet is where people look for
   * syntax, so it has to be documented there too.
   */
  it('documents the three capture sigils', () => {
    open();
    expect(screen.getByText('Capture syntax')).toBeTruthy();
    expect(screen.getByText('#goal')).toBeTruthy();
    expect(screen.getByText('@date')).toBeTruthy();
    expect(screen.getByText('~time')).toBeTruthy();
  });

  it('shows one worked example', () => {
    open();
    expect(screen.getByText(/#english @friday ~90m/)).toBeTruthy();
  });
});
