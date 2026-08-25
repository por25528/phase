# PhaseApp / PhaseWeb split + landing page

Date: 2026-08-25 · Status: approved

## Goal

Restructure the repo into two folders and add a marketing landing page:

```
Phase/               (the git repo, unchanged root)
├── CLAUDE.md        (thin: describes the two folders)
├── docs/            (stays at root — repo-level docs and specs)
├── PhaseApp/        (everything that is the app today)
└── PhaseWeb/        (new: the landing page)
```

## Part 1 — Restructure

- `git mv` every tracked root file/folder except `docs/` into `PhaseApp/` so
  history follows the renames. Untracked build products (`node_modules/`,
  `dist/`, `release/`, `phase-startup-goals.json`) move with plain `mv`.
- The app's `CLAUDE.md` moves to `PhaseApp/CLAUDE.md` unchanged. A new thin
  root `CLAUDE.md` names the two folders and points at it.
- All build paths (`package.json`, vite, electron-builder, scripts) are
  relative and expected to survive; verified by `npm test`, `npx tsc -b`, and
  `npm run build` inside `PhaseApp/`.
- The Phase MCP server registration in the user's Claude config points at
  `mcp/server.js`; update it to `PhaseApp/mcp/server.js`. Requires a Claude
  Code restart to take (known staleness trap).

## Part 2 — PhaseWeb

**Job**: market the macOS app. Public page: what Phase is, real screenshots,
`Download for macOS`.

**Stack**: Vite + React + TypeScript + Tailwind, own `package.json`, builds to
static files, no backend. Independent of PhaseApp at build time — theme tokens
and fonts are *copied* in, not imported across the folder boundary.

**Visual identity**: the product's own — same theme tokens (paper/ink light,
warm-charcoal dark `#141311`/`#1E1D1B`), Public Sans for UI, Fraunces as the
display face, mono for measured figures, the ruled-sheet + `.hatch` language.
The site reads as the app extended, not a template. Light/dark follows the
visitor's system.

**Page structure** (single page):

1. **Hero** — wordmark, one-sentence pitch, `Download for macOS` button wired
   to one `DOWNLOAD_URL` constant (placeholder `#` for now), one real
   screenshot.
2. **Feature story** — three sections with real captures: Today (the framed
   day), Plan (the week grid), Goals (the board).
3. **Local-first** — data lives in IndexedDB on your machine; no account, no
   sync, no server.
4. **Footer** — minimal.

**Screenshots**: captured with the existing Electron screenshot harness
(jsdom markup dump → Tailwind rebuild → `capturePage`), light and dark,
stored under `PhaseWeb/public/`.

## Out of scope

- Publishing a real .dmg / release pipeline (the button stays a constant).
- Deploying the site (builds to static files; hosting is a later step).
- Any change to PhaseApp behaviour beyond the folder move.

## Verification

- `PhaseApp`: `npm test` and `npx tsc -b` pass after the move; `npm run build`
  succeeds.
- `PhaseWeb`: `npm run build` succeeds; page renders in light and dark.
- MCP config points at the new server path.
