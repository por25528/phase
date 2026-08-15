// Measures the shelf card at its real width for every reachable state, so
// HEIGHT in electron/assistantWindow.cjs stays a measurement rather than a
// guess. Run after `npm run build`:
//
//   npx electron scripts/measure-shelf.cjs
//
// The card hugs its content and the window CLIPS rather than scrolls, so the
// tallest state here IS the budget.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const WIDTH = 620

// Free text with no length cap, so two wrapped lines under line-clamp-2 is the
// real worst case, not an edge case to round past.
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

const NOTICE = { tone: 'neutral', text: `Completed "${LONG}" · logged 45m` }

// Two alternatives, and they belong to the SHARED base rather than to the
// sidecar state alone. `AssistantSurface` hands `snapshot.advice.alternatives`
// to `FocusPanel` too, and that list is the only thing that draws the "Other
// options" row — the row the 247.6px measurement of `confirming` in
// assistantWindow.cjs explicitly counts. Scoping them to the idle panel would
// measure a `confirming` state one row shorter than the one that set the
// current budget, and report a fall the checkbox never caused.
const ALTERNATIVES = [
  work({ key: 'step:n2', ref: { kind: 'step', id: 'n2', goalId: 'g1' } }),
  work({ key: 'step:n3', ref: { kind: 'step', id: 'n3', goalId: 'g1' } }),
]

const base = {
  status: 'ready',
  timeLevel: 'medium',
  focusLevel: 'medium',
  activeFocus: null,
  notice: NOTICE,
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
  // The previous tallest, and the one state that renders no checkbox.
  confirming: {
    ...base,
    activeFocus: focus({ phase: 'confirming', elapsedMin: 200, proposedMinutes: 200 }),
  },
  // Gains the checkbox in this change.
  active: { ...base, activeFocus: focus({ phase: 'active', elapsedMin: 12 }) },
  sidecar: base,
  // beyondWindow always slices visible to one item, so alternatives is empty
  // whenever it fires — the fifth combination cannot occur.
  beyondWindow: {
    ...base,
    advice: { kind: 'work', primary: work(), alternatives: [], beyondWindow: true },
  },
  // The other dial's refusal. It reads as the same one-line paragraph in the
  // same slot, which is a reason to expect the same figure and not a reason to
  // skip measuring it — the two are mutually exclusive (`beyondFocus` is only
  // set when `beyondWindow` is not), so this is a state of its own.
  beyondFocus: {
    ...base,
    advice: { kind: 'work', primary: work(), alternatives: [], beyondFocus: true },
  },
}

// One window at a time means the app is momentarily windowless between states,
// and Electron's DEFAULT `window-all-closed` behaviour is to quit — which kills
// the run partway through, at whichever state the shutdown happens to overtake
// (it surfaces as an ERR_FAILED on the NEXT load, not as an error on the
// destroy). This no-op handler is what keeps the loop alive to the last state.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const results = {}
  for (const [name, snapshot] of Object.entries(STATES)) {
    process.env.PHASE_SHELF_SNAPSHOT = JSON.stringify(snapshot)
    const win = new BrowserWindow({
      show: false,
      width: WIDTH,
      height: 1000,
      // The production window uses it too: without it 620 is the frame and the
      // card would be measured a few pixels narrow, which is how a wrapped
      // title turns into a third line that never happens in the real shelf.
      useContentSize: true,
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, 'measure-shelf-preload.cjs'),
      },
    })
    win.webContents.on('preload-error', (_e, p, err) => console.error(`${name} PRELOAD ${p}: ${err && err.stack}`))
    win.webContents.on('did-fail-load', (_e, code, desc) => console.error(`${name} LOAD ${code} ${desc}`))
    try {
      await win.loadFile(path.join(__dirname, '..', 'dist', 'assistant.html'))
    } catch (err) {
      console.error(`${name} THREW ${err.message}`)
    }
    await new Promise((r) => setTimeout(r, 1200))
    results[name] = await win.webContents.executeJavaScript(
      "document.querySelector('[data-shelf]')?.getBoundingClientRect().height ?? -1")
    win.destroy()
  }

  for (const [name, height] of Object.entries(results)) console.log(`${name}=${height}`)
  const tallest = Math.max(...Object.values(results))
  console.log('TALLEST=' + tallest)

  // A state that measured -1 never rendered, and a run where every state came
  // back the same figure means the snapshot never reached the preload — both
  // are worthless measurements rather than small ones, so they fail loudly.
  const heights = Object.values(results)
  const bad = Object.entries(results).filter(([, h]) => !(h > 0)).map(([n]) => n)
  const degenerate = new Set(heights).size === 1
  if (bad.length) console.error('NOT RENDERED: ' + bad.join(', '))
  if (degenerate) console.error('IDENTICAL: the snapshot never varied per window')
  app.exit(bad.length > 0 || degenerate ? 1 : 0)
})
