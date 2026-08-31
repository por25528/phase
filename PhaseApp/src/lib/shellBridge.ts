import type { FocusStatusSnapshot } from './focusStatus';

/**
 * The renderer-side wrapper around the preload bridge for the desktop shell —
 * the sibling of assistantBridge.ts with the same shape of rules. In the
 * browser (Vite dev, web tests) the preload does not exist, so the factory
 * returns an inert stub: openAssistant never opens anything, subscriptions
 * return honest unsubscribe functions, login queries answer null, and
 * `available` says which world this is. The surface is a FIXED set of verbs —
 * none of them accepts a channel name, so nothing here can reach a handler the
 * main process did not explicitly expose.
 */

export interface PhaseShellBridge {
  /** False in the plain browser: every call is a no-op and nothing ever fires. */
  available: boolean;
  /**
   * Whether the window wears the macOS inset title bar, so the app header has
   * to reserve its left edge for the traffic lights. False in the browser,
   * where there are none and a reserved gutter would just be dead space.
   *
   * A fact rather than a verb — the one non-function on this surface — because
   * the title bar style is fixed when the window is constructed and cannot
   * change while it lives.
   */
  insetTitleBar: boolean;
  /** Ask the desktop shell to raise the assistant overlay. */
  openAssistant(): Promise<boolean>;
  /** Subscribe to the shell asking for the settings surface. Returns unsubscribe. */
  onOpenSettings(fn: () => void): () => void;
  /** Whether the app starts at login. Null in the browser, or on refusal. */
  getLaunchAtLogin(): Promise<boolean | null>;
  /** Set whether the app starts at login. Null in the browser, or on refusal. */
  setLaunchAtLogin(enabled: boolean): Promise<boolean | null>;
  /**
   * Tell the shell what the focus draft is doing. Fire-and-forget, and a
   * no-op in the browser — the tray and the idle watcher are desktop facts,
   * and a caller that had to ask whether they exist would grow a branch at
   * every transition.
   */
  publishFocusStatus(snapshot: FocusStatusSnapshot): void;
  /** Subscribe to the shell asking for something. Returns unsubscribe. */
  onFocusRequest(fn: (request: unknown) => void): () => void;
  /**
   * Tell the shell whether the floating pill may show. Fire-and-forget and a
   * no-op in the browser, for the same reason publishFocusStatus is.
   */
  setOverlayEnabled(enabled: boolean): void;
}

interface ShellPreload {
  /** Absent on any preload built before the header reserved the gutter. */
  insetTitleBar?: boolean;
  openAssistant(): Promise<boolean>;
  onOpenSettings(fn: () => void): () => void;
  getLaunchAtLogin(): Promise<boolean | null>;
  setLaunchAtLogin(enabled: boolean): Promise<boolean | null>;
  /** Absent on any preload built before the menu bar learned about sessions. */
  publishFocusStatus?(snapshot: FocusStatusSnapshot): void;
  /** Absent on the same older preloads; the stub's unsubscribe stands in. */
  onFocusRequest?(fn: (request: unknown) => void): () => void;
  /** Absent on any preload built before the overlay pill existed. */
  setOverlayEnabled?(enabled: boolean): void;
}

function preloadOf<T>(name: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, T | undefined>)[name];
}

const noop = (): void => {};

export function shellBridge(): PhaseShellBridge {
  const preload = preloadOf<ShellPreload>('phaseShell');
  if (!preload) {
    return {
      available: false,
      insetTitleBar: false,
      openAssistant: async () => false,
      onOpenSettings: () => noop,
      getLaunchAtLogin: async () => null,
      setLaunchAtLogin: async () => null,
      publishFocusStatus: noop,
      onFocusRequest: () => noop,
      setOverlayEnabled: noop,
    };
  }
  return {
    available: true,
    // `=== true`, so a preload predating this field reads as "no gutter"
    // rather than as `undefined` leaking into the header's class list.
    insetTitleBar: preload.insetTitleBar === true,
    openAssistant: () => preload.openAssistant(),
    onOpenSettings: (fn) => preload.onOpenSettings(fn),
    getLaunchAtLogin: () => preload.getLaunchAtLogin(),
    setLaunchAtLogin: (enabled) => preload.setLaunchAtLogin(enabled),
    // Guarded rather than called straight through, for the same reason
    // `insetTitleBar` is defaulted: a packaged app can outlive the preload it
    // was built beside only in development, but a missing verb here would be a
    // TypeError on every session transition rather than a feature quietly not
    // being there.
    publishFocusStatus: (snapshot) => preload.publishFocusStatus?.(snapshot),
    onFocusRequest: (fn) => preload.onFocusRequest?.(fn) ?? noop,
    setOverlayEnabled: (enabled) => preload.setOverlayEnabled?.(enabled),
  };
}
