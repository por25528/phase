// Screenshots the shelf card at its real width for every reachable state, in
// both themes, so a layout change can be compared against what was approved.
// jsdom has no layout and the component tests therefore cannot see any of this.
//
//   npm run build
//   npx electron scripts/shot-shelf.cjs [outDir]
//
// The sibling of scripts/measure-shelf.cjs: that one reports the card's height
// so HEIGHT stays a measurement, this one reports what the card looks like.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const OUT = process.argv[2] || path.join(__dirname, '..', 'shelf-shots')
const WIDTH = 620

const LONG = 'Draft the comparative literature review for the graduate seminar '
  + 'on nineteenth-century industrialization'

const work = (over = {}) => ({
  key: 'step:n1',
  ref: { kind: 'step', id: 'n1', goalId: 'g1' },
  title: LONG,
  goalTitle: 'Comparative Literature',
  reason: 'scheduled-now',
  expected: { kind: 'estimate', minutes: 45 },
  ...over,
})

// `ExpectedTime` is a discriminated union in src/lib/expectedTime.ts:34-43.
// The history arm is `{ kind, lowMin, highMin, confidence, sampleCount }` —
// all five required. `lowMinutes`/`highMinutes` are NOT the field names, and
// getting them wrong renders "Usually undefined–undefinedm" rather than
// throwing, which is exactly the kind of wrong a screenshot harness must not
// be. The three arms below cover all three of expectedTimeLabel's cases —
// Usually / Planned / Suggested — so one capture exercises every phrasing.
const ALTERNATIVES = [
  work({
    key: 'step:n2',
    ref: { kind: 'step', id: 'n2', goalId: 'g1' },
    title: 'Rewrite the pricing page hero',
    expected: { kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6 },
  }),
  work({
    key: 'step:n3',
    ref: { kind: 'step', id: 'n3', goalId: 'g1' },
    title: 'Reply to the Figma thread',
    goalTitle: 'Website',
    expected: { kind: 'starter', minutes: 30 },
  }),
]

const base = {
  status: 'ready',
  timeLevel: 'medium',
  focusLevel: 'medium',
  activeFocus: null,
  notice: { tone: 'neutral', text: `Completed "${LONG}" · logged 45m` },
  advice: { kind: 'work', primary: work(), alternatives: ALTERNATIVES },
}

const focus = (over) => ({
  ref: { kind: 'step', id: 'n1', goalId: 'g1' },
  title: LONG,
  goalTitle: 'Comparative Literature',
  expected: { kind: 'estimate', minutes: 45 },
  ...over,
})

const STATES = {
  idle: {
    ...base,
    notice: null,
    advice: {
      kind: 'work',
      primary: work({ title: 'Review the onboarding copy' }),
      alternatives: ALTERNATIVES,
    },
  },
  sidecar: base,
  active: { ...base, notice: null, activeFocus: focus({ phase: 'active', elapsedMin: 12 }) },
  break: { ...base, notice: null, activeFocus: focus({ phase: 'break', elapsedMin: 24 }) },
  confirming: {
    ...base,
    notice: null,
    activeFocus: focus({ phase: 'confirming', elapsedMin: 200, proposedMinutes: 200 }),
  },
  clear: { ...base, notice: null, advice: { kind: 'clear' } },
  loading: { status: 'loading' },
}

// One window at a time means the app is momentarily windowless between states,
// and Electron's default `window-all-closed` behaviour would quit the run
// partway through. Same no-op guard as measure-shelf.cjs.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  for (const theme of ['dark', 'light']) {
    for (const [name, snapshot] of Object.entries(STATES)) {
      process.env.PHASE_SHELF_SNAPSHOT = JSON.stringify(snapshot)
      const win = new BrowserWindow({
        show: false,
        width: WIDTH,
        height: 900,
        // Without useContentSize, 620 is the FRAME and the card is measured a
        // few pixels narrow — the same reason the production window sets it.
        useContentSize: true,
        backgroundColor: theme === 'dark' ? '#141311' : '#F7F7F5',
        webPreferences: {
          contextIsolation: true,
          preload: path.join(__dirname, 'measure-shelf-preload.cjs'),
        },
      })
      win.webContents.on('preload-error', (_e, p, err) => console.error(`${name} PRELOAD ${p}: ${err && err.stack}`))
      win.webContents.on('did-fail-load', (_e, c, d) => console.error(`${name} LOAD ${c} ${d}`))
      await win.loadFile(path.join(__dirname, '..', 'dist', 'assistant.html'))
      await win.webContents.executeJavaScript(
        `document.documentElement.classList.toggle('dark', ${theme === 'dark'})`)
      await new Promise((r) => setTimeout(r, 1000))
      const h = await win.webContents.executeJavaScript(
        "document.querySelector('[data-shelf]')?.getBoundingClientRect().height ?? -1")
      if (!(h > 0)) {
        console.error(`${theme}/${name} NOT RENDERED`)
        win.destroy()
        continue
      }
      const img = await win.webContents.capturePage({
        x: 0, y: 0, width: WIDTH, height: Math.ceil(h),
      })
      fs.writeFileSync(path.join(OUT, `${theme}-${name}.png`), img.toPNG())
      console.log(`${theme}/${name} h=${h}`)
      win.destroy()
    }
  }
  app.exit(0)
})
