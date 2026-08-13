import type { AssistantAction, AssistantSnapshot } from './assistantProtocol';
import type { ShortcutStatus } from './assistantAccelerator';

/**
 * The renderer-side wrapper around the preload bridges — and the reason the
 * rest of the app never touches `window.phaseAssistant` directly. In the
 * browser (Vite dev, web tests) the preload does not exist, so both factories
 * return inert stubs: publishing goes nowhere, subscriptions return honest
 * unsubscribe functions, and `available` says which world this is. Nothing
 * else in the codebase needs an "is this Electron?" conditional.
 */

export interface AssistantMainBridge {
  /** False in the plain browser: publish is a no-op and nothing ever fires. */
  available: boolean;
  publish(snapshot: AssistantSnapshot): void;
  onRequestSnapshot(fn: () => void): () => void;
  onAction(fn: (action: AssistantAction) => void): () => void;
  /** Null in the browser, or when the main process refused the request. */
  configureShortcut(accelerator: string): Promise<ShortcutStatus | null>;
}

export interface AssistantOverlayBridge {
  available: boolean;
  ready(): Promise<AssistantSnapshot>;
  onSnapshot(fn: (snapshot: AssistantSnapshot) => void): () => void;
  act(action: AssistantAction): void;
  close(): void;
}

interface MainPreload {
  publish(snapshot: AssistantSnapshot): void;
  onRequestSnapshot(fn: () => void): () => void;
  onAction(fn: (action: AssistantAction) => void): () => void;
  configureShortcut(accelerator: string): Promise<ShortcutStatus | null>;
}

interface OverlayPreload {
  ready(): Promise<AssistantSnapshot>;
  onSnapshot(fn: (snapshot: AssistantSnapshot) => void): () => void;
  act(action: AssistantAction): void;
  close(): void;
}

function preloadOf<T>(name: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, T | undefined>)[name];
}

const noop = (): void => {};

export function assistantMainBridge(): AssistantMainBridge {
  const preload = preloadOf<MainPreload>('phaseAssistant');
  if (!preload) {
    return {
      available: false,
      publish: noop,
      onRequestSnapshot: () => noop,
      onAction: () => noop,
      configureShortcut: async () => null,
    };
  }
  return {
    available: true,
    publish: (snapshot) => preload.publish(snapshot),
    onRequestSnapshot: (fn) => preload.onRequestSnapshot(fn),
    onAction: (fn) => preload.onAction(fn),
    configureShortcut: (accelerator) => preload.configureShortcut(accelerator),
  };
}

export function assistantOverlayBridge(): AssistantOverlayBridge {
  const preload = preloadOf<OverlayPreload>('phaseAssistantOverlay');
  if (!preload) {
    return {
      available: false,
      // An overlay with no relay can only ever be loading; it never resolves
      // to fake data, because fake data would render as fact.
      ready: async () => ({ status: 'loading' }),
      onSnapshot: () => noop,
      act: noop,
      close: noop,
    };
  }
  return {
    available: true,
    ready: () => preload.ready(),
    onSnapshot: (fn) => preload.onSnapshot(fn),
    act: (action) => preload.act(action),
    close: () => preload.close(),
  };
}
