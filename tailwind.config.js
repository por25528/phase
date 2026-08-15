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
      fontSize: {
        root: '14px',      // body base (index.css)
        micro: '.52rem',   // mono eyebrows at their smallest
        eyebrow: '.56rem', // uppercase mono section labels
        tiny: '.6rem',
        kbd: '.62rem',
        // NB: `badge`, not `chip`. `chip` is also a COLOR key, and Tailwind
        // emits both `.text-chip{font-size}` and `.text-chip{color}` — the
        // colour rule wins on order, so every `text-chip` element silently
        // inherited the near-white chip surface colour. That is what made the
        // "Not planned this week" pill invisible on a white card. No fontSize
        // key may share a name with a colour key.
        badge: '.68rem',
        meta: '.72rem',    // counters, dates, secondary metadata
        compact: '.76rem',
        ui: '.8rem',       // default control text
        body: '.84rem',    // default reading text
        lead: '.9rem',
        title: '.98rem',   // row / card titles
        h3: '1.05rem',
        h2: '1.2rem',
        h1: '1.4rem',
        wordmark: '1.5rem',
        // A document's own title. It has to outrank `h1`, because `h1` is what
        // a heading typed INSIDE a note renders at — with the task page's title
        // set to `h2`, a heading in the body came out larger than the name of
        // the thing it was in.
        page: '1.75rem',
      },
      // Corner radii: 4, 6, 11 arbitrary plus `field` (9) and `card` (14).
      borderRadius: {
        card: '14px',
        field: '9px',
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
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
