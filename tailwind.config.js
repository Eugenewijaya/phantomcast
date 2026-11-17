/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', '"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        studio: {
          bg: '#090C10',
          panel: '#10151E',
          surface: '#161D2A',
          border: '#334155',
          cyan: '#00E5FF',
          emerald: '#34D399',
          amber: '#FBBF24',
          danger: '#F87171',
          text: '#F1F5F9',
          muted: '#94A3B8'
        }
      }
    },
  },
  plugins: [],
};
