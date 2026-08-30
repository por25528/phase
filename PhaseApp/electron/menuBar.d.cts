// Deliberately imports nothing from `electron`: main.cjs stays the only
// composition root that may know Tray, Menu, and nativeImage. The controller
// sees tray handles and image facts only through injected capabilities, whose
// types are the narrowest truth this module needs.

/** Minimal nativeImage shape; never nativeImage itself. */
export interface MenuBarImage {
  isEmpty(): boolean;
  setTemplateImage(template: boolean): void;
}

/** Minimal Tray shape; never Tray itself. */
export interface MenuBarNativeTray {
  setToolTip(tooltip: string): void;
  setContextMenu(menu: unknown): void;
  /** The live session timer. Empty string means icon only. */
  setTitle(title: string): void;
  destroy(): void;
}

export interface MenuBarTemplateItem {
  label?: string;
  type?: string;
  click?: () => void;
}

/**
 * What the renderer says the session is doing. Structurally the
 * `FocusStatusSnapshot` declared in `src/lib/focusStatus.ts` — mirrored rather
 * than imported, because the process seam prevents sharing declarations across
 * it (see busyBlocks.d.cts).
 */
export interface MenuBarFocusStatus {
  phase: 'active' | 'break' | 'confirming';
  activeSinceMs: number | null;
  accumulatedMs: number;
  title: string;
}

export interface MenuBarDeps {
  createTray(image: MenuBarImage): MenuBarNativeTray;
  buildMenu(template: MenuBarTemplateItem[]): unknown;
  loadImage(iconPath: string): MenuBarImage;
  iconPath: string;
  onOpenPhase(): void;
  onOpenAssistant(): void;
  onOpenSettings(): void;
  /** The one deliberate route out of the app; never Electron's role: 'quit'. */
  onQuit(): void;
  /** Ask the renderer — the only writer — to pause the running session. */
  onTakeBreak(): void;
  /** Ask the renderer to resume a session that is on a break. */
  onResume(): void;
  /** Ask the renderer to complete the running session. */
  onFinishSession(): void;
  now(): number;
  /** One-shot; returns the cancel. Re-armed by the repaint itself. */
  setTimer(fn: () => void, ms: number): () => void;
  logError(message: string, error?: unknown): void;
}

export interface MenuBar {
  create(): void;
  dispose(): void;
  /** Adopt the renderer's latest snapshot. Dropped when no tray came up. */
  setFocusStatus(status: MenuBarFocusStatus | null): void;
}

export declare function createMenuBar(deps: MenuBarDeps): MenuBar;
/** Exported for the tests that pin the wording of each phase. */
export declare function trayTitle(status: MenuBarFocusStatus | null, nowMs: number): string;
export declare const REPAINT_MS: number;
