import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Needed only by the `.test.tsx` component tests — the pure `.test.ts` suites
  // import no JSX. Harmless for them either way.
  plugins: [react()],
  test: {
    // `node` stays the default: almost every suite here is pure functions or
    // the store, and they run far faster without a DOM. A component test opts
    // in per file with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
