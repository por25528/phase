# Stone Token Remaster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase's warm-editorial identity with "Stone" — warm-neutral
greys, a slate accent, Fraunces on display only over Public Sans and IBM Plex
Mono — without moving a single component.

**Architecture:** Everything lands in the token layer: `src/index.css` holds
the colour ramps as `R G B` channel triples, `tailwind.config.js` holds the
type scale, families and radii. Two consented exceptions touch components — one
new class on `TaskPage`'s title, and 31 section labels routed through a new
`sectionLabel` constant. Guard tests in `src/lib/` encode every rule, and three
of them currently assert the old identity, so they are rewritten as part of the
work rather than after it.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS (JIT, `content` scans
`src/**/*.{js,ts,jsx,tsx}`), Vitest, fontsource (self-hosted fonts — the app is
offline-first Electron and **must not** reference a font CDN).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-15-stone-remaster-design.md`. Where
  this plan and the spec disagree, the spec wins — raise it rather than guess.
- **Colours are `R G B` channel triples** in `index.css`, consumed as
  `rgb(var(--c-*) / <alpha-value>)`. Never a hex, never an `rgb()` literal, in
  either the CSS or the markup — `designScale.test.ts` fails the build on both.
- **Font sizes come from the named `fontSize` scale.** `text-[1.2rem]` fails.
- **Radii:** only `[4px]`, `[6px]`, `rounded-field`, `rounded-card`,
  `rounded-full` after Task 6. `[11px]` is removed from the allowlist.
- **Motion stays in 100–200ms**, CSS and utility classes alike.
- **No `fontSize` key may share a name with a `colors` key.** Tailwind emits
  both as `.text-<key>` and the colour silently wins.
- **Fonts are self-hosted via fontsource.** No `fonts.googleapis.com`, no
  `@import` from a network origin.
- **Before every commit:** `npm test` and `npx tsc -b` must both pass clean.
- **Commit style:** `type(scope): lowercase phrase`, body explaining *why*,
  ending with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Branch:** `docs/stone-remaster-spec` is checked out. A parallel session has
  committed to it before; run `git log --oneline -3` before each commit and do
  not rebase or amend anything you did not write.
- **Run a single test file with:**
  `npx vitest run --config vitest.config.ts <path>`
- **`tsconfig.app.json` includes `src`, so test files are typechecked too**, and
  three of its flags bite when writing them: `noUnusedLocals` and
  `noUnusedParameters` (an import left behind after a refactor fails the build),
  and `verbatimModuleSyntax` (a type-only import must carry `type`, e.g.
  `import { contrastRatio, type Rgb } from './contrast'`). There is no
  `strict` and no `noUncheckedIndexedAccess`, so indexing a
  `Record<string, Rgb>` yields `Rgb` rather than `Rgb | undefined`.

---

### Task 1: Shared contrast maths

The luminance formula exists twice already — correctly in
`projectColour.test.ts`, and as an unlinearised channel sum in
`designScale.test.ts` (fine for its `raised > chip` ordering check, wrong for a
ratio). Task 2 needs a third consumer. Extract it once, first.

**Files:**
- Create: `src/lib/contrast.ts`
- Create: `src/lib/contrast.test.ts`
- Modify: `src/lib/projectColour.test.ts:49-87` (replace private helpers)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Rgb = readonly [number, number, number]`
  - `luminance(rgb: Rgb): number` — WCAG relative luminance, 0–1
  - `contrastRatio(a: Rgb, b: Rgb): number` — order-independent, ≥1
  - `cssBlock(css: string, selector: string): string` — body of the first rule
    matching `selector`, brace-matched
  - `themeTokens(css: string, selector: string): Record<string, Rgb>` — every
    `--c-*` triple declared in that block, keyed without the `--` prefix
    (e.g. `'c-ink'`)

- [ ] **Step 1: Write the failing test**

Create `src/lib/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { contrastRatio, cssBlock, luminance, themeTokens } from './contrast';

describe('luminance', () => {
  it('puts black at 0 and white at 1', () => {
    expect(luminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it('linearises the channel rather than averaging it', () => {
    // Mid-grey is ~21.6% luminance, not 50%. An unlinearised sum returns .5
    // and would silently pass every ratio assertion that follows.
    expect(luminance([128, 128, 128])).toBeGreaterThan(0.2);
    expect(luminance([128, 128, 128])).toBeLessThan(0.23);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it('does not care which argument is lighter', () => {
    const a: [number, number, number] = [26, 26, 24];
    const b: [number, number, number] = [255, 255, 255];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio([58, 74, 92], [58, 74, 92])).toBeCloseTo(1, 10);
  });
});

describe('cssBlock', () => {
  it('returns the body of the named rule', () => {
    expect(cssBlock('a { x: 1; } .b { y: 2; }', '.b').trim()).toBe('y: 2;');
  });

  it('matches braces rather than stopping at the first one', () => {
    const css = '.dark { --c-ink: 1 2 3; @media (x) { --c-bg: 4 5 6; } } .after { z: 9; }';
    const body = cssBlock(css, '.dark');
    expect(body).toContain('--c-bg: 4 5 6');
    expect(body).not.toContain('z: 9');
  });

  it('throws when the selector is absent', () => {
    expect(() => cssBlock('.a { x: 1; }', '.missing')).toThrow(/\.missing/);
  });
});

describe('themeTokens', () => {
  const css = `
    :root { --c-ink: 26 26 24; --c-bg: 247 247 245; --scrim: rgba(0,0,0,.3); }
    .dark { --c-ink: 235 231 222; }
  `;

  it('reads only the triples in the requested scope', () => {
    expect(themeTokens(css, ':root')['c-ink']).toEqual([26, 26, 24]);
    expect(themeTokens(css, '.dark')['c-ink']).toEqual([235, 231, 222]);
  });

  it('ignores declarations that are not channel triples', () => {
    expect(themeTokens(css, ':root')).not.toHaveProperty('scrim');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/lib/contrast.test.ts`
Expected: FAIL — `Failed to resolve import "./contrast"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/contrast.ts`:

```ts
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
 * The body of the first rule matching `selector`, brace-matched.
 *
 * Splitting on the selector and taking the remainder — which is what the
 * existing guards do — hands back the whole rest of the file, so a token
 * redeclared in a later rule would be read as if it belonged to this one.
 */
export function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`${selector} not found in stylesheet`);
  const open = css.indexOf('{', start);
  if (open === -1) throw new Error(`${selector} has no block`);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run --config vitest.config.ts src/lib/contrast.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Point `projectColour.test.ts` at the shared module**

In `src/lib/projectColour.test.ts`, replace the whole `describe('palette
contrast', …)` block (lines 49–87, including the comment above it) with:

```ts
/*
 * The rail is a 3px non-text element, so WCAG 1.4.11 applies and each colour
 * must clear 3:1 against the panel it sits on — in BOTH themes. The tokens are
 * declared once (see index.css); this is what proves that single declaration
 * spans both panels.
 */
describe('palette contrast', () => {
  const CSS = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');
  const LIGHT_PANEL: Rgb = [255, 255, 255];
  const DARK_PANEL: Rgb = themeTokens(CSS, '.dark')['c-panel'];

  it('reads a dark panel from the stylesheet rather than a literal', () => {
    // If `--c-panel` is ever renamed, every assertion below would otherwise
    // compare against `undefined` and throw somewhere less obvious.
    expect(DARK_PANEL).toBeDefined();
  });

  for (let i = 0; i < PROJECT_COLOURS; i += 1) {
    it(`--c-proj-${i} clears 3:1 on both panels`, () => {
      const hue = themeTokens(CSS, ':root')[`c-proj-${i}`];
      expect(hue, `--c-proj-${i} missing from :root`).toBeDefined();
      expect(contrastRatio(hue, LIGHT_PANEL)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(hue, DARK_PANEL)).toBeGreaterThanOrEqual(3);
    });
  }
});
```

Update the imports at the top of the file to:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { contrastRatio, themeTokens, type Rgb } from './contrast';
import { projectColourIndex, projectBlockClass, PROJECT_COLOURS } from './projectColour';
```

**Reading the dark panel from the stylesheet is the point.** The old test hard-
coded `luminance([13, 13, 14])`. Task 3 changes that panel, and a hardcoded
copy would have kept asserting against a colour the app no longer has.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. The six `--c-proj-N` assertions still pass — the hues have not
moved yet, and `#0D0D0E` is still what `--c-panel` says in `.dark`.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/contrast.ts src/lib/contrast.test.ts src/lib/projectColour.test.ts
git commit -m "$(cat <<'MSG'
refactor(lib): one luminance formula, and it reads the panel it tests against

The contrast maths existed twice — correctly in projectColour.test.ts and as
an unlinearised channel sum in designScale.test.ts. The palette guard needs a
third consumer, so it moves to lib/contrast.ts before that happens.

projectColour.test.ts also stops hardcoding `luminance([13, 13, 14])` as the
dark panel and reads `--c-panel` from the stylesheet instead. The panel is
about to change; a literal copy would have gone on asserting against a colour
the app no longer has, which is the one failure mode this guard exists to
prevent.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The Stone palette

**Files:**
- Create: `src/lib/paletteContrast.test.ts`
- Modify: `src/index.css:10-135` (the `:root` and `.dark` token blocks)

**Interfaces:**
- Consumes: `contrastRatio`, `themeTokens`, `Rgb` from Task 1.
- Produces: every `--c-*` token in its Stone value. Task 3 rewrites
  `--c-proj-0…5` inside the same `:root` block.

- [ ] **Step 1: Write the failing test**

Create `src/lib/paletteContrast.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, themeTokens, type Rgb } from './contrast';

/**
 * Every ratio in the palette was a COMMENT until this file existed.
 *
 * Comments do not fail builds. `--c-line-2` was once used as the unchecked
 * checkbox border at 1.38:1 — the app's primary action, invisible, with a
 * perfectly reasonable-looking token name in the class list. The numbers in
 * index.css are now claims this test either upholds or breaks.
 */
const CSS = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

// Annotated rather than `as const`: `describe.each` types a readonly tuple of
// object literals poorly, and the widened form is all this needs.
const THEMES: { name: string; selector: string }[] = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: '.dark' },
];

describe.each(THEMES)('$name palette', ({ selector }) => {
  const token = (name: string): Rgb => {
    const value = themeTokens(CSS, selector)[name];
    if (!value) throw new Error(`--${name} missing from ${selector}`);
    return value;
  };

  const against = (fg: string, bg: string) => contrastRatio(token(fg), token(bg));

  // Secondary copy carries most of the app's information, so it is TEXT and
  // takes the AA text floor on both surfaces it appears on.
  it('puts `muted` above 4.5:1 on the panel and the page', () => {
    expect(against('c-muted', 'c-panel')).toBeGreaterThanOrEqual(4.5);
    expect(against('c-muted', 'c-bg')).toBeGreaterThanOrEqual(4.5);
  });

  // `faint` is decorative marks, placeholders and disabled states — the 3:1
  // non-text floor, never the 4.5:1 one. Anything a user must READ is `muted`.
  it('puts `faint` above the 3:1 non-text floor', () => {
    expect(against('c-faint', 'c-panel')).toBeGreaterThanOrEqual(3);
    expect(against('c-faint', 'c-bg')).toBeGreaterThanOrEqual(3);
  });

  // WCAG 1.4.11. This is the unchecked checkbox — the app's primary action.
  it('keeps the checkbox border visible', () => {
    expect(against('c-check', 'c-panel')).toBeGreaterThanOrEqual(3);
    expect(against('c-check', 'c-bg')).toBeGreaterThanOrEqual(3);
  });

  it('puts `accent` above 4.5:1 on both surfaces', () => {
    expect(against('c-accent', 'c-panel')).toBeGreaterThanOrEqual(4.5);
    expect(against('c-accent', 'c-bg')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps `accent-contrast` legible on `accent`', () => {
    expect(against('c-accent-contrast', 'c-accent')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps `warn` legible on its tint and on the panel', () => {
    expect(against('c-warn', 'c-warn-tint')).toBeGreaterThanOrEqual(4.5);
    expect(against('c-warn', 'c-panel')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps `chip-ink` legible on `chip`', () => {
    expect(against('c-chip-ink', 'c-chip')).toBeGreaterThanOrEqual(4.5);
  });

  // `ink` is the reading colour. AAA, not AA.
  it('puts `ink` above 7:1 on the panel', () => {
    expect(against('c-ink', 'c-panel')).toBeGreaterThanOrEqual(7);
  });
});
```

- [ ] **Step 2: Run it to see which pairs the CURRENT palette already fails**

Run: `npx vitest run --config vitest.config.ts src/lib/paletteContrast.test.ts`
Expected: mostly PASS — the existing palette was tuned carefully. Record any
failures; they are pre-existing bugs, not regressions, and Step 3 fixes them by
replacing the values wholesale. **Do not weaken an assertion to make it pass.**

- [ ] **Step 3: Replace the `:root` colour tokens**

In `src/index.css`, replace the colour declarations inside `:root` (from
`--c-bg` down to and including `--c-warn-tint`; leave `--c-proj-*`,
`--shadow-*` and `--scrim` for the moment) with:

```css
    --c-bg: 247 247 245;            /* #F7F7F5 */
    --c-panel: 255 255 255;         /* #FFFFFF */
    --c-panel-bright: 255 255 255;  /* #FFFFFF */
    --c-field: 255 255 255;         /* #FFFFFF */
    --c-ink: 26 26 24;              /* #1A1A18 — 17.4:1 panel */
    --c-ink-hover: 51 50 46;        /* #33322E */
    --c-ink-soft: 70 68 62;         /* #46443E */
    /* Secondary copy carries most of the app's information, so `muted` clears
       AA (4.5:1) against both the panel and the page. `faint` is for genuinely
       decorative marks, placeholders and disabled states and holds the 3:1
       non-text floor — anything a user must READ belongs in `muted`.
       paletteContrast.test.ts asserts both. */
    --c-muted: 110 108 102;         /* #6E6C66 — 5.26:1 panel, 4.90:1 bg */
    --c-faint: 146 143 136;         /* #928F88 — 3.23:1 panel, 3.01:1 bg */
    --c-faint-2: 200 197 190;       /* #C8C5BE */
    --c-line: 233 232 228;          /* #E9E8E4 */
    --c-line-2: 216 214 208;        /* #D8D6D0 */
    /* Unchecked checkbox border. Deliberately stronger than --c-line-2, which
       at 1.38:1 failed WCAG 1.4.11 and made the app's primary action invisible. */
    --c-check: 139 136 127;         /* #8B887F — 3.54:1 panel, 3.30:1 bg */
    --c-line-soft: 240 239 235;     /* #F0EFEB */
    --c-hover: 242 241 238;         /* #F2F1EE */
    --c-hover-deep: 233 232 227;    /* #E9E8E3 */
    --c-fill: 26 26 24;             /* #1A1A18 */
    --c-dot: 51 50 46;              /* #33322E */
    --c-dot-off: 228 226 220;       /* #E4E2DC */
    --c-track: 237 236 232;         /* #EDECE8 */
    /* Slate, not terracotta. The old accent (192 78 45) sat nine degrees from
       --c-warn (158 89 44), so "this is the action" and "this is trouble" were
       told apart mostly by context. These two cannot be confused. */
    --c-accent: 58 74 92;           /* #3A4A5C — 9.08:1 panel, 8.46:1 bg */
    --c-accent-deep: 44 58 73;      /* #2C3A49 */
    --c-accent-soft: 139 154 170;   /* #8B9AAA */
    --c-accent-contrast: 255 255 255; /* #FFFFFF — 9.08:1 on accent */
    --c-accent-tint: 232 236 240;   /* #E8ECF0 */
    --c-paper: 247 247 245;         /* #F7F7F5 */
    --c-chip: 241 240 236;          /* #F1F0EC */
    --c-chip-ink: 102 100 94;       /* #66645E — 5.19:1 on chip */
    /* The selected segment of a segmented control: one step UP from the `chip`
       track it sits in. It needs its own token because "up" is not a fixed
       colour — designScale.test.ts asserts the RELATIONSHIP in both themes. */
    --c-raised: 255 255 255;        /* #FFFFFF — chip is 241 */
    --c-warn: 161 84 31;            /* #A1541F — 4.73:1 on warn-tint */
    --c-warn-tint: 246 237 228;     /* #F6EDE4 */
```

Then replace the two shadow lines and the scrim in `:root`:

```css
    --shadow-card: 0 1px 2px rgba(26, 26, 24, 0.05);
    --shadow-today: 0 2px 6px rgba(26, 26, 24, 0.07);
```

```css
    --scrim: rgba(20, 19, 17, 0.30);
```

- [ ] **Step 4: Replace the `.dark` colour tokens**

Replace the corresponding declarations inside `.dark`. Update the block comment
above `.dark` first — it currently says "OLED dark theme — pure-black base":

```css
  /* Warm charcoal dark theme — warm near-black base, faintly elevated surfaces,
     warm off-white ink, a lighter slate accent. Toggled by adding `.dark` to
     <html> (see src/lib/theme.ts).

     This is NOT OLED black any more, and that was a deliberate trade: a pure
     black theme beside a warm light theme is two identities in one app. The
     cost is paid by --c-proj-*, whose contrast band narrows against a lighter
     panel — see the note on those tokens. */
  .dark {
    --c-bg: 20 19 17;               /* #141311 */
    --c-panel: 30 29 27;            /* #1E1D1B */
    --c-panel-bright: 38 36 33;     /* #262421 */
    --c-field: 30 29 27;            /* #1E1D1B */
    --c-ink: 235 231 222;           /* #EBE7DE — 13.7:1 panel */
    --c-ink-hover: 214 210 201;     /* #D6D2C9 */
    --c-ink-soft: 181 176 165;      /* #B5B0A5 */
    --c-muted: 142 137 126;         /* #8E897E — 4.86:1 panel, 5.34:1 bg */
    --c-faint: 114 109 98;          /* #726D62 — 3.24:1 panel, 3.57:1 bg */
    --c-faint-2: 74 70 62;          /* #4A463E */
    --c-line: 44 42 38;             /* #2C2A26 */
    --c-line-2: 59 56 49;           /* #3B3831 */
    --c-check: 110 106 96;          /* #6E6A60 — 3.11:1 panel */
    --c-line-soft: 35 34 32;        /* #232220 */
    --c-hover: 38 36 33;            /* #262421 */
    --c-hover-deep: 50 47 42;       /* #322F2A */
    --c-fill: 235 231 222;          /* #EBE7DE */
    --c-dot: 220 216 207;           /* #DCD8CF */
    --c-dot-off: 53 50 44;          /* #35322C */
    --c-track: 42 40 36;            /* #2A2824 */
    --c-accent: 159 178 198;        /* #9FB2C6 — 7.83:1 panel */
    --c-accent-deep: 184 199 214;   /* #B8C7D6 — deeper = LIGHTER on a dark surface */
    --c-accent-soft: 74 87 104;     /* #4A5768 */
    --c-accent-contrast: 20 24 29;  /* #14181D — 8.40:1 on accent */
    --c-accent-tint: 34 40 47;      /* #22282F */
    --c-paper: 16 15 14;            /* #100F0E */
    --c-chip: 38 36 33;             /* #262421 */
    --c-chip-ink: 154 149 138;      /* #9A958A — 5.14:1 on chip */
    /* Up means brighter here too — the same step, in the direction this theme
       calls up. */
    --c-raised: 58 55 48;           /* #3A3730 — chip is 38 */
    --c-warn: 201 136 75;           /* #C9884B — 5.42:1 on warn-tint */
    --c-warn-tint: 42 32 24;        /* #2A2018 */

    --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.45);
    --shadow-today: 0 2px 8px rgba(0, 0, 0, 0.55);

    /* Lighter than the old .66: the panel is now 8% above the page rather than
       5%, so the surface itself carries more of the separation. */
    --scrim: rgba(10, 9, 8, 0.62);
  }
```

- [ ] **Step 5: Correct the stale shadow comment in `tailwind.config.js`**

The `boxShadow` block is prefaced with "Warm rgba drops are invisible on OLED
black — theme them too so dark can fall back to a darker drop plus the
border-line hairlines cards carry." Dark is no longer OLED black and a drop is
no longer invisible on it. Replace that comment:

```js
      // Drops are themed because their COLOUR has to change, not because dark
      // cannot show one: a warm rgba drop over #141311 is invisible, a black
      // one over it is not. The dark values are heavier to compensate for the
      // smaller gap between panel and page.
```

- [ ] **Step 6: Run the palette guard**

Run: `npx vitest run --config vitest.config.ts src/lib/paletteContrast.test.ts`
Expected: PASS, 16 tests (8 per theme).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: **`projectColour.test.ts` now FAILS.** The dark panel it reads is
`#1E1D1B`, and the six project hues were drawn for `#0D0D0E`. This failure is
the whole point of Task 1 Step 5 and is fixed in Task 3 — do not touch the
project hues yet, and do not weaken the assertion.

Also expect `designScale.test.ts`'s `raised > chip` check to still pass: light
is 255 over 241, dark is 58/55/48 over 38/36/33.

- [ ] **Step 8: Commit**

```bash
npx tsc -b
git add src/index.css tailwind.config.js src/lib/paletteContrast.test.ts
git commit -m "$(cat <<'MSG'
feat(design): stone — warm neutrals, a slate accent, and a warm charcoal dark

Every ratio in this file used to be a comment, and comments do not fail
builds: --c-line-2 was once the unchecked checkbox border at 1.38:1, the
app's primary action invisible behind a reasonable-looking token name.
paletteContrast.test.ts turns those comments into claims.

The accent moves from terracotta to slate for a functional reason as much as
an aesthetic one. The old --c-accent (192 78 45) sat nine degrees from
--c-warn (158 89 44), so "action" and "trouble" were distinguished mostly by
context. #3A4A5C and #A1541F cannot be mistaken for each other.

Dark is no longer OLED black. A pure black theme beside a warm light theme is
two identities in one app. The bill for that arrives in projectColour.test.ts,
which fails on this commit by design and is settled in the next.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Project hues on the warm panel

The warm panel is lighter than OLED black, which raises the floor of the
luminance band the six hues can occupy from `L ≥ 0.113` to `L ≥ 0.137`. The set
drawn against the old panel fails: plum lands at 2.70:1.

**Files:**
- Modify: `src/index.css` (the `--c-proj-0…5` block in `:root`)
- Modify: `src/lib/projectColour.ts:14-19` (the alpha comment)

**Interfaces:**
- Consumes: `--c-panel` from Task 2's `.dark` block.
- Produces: six hues in `L ∈ [0.160, 0.196]`.

- [ ] **Step 1: Confirm the failure and its shape**

Run: `npx vitest run --config vitest.config.ts src/lib/projectColour.test.ts`
Expected: FAIL. At least `--c-proj-2` (plum, `#7A5470`) at ~2.70:1 against
`#1E1D1B`. Note which of the six fail — all but clay should.

- [ ] **Step 2: Replace the six hues**

In `src/index.css`, replace the `--c-proj-*` block and its comment:

```css
    /*
     * Project identity. Six hues, assigned by hash — see lib/projectColour.ts.
     *
     * Declared once rather than per theme: every value's relative luminance
     * sits in [0.160, 0.196], which clears 3:1 against BOTH panels (#FFFFFF at
     * ≥4.26:1 and #1E1D1B at ≥3.38:1). WCAG 1.4.11 applies because the rail is
     * a 3px non-text element, the same reason --c-check is tuned.
     * projectColour.test.ts asserts the ratio against both, reading the dark
     * panel out of this file rather than hardcoding it.
     *
     * These are LIGHTER than the set they replace, and not by taste. The warm
     * charcoal panel (#1E1D1B, L≈0.0122) is brighter than the OLED panel it
     * replaced (#0D0D0E, L≈0.0045), which lifts the floor of the usable band
     * from L≥0.113 to L≥0.137. The previous plum (#7A5470, L=0.118) measured
     * 2.70:1 here — a build failure, not a near miss.
     *
     * Deliberately not near --c-accent (58 74 92): accent means ACTION and
     * warn means TROUBLE. Project identity is a third channel and must not be
     * mistaken for either.
     */
    --c-proj-0: 74 128 120;   /* #4A8078 teal  — L .182 */
    --c-proj-1: 98 111 163;   /* #626FA3 indigo— L .165 */
    --c-proj-2: 140 98 128;   /* #8C6280 plum  — L .160 */
    --c-proj-3: 114 121 79;   /* #72794F moss  — L .177 */
    --c-proj-4: 83 120 143;   /* #53788F steel — L .170 */
    --c-proj-5: 155 113 96;   /* #9B7160 clay  — L .196 */
```

- [ ] **Step 3: Update the alpha comment in `projectColour.ts`**

`src/lib/projectColour.ts:14-19` names the old panel. Replace that paragraph:

```ts
 * Two alphas per entry. 12% over the white panel is a legible wash; the same
 * 12% over the warm charcoal panel (#1E1D1B) is far too faint, so the dark
 * theme takes 22%. Ink stays `text-ink` at both: a near-black/near-white on a
 * 12–22% wash clears AA comfortably, whereas colouring the text to match would
 * land around 4.2:1 and fail it.
```

Also update the dark-fill comment in `projectColour.test.ts:41-42`, which still
says `#0D0D0E`:

```ts
    // A 12% tint over #1E1D1B is too faint to read as a fill; the dark variant
    // is what keeps the block distinguishable from the grid in the dark theme.
```

- [ ] **Step 4: Run the guard**

Run: `npx vitest run --config vitest.config.ts src/lib/projectColour.test.ts`
Expected: PASS, all six clear both panels.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` — expected PASS. Then:

```bash
npx tsc -b
git add src/index.css src/lib/projectColour.ts src/lib/projectColour.test.ts
git commit -m "$(cat <<'MSG'
fix(design): lift the project hues onto the panel that now sits under them

The warm charcoal panel (#1E1D1B, L≈0.0122) is brighter than the OLED panel
it replaced (#0D0D0E, L≈0.0045), which raises the floor of the band these six
must occupy from L≥0.113 to L≥0.137. Four of the six no longer cleared 3:1;
plum measured 2.70:1.

All six move into [0.160, 0.196] — ≥3.38:1 on the dark panel and ≥4.26:1 on
white. They read more pastel than the set they replace. That is the price of
the dark theme rather than a drafting error, and the comment says so, because
the next reader's instinct will be to saturate them again.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The three faces

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/main.tsx:1-2`
- Modify: `src/assistant/main.tsx:1`
- Modify: `tailwind.config.js` (`fontFamily`)

**Interfaces:**
- Consumes: nothing.
- Produces: `font-disp` → Fraunces, `font-ui` → Public Sans, `font-mono` → IBM
  Plex Mono. Task 8 depends on `font-mono` naming a real family.

- [ ] **Step 1: Swap the packages**

```bash
npm install @fontsource-variable/public-sans @fontsource/ibm-plex-mono
npm uninstall @fontsource-variable/inter
```

**IBM Plex Mono has no variable build on fontsource** — `@fontsource-variable/ibm-plex-mono` does not exist. The static package is correct, and only weights 400 and 500 get imported.

- [ ] **Step 2: Swap the imports**

`src/main.tsx`, lines 1–2 become:

```ts
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/public-sans/index.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
```

`src/assistant/main.tsx`, line 1 becomes:

```ts
import '@fontsource-variable/public-sans/index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
```

The assistant shelf does not render a wordmark or a note, so it does not import
Fraunces — the same reason it never imported it before.

- [ ] **Step 3: Point the families at the new faces**

In `tailwind.config.js`, replace the `fontFamily` block:

```js
      fontFamily: {
        // DISPLAY ONLY, and the boundary is enforced by designScale.test.ts:
        // the wordmark, a document's own title, and headings typed inside a
        // note. Nothing in the working UI. Fraunces on ordinary metadata is
        // what made a `62%` carry the same voice as a masthead.
        disp: ['Fraunces Variable', 'Fraunces', 'Georgia', 'serif'],
        // Public Sans replaces Inter. Its design brief was legibility and
        // neutrality for documents people must not misread, which is the
        // quality being aimed at, and character here would compete with the
        // serif above it.
        ui: ['Public Sans Variable', 'Public Sans', '-apple-system', 'system-ui', 'sans-serif'],
        // The eyebrow/label face — the app's THIRD type role, not a stray.
        // It is on every section label, every key hint and every tabular stat.
        // Naming a real family is the point: the stack this replaces resolved
        // to SF Mono here, Consolas on Windows and Liberation Mono on Linux,
        // at three different widths, so the `tracking-[.11em]` tuned against
        // those labels was correct only on the machine that tuned it.
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
```

- [ ] **Step 4: Verify no CDN reference crept in**

Run: `grep -rn "fonts.googleapis\|fonts.gstatic\|@import url(http" src/ index.html`
Expected: no matches. The app is offline-first Electron; a network font would
render nothing when the machine is offline.

- [ ] **Step 5: Verify Inter is gone**

Run: `grep -rn "fontsource-variable/inter\|'Inter'\|Inter Variable" src/ tailwind.config.js`
Expected: no matches in code. Prose mentions inside `designScale.test.ts` and
`Icons.tsx` comments are handled in Task 7 — note them, do not fix them here.

- [ ] **Step 6: Build, test, commit**

```bash
npm test && npx tsc -b && npm run build
git add package.json package-lock.json src/main.tsx src/assistant/main.tsx tailwind.config.js
git commit -m "$(cat <<'MSG'
feat(design): three faces, and the mono is finally one of them

Fraunces stays but becomes display-only. Public Sans replaces Inter. IBM Plex
Mono replaces a system stack.

That last one is the substantive change. `font-mono` is applied in a dozen
files — every section label, every key hint, every tabular stat — and named
only `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, so the one
face on every section header was whatever the OS supplied: SF Mono here,
Consolas on Windows, Liberation Mono on Linux, at three different widths. The
`tracking-[.11em]` tuned against those labels was correct on exactly one
machine.

Plex Mono has no variable build on fontsource, so 400 and 500 ship as static
files. Mono appears on labels, key hints and counters; none of them needs a
third weight.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The type scale

17 keys become 11. Six are re-valued onto their survivor rather than deleted,
so no call site moves — deletion is Task 10.

**Files:**
- Modify: `tailwind.config.js` (`fontSize`)

**Interfaces:**
- Consumes: nothing.
- Produces: `micro` .625rem, `meta` .75rem, `ui` .8rem, `body` .875rem, `lead`
  .95rem, `title` 1rem, `h2` 1.15rem, `h1` 1.4rem, `wordmark` 1.2rem, `page`
  1.85rem. Task 8 uses `micro`.

- [ ] **Step 1: Replace the `fontSize` block**

```js
      // The type scale. Every size in src/ is one of these — pick from the menu
      // rather than inventing a value; 37 near-duplicate sizes was the loudest
      // "no system here" signal in the UI.
      //
      // Eleven steps, down from seventeen. Six keys below are ALIASES holding
      // their survivor's value: they still resolve, so no call site had to move
      // when the scale collapsed, and deleting them is a separate mechanical
      // pass. An alias is not a step — do not reach for one in new code.
      fontSize: {
        root: '14px',       // body base (index.css)
        micro: '.625rem',   // 8.75px — mono section labels and eyebrows
        eyebrow: '.625rem', // ALIAS of micro
        tiny: '.75rem',     // ALIAS of meta
        kbd: '.75rem',      // ALIAS of meta
        // NB: `badge`, not `chip`. `chip` is also a COLOR key, and Tailwind
        // emits both `.text-chip{font-size}` and `.text-chip{color}` — the
        // colour rule wins on order, so every `text-chip` element silently
        // inherited the near-white chip surface colour. No fontSize key may
        // share a name with a colour key; designScale.test.ts asserts it.
        badge: '.75rem',    // ALIAS of meta
        meta: '.75rem',     // 10.5px — counters, dates, secondary metadata
        compact: '.8rem',   // ALIAS of ui
        ui: '.8rem',        // 11.2px — default control text
        body: '.875rem',    // 12.25px — default reading text, row titles
        lead: '.95rem',     // 13.3px — the note body at full measure
        title: '1rem',      // 14px — card titles
        h3: '1rem',         // ALIAS of title
        h2: '1.15rem',      // 16.1px
        h1: '1.4rem',       // 19.6px
        // Down from 1.5rem. A serif mark at 21px in a 48px header bar competed
        // with the view title beneath it; at 16.8px it sits with the nav.
        wordmark: '1.2rem', // 16.8px
        // A document's own title. It has to outrank `h1`, because `h1` is what
        // a heading typed INSIDE a note renders at — with the task page's title
        // set to `h2`, a heading in the body came out larger than the name of
        // the thing it was in.
        page: '1.85rem',    // 25.9px
      },
```

- [ ] **Step 2: Confirm no key collides with a colour**

Run: `npx vitest run --config vitest.config.ts src/lib/designScale.test.ts -t "shares no key"`
Expected: PASS.

- [ ] **Step 3: Run the full suite and commit**

```bash
npm test && npx tsc -b
git add tailwind.config.js
git commit -m "$(cat <<'MSG'
refactor(design): seventeen type steps become eleven, without moving a call site

Four sizes lived inside .1rem of each other at the small end (micro .52,
eyebrow .56, tiny .6, kbd .62) and three more were used once or twice each.

The six doomed keys are re-valued onto their survivor rather than deleted, so
every existing `text-tiny` and `text-badge` still resolves and no component
had to change in this commit. Deleting them is a mechanical sweep of ~26 call
sites and is deliberately separate, so the scale can be judged on screen
before anyone commits to it.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Corner radii

**Files:**
- Modify: `tailwind.config.js` (`borderRadius`)
- Modify: `src/views/Timeline.tsx:550,572,579`
- Modify: `src/views/Goals.tsx:475`
- Modify: `src/lib/designScale.test.ts:56-66`

- [ ] **Step 1: Tighten the two named radii**

```js
      // Corner radii: 4 and 6 inline, plus `field` (8) and `card` (12).
      // Controls rounding LESS than surfaces is deliberate — round 2 rejected
      // swapping them. 11px was a fourth near-duplicate and is gone.
      borderRadius: {
        card: '12px',
        field: '8px',
      },
```

- [ ] **Step 2: Retire the four `[11px]` sites**

Each becomes the radius of the thing it actually is — a panel takes `card`, a
control track takes `field`:

- `src/views/Timeline.tsx:550` — `rounded-[11px]` → `rounded-card` (a warning panel)
- `src/views/Timeline.tsx:572` — `rounded-[11px]` → `rounded-card` (an empty-state panel)
- `src/views/Timeline.tsx:579` — `rounded-[11px]` → `rounded-card` (the scroll container)
- `src/views/Goals.tsx:475` — `rounded-[11px]` → `rounded-field` (a segmented-control track)

- [ ] **Step 3: Remove 11 from the guard's allowlist**

In `src/lib/designScale.test.ts`, replace lines 56–59:

```ts
  // 4 and 6 remain inline alongside the named `field` (8) and `card` (12).
  // 11 was a fourth near-duplicate at four sites — three Timeline panels and
  // one segmented-control track — and is not coming back.
  const ALLOWED_RADII = new Set(['4', '6']);

  it('uses only the four agreed corner radii', () => {
```

- [ ] **Step 4: Run the guard**

Run: `npx vitest run --config vitest.config.ts src/lib/designScale.test.ts -t "corner radii"`
Expected: PASS. A leftover `rounded-[11px]` would list its file and line.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npx tsc -b
git add tailwind.config.js src/views/Timeline.tsx src/views/Goals.tsx src/lib/designScale.test.ts
git commit -m "$(cat <<'MSG'
refactor(design): four radii, not five

field 9→8 and card 14→12 tighten the app slightly, which reads more tool and
less consumer. 11px was the only true stray — three Timeline panels and one
segmented-control track — and each resolves to the radius of the thing it
actually is. Removing it from ALLOWED_RADII is what stops it coming back.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Fraunces on the page title, and an honest `font-disp` guard

The guard asserts `font-disp` appears in exactly one file. That has been
passing while Fraunces rendered in **two** roles, because `offenders()` scans
`.tsx`/`.ts` and `.note-prose`'s headings live in `index.css`.

**Files:**
- Modify: `src/views/project/TaskPage.tsx:210,220`
- Modify: `src/lib/designScale.test.ts:265-277` and `:137-159`

- [ ] **Step 1: Update the guard first — it should fail**

Replace the `it('keeps the display serif out of the working UI', …)` block:

```ts
  /**
   * Fraunces made ordinary metadata feel editorial: it was on goal titles, task
   * titles, percentages, modal headings, the focus-summary numerals and the
   * backlog rows, so a `62%` carried the same voice as a masthead. It is a
   * display face now — three roles and no others.
   *
   * The list below covers MARKUP only. `.note-prose > div > h1/h2/h3` in
   * index.css is the third role and is invisible here, because `offenders()`
   * scans .tsx/.ts. That is worth stating rather than discovering: a reader who
   * assumes this list is exhaustive will conclude Fraunces renders in two
   * places when it renders in three.
   */
  it('keeps the display serif out of the working UI', () => {
    // The file, not the line: pinning a line number makes an unrelated import
    // above it fail this test, which teaches people to edit the assertion.
    const files = offenders(/font-disp/g).map((h) => h.split(':')[0]);
    expect([...new Set(files)].sort()).toEqual([
      'App.tsx',                      // the wordmark
      'views/project/TaskPage.tsx',   // a document's own title
    ]);
  });
```

Run: `npx vitest run --config vitest.config.ts src/lib/designScale.test.ts -t "display serif"`
Expected: FAIL — got `['App.tsx']`, expected two entries.

- [ ] **Step 2: Put the serif on the page title**

`src/views/project/TaskPage.tsx:210` — add `font-disp` and relax the tracking,
which was tuned for a sans:

```tsx
                className="font-disp text-page font-semibold tracking-[-0.01em]"
```

`src/views/project/TaskPage.tsx:220`:

```tsx
                className="font-disp text-page font-semibold tracking-[-0.01em] cursor-text hover:text-ink-hover w-full text-left rounded-[6px] leading-[1.2]"
```

Both sites are the same title in its static and editable states. **They must
stay identical in face, size and tracking** — a title that reflows when you
click it is worse than one that never invited the click.

- [ ] **Step 3: Run the guard**

Run: `npx vitest run --config vitest.config.ts src/lib/designScale.test.ts -t "display serif"`
Expected: PASS.

- [ ] **Step 4: Give the note at full measure its reading size**

`.note-prose` sets `text-body` (`index.css:233-236`), which both notes inherit.
Spec §4 assigns `lead` the role "the note body at full measure" — so the docked
inspector keeps `body` (there the note is one control among several) and the
task page's note steps up to `lead`. Add one declaration after the existing
`.note-prose.note-page` rule:

```css
  /* The document reads a step larger than the chrome around it. The docked
     inspector's note keeps `text-body`: there it is one control among several,
     sharing a narrow column. Here it is the whole point of the page. */
  .note-prose.note-page {
    @apply text-lead;
  }
```

Merge it into the existing `.note-prose.note-page { @apply border-0 px-0; }`
rule rather than adding a second block — one selector, one rule:

```css
  .note-prose.note-page {
    @apply border-0 px-0 text-lead;
  }
```

- [ ] **Step 5: Correct the two Inter comments**

`designScale.test.ts:140` and `Icons.tsx:15` both explain the icon-glyph rule in
terms of Inter's `unicode-range`. Inter is no longer installed. Replace the
opening of the `designScale.test.ts` paragraph:

```ts
   * Public Sans is self-hosted and subsetted, and `@fontsource-variable/public-sans`'s
   * `unicode-range` list covers Latin, Greek, Cyrillic, Vietnamese and a short
   * roster of named symbols. Every glyph below is outside all of them, so the
```

And in the same block, the two sentences naming Inter by name near the end:

```ts
   *   - `×` (U+00D7) is a multiplication sign in "1.5× short" and IS in Public Sans.
   *   - `·`, `–`, `…` are punctuation, and are in Public Sans.
```

Make the equivalent substitution in `src/components/Icons.tsx:15`.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test && npx tsc -b
git add src/views/project/TaskPage.tsx src/index.css src/lib/designScale.test.ts src/components/Icons.tsx
git commit -m "$(cat <<'MSG'
feat(design): the serif reaches a document's own title, and the guard says so

The rule "font-disp appears in exactly one file" has been passing while
Fraunces rendered in two roles: `.note-prose > div > h1/h2/h3` has carried
`@apply font-disp` all along, and `offenders()` scans .tsx/.ts, so index.css
was never in scope. The rewritten comment states that, because a reader who
assumes the list is exhaustive gets the wrong count.

TaskPage's title is the third role and the only new one. Both its static and
editable spans take the same face, size and tracking — a title that reflows
when you click it is worse than one that never invited the click. The tracking
relaxes from -0.02em to -0.01em because the old value was tuned for a sans.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The section-label constant

`text-meta font-semibold text-muted` is hand-copied at 36 sites. The voice moves
into a constant before it changes.

**Files:**
- Create: `src/components/sectionLabel.ts`
- Modify: 31 sites (enumerated below)
- Modify: `src/lib/designScale.test.ts:279-294`

**Interfaces:**
- Consumes: `text-micro` (Task 5), `font-mono` → IBM Plex Mono (Task 4).
- Produces: `sectionLabel: string`.

- [ ] **Step 1: Create the constant**

`src/components/sectionLabel.ts`:

```ts
/**
 * The one section-label voice.
 *
 * This string was hand-copied at 36 sites, which is the condition that lets a
 * voice drift — the same reason `dialogStyles.ts` exists for buttons. Changing
 * it here changes every region heading in the app.
 *
 * A section label names a REGION of a working surface: `Now`, `Free time`,
 * `Carried over`, `Done today`. In the mono voice it stops reading as a prose
 * heading and starts reading as the legend on an instrument, which is the
 * point. It is also quieter than what it replaced — 10.08px semibold sentence
 * case became 8.75px medium uppercase — so it recedes behind the content it
 * introduces while becoming more distinct from it.
 *
 * NOT for: a button that happens to be small (`TaskPage`'s time-log toggle,
 * `RecapPanel`'s show-more), a row label in a sticky column (`Timeline`), or a
 * caption sitting beside its control (`AssistantSurface`'s "Focus"). Those five
 * sites share the old class string by coincidence, not by role, and they keep
 * it written out in full.
 */
export const sectionLabel = 'text-micro font-medium text-muted font-mono uppercase tracking-[.11em]';
```

- [ ] **Step 2: Convert the 31 headings**

At each site, replace the literal `text-meta font-semibold text-muted` with the
constant, preserving every other class on the element. Where the class list has
no other classes, `className={sectionLabel}`; where it does, use a template
literal, e.g. `Today.tsx:257`:

```tsx
            <div className={`px-[8px] mb-[2px] ${sectionLabel}`}>
```

Add `import { sectionLabel } from '../components/sectionLabel';` (adjusting the
relative depth) to each file.

| File | Lines |
|---|---|
| `src/views/Today.tsx` | 257, 292, 330, 397, 443, 500, 539 |
| `src/views/project/OverviewTab.tsx` | 61, 137, 167, 184, 208 |
| `src/components/SettingsModal.tsx` | 26, 33, 41 |
| `src/components/ShortcutsOverlay.tsx` | 171, 181, 191 |
| `src/views/plan/RecapPanel.tsx` | 72, 130 |
| `src/views/project/StepPanel.tsx` | 24, 187 |
| `src/components/CardSection.tsx` | 15 |
| `src/components/assistant/AssistantSurface.tsx` | 61 |
| `src/views/Goals.tsx` | 654 |
| `src/views/plan/sidebar/Backlog.tsx` | 238 |
| `src/views/plan/PlanSidebar.tsx` | 44 |
| `src/views/plan/WeekHeader.tsx` | 58 |
| `src/views/project/NotesTab.tsx` | 11 |
| `src/views/project/CalendarTab.tsx` | 137 |
| `src/views/plan/UnestimatedPanel.tsx` | 38 |

**Leave these five exactly as they are:**

| Site | Why |
|---|---|
| `src/views/project/TaskPage.tsx:419` | a button — carries `hover:bg-hover hover:text-ink` |
| `src/views/plan/RecapPanel.tsx:115` | a button — carries `hover:text-ink` |
| `src/views/Timeline.tsx:584` | a sticky row label in the left column |
| `src/views/Timeline.tsx:617` | a sticky row label in the left column |
| `src/components/assistant/AssistantSurface.tsx:77` | "Focus", beside its control |

- [ ] **Step 3: Verify the count**

Run: `grep -rn "text-meta font-semibold text-muted" src/ | grep -v "\.test\." | wc -l`
Expected: `5`.

Run: `grep -rln "sectionLabel" src/ | grep -v "\.test\." | wc -l`
Expected: `16` — fifteen consumers plus the module itself.

- [ ] **Step 4: Rewrite the `uppercase` guard**

The current rule allowlists four files. Replace it:

```ts
  /**
   * A letter-spaced uppercase mono eyebrow over every group used to be a
   * second typeface doing a job a font weight already does. It is now the
   * section-label voice — see `components/sectionLabel.ts` — and the rule that
   * keeps it from spreading is that uppercase must travel WITH `font-mono`.
   *
   * Uppercase in the UI face is still a build failure. The survivors that
   * carry no mono are the weekday strips on the calendars, which is what a
   * terse uppercase micro label is genuinely for — including the date picker's,
   * which is a weekday strip by the same definition as the other three.
   */
  const WEEKDAY_STRIPS = [
    'components/DatePopover.tsx',
    'views/plan/MonthGrid.tsx',
    'views/plan/WeekGrid.tsx',
    'views/timeline/DaysLane.tsx',
  ];

  it('reserves uppercase for the mono label voice and terse date labels', () => {
    const bad = offenders(/\buppercase\b/g).filter((hit) => {
      const [file] = hit.split(':');
      if (WEEKDAY_STRIPS.includes(file)) return false;
      // `sectionLabel.ts` declares the voice; every consumer references it by
      // name and never spells `uppercase` itself, so a hit anywhere else is a
      // hand-rolled label.
      return file !== 'components/sectionLabel.ts';
    });
    expect(bad).toEqual([]);
  });
```

- [ ] **Step 5: Run the guards and the full suite**

Run: `npx vitest run --config vitest.config.ts src/lib/designScale.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS. **If a component test fails here, read it before editing it.**
A test asserting `text-meta` on a heading is asserting the old voice and should
move to `sectionLabel`; a test asserting on visible TEXT should not need to
change at all, and if it does, the conversion changed markup it should not have.

- [ ] **Step 6: Commit**

```bash
npx tsc -b
git add src/components/sectionLabel.ts src/views src/components src/lib/designScale.test.ts
git commit -m "$(cat <<'MSG'
feat(design): the section label becomes an instrument legend, from one file

`text-meta font-semibold text-muted` was hand-copied at 36 sites, which is
how a voice drifts. It lives in `components/sectionLabel.ts` now, the way
button classes already live in `dialogStyles.ts`, so the next change to it is
one line rather than thirty-one.

Five of those 36 are not section labels and keep the old classes written out:
two buttons carrying hover states, two sticky row labels in Timeline's left
column, and the "Focus" caption beside its control. They shared the string by
coincidence, not by role.

The label also gets quieter, not louder — 10.08px semibold sentence case to
8.75px medium uppercase — so it recedes behind the content it introduces while
becoming more distinct from it. The `uppercase` guard now tests a RULE rather
than a file list: uppercase must travel with font-mono, or be a weekday strip.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: CLAUDE.md

Four bullets describe a palette that no longer exists. Leaving them is worse
than never having written them: they are the file the next session reads first.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "Visual identity is locked" bullet**

Find this exact run of text inside that bullet:

> It also pins the two remaster type rules: `font-disp` (Fraunces) appears
> exactly once, on the wordmark, and all-caps is reserved for the three weekday
> strips. A section label is `text-meta font-semibold text-muted` — sentence
> case, UI face.

Replace it with:

> It also pins the type roles. **`font-disp` (Fraunces) is display-only** and
> reaches exactly three places: the wordmark, `TaskPage`'s own title, and
> headings typed inside a note (`.note-prose > div > h1/h2/h3`). The guard sees
> only the first two — it scans `.tsx`/`.ts`, and the third lives in
> `index.css` — so a reader taking its allowlist as the whole story will
> undercount by one. **All-caps travels with `font-mono`**, or is one of the
> three weekday strips; uppercase in the UI face is a build failure. **A section
> label is `sectionLabel`** from `components/sectionLabel.ts` — mono, uppercase,
> `text-micro`, `tracking-[.11em]` — and it is a constant precisely because that
> string was hand-copied at 36 sites before it was one. Five sites that share
> the old class string are NOT labels (two buttons, two Timeline row labels,
> `AssistantSurface`'s "Focus" caption) and keep it written out.

Also, in the same bullet, the radius list becomes `[4px]`, `[6px]`,
`rounded-field` (8px), `rounded-card` (12px) — `[11px]` is gone.

- [ ] **Step 2: Update the dark-theme description**

Any bullet describing the dark theme as OLED / pure black is now wrong. State
that dark is warm charcoal (`#141311` page, `#1E1D1B` panel), that this was
chosen over OLED black for identity coherence, and that **the panel's luminance
is what sets the project-hue band** — the coupling a future editor is most
likely to break by saturating those six again.

- [ ] **Step 3: Add the palette-guard bullet**

Add one bullet stating that `paletteContrast.test.ts` asserts every ratio the
tokens claim, in both themes, and that the ratios in `index.css` comments are
therefore claims rather than notes.

- [ ] **Step 4: Verify and commit**

Run: `grep -n "OLED\|terracotta\|C04E2D\|FAF9F7\|11px\|sentence case" CLAUDE.md`
Expected: no surviving reference to the old identity.

```bash
git add CLAUDE.md
git commit -m "$(cat <<'MSG'
docs: CLAUDE.md describes Stone, and names the coupling that will break first

Four bullets described the warm-paper identity, the terracotta accent, the
OLED dark theme and a sentence-case section label. None of those exist now,
and this is the file the next session reads first.

The bullet worth reading twice is the dark one: the panel's luminance is what
sets the band the six project hues may occupy. A future editor's instinct on
seeing pastel rails will be to saturate them, and that is a build failure
rather than a matter of taste.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

### Task 10 (optional, deferred): delete the aliases

**Do not start this until the result of Tasks 1–9 has been seen on screen and
approved.** It is mechanical, has no visual effect, and exists only to stop the
config carrying six keys indistinguishable from their neighbours.

**Files:**
- Modify: `tailwind.config.js` (`fontSize`)
- Modify: ~26 call sites

- [ ] **Step 1: Enumerate the call sites**

```bash
grep -rn "text-eyebrow\|text-tiny\|text-kbd\|text-badge\|text-compact\|text-h3" src/ | grep -v "\.test\."
```

Expected roughly: `text-tiny` ×9, `text-badge` ×7, `text-kbd` ×5, `text-eyebrow`
×2, `text-compact` ×2, `text-h3` ×1 (in `index.css`, on `.note-prose h3`).

- [ ] **Step 2: Substitute each alias for its survivor**

`text-eyebrow` → `text-micro`; `text-tiny`, `text-kbd`, `text-badge` →
`text-meta`; `text-compact` → `text-ui`; `text-h3` → `text-title`.

These are value-identical after Task 5, so **nothing may move by a pixel**. If
something does, an alias was given the wrong survivor.

- [ ] **Step 3: Delete the six keys from `tailwind.config.js`**

Remove `eyebrow`, `tiny`, `kbd`, `badge`, `compact`, `h3` and the "ALIAS"
comments. Update the block comment to say eleven steps with no aliases.

- [ ] **Step 4: Verify nothing references a deleted key**

```bash
grep -rn "text-eyebrow\|text-tiny\|text-kbd\|text-badge\|text-compact\|text-h3" src/
```
Expected: no matches. A missed one produces no class at all — the element falls
back to inherited size, silently.

- [ ] **Step 5: Test, build and commit**

```bash
npm test && npx tsc -b && npm run build
git add tailwind.config.js src/
git commit -m "$(cat <<'MSG'
refactor(design): delete the six alias type keys

They held their survivor's value so the scale could collapse without moving a
call site. Nothing renders differently — the substitutions are value-identical
— and the config stops carrying six keys indistinguishable from the ones
beside them, which is the exact "no system here" signal the scale was
introduced to kill.

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
)"
```

---

## Verification before calling this done

- [ ] `npm test` passes — including `paletteContrast`, `projectColour`,
      `designScale` and every component suite
- [ ] `npx tsc -b` is clean
- [ ] `npm run build` succeeds
- [ ] `npm run app:dev` — check **both themes**, toggling with the existing
      control, on: Today, Plan (week grid, with blocks from ≥3 projects),
      Goals board, a goal's Steps tab, a TaskPage with a note, the command
      palette, a modal, and the assistant shelf
- [ ] `grep -rn "fonts.googleapis\|fonts.gstatic" src/ index.html` → no matches
- [ ] No horizontal reflow: the backlog rail is still 249px and its rows still
      truncate rather than wrap
- [ ] The six project rails are distinguishable **from each other** on the dark
      week grid, not merely contrasty against it — the test proves the second
      and cannot prove the first
