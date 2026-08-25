// Deliberately imports nothing from `electron`: main.cjs stays the only
// composition root that may know app, BrowserWindow, and their events. The
// lifecycle module sees app events and window handles only through injected
// shapes, whose types are the narrowest truth this module needs.

/** A window handle with only the two capabilities the lifecycle consumes. */
export interface AppLifecycleWindow {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  hide(): void;
}

/** The narrow app-event emitter shape; never Electron's App itself. */
export interface AppLifecycleEmitter {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** A close event with only the member the lifecycle consumes. */
export interface AppLifecycleCloseEvent {
  preventDefault(): void;
}

export interface AppLifecycleSettings {
  wasOpenedAtLogin?: boolean;
}

export interface AppLifecycleDeps {
  app: AppLifecycleEmitter;
  /** Reopen the Hub on Dock activation or menu-bar Open Phase. */
  onActivate(): void;
  /** Release shortcuts and other resources on explicit quit. */
  onWillQuit(): void;
}

export interface AppLifecycle {
  register(): void;
  protectMainWindow(win: AppLifecycleWindow): void;
  isQuitting(): boolean;
  dispose(): void;
}

export declare function shouldShowMainAtLaunch(settings: AppLifecycleSettings): boolean;
export declare function createAppLifecycle(deps: AppLifecycleDeps): AppLifecycle;
