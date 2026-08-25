// The main↔renderer half of the agent bridge, as a deep module.
//
// One channel in each direction and nothing else: main SENDS a request
// envelope to the main renderer, and the renderer answers on a single
// `reply` channel whose sender is matched exactly against the live window —
// the same rule shellIpc.cjs applies. There are no renderer-supplied channel
// names and no forwarding.
//
// `call` never rejects. A dead renderer is an ordinary answer ("Phase is not
// running"), because the caller is a socket handler that must always write
// one line back.

const AGENT_CHANNEL_PREFIX = 'phase-agent';
const REQUEST_CHANNEL = `${AGENT_CHANNEL_PREFIX}:request`;
const REPLY_CHANNEL = `${AGENT_CHANNEL_PREFIX}:reply`;

function createAgentIpc(deps) {
  const { getMainWindow } = deps;
  const pending = new Map();
  let nextId = 1;

  // The live-window helper: a destroyed handle is no handle at all.
  function liveMain() {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  function onReply(event, payload) {
    const main = liveMain();
    if (!main || event.sender.id !== main.webContents.id) return false;
    if (!payload || typeof payload !== 'object') return false;
    const settle = pending.get(payload.id);
    if (!settle) return false;
    pending.delete(payload.id);
    settle(payload.response);
    return true;
  }

  return {
    register(ipcMain) {
      ipcMain.handle(REPLY_CHANNEL, onReply);
    },
    dispose(ipcMain) {
      ipcMain.removeHandler(REPLY_CHANNEL);
      for (const settle of pending.values()) {
        settle({ ok: false, error: 'Phase is shutting down.' });
      }
      pending.clear();
    },
    call(request) {
      const main = liveMain();
      if (!main) return Promise.resolve({ ok: false, error: 'Phase is not running.' });
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        main.webContents.send(REQUEST_CHANNEL, { id, request });
      });
    },
  };
}

module.exports = { createAgentIpc, AGENT_CHANNEL_PREFIX };
