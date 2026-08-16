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
}

interface ShellPreload {
  /** Absent on any preload built before the header reserved the gutter. */
  insetTitleBar?: boolean;
  openAssistant(): Promise<boolean>;
  onOpenSettings(fn: () => void): () => void;
  getLaunchAtLogin(): Promise<boolean | null>;
  setLaunchAtLogin(enabled: boolean): Promise<boolean | null>;
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
  };
}
