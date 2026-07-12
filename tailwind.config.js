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
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        'warn-tint': 'rgb(var(--c-warn-tint) / <alpha-value>)',
      },
      borderRadius: {
        card: '14px',
        field: '9px',
      },
      // Warm rgba drops are invisible on OLED black — theme them too so dark can
      // fall back to a darker drop plus the border-line hairlines cards carry.
      boxShadow: {
        card: 'var(--shadow-card)',
        today: 'var(--shadow-today)',
      },
      fontFamily: {
        disp: ['Fraunces Variable', 'Fraunces', 'Georgia', 'serif'],
        ui: ['Inter Variable', 'Inter', '-apple-system', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
