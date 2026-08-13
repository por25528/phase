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
  destroy(): void;
}

export interface MenuBarTemplateItem {
  label?: string;
  type?: string;
  click?: () => void;
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
  logError(message: string, error?: unknown): void;
}

export interface MenuBar {
  create(): void;
  dispose(): void;
}

export declare function createMenuBar(deps: MenuBarDeps): MenuBar;
