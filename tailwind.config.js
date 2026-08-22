/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Colors are CSS-variable channel triples (`R G B`) so Tailwind's opacity
      // modifiers (e.g. `bg-ink/40`) keep working via the `<alpha-value>` slot.
      // Light values live in `:root`, dark under `.dark` — see src/index.css.
      colors: {
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        'panel-bright': 'rgb(var(--c-panel-bright) / <alpha-value>)',
        field: 'rgb(var(--c-field) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-hover': 'rgb(var(--c-ink-hover) / <alpha-value>)',
        'ink-soft': 'rgb(var(--c-ink-soft) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        faint: 'rgb(var(--c-faint) / <alpha-value>)',
        'faint-2': 'rgb(var(--c-faint-2) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        'line-2': 'rgb(var(--c-line-2) / <alpha-value>)',
        'line-soft': 'rgb(var(--c-line-soft) / <alpha-value>)',
        check: 'rgb(var(--c-check) / <alpha-value>)',
        hover: 'rgb(var(--c-hover) / <alpha-value>)',
        'hover-deep': 'rgb(var(--c-hover-deep) / <alpha-value>)',
        fill: 'rgb(var(--c-fill) / <alpha-value>)',
        dot: 'rgb(var(--c-dot) / <alpha-value>)',
        'dot-off': 'rgb(var(--c-dot-off) / <alpha-value>)',
        track: 'rgb(var(--c-track) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-deep': 'rgb(var(--c-accent-deep) / <alpha-value>)',
        'accent-soft': 'rgb(var(--c-accent-soft) / <alpha-value>)',
        'accent-contrast': 'rgb(var(--c-accent-contrast) / <alpha-value>)',
        'accent-tint': 'rgb(var(--c-accent-tint) / <alpha-value>)',
        paper: 'rgb(var(--c-paper) / <alpha-value>)',
        chip: 'rgb(var(--c-chip) / <alpha-value>)',
        'chip-ink': 'rgb(var(--c-chip-ink) / <alpha-value>)',
        // One step UP from `chip`, in whichever direction the theme calls up.
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        'warn-tint': 'rgb(var(--c-warn-tint) / <alpha-value>)',
        // Project identity — see index.css for the contrast rationale. No key
        // here may collide with a fontSize key; designScale.test.ts asserts it.
        'proj-0': 'rgb(var(--c-proj-0) / <alpha-value>)',
        'proj-1': 'rgb(var(--c-proj-1) / <alpha-value>)',
        'proj-2': 'rgb(var(--c-proj-2) / <alpha-value>)',
        'proj-3': 'rgb(var(--c-proj-3) / <alpha-value>)',
        'proj-4': 'rgb(var(--c-proj-4) / <alpha-value>)',
        'proj-5': 'rgb(var(--c-proj-5) / <alpha-value>)',
      },
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
        // 11px — mono section labels and eyebrows. Raised from .625rem (10px at
        // the app's 16px html base): ten-pixel type in the dark UI at 1440px is
        // a squint, and this is the app's smallest role, so it sets the floor.
        // Stays a step BELOW `meta` (12px) so the label/metadata hierarchy holds.
        micro: '.6875rem',  // 11px — mono section labels and eyebrows
        eyebrow: '.6875rem', // ALIAS of micro
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
        // The Today masthead, and the top of the scale.
        //
        // `page` is a DOCUMENT's own title — it has to outrank a heading typed
        // inside that document and nothing more. This is a VIEW's masthead on a
        // page that is a measured object: the stamp above it is the app's
        // smallest role (11px) and the greeting is the thing you read from
        // across the desk, so the two ends have to be far enough apart for the
        // range itself to read as composition rather than as drift.
        //
        // Named `mast`, not `display`: the display FACE is Fraunces and is
        // locked to three places, while this step is deliberately set in the UI
        // face. A `text-display` step would read as "use the display face here"
        // to the next person, which is exactly the mistake the font-disp guard
        // exists to catch. `mast` is also free of the colour scale — no
        // fontSize key may collide with one; designScale.test.ts asserts it.
        mast: '2.125rem',   // 34px
      },
      // Corner radii: 4 and 6 inline, plus `field` (8) and `card` (12).
      // Controls rounding LESS than surfaces is deliberate — round 2 rejected
      // swapping them. 11px was a fourth near-duplicate and is gone.
      borderRadius: {
        card: '12px',
        field: '8px',
      },
      // Drops are themed because their COLOUR has to change, not because dark
      // cannot show one: a warm rgba drop over #141311 is invisible, a black
      // one over it is not. The dark values are heavier to compensate for the
      // smaller gap between panel and page.
      boxShadow: {
        card: 'var(--shadow-card)',
        today: 'var(--shadow-today)',
      },
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
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
