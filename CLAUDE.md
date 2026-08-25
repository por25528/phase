# CLAUDE.md

This repo holds two projects:

- `PhaseApp/` — the Phase desktop app (React + Vite + Electron). Its own
  `CLAUDE.md` in that folder is the authority for all app work; run its
  commands (`npm test`, `npx tsc -b`, `npm run build`) from inside `PhaseApp/`.
- `PhaseWeb/` — the marketing landing page for Phase (React + Vite +
  Tailwind, static build). It copies the app's theme tokens and fonts; it
  never imports across the folder boundary.

`docs/` at the root holds repo-level docs and specs.
