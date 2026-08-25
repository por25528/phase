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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
