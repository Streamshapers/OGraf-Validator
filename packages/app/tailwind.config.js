/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ss: {
          // ── Primary accents ──────────────────────────────────────
          primary:              'rgb(var(--ss-primary) / <alpha-value>)',
          'primary-container':  'rgb(var(--ss-primary-container) / <alpha-value>)',
          'primary-dark':       'rgb(var(--ss-primary-dark) / <alpha-value>)',
          'primary-light':      'rgb(var(--ss-primary-light) / <alpha-value>)',

          // ── Secondary / warning ──────────────────────────────────
          secondary:            'rgb(var(--ss-secondary) / <alpha-value>)',
          'secondary-dark':     'rgb(var(--ss-secondary-dark) / <alpha-value>)',
          'secondary-light':    'rgb(var(--ss-secondary-light) / <alpha-value>)',
          warning:              'rgb(var(--ss-warning) / <alpha-value>)',

          // ── Status ───────────────────────────────────────────────
          success:              'rgb(var(--ss-success) / <alpha-value>)',
          error:                'rgb(var(--ss-error) / <alpha-value>)',
          'error-container':    'rgb(var(--ss-error-container) / <alpha-value>)',
          info:                 'rgb(var(--ss-info) / <alpha-value>)',

          // ── Surface tiers ─────────────────────────────────────────
          'surface-dim':        'rgb(var(--ss-surface-dim) / <alpha-value>)',
          'surface-lowest':     'rgb(var(--ss-surface-lowest) / <alpha-value>)',
          surface:              'rgb(var(--ss-surface) / <alpha-value>)',
          'surface-high':       'rgb(var(--ss-surface-high) / <alpha-value>)',
          'surface-highest':    'rgb(var(--ss-surface-highest) / <alpha-value>)',
          'surface-variant':    'rgb(var(--ss-surface-variant) / <alpha-value>)',

          // ── Legacy aliases ───────────────────────────────────────
          grey:                 'rgb(var(--ss-grey) / <alpha-value>)',
          'dark-1':             'rgb(var(--ss-surface-high) / <alpha-value>)',
          'dark-2':             'rgb(var(--ss-surface) / <alpha-value>)',
          'dark-3':             'rgb(var(--ss-surface-dim) / <alpha-value>)',

          // ── Text ─────────────────────────────────────────────────
          'text-1':             'rgb(var(--ss-on-surface) / <alpha-value>)',
          'on-surface':         'rgb(var(--ss-on-surface) / <alpha-value>)',
          'on-surface-variant': 'rgb(var(--ss-on-surface-variant) / <alpha-value>)',
          'text-2':             'rgb(var(--ss-text-2) / <alpha-value>)',

          // ── Borders ──────────────────────────────────────────────
          border:               'rgb(var(--ss-border) / <alpha-value>)',
          'outline-variant':    'rgb(var(--ss-outline-variant) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans:  ['Open Sans', 'Arial', 'sans-serif'],
        mono:  ['JetBrains Mono', 'Roboto Mono', 'monospace'],
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
      },
      fontSize: {
        'label-sm':    ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.05em' }],
        'body-sm':     ['0.75rem', { lineHeight: '1.125rem' }],
        'title-sm':    ['0.875rem', { lineHeight: '1.25rem', fontWeight: '500' }],
        'headline-sm': ['1.5rem', { lineHeight: '2rem' }],
      },
    },
  },
  plugins: [],
}
