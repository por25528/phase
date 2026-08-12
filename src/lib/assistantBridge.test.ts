// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantMainBridge, assistantOverlayBridge } from './assistantBridge';
import type { AssistantSnapshot } from './assistantProtocol';

type AnyWindow = Record<string, unknown>;

afterEach(() => {
  delete (window as unknown as AnyWindow).phaseAssistant;
  delete (window as unknown as AnyWindow).phaseAssistantOverlay;
});

describe('assistantMainBridge', () => {
  it('returns a safe stub in the plain browser', () => {
    const bridge = assistantMainBridge();
    expect(bridge.available).toBe(false);
    expect(() => bridge.publish({ status: 'loading' })).not.toThrow();
    const unsubscribe = bridge.onRequestSnapshot(() => {});
    expect(() => unsubscribe()).not.toThrow();
    expect(() => bridge.onAction(() => {})()).not.toThrow();
  });

  it('wraps the preload and passes unsubscribe functions through', () => {
    const off = vi.fn();
    const preload = {
      publish: vi.fn(),
      onRequestSnapshot: vi.fn(() => off),
      onAction: vi.fn(() => off),
    };
    (window as unknown as AnyWindow).phaseAssistant = preload;

    const bridge = assistantMainBridge();
    expect(bridge.available).toBe(true);

    const snapshot: AssistantSnapshot = { status: 'loading' };
    bridge.publish(snapshot);
    expect(preload.publish).toHaveBeenCalledWith(snapshot);

    const unsubscribe = bridge.onRequestSnapshot(() => {});
    unsubscribe();
    expect(off).toHaveBeenCalledTimes(1);
  });
});

describe('assistantOverlayBridge', () => {
  it('reports loading forever without a relay, never fake data', async () => {
    const bridge = assistantOverlayBridge();
    expect(bridge.available).toBe(false);
    expect(await bridge.ready()).toEqual({ status: 'loading' });
    expect(() => bridge.onSnapshot(() => {})()).not.toThrow();
    expect(() => bridge.act({ type: 'close' })).not.toThrow();
    expect(() => bridge.close()).not.toThrow();
  });

  it('wraps the preload when it exists', async () => {
    const off = vi.fn();
    const preload = {
      ready: vi.fn(async (): Promise<AssistantSnapshot> => ({ status: 'loading' })),
      onSnapshot: vi.fn(() => off),
      act: vi.fn(),
      close: vi.fn(),
    };
    (window as unknown as AnyWindow).phaseAssistantOverlay = preload;

    const bridge = assistantOverlayBridge();
    expect(bridge.available).toBe(true);
    await bridge.ready();
    expect(preload.ready).toHaveBeenCalled();
    bridge.onSnapshot(() => {})();
    expect(off).toHaveBeenCalled();
    bridge.act({ type: 'complete-focus' });
    expect(preload.act).toHaveBeenCalledWith({ type: 'complete-focus' });
  });
});
