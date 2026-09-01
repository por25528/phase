// Drives the REAL pill page, because vitest cannot.
//
//   npx electron scripts/smoke-pill.cjs
//
// `electron/assets/overlay.html` is the one surface in this app whose logic
// lives in an inline script behind a CSP, in a page loaded by `loadFile` into
// a window with its own preload. jsdom can render the markup but not the
// custom properties main sets on it, and `overlayWindow.test.ts` can assert
// the MODEL main sends without ever proving the page applies it — so the two
// things this checks are exactly the two nothing else can: that every field of
// the model reaches CSS, and that the 4px threshold tells a click from a drag.
// That threshold is the page's only decision, and it is the whole difference
// between "click to open Today" working and the pill doing nothing.
//
// Same species as measure-shelf.cjs: an Electron script run by hand, never
// part of `npm test`.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const PAGE = path.join(__dirname, '..', 'electron', 'assets', 'overlay.html')

const fails = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`)
  if (!ok) fails.push(name)
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 240, height: 36, useContentSize: true,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'smoke-pill-preload.cjs') },
  })
  win.webContents.on('preload-error', (_e, p, err) => console.error('PRELOAD', p, err))
  await win.loadFile(PAGE)
  const js = (src) => win.webContents.executeJavaScript(src)

  // 1. The model paints: text, glyph, and every custom property.
  await js(`window.__probe.paint({ glyph: '\\u25B6', text: '18m left \\u00B7 Problem set 4',
    font: 15, height: 44, radius: 22, padX: 18, bg: 'rgba(28,27,26,0.7)', ink: '#f5f2ec' })`)
  const painted = await js(`(() => {
    const p = document.getElementById('pill');
    const s = getComputedStyle(p);
    return { text: document.getElementById('text').textContent,
      glyph: document.getElementById('glyph').textContent,
      shown: p.classList.contains('shown'),
      height: s.height, radius: s.borderTopLeftRadius, font: s.fontSize,
      bg: s.backgroundColor, ink: s.color, pad: s.paddingLeft };
  })()`)
  check('paints the text main computed', painted.text === '18m left · Problem set 4', JSON.stringify(painted))
  check('paints the glyph', painted.glyph === '▶', JSON.stringify(painted))
  check('is shown after the first model', painted.shown === true, JSON.stringify(painted))
  check('applies the size geometry', painted.height === '44px' && painted.radius === '22px'
    && painted.font === '15px' && painted.pad === '18px', JSON.stringify(painted))
  check('applies the skin', painted.bg === 'rgba(28, 27, 26, 0.7)' && painted.ink === 'rgb(245, 242, 236)',
    JSON.stringify(painted))

  // 2. showGlyph:false — the model simply omits the key.
  await js(`window.__probe.paint({ text: '18m left', font: 13, height: 36, radius: 18, padX: 14,
    bg: 'rgba(250,248,244,0.92)', ink: '#1c1b1a' })`)
  const noGlyph = await js(`(() => {
    const g = document.getElementById('glyph');
    return { hidden: g.classList.contains('hidden'), display: getComputedStyle(g).display,
      text: g.textContent, ink: getComputedStyle(document.getElementById('pill')).color };
  })()`)
  check('hides the glyph, and never prints undefined',
    noGlyph.hidden && noGlyph.display === 'none' && noGlyph.text === '', JSON.stringify(noGlyph))
  check('repaints to the light skin', noGlyph.ink === 'rgb(28, 27, 26)', JSON.stringify(noGlyph))

  // 3. A press that does not move is a CLICK.
  const press = (dx, dy) => js(`(() => {
    window.__probe.reset();
    const pill = document.getElementById('pill');
    const ev = (t, sx, sy, target) => target.dispatchEvent(
      new MouseEvent(t, { bubbles: true, screenX: sx, screenY: sy }));
    ev('mousedown', 500, 400, pill);
    ev('mousemove', 500 + ${dx}, 400 + ${dy}, window);
    ev('mouseup', 500 + ${dx}, 400 + ${dy}, window);
    return window.__probe.calls();
  })()`)

  const click = await press(2, 2)
  check('a sub-4px press opens Today',
    click.some((c) => c[0] === 'openToday'), JSON.stringify(click))
  check('and still reports the drag start and end',
    click[0][0] === 'dragStart' && click.some((c) => c[0] === 'dragEnd'), JSON.stringify(click))

  const drag = await press(40, 25)
  check('a 40px drag is a drag and never a click',
    !drag.some((c) => c[0] === 'openToday'), JSON.stringify(drag))
  check('and reports the pointer position for main to do the arithmetic',
    drag.some((c) => c[0] === 'dragTo' && c[1] === 540 && c[2] === 425), JSON.stringify(drag))

  // 4. Exactly on the threshold counts as a move, not a click.
  const edge = await press(4, 0)
  check('4px is a drag, not a click', !edge.some((c) => c[0] === 'openToday'), JSON.stringify(edge))

  win.destroy()
  console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nALL PASS')
  app.exit(fails.length ? 1 : 0)
})
