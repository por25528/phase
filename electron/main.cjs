// Electron main process for Phase.
// Wraps the built Vite app (dist/) in a native macOS window.
const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { safeStorage, ipcMain } = require('electron')
const { createSecretStore } = require('./secrets.cjs')
const { createPkce } = require('./pkce.cjs')
const { createOAuth } = require('./oauth.cjs')
const { createGoogleClient } = require('./googleClient.cjs')
const { normalizeEvents } = require('./busyBlocks.cjs')
const { createCalendarHandlers, registerCalendarIpc } = require('./calendarIpc.cjs')

// When VITE_DEV_SERVER_URL is set (npm run app:dev) we load the live dev
// server for hot-reload; otherwise we load the built files from dist/.
const devServerUrl = process.env.VITE_DEV_SERVER_URL

/** @type {BrowserWindow | null} */
let mainWindow = null

// The encrypted store lives beside the app's other user data, NOT in the
// bundle: an .app is read-only and is replaced wholesale on every update.
const secretsPath = () => path.join(app.getPath('userData'), 'calendar-secrets.bin')

/** Adapts node:http to the LoopbackServer shape oauth.cjs expects. */
function createLoopbackServer() {
  let handler = null
  const server = http.createServer((req, res) => {
    if (handler) handler(req.url, (status, body) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(body)
    })
  })
  return {
    listen: () => new Promise((resolve, reject) => {
      // Port 0 asks the OS for any free port, and 127.0.0.1 keeps the socket
      // off every other interface.
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    }),
    close: () => {
      try { server.close() } catch { /* already closed */ }
      // server.close() waits on existing keep-alive sockets; force them closed
      // so the OAuth loopback port is gone on every outcome.
      server.closeAllConnections()
    },
    onRequest: (fn) => { handler = fn },
  }
}

async function httpJson(url, init) {
  const res = await fetch(url, init)
  let json = {}
  try { json = await res.json() } catch { /* an error body need not be JSON */ }
  return { ok: res.ok, status: res.status, json }
}

function buildCalendar() {
  const secrets = createSecretStore({
    readFile: () => (fs.existsSync(secretsPath()) ? fs.readFileSync(secretsPath()) : null),
    writeFile: (bytes) => fs.writeFileSync(secretsPath(), bytes, { mode: 0o600 }),
    removeFile: () => { try { fs.unlinkSync(secretsPath()) } catch { /* already gone */ } },
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (bytes) => safeStorage.decryptString(bytes),
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  })

  const oauth = createOAuth({
    secrets,
    httpPost: (url, body) => httpJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }),
    createServer: createLoopbackServer,
    openExternal: (url) => shell.openExternal(url),
    now: () => Date.now(),
    setTimer: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id) },
    createPkce: () => createPkce(),
  })

  const googleClient = createGoogleClient({
    httpGet: (url, accessToken) => httpJson(url, { headers: { Authorization: `Bearer ${accessToken}` } }),
    getAccessToken: () => oauth.getAccessToken(),
  })

  return createCalendarHandlers({
    secrets,
    oauth,
    googleClient,
    normalizeEvents,
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    nowIso: () => new Date().toISOString(),
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#FAF9F7', // matches the app's near-white canvas, avoids white flash
    titleBarStyle: 'hiddenInset', // native mac traffic lights, roomier chrome
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Show only once the first paint is ready — no blank window on launch.
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Open target="_blank" / external links in the user's browser, not in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // Before createWindow: a fast first paint must not reach a channel that
  // does not exist yet.
  registerCalendarIpc(ipcMain, buildCalendar())
  createWindow()

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// macOS convention: apps stay running after all windows close, but for a
// single-window personal tool it's friendlier to fully quit.
app.on('window-all-closed', () => {
  app.quit()
})
