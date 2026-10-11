/** Colours come from CSS variables (index.css) so light and dark mode follow the other iSteel apps. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', card: 'var(--card)', ink: 'var(--text)', muted: 'var(--muted)', line: 'var(--line)', field: 'var(--field)',
        brand: 'var(--brand)', accent: 'var(--accent)', soft: 'var(--soft)', onbrand: 'var(--on-brand)', navy: '#011e41',
        bad: 'var(--bad)', badsoft: 'var(--bad-soft)', ok: 'var(--ok)', oksoft: 'var(--ok-soft)', warn: 'var(--warn)', warnsoft: 'var(--warn-soft)',
      },
      fontFamily: { sans: ['"Noto Sans Khmer"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
