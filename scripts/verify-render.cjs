// Headless check: load the built app from dist/ over file:// and confirm
// React actually mounted (i.e. Vite assets resolved). Exits non-zero if blank.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } })
  const failures = []
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    failures.push(`${code} ${desc} ${url}`))

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 1800)) // let React mount + store hydrate

  const count = await win.webContents.executeJavaScript(
    "document.getElementById('root')?.childElementCount || 0")
  const title = await win.webContents.executeJavaScript('document.title')

  console.log('TITLE=' + title)
  console.log('ROOT_CHILDREN=' + count)
  console.log('FAILURES=' + (failures.length ? failures.join('; ') : 'none'))
  app.exit(count > 0 && failures.length === 0 ? 0 : 1)
})
