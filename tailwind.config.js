/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#FCFCFB',
        panel: '#FFFFFF',
        ink: '#1A1A1A',
        'ink-soft': '#3C3C3A',
        muted: '#8A8A86',
        faint: '#B6B6B1',
        line: '#ECEBE7',
        'line-2': '#E1E0DB',
        hover: '#F4F3F0',
        fill: '#2C2C2A',
        track: '#EDECE8',
        accent: '#5D6B82',
        'accent-tint': '#EBEEF3',
      },
      borderRadius: {
        card: '7px',
      },
      fontFamily: {
        disp: ['Fraunces', 'Georgia', 'serif'],
        ui: ['Inter', '-apple-system', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
