import type { FocusStatusSnapshot } from './focusStatus';
import type { PillPrefs } from './pillPrefs';
import type { ShelfPrefs } from './shelfPrefs';

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
  /** Subscribe to the shell asking for Today — the pill was clicked. Returns unsubscribe. */
  onOpenToday(fn: () => void): () => void;
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
   * Tell the shell how the floating pill should look — the whole row at once,
   * so main never has to reconcile nine independent pushes. Fire-and-forget
   * and a no-op in the browser, for the same reason publishFocusStatus is.
   */
  setPillPrefs(prefs: PillPrefs): void;
  /**
   * Tell the shell how the Cmd+Space shelf should be shaped. Only the GEOMETRY
   * half means anything to main — the content half rides the assistant relay,
   * because the shelf's renderer does not own the store.
   */
  setShelfPrefs(prefs: ShelfPrefs): void;
  /**
   * Announce a cycle boundary — the OS notification, raised by main. Same
   * fire-and-forget contract: the transition is written before this is called,
   * and a notice that could not be raised is a log line, never a failed
   * transition.
   */
  notifyFocus(notice: { title: string; body: string }): void;
}

interface ShellPreload {
  /** Absent on any preload built before the header reserved the gutter. */
  insetTitleBar?: boolean;
  openAssistant(): Promise<boolean>;
  onOpenSettings(fn: () => void): () => void;
  /** Absent on any preload built before a click on the pill meant anything. */
  onOpenToday?(fn: () => void): () => void;
  getLaunchAtLogin(): Promise<boolean | null>;
  setLaunchAtLogin(enabled: boolean): Promise<boolean | null>;
  /** Absent on any preload built before the menu bar learned about sessions. */
  publishFocusStatus?(snapshot: FocusStatusSnapshot): void;
  /** Absent on the same older preloads; the stub's unsubscribe stands in. */
  onFocusRequest?(fn: (request: unknown) => void): () => void;
  /** Absent on any preload built before the pill had a settings group. */
  setPillPrefs?(prefs: PillPrefs): void;
  /** Absent on any preload built before the shelf had a settings group. */
  setShelfPrefs?(prefs: ShelfPrefs): void;
  /** Absent on any preload built before the cycle boundary had a voice. */
  notifyFocus?(notice: { title: string; body: string }): void;
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
      onOpenToday: () => noop,
      getLaunchAtLogin: async () => null,
      setLaunchAtLogin: async () => null,
      publishFocusStatus: noop,
      onFocusRequest: () => noop,
      setPillPrefs: noop,
      setShelfPrefs: noop,
      notifyFocus: noop,
    };
  }
  return {
    available: true,
    // `=== true`, so a preload predating this field reads as "no gutter"
    // rather than as `undefined` leaking into the header's class list.
    insetTitleBar: preload.insetTitleBar === true,
    openAssistant: () => preload.openAssistant(),
    onOpenSettings: (fn) => preload.onOpenSettings(fn),
    onOpenToday: (fn) => preload.onOpenToday?.(fn) ?? noop,
    getLaunchAtLogin: () => preload.getLaunchAtLogin(),
    setLaunchAtLogin: (enabled) => preload.setLaunchAtLogin(enabled),
    // Guarded rather than called straight through, for the same reason
    // `insetTitleBar` is defaulted: a packaged app can outlive the preload it
    // was built beside only in development, but a missing verb here would be a
    // TypeError on every session transition rather than a feature quietly not
    // being there.
    publishFocusStatus: (snapshot) => preload.publishFocusStatus?.(snapshot),
    onFocusRequest: (fn) => preload.onFocusRequest?.(fn) ?? noop,
    setPillPrefs: (prefs) => preload.setPillPrefs?.(prefs),
    setShelfPrefs: (prefs) => preload.setShelfPrefs?.(prefs),
    notifyFocus: (notice) => preload.notifyFocus?.(notice),
  };
}
