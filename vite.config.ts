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
      // Two pages, one build: the app, and the assistant overlay the desktop
      // shell floats over everything. The overlay's entry deliberately cannot
      // reach the store or Dexie — src/assistant/entryBoundary.test.ts.
      // fileURLToPath, not .pathname: the repo path contains a space.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        assistant: fileURLToPath(new URL('./assistant.html', import.meta.url)),
      },
    },
  },
})
