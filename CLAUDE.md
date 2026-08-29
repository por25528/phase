# CLAUDE.md

This repo holds three projects:

- `PhaseApp/` — the Phase desktop app (React + Vite + Electron). Its own
  `CLAUDE.md` in that folder is the authority for all app work; run its
  commands (`npm test`, `npx tsc -b`, `npm run build`) from inside `PhaseApp/`.
- `PhaseWeb/` — the marketing landing page for Phase (React + Vite +
  Tailwind, static build). It copies the app's theme tokens and fonts; it
  never imports across the folder boundary.
- `PhasePhone/` — the iPhone companion (React + Vite + Tailwind, wrapped by
  Capacitor). Its `README.md` is the authority for its commands and for the
  iOS pipeline. It is the ONE place the no-cross-imports rule is relaxed, in
  one direction only: it may import `PhaseApp/src/lib/**` and
  `PhaseApp/src/db/types.ts` through the `@app/*` alias — never a view, never
  `state/store.ts`, never Dexie. `PhasePhone/plugin-icloud/` is a local
  Capacitor plugin (the project's only Swift).

The Mac owns canonical state and the phone owns a journal of its own edits.
That asymmetry is the sync design and not an implementation detail: nothing in
`PhasePhone/` may ever gain a way to write `state.json`.

`docs/` at the root holds repo-level docs and specs.
