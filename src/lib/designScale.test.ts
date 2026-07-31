import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The type and radius scales are only a system if they are enforced.
 *
 * Before this guard the codebase carried 37 distinct font sizes — `.74`, `.75`,
 * `.76`, `.78`, `.79`, `.8rem` all coexisting — because every component picked
 * its own value. Consolidating them once is worthless if the next feature adds
 * `text-[.77rem]`, so the rule lives here rather than in a review comment.
 *
 * Add a step to tailwind.config's `fontSize` and use it by name; don't inline a
 * new number.
 */
// fileURLToPath, not .pathname: the repo path contains a space.
const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const files = sourceFiles(SRC);

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      for (const match of line.matchAll(pattern)) {
        hits.push(`${file.slice(SRC.length)}:${i + 1} ${match[0]}`);
      }
    });
  }
  return hits;
}

describe('design scale', () => {
  it('declares no arbitrary font sizes — use the named steps', () => {
    expect(offenders(/text-\[[0-9.]+(?:rem|px|em)\]/g)).toEqual([]);
  });

  // 4, 6 and 11 remain inline alongside the named `field` (9) and `card` (14).
  const ALLOWED_RADII = new Set(['4', '6', '11']);

  it('uses only the five agreed corner radii', () => {
    const bad = offenders(/rounded-\[(\d+)px\]/g)
      .filter((hit) => {
        const px = /rounded-\[(\d+)px\]/.exec(hit)?.[1];
        return px != null && !ALLOWED_RADII.has(px);
      });
    expect(bad).toEqual([]);
  });
});
