/** @type {import('tailwindcss').Config}
 * Copied from PhaseApp's config so the site speaks the product's language.
 * Tokens are CSS-variable channel triples — light in `:root`, dark under
 * `@media (prefers-color-scheme: dark)` (the site follows the system; there
 * is no in-page toggle, so no `.dark` class).
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-soft': 'rgb(var(--c-ink-soft) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        faint: 'rgb(var(--c-faint) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        'line-2': 'rgb(var(--c-line-2) / <alpha-value>)',
        hover: 'rgb(var(--c-hover) / <alpha-value>)',
        chip: 'rgb(var(--c-chip) / <alpha-value>)',
        'chip-ink': 'rgb(var(--c-chip-ink) / <alpha-value>)',
        paper: 'rgb(var(--c-paper) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-contrast': 'rgb(var(--c-accent-contrast) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
      },
      fontSize: {
        root: '14px',
        micro: '.6875rem',
        meta: '.75rem',
        ui: '.8rem',
        body: '.875rem',
        lead: '.95rem',
        title: '1rem',
        h2: '1.15rem',
        h1: '1.4rem',
        wordmark: '1.2rem',
        page: '1.85rem',
        mast: '2.125rem',
      },
      borderRadius: {
        card: '12px',
        field: '8px',
      },
      fontFamily: {
        disp: ['Fraunces Variable', 'Fraunces', 'Georgia', 'serif'],
        ui: ['Public Sans Variable', 'Public Sans', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        shot: 'var(--shadow-shot)',
      },
    },
  },
  plugins: [],
};
