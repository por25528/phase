// The validated door between the main renderer and the local backup folder.
//
// Three narrow invoke verbs, all validated at the sender seam exactly as
// shellIpc.cjs validates its own: the main window's webContents id is the only
// id allowed to reach the user's data folder, matched against the live window.
// There are no renderer-supplied channels, no paths, and no forwarding —
// `register` installs exactly these three handlers and `dispose` removes
// exactly those three.
//
// The renderer names a FILE, never a path: `isBackupName` is re-applied here
// even though the store applies it too, because the traversal guard must not
// be something a future store swap can quietly remove.
//
// Every verb DEGRADES rather than throws. A backup folder on a full or
// read-only disk is a bad day, not a reason for the planner to stop answering
// — the renderer reads the empty list or the null and says so in words.

const { isBackupName, BACKUP_REASONS } = require('./backupStore.cjs');

const BACKUP_CHANNEL_PREFIX = 'phase-backups';

/**
 * A ceiling on one snapshot, so a runaway renderer cannot fill the disk one
 * `write` at a time. 64 MiB is far above any real Phase database — the whole
 * backup is JSON plus base64 images — and far below "the volume is gone".
 */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

function createBackupIpc(deps) {
  const { getMainWindow, store, logError } = deps;

  // The live-window helper: a destroyed handle is no handle at all.
  function liveMain() {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  // Sender validation is an exact id match against the live main webContents —
  // not a name, not a prefix, not a stale handle.
  function isMainSender(event) {
    const main = liveMain();
    return !!main && event.sender.id === main.webContents.id;
  }

  function onList(event) {
    if (!isMainSender(event)) return [];
    try {
      return store.list();
    } catch (err) {
      logError('[phase-backups] could not list the backup folder', err);
      return [];
    }
  }

  function onWrite(event, payload) {
    if (!isMainSender(event)) return null;
    if (!payload || typeof payload !== 'object') return null;
    const { text, reason } = payload;
    if (typeof text !== 'string' || text.length === 0) return null;
    if (!BACKUP_REASONS.includes(reason)) return null;
    // Length, not byte length: it is a cheap upper bound on the same thing and
    // this check exists to refuse the absurd, not to meter the reasonable.
    if (text.length > MAX_BACKUP_BYTES) return null;
    try {
      return store.write(text, reason);
    } catch (err) {
      logError('[phase-backups] could not write a backup', err);
      return null;
    }
  }

  function onRead(event, name) {
    if (!isMainSender(event)) return null;
    if (!isBackupName(name)) return null;
    try {
      return store.read(name);
    } catch (err) {
      logError('[phase-backups] could not read a backup', err);
      return null;
    }
  }

  return {
    register(ipcMain) {
      ipcMain.handle(`${BACKUP_CHANNEL_PREFIX}:list`, onList);
      ipcMain.handle(`${BACKUP_CHANNEL_PREFIX}:write`, onWrite);
      ipcMain.handle(`${BACKUP_CHANNEL_PREFIX}:read`, onRead);
    },
    dispose(ipcMain) {
      ipcMain.removeHandler(`${BACKUP_CHANNEL_PREFIX}:list`);
      ipcMain.removeHandler(`${BACKUP_CHANNEL_PREFIX}:write`);
      ipcMain.removeHandler(`${BACKUP_CHANNEL_PREFIX}:read`);
    },
  };
}

module.exports = { BACKUP_CHANNEL_PREFIX, MAX_BACKUP_BYTES, createBackupIpc };
