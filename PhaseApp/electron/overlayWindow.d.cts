// Deliberately imports nothing from `electron`: main.cjs stays the only
// composition root that may know BrowserWindow and screen. The controller
// sees window handles only through injected capabilities, whose types are
// the narrowest truth this module needs.

/** Structurally FocusStatusSnapshot from src/lib/focusStatus.ts — mirrored, never imported (see menuBar.d.cts). */
export interface OverlayFocusStatus {
  phase: 'active' | 'break' | 'confirming';
  activeSinceMs: number | null;
  accumulatedMs: number;
  title: string;
  /** Present only on a pomodoro session; durations, never a remaining figure. */
  cycle?: {
    workMin: number;
    breakMin: number;
    longBreakMin: number;
    longEvery: number;
    completed: number;
    breakStartedMs?: number;
    breakKind?: 'short' | 'long';
  };
}

export interface OverlayPillModel {
  glyph: '▶' | '⏸';
  text: string;
}

export interface OverlayPoint { x: number; y: number }
export interface OverlayWorkArea { x: number; y: number; width: number; height: number }

export interface OverlayWebContents {
  readonly id: number;
  send(channel: string, model: OverlayPillModel): void;
  on(event: 'did-finish-load', fn: () => void): void;
}

/** Minimal BrowserWindow shape; never BrowserWindow itself. */
export interface OverlayNativeWindow {
  isDestroyed(): boolean;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  setAlwaysOnTop(flag: boolean, level: 'status'): void;
  setVisibleOnAllWorkspaces(visible: boolean, options: { visibleOnFullScreen: boolean }): void;
  getPosition(): number[];
  on(event: 'moved', fn: () => void): void;
  loadFile(htmlPath: string): Promise<void>;
  webContents: OverlayWebContents;
}

export interface OverlayWindowOptions {
  x: number; y: number; width: number; height: number;
  frame: false; transparent: true; resizable: false; hasShadow: false;
  focusable: false; skipTaskbar: true; alwaysOnTop: true; show: false;
  webPreferences: { preload: string; contextIsolation: true; sandbox: true };
}

export interface OverlayWindowDeps {
  createWindow(options: OverlayWindowOptions): OverlayNativeWindow;
  htmlPath: string;
  preloadPath: string;
  getPrimaryWorkArea(): OverlayWorkArea;
  /** Work area of the display nearest the given point. */
  workAreaNearest(point: OverlayPoint): OverlayWorkArea;
  /** Last saved position, or null when none or unreadable. */
  readPosition(): OverlayPoint | null;
  writePosition(point: OverlayPoint): void;
  now(): number;
  /** One-shot; returns the cancel. Re-armed by the repaint itself. */
  setTimer(fn: () => void, ms: number): () => void;
  logError(message: string, error?: unknown): void;
}

export interface OverlayWindow {
  create(): void;
  dispose(): void;
  /** Adopt the renderer's latest snapshot. Dropped when no window came up. */
  setFocusStatus(status: OverlayFocusStatus | null): void;
  /** Settings toggle; false hides regardless of snapshot, true re-evaluates it. */
  setEnabled(enabled: boolean): void;
  /** Whether the given webContents id is this overlay's page. */
  isSender(webContentsId: number): boolean;
}

export declare function createOverlayWindow(deps: OverlayWindowDeps): OverlayWindow;
export declare function pillModel(status: OverlayFocusStatus | null, nowMs: number): OverlayPillModel | null;
export declare function clampToWorkArea(point: OverlayPoint, workArea: OverlayWorkArea): OverlayPoint;
export declare function defaultPosition(workArea: OverlayWorkArea): OverlayPoint;
export declare const REPAINT_MS: number;
export declare const OVERLAY_WIDTH: number;
export declare const OVERLAY_HEIGHT: number;
