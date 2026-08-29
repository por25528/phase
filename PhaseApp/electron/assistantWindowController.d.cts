// Deliberately imports nothing from `electron`: main.cjs stays the only
// composition root that may know BrowserWindow, screen, and listeners. The
// controller sees window handles and screen facts only through injected
// capabilities, whose types are the narrowest truth this module needs.
import type { AssistantEntry, AssistantWindowOptions } from './assistantWindow.d.cts';

/** Minimal main-process window shape; never BrowserWindow itself. */
export interface AssistantShelfWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  setBounds(bounds: { x: number; y: number; width: number; height: number }, animate: boolean): void;
  setAlwaysOnTop(flag: boolean, level: string): void;
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options: { visibleOnFullScreen: boolean; skipTransformProcessType: boolean },
  ): void;
  show(): void;
  hide(): void;
  focus(): void;
  destroy(): void;
  loadURL(url: string): unknown;
  loadFile(path: string): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  webContents: {
    focus(): void;
    setWindowOpenHandler(handler: (details: unknown) => { action: 'deny' }): void;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
  };
}

export interface AssistantShelfPoint {
  x: number;
  y: number;
}

export interface AssistantShelfDisplay {
  workArea: { x: number; y: number; width: number; height: number };
}

export interface AssistantWindowControllerDeps {
  createWindow(options: AssistantWindowOptions): AssistantShelfWindow;
  preloadPath: string;
  entry: AssistantEntry;
  getCursorScreenPoint(): AssistantShelfPoint;
  getDisplayNearestPoint(point: AssistantShelfPoint): AssistantShelfDisplay;
  beforeShow(): void;
  platform?: NodeJS.Platform;
  shouldUseDarkColors?(): boolean;
  logError?(message: string, error?: unknown): void;
  /**
   * Install the navigation policy on the shelf's `webContents`.
   *
   * Injected rather than imported so this module keeps owning the window's
   * lifecycle and nothing else — `main.cjs` supplies the same policy the main
   * frame runs. Defaults to a no-op, which is what every existing test wants.
   */
  guardNavigation?(contents: AssistantShelfWindow['webContents']): void;
}

export interface AssistantWindowController {
  create(): void;
  position(): void;
  showAndFocus(): void;
  hide(): void;
  isShowing(): boolean;
  current(): AssistantShelfWindow | null;
  dispose(): void;
}

export declare function createAssistantWindowController(
  deps: AssistantWindowControllerDeps,
): AssistantWindowController;
