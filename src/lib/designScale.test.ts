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
   * `rgba()` is a colour too, and the two assertions above only match `#`.
   *
   * The modal scrim sat at `bg-[rgba(20,20,18,0.28)]` in BOTH `Modal` and
   * `CommandPalette` — duplicated, and the only colour in the app that did not
   * theme, because nothing here was looking for it. It is now `--scrim`.
   *
   * `rgb(var(--c-*))` stays allowed for the same reason as above: that IS the
   * token. The guard only fires on a literal channel number.
   */
  it('declares no literal rgb/hsl colours — use the theme tokens', () => {
    expect(offenders(/(?:text|bg|border|fill|stroke|ring|shadow)-\[[^\]]*(?:rgba?|hsla?)\(\s*[0-9][^\]]*\]/g))
      .toEqual([]);
  });

  /**
   * An icon has to be in the font, or it is not an icon — it is a lottery.
   *
   * Inter is self-hosted and subsetted, and `@fontsource-variable/inter`'s
   * `unicode-range` list covers Latin, Greek, Cyrillic, Vietnamese and a short
   * roster of named symbols. Every glyph below is outside all of them, so the
   * browser resolved each one through per-glyph fallback: the app's close,
   * complete, rename, drag, expand and overflow icons were drawn by whatever
   * face the OS offered, at whatever weight it happened to have. Two of them
   * (`⚠` U+26A0 and `✦` U+2726) have emoji presentation defaults and could
   * resolve to a colour emoji, which ignores `currentColor` outright.
   *
   * It was not visible locally — macOS has a glyph for all of these and they
   * look plausible — which is exactly why it needs a test rather than an eye.
   * They now live in `components/Icons.tsx` as SVGs on one grid.
   *
   * Only unambiguous ICON characters are listed. Deliberately absent:
   *   - `⌘ ⌥ ⇧ ⌫ ← →` in `ShortcutsOverlay` name physical keys, have no icon
   *     equivalent, and are set in `font-mono` (SF Mono / Menlo) which covers
   *     them in one face.
   *   - `×` (U+00D7) is a multiplication sign in "1.5× short" and IS in Inter.
   *   - `·`, `–`, `…` are punctuation, and are in Inter.
   */
  const ICON_GLYPHS = '✕✓✎▶◆◇⠿⋯✦⚠⌕＋';

  it('renders no icon as a Unicode glyph — use components/Icons.tsx', () => {
    // Comments are stripped first: `Icons.tsx` documents each character it
    // replaced, and half a dozen components explain the control they used to
    // draw. Over-stripping (a `//` inside a string) can only hide a violation,
    // never invent one, so the guard stays sound in the direction that matters.
    const stripComments = (src: string) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
        .join('\n');

    const hits: string[] = [];
    for (const file of files) {
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          for (const glyph of ICON_GLYPHS) {
            if (line.includes(glyph)) hits.push(`${file.slice(SRC.length)}:${i + 1} ${glyph}`);
          }
        });
    }
    expect(hits).toEqual([]);
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

/**
 * Two rules the remaster added, both of them about restraint rather than
 * consistency — the scale was already consistent and still too ornamental.
 */
describe('type roles', () => {
  /**
   * Fraunces made ordinary metadata feel editorial: it was on goal titles, task
   * titles, percentages, modal headings, the focus-summary numerals and the
   * backlog rows, so a `62%` carried the same voice as a masthead. It is a
   * brand mark now and nothing else.
   */
  it('keeps the display serif out of the working UI', () => {
    // The file, not the line: pinning a line number makes an unrelated import
    // above it fail this test, which teaches people to edit the assertion.
    const files = offenders(/font-disp/g).map((h) => h.split(':')[0]);
    expect(files).toEqual(['App.tsx']);
  });

  /**
   * A letter-spaced uppercase mono eyebrow over every group is a second
   * typeface doing a job a font weight already does. The survivors are the
   * weekday strips on the calendars, which is what a terse uppercase micro
   * label is genuinely for.
   */
  it('reserves uppercase for terse date labels', () => {
    const files = offenders(/uppercase/g).map((h) => h.split(':')[0]);
    expect([...new Set(files)].sort()).toEqual([
      'views/plan/MonthGrid.tsx',
      'views/plan/WeekGrid.tsx',
      'views/timeline/DaysLane.tsx',
    ]);
  });
});

/**
 * A dashed border is the app's DROP-TARGET signal — what a day column draws
 * while something is in the air. Spending it on ordinary empty states, in four
 * board columns at once, is how it stops meaning anything.
 *
 * The two survivors are semantic: the drop preview itself, and a calendar block
 * whose height is a guessed hour rather than an estimate somebody typed.
 */
describe('dashed borders', () => {
  it('are reserved for drop targets and guessed durations', () => {
    const files = offenders(/border-dashed/g).map((h) => h.split(':')[0]);
    expect([...new Set(files)].sort()).toEqual([
      'views/plan/DayColumn.tsx',
      'views/plan/EventBlock.tsx',
    ]);
  });
});

/**
 * An empty note should read as empty page, not as an empty form field.
 *
 * `.note-prose` is the only large outlined box left on a task page, and it is
 * outlined even when it holds nothing — which is what made a task detail feel
 * like a form rather than a document. The border still EXISTS at rest, so the
 * text does not shift by a pixel when it appears; it is simply transparent
 * until the editor has focus.
 */
describe('the notes editor', () => {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8');
  const rule = /\.note-prose\s*\{[^}]*\}/.exec(css)?.[0] ?? '';

  it('keeps its border transparent at rest', () => {
    expect(rule).toContain('border-transparent');
    expect(/border-line\b/.test(rule)).toBe(false);
  });

  it('paints that border only while it is focused', () => {
    expect(/\.note-prose:focus-within\s*\{[^}]*border-line\b[^}]*\}/.test(css)).toBe(true);
  });
});
