import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAgentBridge } from './agentBridge';

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

function withPreload(preload: unknown) {
  (globalThis as Record<string, unknown>).window = { phaseAgent: preload };
}

describe('createAgentBridge', () => {
  it('is inert in a plain browser', () => {
    (globalThis as Record<string, unknown>).window = {};
    const bridge = createAgentBridge();
    expect(bridge.available).toBe(false);
    // Subscribing still returns an honest unsubscribe rather than throwing.
    expect(bridge.onRequest(() => {})()).toBeUndefined();
    expect(() => bridge.reply(1, { ok: true, data: null })).not.toThrow();
  });

  it('forwards subscriptions and replies to the preload', () => {
    const onRequest = vi.fn(() => () => {});
    const reply = vi.fn();
    withPreload({ onRequest, reply });

    const bridge = createAgentBridge();
    expect(bridge.available).toBe(true);

    const fn = vi.fn();
    bridge.onRequest(fn);
    expect(onRequest).toHaveBeenCalledWith(fn);

    bridge.reply(7, { ok: false, error: 'no' });
    expect(reply).toHaveBeenCalledWith(7, { ok: false, error: 'no' });
  });
});
