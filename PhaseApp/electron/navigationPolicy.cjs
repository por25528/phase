// What the main frame is allowed to become.
//
// THE PRELOAD IS THE ASSET. `preload.cjs` exposes `phaseAgent`,
// `phaseBackups`, `phaseCalendar`, `phaseSync` and `phaseShell` — the store's
// whole write surface, the backup folder, and the calendar's stored tokens —
// and a preload SURVIVES a top-level navigation. So a renderer that can be
// talked into setting `location` hands all of it to whatever loads next, with
// `contextIsolation` fully on and helping not at all: the bridge is still
// there and still bound.
//
// Nothing in Phase navigates the main frame. Every link is external, the
// router is in-memory, and the only documents the app ever loads are the ones
// the shell loads for it. That is what lets this be a whitelist of two entries
// and a refusal for everything else, rather than a list of bad schemes — a
// denylist is a promise to have thought of everything.
//
// Three answers, because there are three:
//   internal  the app's own document; let it happen
//   external  a real web address; hand it to the browser and cancel
//   block     everything else; cancel and hand it to NOBODY

const WEB_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Parse, or refuse. A URL that will not parse is not a URL we can reason
 * about, and guessing at one is how a policy acquires a hole.
 */
function parse(url) {
  if (typeof url !== 'string' || url === '') return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * The decision for one target.
 *
 * `devServerUrl` is set only by `npm run app:dev`; `appEntryFile` is the
 * absolute path of the packaged `dist/index.html`. Exactly one of the two is
 * the app's own document at any moment, which is why a `file://` target is
 * refused in dev and the dev origin is refused in a packaged build — in both
 * cases the target is a DIFFERENT document from the one that is loaded, and
 * that is what this exists to stop.
 *
 * @param {string} url
 * @param {{ devServerUrl?: string | null, appEntryFile?: string | null }} where
 * @returns {'internal' | 'external' | 'block'}
 */
function navigationDecision(url, where) {
  const target = parse(url)
  if (!target) return 'block'

  const devServerUrl = where && where.devServerUrl
  if (devServerUrl) {
    const dev = parse(devServerUrl)
    // Origin, never a prefix: `http://localhost:5173.evil.com` and
    // `http://evil-localhost:5173` both pass a `startsWith` and are not us.
    if (dev && target.origin === dev.origin) return 'internal'
  } else {
    const entry = where && where.appEntryFile
    // `pathname` and nothing else: a query or a hash is the same document
    // reloading, and comparing the whole href would refuse an ordinary reload.
    if (entry && target.protocol === 'file:' && decodeURIComponent(target.pathname) === entry) {
      return 'internal'
    }
  }

  if (WEB_PROTOCOLS.has(target.protocol)) return 'external'
  return 'block'
}

/**
 * Install the policy on one `webContents`.
 *
 * Both doors, because they are genuinely two: `will-navigate` is the main
 * frame changing document, `setWindowOpenHandler` is `window.open` and
 * `target="_blank"`. The open handler previously answered `{ action: 'allow' }`
 * for anything that was not http(s) — the default was the wrong way round, so
 * `file:`, `data:` and every custom scheme got a real window with the real
 * preload in it. It now denies unconditionally: Phase has no second in-app
 * window to offer, so a target is either worth a browser or worth nothing.
 *
 * `will-frame-navigate` covers subframes. There are none today; the guard
 * costs one line and the day one appears is not the day to remember this.
 */
function applyNavigationPolicy(contents, deps) {
  const { devServerUrl = null, appEntryFile = null, openExternal } = deps

  const toBrowser = (url) => {
    // A rejected promise here — no handler for the scheme, a refusing shell —
    // must not become an unhandled rejection that takes the window with it.
    // The navigation is already cancelled either way.
    try {
      const result = openExternal(url)
      if (result && typeof result.catch === 'function') result.catch(() => {})
    } catch {
      /* the link did not open; the window is still alive, which is the point */
    }
  }

  const guard = (event, url) => {
    const decision = navigationDecision(url, { devServerUrl, appEntryFile })
    if (decision === 'internal') return
    event.preventDefault()
    // Only `external` reaches the shell. Handing a blocked target to
    // `openExternal` is how a refused navigation becomes a worse one.
    if (decision === 'external') toBrowser(url)
  }

  contents.on('will-navigate', guard)
  contents.on('will-frame-navigate', guard)

  contents.setWindowOpenHandler(({ url }) => {
    if (navigationDecision(url, { devServerUrl, appEntryFile }) === 'external') toBrowser(url)
    return { action: 'deny' }
  })
}

module.exports = { navigationDecision, applyNavigationPolicy }
