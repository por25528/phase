import { describe, expect, it } from 'vitest';
import { createModalRegistry } from './modalRegistry';

describe('modal registry', () => {
  it('tracks whether a shared modal is open and which one is topmost', () => {
    const registry = createModalRegistry();
    const closeFirst = registry.register('first');

    expect(registry.hasOpenModal()).toBe(true);
    expect(registry.isTopmost('first')).toBe(true);

    const closeSecond = registry.register('second');
    expect(registry.isTopmost('first')).toBe(false);
    expect(registry.isTopmost('second')).toBe(true);

    closeSecond();
    expect(registry.isTopmost('first')).toBe(true);
    closeFirst();
    expect(registry.hasOpenModal()).toBe(false);
    expect(registry.topmost()).toBeNull();
  });

  it('unregisters an instance idempotently without disturbing newer modals', () => {
    const registry = createModalRegistry();
    const closeFirst = registry.register('modal');
    const closeSecond = registry.register('modal');

    closeFirst();
    closeFirst();
    expect(registry.hasOpenModal()).toBe(true);
    expect(registry.topmost()).toBe('modal');

    closeSecond();
    expect(registry.hasOpenModal()).toBe(false);
  });
});
