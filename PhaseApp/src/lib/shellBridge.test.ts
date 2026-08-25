// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shellBridge } from './shellBridge';

type AnyWindow = Record<string, unknown>;

afterEach(() => {
  delete (window as unknown as AnyWindow).phaseShell;
});

describe('shellBridge', () => {
  it('returns a safe stub in the plain browser', async () => {
    const bridge = shellBridge();
    expect(bridge.available).toBe(false);
    // No traffic lights in a browser tab, so no gutter to reserve for them.
    expect(bridge.insetTitleBar).toBe(false);
    expect(await bridge.openAssistant()).toBe(false);
    expect(await bridge.getLaunchAtLogin()).toBeNull();
    expect(await bridge.setLaunchAtLogin(true)).toBeNull();
    const unsubscribe = bridge.onOpenSettings(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });

  it('wraps the preload and passes all four calls plus unsubscribe through', async () => {
    const off = vi.fn();
    const preload = {
      openAssistant: vi.fn(async () => true),
      onOpenSettings: vi.fn(() => off),
      getLaunchAtLogin: vi.fn(async () => true),
      setLaunchAtLogin: vi.fn(async () => true),
    };
    (window as unknown as AnyWindow).phaseShell = preload;

    const bridge = shellBridge();
    expect(bridge.available).toBe(true);

    expect(await bridge.openAssistant()).toBe(true);
    expect(preload.openAssistant).toHaveBeenCalledTimes(1);

    const fn = vi.fn();
    bridge.onOpenSettings(fn);
    expect(preload.onOpenSettings).toHaveBeenCalledWith(fn);
    const unsubscribe = bridge.onOpenSettings(vi.fn());
    unsubscribe();
    expect(off).toHaveBeenCalledTimes(1);

    expect(await bridge.getLaunchAtLogin()).toBe(true);
    expect(preload.getLaunchAtLogin).toHaveBeenCalledTimes(1);

    expect(await bridge.setLaunchAtLogin(false)).toBe(true);
    expect(preload.setLaunchAtLogin).toHaveBeenCalledWith(false);
  });

  it('exposes a fixed verb set — nothing accepts a channel name', () => {
    (window as unknown as AnyWindow).phaseShell = {
      openAssistant: vi.fn(async () => true),
      onOpenSettings: vi.fn(() => vi.fn()),
      getLaunchAtLogin: vi.fn(async () => null),
      setLaunchAtLogin: vi.fn(async () => null),
    };
    const bridge = shellBridge();
    expect(Object.keys(bridge).sort()).toEqual([
      'available',
      'getLaunchAtLogin',
      'insetTitleBar',
      'onOpenSettings',
      'openAssistant',
      'setLaunchAtLogin',
    ]);
  });

  /**
   * The header spends this straight into a class list, so it has to be a real
   * boolean on every path. A preload built before the field existed reports
   * `undefined`, and the browser stub has no preload at all — neither may reach
   * the template as anything but `false`.
   */
  it('reports the title bar inset as a boolean, whatever the preload says', () => {
    const base = {
      openAssistant: vi.fn(async () => true),
      onOpenSettings: vi.fn(() => vi.fn()),
      getLaunchAtLogin: vi.fn(async () => null),
      setLaunchAtLogin: vi.fn(async () => null),
    };

    (window as unknown as AnyWindow).phaseShell = { ...base, insetTitleBar: true };
    expect(shellBridge().insetTitleBar).toBe(true);

    (window as unknown as AnyWindow).phaseShell = { ...base, insetTitleBar: false };
    expect(shellBridge().insetTitleBar).toBe(false);

    // An older preload, with no such key.
    (window as unknown as AnyWindow).phaseShell = base;
    expect(shellBridge().insetTitleBar).toBe(false);
  });
});
