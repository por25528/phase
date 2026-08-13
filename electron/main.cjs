// Electron main process for Phase.
// Wraps the built Vite app (dist/) in a native macOS window and composes the
// background command shelf: the Hub stays the single store owner, the shelf is
// a prewarmed read-only panel behind a controller, and the menu bar plus
// login-item access sit behind the validated shell bridge. main.cjs is the
// only module that may know BrowserWindow, screen, Tray, Menu, and nativeImage.
const { app, BrowserWindow, shell, safeStorage, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage, nativeTheme } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { createSecretStore } = require('./secrets.cjs')
const { createPkce } = require('./pkce.cjs')
const { createOAuth } = require('./oauth.cjs')
const { createGoogleClient } = require('./googleClient.cjs')
const { normalizeEvents } = require('./busyBlocks.cjs')
const { createCalendarHandlers, registerCalendarIpc } = require('./calendarIpc.cjs')
const { createAssistantIpc } = require('./assistantIpc.cjs')
const { createAssistantShortcut } = require('./assistantShortcut.cjs')
const { assistantEntry } = require('./assistantWindow.cjs')
const { createAssistantWindowController } = require('./assistantWindowController.cjs')
const { createAppLifecycle, shouldShowMainAtLaunch } = require('./appLifecycle.cjs')
const { createShellIpc } = require('./shellIpc.cjs')
const { createMenuBar } = require('./menuBar.cjs')

// When VITE_DEV_SERVER_URL is set (npm run app:dev) we load the live dev
// server for hot-reload; otherwise we load the built files from dist/.
const devServerUrl = process.env.VITE_DEV_SERVER_URL

/** @type {BrowserWindow | null} */
let mainWindow = null

/** @type {ReturnType<typeof createAssistantWindowController> | null} */
let assistantController = null

/** @type {ReturnType<typeof createMenuBar> | null} */
let menuBar = null

// The relay between the main renderer (the one store owner) and the shelf
// renderer. Window getters, not references: the Hub can be recreated and the
// shelf is owned by its controller, so the relay must always speak to the
// live windows.
const assistantIpc = createAssistantIpc({
  getMainWindow: () => mainWindow,
  getAssistantWindow: () => assistantController?.current() ?? null,
  hideAssistant: () => assistantController?.hide(),
  setShortcut: (accelerator) => assistantShortcut.setAccelerator(accelerator),
})

// The shelf is an explicit surface: open always shows and focuses it, while
// the shortcut toggles — a second summon hides it without a send-off.
function openAssistant() {
  assistantController?.showAndFocus()
}

function toggleAssistant() {
  if (!assistantController) return
  if (assistantController.isShowing()) assistantController.hide()
  else assistantController.showAndFocus()
}

// Registration is renderer-driven: Electron cannot read Dexie, so the stored
// chord arrives over validated IPC after hydration. Until then nothing is
// registered — a shortcut the user may have changed must not fire its old one.
const assistantShortcut = createAssistantShortcut({
  register: (accelerator, handler) => globalShortcut.register(accelerator, handler),
  unregister: (accelerator) => globalShortcut.unregister(accelerator),
  onOpen: () => toggleAssistant(),
})

// The lifecycle owns the close-to-hide Hub, the dock-activate reopen, and the
// single will-quit release of every global the app owns.
const lifecycle = createAppLifecycle({
  app,
  onActivate: () => openPhase(),
  onWillQuit: () => {
    assistantShortcut.dispose()
    globalShortcut.unregisterAll()
    assistantController?.dispose()
    menuBar.dispose()
    assistantIpc.dispose(ipcMain)
    shellIpc.dispose(ipcMain)
    assistantController = null
    menuBar = null
  },
})

// Reopen the Hub from the dock, the menu bar, or shell Settings. The Hub is
// never destroyed while the app lives — lifecycle hides it on close — so this
// is a show-and-focus, with a defensive rebuild if the window somehow died.
function openPhase() {
  const win = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : createWindow(true)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(showOnReady = true) {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const win = new BrowserWindow({
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
  mainWindow = win
  lifecycle.protectMainWindow(win)

  // Show only once the first paint is ready — unless the app launched hidden
  // at login, where the Hub stays behind until it is summoned.
  win.once('ready-to-show', () => {
    if (showOnReady && mainWindow === win) win.show()
  })

  // Open target="_blank" / external links in the user's browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

// The validated shell bridge. Login-item access is the one desktop capability
// the OS can refuse at runtime, so both verbs catch, log the exact line, and
// report null rather than crash the Hub's Settings modal. The setter reads
// back the observed openAtLogin after the write rather than trusting the
// requested value.
const shellIpc = createShellIpc({
  getMainWindow: () => mainWindow,
  openAssistant,
  showMainWindow: openPhase,
  getLaunchAtLogin: () => {
    try {
      return app.getLoginItemSettings().openAtLogin
    } catch (error) {
      console.error('[phase-shell] login item unavailable', error)
      return null
    }
  },
  setLaunchAtLogin: (enabled) => {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled })
      return app.getLoginItemSettings().openAtLogin
    } catch (error) {
      console.error('[phase-shell] login item unavailable', error)
      return null
    }
  },
})

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
  server.on('error', (err) => {
    console.error('[phase-calendar] loopback server error', err)
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
  try {
    assistantIpc.register(ipcMain)
  } catch (err) {
    // Same rule: the app opens even if the assistant relay cannot.
    console.error('[phase-assistant] IPC registration failed', err)
  }
  try {
    shellIpc.register(ipcMain)
  } catch (err) {
    // Same rule: the app opens even if the shell bridge cannot.
    console.error('[phase-shell] IPC registration failed', err)
  }

  lifecycle.register()

  // A login launch keeps the Hub hidden — the background state owner must not
  // steal focus from whatever the user is doing when the machine signs in.
  const showMain = shouldShowMainAtLaunch(app.getLoginItemSettings())
  createWindow(showMain)

  // The shelf is prewarmed hidden so a Command–Space summon is instant. It
  // stays show:false: on macOS a transparent native background paints the
  // rounded CSS surface without a flash, and a theme-matched first frame does
  // the same on fallback platforms.
  assistantController = createAssistantWindowController({
    createWindow: (options) => new BrowserWindow(options),
    preloadPath: path.join(__dirname, 'assistantPreload.cjs'),
    entry: assistantEntry(devServerUrl),
    getCursorScreenPoint: () => screen.getCursorScreenPoint(),
    getDisplayNearestPoint: (point) => screen.getDisplayNearestPoint(point),
    beforeShow: () => assistantIpc.requestSnapshot(),
    shouldUseDarkColors: () => nativeTheme.shouldUseDarkColors,
    logError: (...args) => console.error(...args),
  })
  assistantController.create()

  // The menu bar is a nicety, never a requirement: createMenuBar catches its
  // own failures and leaves the Hub and the shortcut working either way.
  menuBar = createMenuBar({
    createTray: (image) => new Tray(image),
    buildMenu: (template) => Menu.buildFromTemplate(template),
    loadImage: (assetPath) => nativeImage.createFromPath(assetPath),
    iconPath: path.join(__dirname, 'assets', 'phaseTemplate.png'),
    onOpenPhase: openPhase,
    onOpenAssistant: openAssistant,
    onOpenSettings: () => shellIpc.openSettings(),
    onQuit: () => app.quit(),
    logError: (...args) => console.error(...args),
  })
  menuBar.create()
})
