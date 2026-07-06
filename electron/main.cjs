// Electron main process for Phase.
// Wraps the built Vite app (dist/) in a native macOS window.
const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

// When VITE_DEV_SERVER_URL is set (npm run app:dev) we load the live dev
// server for hot-reload; otherwise we load the built files from dist/.
const devServerUrl = process.env.VITE_DEV_SERVER_URL

/** @type {BrowserWindow | null} */
let mainWindow = null

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
