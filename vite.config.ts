import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' emits relative asset URLs so the built app works both when
// served from a web root and when loaded from file:// inside Electron.
export default defineConfig({
  base: './',
  plugins: [react()],
})
