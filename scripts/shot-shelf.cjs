// Screenshots the shelf card at its real width for every reachable state, in
// both themes, in BOTH presentations, so a layout change can be compared
// against what was approved. jsdom has no layout and the component tests
// therefore cannot see any of this.
//
//   npm run build
//   npx electron scripts/shot-shelf.cjs [outDir]
//
// The sibling of scripts/measure-shelf.cjs: that one reports the card's height
// so HEIGHT stays a measurement, this one reports what the card looks like.
//
// Two presentations, because `AssistantSurface` is ONE component rendered in
// two places and only one of them had a page. `assistant.html` mounts
// `AssistantOverlay`, which hard-codes `presentation="shelf"` — so every
// capture ever taken here, and every height measure-shelf.cjs ever printed,
// was of the 620px arrangement. The 380px `embedded` one inside
// `AssistantHost` went unrendered until `assistant-embedded.html`, which is
// how its title came to measure 28px and draw as `D…` through seven reviews.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const OUT = process.argv[2] || path.join(__dirname, '..', 'shelf-shots')

// The two real widths, and the two pages that reach them. `width` is the
// window's CONTENT width and the card fills it, so it is also the card's.
const PRESENTATIONS = [
  { name: 'shelf', page: 'assistant.html', width: 620 },
  { name: 'embedded', page: 'assistant-embedded.html', width: 380 },
]

// Every presentation in every theme, flattened so the loop below stays one
// deep and the IDENTICAL guard keeps one set of heights per run.
const RUNS = PRESENTATIONS.flatMap((presentation) =>
  ['dark', 'light'].map((theme) => ({ presentation, theme })))

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
  // The first thing a new install ever shows, and the one state that had no
  // capture: `needs-hours` and `clear` are the two early returns in
  // `AdvicePanel`, they are the only bodies that are a bare sentence rather
  // than a band, and a sentence with no inset sits on the card's own rounded
  // corner. Neither is visible in a shot nobody takes.
  'needs-hours': { ...base, notice: null, advice: { kind: 'needs-hours' } },
  loading: { status: 'loading' },
}

/**
 * What the run reports besides the picture.
 *
 * The card's height is what `HEIGHT` is budgeted against. The TITLE's width is
 * the thing this surface exists to give room to, and the number that hid: a
 * screenshot of a 28px title reads as a rendering glitch, a printed `title=28`
 * reads as the bug it is. `alt` is the same question one band down.
 */
const MEASURE = `(() => {
  const card = document.querySelector('[data-shelf]')
  const width = (el) => (el ? el.getBoundingClientRect().width : null)
  return JSON.stringify({
    h: card ? card.getBoundingClientRect().height : -1,
    title: width(document.querySelector('[data-shelf] h2')),
    alt: width(document.querySelector('[data-shelf] button > span.truncate')),
  })
})()`

const px = (value) => (value === null ? 'n/a' : `${Math.round(value * 10) / 10}px`)

// One window at a time means the app is momentarily windowless between states,
// and Electron's default `window-all-closed` behaviour would quit the run
// partway through. Same no-op guard as measure-shelf.cjs.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const failed = []
  for (const { presentation, theme } of RUNS) {
    // Heights collected per theme AND per presentation, never pooled: dark and
    // light legitimately land on the same figure for a given state (confirming
    // measured 277.99 in both), and the two presentations are different
    // layouts entirely, so a set spanning either axis would blur a real
    // collapse (every state landing on one height within one run) with that
    // expected overlap. active/break also share a height by design, so the
    // guard below is "more than one distinct height", never "all eight".
    const heights = []
    for (const [name, snapshot] of Object.entries(STATES)) {
      const label = `${presentation.name}/${theme}/${name}`
      process.env.PHASE_SHELF_SNAPSHOT = JSON.stringify(snapshot)
      const win = new BrowserWindow({
        show: false,
        width: presentation.width,
        height: 900,
        // Without useContentSize, the width is the FRAME and the card is
        // measured a few pixels narrow — the same reason the production window
        // sets it. It matters more at 380 than at 620.
        useContentSize: true,
        backgroundColor: theme === 'dark' ? '#141311' : '#F7F7F5',
        webPreferences: {
          contextIsolation: true,
          preload: path.join(__dirname, 'measure-shelf-preload.cjs'),
        },
      })
      win.webContents.on('preload-error', (_e, p, err) => console.error(`${label} PRELOAD ${p}: ${err && err.stack}`))
      win.webContents.on('did-fail-load', (_e, c, d) => console.error(`${label} LOAD ${c} ${d}`))
      try {
        await win.loadFile(path.join(__dirname, '..', 'dist', presentation.page))
      } catch (err) {
        console.error(`${label} THREW ${err.message}`)
        failed.push(label)
        win.destroy()
        continue
      }
      await win.webContents.executeJavaScript(
        `document.documentElement.classList.toggle('dark', ${theme === 'dark'})`)
      await new Promise((r) => setTimeout(r, 1000))
      const seen = JSON.parse(await win.webContents.executeJavaScript(MEASURE))
      if (!(seen.h > 0)) {
        console.error(`${label} NOT RENDERED`)
        failed.push(label)
        win.destroy()
        continue
      }
      const img = await win.webContents.capturePage({
        x: 0, y: 0, width: presentation.width, height: Math.ceil(seen.h),
      })
      fs.writeFileSync(path.join(OUT, `${presentation.name}-${theme}-${name}.png`), img.toPNG())
      console.log(`${label} h=${seen.h} title=${px(seen.title)} alt=${px(seen.alt)}`)
      heights.push(seen.h)
      win.destroy()
    }
    // If PHASE_SHELF_SNAPSHOT never reached the renderer, every window in this
    // run draws whatever the component falls back to and every height comes
    // back identical — a screenful of plausible-looking PNGs that are all the
    // same picture. That is a worthless run, not a small one, so it fails
    // loudly rather than printing green.
    if (heights.length > 1 && new Set(heights).size === 1) {
      console.error(`IDENTICAL: every ${presentation.name}/${theme} state measured the same height — the snapshot never varied per window`)
      failed.push(`${presentation.name}/${theme}/*`)
    }
  }

  // A state that never rendered (or threw) is silently missing a PNG, and an
  // unconditional exit(0) would tell a caller gating on the exit code that the
  // run succeeded anyway. Name what failed and fail the process for it.
  if (failed.length) console.error('FAILED: ' + failed.join(', '))
  app.exit(failed.length > 0 ? 1 : 0)
})
