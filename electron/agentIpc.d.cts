// Imports nothing from src/ and nothing from `electron`: the process seam
// prevents sharing declarations across it, and every capability is injected.

/** Loosely-typed window handle so this module never imports `electron`. */
export interface AgentWindow {
  isDestroyed(): boolean;
  webContents: {
    id: number;
    send(channel: string, payload?: unknown): void;
  };
}

export interface AgentIpcDeps {
  getMainWindow(): AgentWindow | null;
}

export interface AgentIpc {
  register(ipcMain: { handle(channel: string, fn: (...args: any[]) => unknown): void }): void;
  dispose(ipcMain: { removeHandler(channel: string): void }): void;
  /** Never rejects — an unreachable renderer resolves to an error response. */
  call(request: unknown): Promise<unknown>;
}

export declare const AGENT_CHANNEL_PREFIX: string;
export declare function createAgentIpc(deps: AgentIpcDeps): AgentIpc;
