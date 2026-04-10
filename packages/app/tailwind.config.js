/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ss: {
          primary:          '#4ba1e2',
          'primary-dark':   '#348bc1',
          'primary-light':  '#6abcef',
          secondary:        '#e2b06f',
          'secondary-dark': '#c69152',
          'secondary-light':'#f9cc95',
          success:          '#28af62',
          error:            '#cc5662',
          grey:             '#494949',
          'dark-1':         '#363636',
          'dark-2':         '#282828',
          'dark-3':         '#181818',
          'text-1':         '#eeeeee',
          'text-2':         '#888888',
          border:           '#494949',
        },
      },
      fontFamily: {
        sans: ['Open Sans', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
