import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appSrc = fileURLToPath(new URL('../PhaseApp/src', import.meta.url));

/**
 * `@app/*` is the ONE door into the desktop app, and it is deliberately a
 * source alias rather than a package: the companion renders the same
 * derivations the Mac does (`buildDailyWork`, `firstOpenLeaf`, the status
 * vocabulary), and a copy would drift the first time either side changed.
 *
 * What may come through it is `src/lib/**` and `src/db/types.ts` — pure logic
 * and the domain types. Never a view, never `state/store.ts`, never
 * `db/db.ts`: the phone owns no state and has no Dexie.
 *
 * `fs.allow` is what lets the dev server read a sibling folder at all —
 * without it Vite refuses anything above the project root.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@app\//, replacement: `${appSrc}/` }],
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), appSrc] },
  },
});
