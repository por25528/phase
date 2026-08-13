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
      openAssistant: async () => false,
      onOpenSettings: () => noop,
      getLaunchAtLogin: async () => null,
      setLaunchAtLogin: async () => null,
    };
  }
  return {
    available: true,
    openAssistant: () => preload.openAssistant(),
    onOpenSettings: (fn) => preload.onOpenSettings(fn),
    getLaunchAtLogin: () => preload.getLaunchAtLogin(),
    setLaunchAtLogin: (enabled) => preload.setLaunchAtLogin(enabled),
  };
}
