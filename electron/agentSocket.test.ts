import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createAgentSocket } =
  nativeRequire('./agentSocket.cjs') as typeof import('./agentSocket.cjs');

/** A fake socket that records what was written and lets tests feed it data. */
function fakeConnection() {
  const listeners = new Map<string, (chunk: unknown) => void>();
  return {
    setEncoding: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn((event: string, fn: (chunk: unknown) => void) => {
      listeners.set(event, fn);
    }),
    feed: (text: string) => listeners.get('data')?.(text),
  };
}

function fakeNet() {
  let onConnection: ((conn: unknown) => void) | null = null;
  const server = {
    listen: vi.fn((_path: string, cb?: () => void) => cb?.()),
    close: vi.fn(),
    on: vi.fn(),
  };
  return {
    createServer: vi.fn((fn: (conn: unknown) => void) => {
      onConnection = fn;
      return server;
    }),
    server,
    connect: (conn: unknown) => onConnection?.(conn),
  };
}

function fakeFs() {
  return { existsSync: vi.fn(() => false), unlinkSync: vi.fn(), chmodSync: vi.fn() };
}

const SOCKET = '/tmp/phase-test/agent.sock';

describe('createAgentSocket', () => {
  it('locks the socket to the owner on listen', () => {
    const net = fakeNet();
    const fs = fakeFs();
    createAgentSocket({
      socketPath: SOCKET, handle: async () => ({ ok: true, data: null }), net, fs,
    }).listen();

    expect(net.server.listen).toHaveBeenCalledWith(SOCKET, expect.any(Function));
    expect(fs.chmodSync).toHaveBeenCalledWith(SOCKET, 0o600);
  });

  it('removes a stale socket file before listening', () => {
    const net = fakeNet();
    const fs = fakeFs();
    fs.existsSync.mockReturnValue(true);
    createAgentSocket({
      socketPath: SOCKET, handle: async () => ({ ok: true, data: null }), net, fs,
    }).listen();

    expect(fs.unlinkSync).toHaveBeenCalledWith(SOCKET);
  });

  it('answers one line per request line', async () => {
    const net = fakeNet();
    const handle = vi.fn(async () => ({ ok: true, data: { free: 90 } }));
    createAgentSocket({ socketPath: SOCKET, handle, net, fs: fakeFs() }).listen();

    const conn = fakeConnection();
    net.connect(conn);
    conn.feed('{"tool":"week"}\n');
    await vi.waitFor(() => expect(conn.write).toHaveBeenCalled());

    expect(handle).toHaveBeenCalledWith({ tool: 'week' });
    expect(conn.write.mock.calls[0][0]).toBe('{"ok":true,"data":{"free":90}}\n');
  });

  it('answers malformed JSON without calling the handler', async () => {
    const net = fakeNet();
    const handle = vi.fn(async () => ({ ok: true, data: null }));
    createAgentSocket({ socketPath: SOCKET, handle, net, fs: fakeFs() }).listen();

    const conn = fakeConnection();
    net.connect(conn);
    conn.feed('not json\n');
    await vi.waitFor(() => expect(conn.write).toHaveBeenCalled());

    expect(handle).not.toHaveBeenCalled();
    expect(JSON.parse(conn.write.mock.calls[0][0] as string))
      .toEqual({ ok: false, error: 'Malformed request.' });
  });

  it('buffers a request split across chunks', async () => {
    const net = fakeNet();
    const handle = vi.fn(async () => ({ ok: true, data: null }));
    createAgentSocket({ socketPath: SOCKET, handle, net, fs: fakeFs() }).listen();

    const conn = fakeConnection();
    net.connect(conn);
    conn.feed('{"tool":');
    expect(handle).not.toHaveBeenCalled();
    conn.feed('"today"}\n');
    await vi.waitFor(() => expect(handle).toHaveBeenCalledWith({ tool: 'today' }));
  });
});
