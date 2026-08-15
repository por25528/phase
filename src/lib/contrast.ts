/**
 * WCAG contrast maths, in one place.
 *
 * This existed twice before: correctly inside `projectColour.test.ts`, and as
 * an unlinearised channel sum inside `designScale.test.ts` — adequate for that
 * file's "is `raised` lighter than `chip`" ordering question, and wrong by up
 * to 30 points for a ratio. A third copy was about to be written for the
 * palette guard, so it lives here instead.
 *
 * Every function is pure and takes CSS as a STRING. Reading `index.css` off
 * disk stays in the tests, so nothing here needs `node:fs`.
 */
export type Rgb = readonly [number, number, number];

/** WCAG 2.x relative luminance. 0 for black, 1 for white. */
export function luminance([r, g, b]: Rgb): number {
  const lin = [r, g, b].map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Contrast ratio between two colours, 1–21. Argument order is irrelevant. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A CSS comment can legitimately mention a selector or a class in prose (as
 * this file's own header does), and a plain-text scan over raw stylesheet
 * text would happily match that prose instead of the rule it describes.
 *
 * Comment bodies are blanked to EQUAL-LENGTH runs of spaces rather than
 * removed, so every remaining character keeps its original string index —
 * a caller that reports a line/column, or that re-slices the ORIGINAL `css`
 * using an offset found in the stripped text (as `cssBlock` does), still
 * lines up.
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
}

/**
 * The body of the first rule matching `selector`, brace-matched.
 *
 * Splitting on the selector and taking the remainder — which is what the
 * existing guards do — hands back the whole rest of the file, so a token
 * redeclared in a later rule would be read as if it belonged to this one.
 *
 * Comments are stripped before the search: a selector can legitimately be
 * mentioned in a `/* ... *\/` remark (as `index.css`'s own header does), and
 * a plain substring search would happily match that prose instead of the rule
 * it describes.
 */
export function cssBlock(css: string, selector: string): string {
  const stripped = stripCssComments(css);
  const start = stripped.indexOf(selector);
  if (start === -1) throw new Error(`${selector} not found in stylesheet`);
  const open = stripped.indexOf('{', start);
  if (open === -1) throw new Error(`${selector} has no block`);
  let depth = 0;
  for (let i = open; i < stripped.length; i += 1) {
    if (stripped[i] === '{') depth += 1;
    else if (stripped[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`${selector} is unclosed`);
}

/**
 * Every `--c-*` channel triple declared in one theme scope, keyed without the
 * leading `--`. Declarations that are not triples (`--scrim`, `--shadow-card`)
 * are skipped: they are whole CSS values, not colours this module can reason
 * about.
 */
export function themeTokens(css: string, selector: string): Record<string, Rgb> {
  const body = cssBlock(css, selector);
  const tokens: Record<string, Rgb> = {};
  for (const [, name, r, g, b] of body.matchAll(
    /--(c-[\w-]+):\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;/g,
  )) {
    tokens[name] = [Number(r), Number(g), Number(b)];
  }
  return tokens;
}
