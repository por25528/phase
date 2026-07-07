# Phase

A local-first goal, habit, and task planner. Goals decompose into a tree of sub-goals; progress rolls up automatically from leaf checkboxes. Runs as a web app, installable PWA, or a native macOS app.

## Prerequisites

- Node.js and npm
- macOS, to build the desktop app (`build:mac`)

## Commands

- `npm install`
- `npm run dev` — start the Vite dev server
- `npm run build` — typecheck and build for production
- `npm test` — run the Vitest suite
- `npm run app:dev` — run the Electron shell against the dev server
- `npm run build:mac` — build and package the macOS app (.dmg)

## Data

All data lives locally in the browser's IndexedDB (via Dexie) — nothing is sent to a server. Use the Export/Import buttons in the header to back up or restore your data as a JSON file.
