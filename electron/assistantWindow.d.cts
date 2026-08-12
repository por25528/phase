export interface AssistantWindowOptions {
  width: number;
  height: number;
  maxHeight: number;
  minWidth: number;
  maxWidth: number;
  frame: boolean;
  show: boolean;
  skipTaskbar: boolean;
  fullscreenable: boolean;
  minimizable: boolean;
  maximizable: boolean;
  backgroundColor: string;
  webPreferences: {
    contextIsolation: boolean;
    nodeIntegration: boolean;
    preload: string;
  };
}

export type AssistantEntry =
  | { kind: 'url'; target: string }
  | { kind: 'file'; target: string };

export declare function assistantWindowOptions(preloadPath: string): AssistantWindowOptions;
export declare function assistantEntry(devServerUrl: string | undefined): AssistantEntry;
