/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Michroma', 'ui-sans-serif', 'sans-serif'],
        ui: ['"Chakra Petch"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // "Event Horizon" interface palette. The game canvas keeps its own colors.
      colors: {
        hull: {
          950: '#08060f',
          900: '#100d1c',
          850: '#16122a',
          800: '#1d1838',
          700: '#2b2450',
          600: '#3d3470',
          400: '#8e87b8',
          300: '#b9b3da',
          100: '#efeaff',
        },
        flare: { 200: '#ffe2b8', 300: '#ffc98a', 400: '#ffab4d', 500: '#ff8a1f', 600: '#e56a00' },
        nebula: { 300: '#d9b8ff', 400: '#bf8cff', 500: '#9d5cff', 600: '#7c3aed' },
        mint: { 300: '#7cf2c9', 400: '#34e0a1' },
        ember: { 300: '#ff9aa8', 400: '#ff5d73' },
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.08)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        pop: 'pop 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
      },
    },
  },
  plugins: [],
};
