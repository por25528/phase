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

/**
 * Everything the pill may be told about how to look. Structurally
 * `PillPrefs` from `src/lib/pillPrefs.ts` — mirrored, never imported.
 */
export interface OverlayPillPrefs {
  show: boolean;
  content: 'countdown' | 'elapsed';
  showTitle: boolean;
  showGlyph: boolean;
  size: 'small' | 'medium' | 'large';
  opacity: number;
  theme: 'system' | 'dark' | 'light';
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  clickThrough: boolean;
}

export interface OverlaySize {
  width: number; height: number; font: number; radius: number; padX: number;
}

/**
 * What main paints and the page applies. Every decision is already made here:
 * the page sets custom properties from these numbers and colours and decides
 * nothing of its own.
 */
export interface OverlayPillModel {
  glyph?: '▶' | '⏸';
  text: string;
  font: number;
  height: number;
  radius: number;
  padX: number;
  bg: string;
  ink: string;
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
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setIgnoreMouseEvents(ignore: boolean): void;
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
  /** `nativeTheme.shouldUseDarkColors`, read only for the `system` theme. */
  isSystemDark(): boolean;
  /** One-shot; returns the cancel. Re-armed by the repaint itself. */
  setTimer(fn: () => void, ms: number): () => void;
  logError(message: string, error?: unknown): void;
}

export interface OverlayWindow {
  create(): void;
  dispose(): void;
  /** Adopt the renderer's latest snapshot. Dropped when no window came up. */
  setFocusStatus(status: OverlayFocusStatus | null): void;
  /** The pill's settings row, validated here. `show: false` hides regardless of snapshot. */
  setPrefs(prefs: unknown): void;
  /** Recompute against the injected clock and OS palette; main calls it on `nativeTheme` updates. */
  repaint(): void;
  /** Whether the given webContents id is this overlay's page. */
  isSender(webContentsId: number): boolean;
}

export declare function createOverlayWindow(deps: OverlayWindowDeps): OverlayWindow;
export declare function pillModel(
  status: OverlayFocusStatus | null,
  nowMs: number,
  prefs: OverlayPillPrefs,
  isSystemDark: boolean,
): OverlayPillModel | null;
export declare function normalizePillPrefs(raw: unknown): OverlayPillPrefs;
export declare function clampToWorkArea(
  point: OverlayPoint, workArea: OverlayWorkArea, footprint?: OverlaySize,
): OverlayPoint;
export declare function defaultPosition(
  workArea: OverlayWorkArea,
  corner?: OverlayPillPrefs['corner'],
  footprint?: OverlaySize,
): OverlayPoint;
export declare const DEFAULT_PILL_PREFS: OverlayPillPrefs;
export declare const PILL_SIZES: Record<OverlayPillPrefs['size'], OverlaySize>;
export declare const REPAINT_MS: number;
export declare const OVERLAY_WIDTH: number;
export declare const OVERLAY_HEIGHT: number;
