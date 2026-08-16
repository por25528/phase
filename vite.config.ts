import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' emits relative asset URLs so the built app works both when
// served from a web root and when loaded from file:// inside Electron.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      // Three pages, one build: the app, the assistant overlay the desktop
      // shell floats over everything, and the harness page that renders that
      // same surface in its OTHER presentation at 380px. The overlay's entry
      // deliberately cannot reach the store or Dexie —
      // src/assistant/entryBoundary.test.ts, whose graph starts at
      // src/assistant/main.tsx and is not widened by the harness beside it.
      // fileURLToPath, not .pathname: the repo path contains a space.
      //
      // The harness builds unconditionally because the only thing that reads
      // it — scripts/shot-shelf.cjs — runs against `dist/` after a plain
      // `npm run build`, and a flag would make the capture that proves the
      // layout the one capture nobody's build produces. It ships a page no
      // menu reaches, and it is inert: no store, no Dexie, no relay.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        assistant: fileURLToPath(new URL('./assistant.html', import.meta.url)),
        assistantEmbedded: fileURLToPath(
          new URL('./assistant-embedded.html', import.meta.url)),
      },
    },
  },
})
