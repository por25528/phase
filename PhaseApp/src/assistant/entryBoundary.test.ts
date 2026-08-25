import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The overlay is read-only BY CONSTRUCTION, and this test is the construction.
 *
 * The floating window renders the same `AssistantSurface` the app uses, but it
 * must never become a second writer: no store, no Dexie, no tab lock. Rather
 * than trusting review to notice a new import, this walks the real module
 * graph from the overlay entry and fails the build if any runtime path reaches
 * `src/state/`, `src/db/`, or `App.tsx`. Type-only imports are exempt — they
 * are erased at compile time and cannot execute a byte.
 */

// fileURLToPath, not .pathname: the repo path contains a space.
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const ENTRY = resolve(HERE, 'main.tsx');

const FORBIDDEN = [
  `${resolve(SRC, 'state')}/`,
  `${resolve(SRC, 'db')}/`,
  resolve(SRC, 'App.tsx'),
];

/** Relative runtime imports in one source file. `import type` is erased, so skipped. */
function runtimeImports(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+([^;]+?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(re)) {
    const clause = match[2];
    const specifier = match[3];
    if (!specifier.startsWith('.')) continue;
    if (/^type[\s{]/.test(clause.trim())) continue; // import type { … } / export type { … }
    out.push(specifier);
  }
  // Side-effect imports: import './index.css'
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g)) {
    out.push(match[1]);
  }
  return out;
}

function resolveImport(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    base,
    `${base}.ts`, `${base}.tsx`,
    resolve(base, 'index.ts'), resolve(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && /\.(ts|tsx|css)$/.test(candidate)) return candidate;
  }
  return null;
}

function walkGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const specifier of runtimeImports(source)) {
      const target = resolveImport(file, specifier);
      if (target) queue.push(target);
    }
  }
  return visited;
}

describe('the overlay entry boundary', () => {
  it('exists', () => {
    expect(existsSync(ENTRY)).toBe(true);
  });

  it('never reaches the store, the database, or the app shell at runtime', () => {
    const reached = [...walkGraph(ENTRY)];
    const offenders = reached.filter((file) =>
      FORBIDDEN.some((banned) => file === banned || file.startsWith(banned)));
    expect(offenders).toEqual([]);
  });

  it('walks a real graph, not an empty one', () => {
    // A regression guard for the walker itself: if the import regex breaks,
    // the boundary test above would pass vacuously.
    const reached = walkGraph(ENTRY);
    expect(reached.size).toBeGreaterThan(3);
    expect([...reached].some((f) => f.endsWith('AssistantSurface.tsx'))).toBe(true);
  });

  it('assistant.html boots the overlay entry, never the app entry', () => {
    const html = readFileSync(resolve(SRC, '..', 'assistant.html'), 'utf8');
    expect(html).toContain('src/assistant/main.tsx');
    expect(html).not.toContain('src/main.tsx');
  });
});
