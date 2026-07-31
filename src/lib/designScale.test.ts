import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain JS config, no types, and adding a .d.ts for one import
// would be more ceremony than the guard below is worth.
import tailwindConfig from '../../tailwind.config.js';

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
    // `.test.tsx` matches `/\.tsx?$/` and is NOT caught by a `.test.ts` suffix
    // check, so component tests were being scanned: a class named only in a test
    // string counted as "applied" for the orphan guard, and the hex / font-size
    // rules policed fixtures that legitimately need literal values.
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
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

  /**
   * Hand-written CSS is only real if something wears the class.
   *
   * `index.css` accumulated four rules targeting classes no markup applied:
   * `.today-main` (its view was deleted), `.hb-history-toggle` (never existed),
   * `.quiet-control` (written to fix hover controls on touch, then not adopted
   * at any of its twelve call sites), and `.hb-stat` — which was listed in a
   * media rule alongside `.hb-dots` so the two would hide together, except only
   * `.hb-dots` was ever applied, so below 1000px the trail vanished and its
   * fixed 76px column stayed behind. That is the exact split the rule existed
   * to prevent, and nothing failed.
   *
   * Tailwind utilities are excluded: they are generated, so a `.flex` in the
   * output proves nothing about this repo's markup. Only classes this codebase
   * declares by hand are checked.
   */
  it('applies every class its own stylesheet targets', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    // Class selectors written inside our own rules, minus Tailwind's own
    // group/peer/dark hooks and the `@apply` bodies.
    const declared = new Set(
      [...css.matchAll(/^\s*(?:\.[\w-]+\s*,\s*)*\.([\w-]+)[^{]*\{/gm)].flatMap((m) =>
        [...m[0].matchAll(/\.([\w-]+)/g)].map((c) => c[1]),
      ),
    );
    const ignored = new Set(['dark', 'group', 'peer']);
    const markup = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const orphans = [...declared]
      .filter((cls) => !ignored.has(cls))
      .filter((cls) => !new RegExp(`[\\s"'\`]${cls}[\\s"'\`]`).test(markup));

    expect(orphans).toEqual([]);
  });

  /**
   * A literal hex is a colour that cannot follow the theme.
   *
   * The destructive red `#b4453a` was hardcoded at six sites — two error
   * messages and the irreversible "Delete project" menu item among them. It
   * clears AA on the light panel at 5.46:1 and fails it on the dark panel at
   * 3.56:1, which is exactly why `--c-warn` is re-tuned per theme. `InlineEdit`
   * had the same bug in an inline style, with a near-accent matching neither
   * theme's accent.
   *
   * `rgb(var(--c-*))` stays allowed: that IS the token, reached the one way
   * Tailwind arbitrary values can reach a CSS variable.
   */
  it('declares no literal hex colours — use the theme tokens', () => {
    expect(offenders(/(?:text|bg|border|fill|stroke|ring|shadow)-\[[^\]]*#[0-9a-fA-F]{3,8}[^\]]*\]/g))
      .toEqual([]);
    expect(offenders(/\b(?:color|background|border(?:-\w+)?|fill|stroke)\s*:\s*[^;'"`]*#[0-9a-fA-F]{3,8}/g))
      .toEqual([]);
  });

  /**
   * Tailwind emits `text-<key>` for BOTH the `fontSize` and the `colors` scale,
   * into the same stylesheet, with no namespacing. A key present in both
   * therefore produces two `.text-<key>` rules and the later one silently wins
   * for its property while the earlier still applies its own — so `text-chip`
   * meant "font-size: .68rem" to whoever wrote it and "color: near-white" to
   * the browser. That shipped: every badge using it went invisible on a light
   * card, and nothing failed, because both class names are perfectly valid.
   *
   * This is unreviewable by eye — the two scales are 60 lines apart in the
   * config and neither mentions the other — so it is asserted instead.
   */
  it('shares no key between the fontSize and colors scales', () => {
    const extend = tailwindConfig.theme?.extend ?? {};
    const fontSizes = Object.keys(extend.fontSize ?? {});
    const colors = Object.keys(extend.colors ?? {});
    expect(fontSizes.filter((key) => colors.includes(key))).toEqual([]);
  });
});
