import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const appSrc = fileURLToPath(new URL('../PhaseApp/src', import.meta.url));

/**
 * `jsdom` is the DEFAULT here, the reverse of PhaseApp's config. Almost every
 * suite in this project renders something — the companion is three screens and
 * one store — so opting in per file would be an annotation on nearly all of
 * them.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@app\//, replacement: `${appSrc}/` }],
  },
  test: {
    environment: 'jsdom',
    // See the file: Node's own `localStorage` global shadows jsdom's, so the
    // runner needs the polyfill the browser does not.
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
