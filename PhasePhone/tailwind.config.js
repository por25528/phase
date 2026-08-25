/** @type {import('tailwindcss').Config}
 * Copied from PhaseApp's config so the companion speaks the product's
 * language. Tokens are CSS-variable channel triples — light in `:root`, dark
 * under `@media (prefers-color-scheme: dark)`, the same convention PhaseWeb
 * follows: the phone takes the system appearance and offers no in-page
 * toggle, so there is no `.dark` class to keep alive.
 *
 * The token set is the APP's, not the site's, because this project draws the
 * app's own objects — a checkbox at `border-check`, a parked bar in
 * `bg-muted`, a warn tint — and a reduced palette would leave those
 * semantics with nowhere to resolve.
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
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
        track: 'rgb(var(--c-track) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-deep': 'rgb(var(--c-accent-deep) / <alpha-value>)',
        'accent-soft': 'rgb(var(--c-accent-soft) / <alpha-value>)',
        'accent-contrast': 'rgb(var(--c-accent-contrast) / <alpha-value>)',
        'accent-tint': 'rgb(var(--c-accent-tint) / <alpha-value>)',
        paper: 'rgb(var(--c-paper) / <alpha-value>)',
        chip: 'rgb(var(--c-chip) / <alpha-value>)',
        'chip-ink': 'rgb(var(--c-chip-ink) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        'warn-tint': 'rgb(var(--c-warn-tint) / <alpha-value>)',
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
        today: 'var(--shadow-today)',
      },
    },
  },
  plugins: [],
};
