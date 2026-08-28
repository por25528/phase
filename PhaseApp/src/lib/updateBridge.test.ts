// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateBridge } from './updateBridge';

declare global {
  interface Window {
    phaseUpdates?: { check(): Promise<{ version: string; url: string } | null> };
  }
}

afterEach(() => {
  delete window.phaseUpdates;
});

describe('updateBridge', () => {
  it('is an inert stub in the plain browser', async () => {
    const bridge = updateBridge();
    expect(bridge.available).toBe(false);
    expect(await bridge.check()).toBeNull();
  });

  it('passes check through to the preload', async () => {
    const info = { version: '0.2.0', url: 'https://github.com/por25528/phase/releases/tag/v0.2.0' };
    const check = vi.fn(async () => info);
    window.phaseUpdates = { check };
    const bridge = updateBridge();
    expect(bridge.available).toBe(true);
    expect(await bridge.check()).toEqual(info);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
