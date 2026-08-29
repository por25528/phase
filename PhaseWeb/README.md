# Phase Web

The marketing landing page for [Phase](../PhaseApp), the local goal, habit and
task planner for macOS. React + Vite + Tailwind, built as a static site.

The site copies the app's theme tokens and fonts rather than sharing them — it
never imports across the folder boundary. When the app's tokens change, mirror
the change here by hand.

## Commands

- `npm install`
- `npm run dev` — start the Vite dev server
- `npm run build` — typecheck and build for production into `dist/`

## Deploy

Hosted on Vercel:

- **Root directory**: `PhaseWeb`
- **Framework preset**: Vite
- **Output directory**: `dist`

Pushes to `main` deploy to production; every other branch gets a preview
deployment. `vercel.json` sets clean URLs and a one-year immutable cache on the
fingerprinted files in `/assets`.
