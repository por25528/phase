// Electron main process for Phase.
// Wraps the built Vite app (dist/) in a native macOS window.
const { app, BrowserWindow, shell, safeStorage, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
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
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve(server.address().port)
      })
    }),
    close: () => {
      try {
        server.close()
        // Deferred: the success page is written in the same tick as the close,
        // and closeAllConnections() destroys the socket carrying it. close()
        // alone would leave the port bound while keep-alive sockets linger,
        // which is the leak this exists to prevent.
        setTimeout(() => server.closeAllConnections(), 0)
      } catch { /* already closed */ }
    },
    onRequest: (fn) => { handler = fn },
  }
}

async function httpJson(url, init) {
  const res = await fetch(url, init)
  let json = {}
  let parsed = true
  try { json = await res.json() } catch { parsed = false }
  // A parse failure on an ERROR body is fine — Google's 4xx/5xx are not always
  // JSON. On a SUCCESS body it is not: treating it as an empty result would
  // report zero events, and a day with no events renders as free. A captive
  // portal answering 200 with an HTML login page is the realistic case.
  return { ok: res.ok && parsed, status: res.status, json }
}

function buildCalendar() {
  const secrets = createSecretStore({
    readFile: () => (fs.existsSync(secretsPath()) ? fs.readFileSync(secretsPath()) : null),
    writeFile: (bytes) => fs.writeFileSync(secretsPath(), bytes, { mode: 0o600 }),
    removeFile: () => {
      try {
        fs.unlinkSync(secretsPath())
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err
      }
    },
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
  try {
    registerCalendarIpc(ipcMain, buildCalendar())
  } catch (err) {
    // The planner must open even if the calendar wiring cannot. The renderer
    // sees phaseCalendar reject, which the UI can show; a dead dock icon it
    // cannot.
    console.error('[phase-calendar] IPC registration failed', err)
  }
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
