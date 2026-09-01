export interface AssistantWindowOptions {
  type?: 'panel';
  title: string;
  width: number;
  height: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  useContentSize: boolean;
  frame: boolean;
  show: boolean;
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
  hiddenInMissionControl: boolean;
  resizable: boolean;
  minimizable: boolean;
  maximizable: boolean;
  fullscreenable: boolean;
  movable: boolean;
  hasShadow: boolean;
  transparent: boolean;
  backgroundColor: string;
  webPreferences: {
    contextIsolation: boolean;
    nodeIntegration: boolean;
    preload: string;
  };
}

export interface AssistantWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AssistantShelfBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AssistantEntry =
  | { kind: 'url'; target: string }
  | { kind: 'file'; target: string };

export declare function assistantWindowOptions(
  preloadPath: string,
  platform?: NodeJS.Platform,
  darkMode?: boolean,
): AssistantWindowOptions;
/** The geometry half of `ShelfPrefs`, mirrored — never imported from `src/`. */
export interface AssistantShelfGeometry {
  width: 'narrow' | 'default' | 'wide';
  position: 'center' | 'top-center';
}

export declare const SHELF_WIDTHS: Record<AssistantShelfGeometry['width'], number>;
export declare function normalizeShelfGeometry(raw: unknown): AssistantShelfGeometry;
export declare function assistantShelfBounds(
  workArea: AssistantWorkArea,
  geometry?: unknown,
): AssistantShelfBounds;
export declare function assistantEntry(devServerUrl: string | undefined): AssistantEntry;
