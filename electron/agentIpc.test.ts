import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createAgentIpc, AGENT_CHANNEL_PREFIX } =
  nativeRequire('./agentIpc.cjs') as typeof import('./agentIpc.cjs');

type Listener = (event: { sender: { id: number } }, payload?: unknown) => unknown;

function fakeIpcMain() {
  const handles = new Map<string, Listener>();
  return {
    handle: vi.fn((channel: string, fn: Listener) => handles.set(channel, fn)),
    removeHandler: vi.fn((channel: string) => handles.delete(channel)),
    invoke: (channel: string, senderId: number, payload?: unknown) =>
      handles.get(channel)?.({ sender: { id: senderId } }, payload),
    channels: () => [...handles.keys()],
  };
}

function fakeWindow(id: number) {
  const send = vi.fn();
  return { isDestroyed: () => false, webContents: { id, send } };
}

const MAIN_ID = 1;
const STRANGER_ID = 9;

describe('createAgentIpc', () => {
  it('answers with an error when no renderer is alive', async () => {
    const ipc = createAgentIpc({ getMainWindow: () => null });
    await expect(ipc.call({ tool: 'today' }))
      .resolves.toEqual({ ok: false, error: 'Phase is not running.' });
  });

  it('sends the request to the renderer and resolves its reply', async () => {
    const win = fakeWindow(MAIN_ID);
    const ipc = createAgentIpc({ getMainWindow: () => win });
    const ipcMain = fakeIpcMain();
    ipc.register(ipcMain);

    const pending = ipc.call({ tool: 'today' });

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    const [channel, envelope] = win.webContents.send.mock.calls[0];
    expect(channel).toBe(`${AGENT_CHANNEL_PREFIX}:request`);

    ipcMain.invoke(`${AGENT_CHANNEL_PREFIX}:reply`, MAIN_ID, {
      id: (envelope as { id: number }).id,
      response: { ok: true, data: { now: null } },
    });

    await expect(pending).resolves.toEqual({ ok: true, data: { now: null } });
  });

  it('ignores a reply from a sender that is not the main renderer', async () => {
    const win = fakeWindow(MAIN_ID);
    const ipc = createAgentIpc({ getMainWindow: () => win });
    const ipcMain = fakeIpcMain();
    ipc.register(ipcMain);

    const pending = ipc.call({ tool: 'today' });
    const [, envelope] = win.webContents.send.mock.calls[0];

    const accepted = ipcMain.invoke(`${AGENT_CHANNEL_PREFIX}:reply`, STRANGER_ID, {
      id: (envelope as { id: number }).id,
      response: { ok: true, data: 'stolen' },
    });
    expect(accepted).toBe(false);

    // The real renderer can still answer.
    ipcMain.invoke(`${AGENT_CHANNEL_PREFIX}:reply`, MAIN_ID, {
      id: (envelope as { id: number }).id,
      response: { ok: true, data: 'real' },
    });
    await expect(pending).resolves.toEqual({ ok: true, data: 'real' });
  });

  it('registers exactly one channel and disposes it', () => {
    const ipc = createAgentIpc({ getMainWindow: () => null });
    const ipcMain = fakeIpcMain();
    ipc.register(ipcMain);
    expect(ipcMain.channels()).toEqual([`${AGENT_CHANNEL_PREFIX}:reply`]);
    ipc.dispose(ipcMain);
    expect(ipcMain.channels()).toEqual([]);
  });
});

/**
 * A sandboxed preload cannot `require` this module for the prefix, so
 * preload.cjs writes the two channel names out by hand — and drift would be a
 * silent "function is not a function" in the renderer rather than a build
 * error. calendarIpc.test.ts guards the calendar door the same way.
 */
describe('preload drift', () => {
  it('exposes exactly the two agent channels the relay uses', () => {
    const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
    expect(preload).toContain(`${AGENT_CHANNEL_PREFIX}:request`);
    expect(preload).toContain(`${AGENT_CHANNEL_PREFIX}:reply`);
    // The renderer must never be handed a channel-name parameter.
    expect(preload).not.toMatch(/phaseAgent[\s\S]*?ipcRenderer\.(invoke|send|on)\(\s*channel/);
  });
});
