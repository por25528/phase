// Imports nothing from src/ and nothing from `electron`: `net` and `fs` are
// injected, so the static face names only the slice of each this module uses.

/** The slice of a `net.Socket` a connection handler needs. */
export interface AgentConnection {
  setEncoding(encoding: string): void;
  write(chunk: string): void;
  end(): void;
  on(event: 'data' | 'error', fn: (chunk: any) => void): void;
}

export interface NetLike {
  createServer(onConnection: (conn: AgentConnection) => void): {
    listen(path: string, cb?: () => void): void;
    close(): void;
    on(event: 'error', fn: (err: unknown) => void): void;
  };
}

export interface FsLike {
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
  chmodSync(path: string, mode: number): void;
}

export interface AgentSocketDeps {
  socketPath: string;
  /** Never rejects — the relay answers an unreachable renderer with an error. */
  handle(request: unknown): Promise<unknown>;
  net: NetLike;
  fs: FsLike;
}

export interface AgentSocket {
  listen(): void;
  close(): void;
}

export declare function createAgentSocket(deps: AgentSocketDeps): AgentSocket;
