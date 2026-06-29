/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Marca CampusFix: verd bosc (alineat amb el logo UAB).
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#16a34a',
          600: '#15803d',
          700: '#166534',
          900: '#14532d',
        },
        // Superfície de targetes (substitueix `bg-white`). Variable perquè
        // s'inverteixi en mode fosc sense afectar `text-white` dels botons.
        surface: 'rgb(var(--surface) / <alpha-value>)',
        // Escala de grisos basada en variables CSS. En mode clar té els valors
        // estàndard de Tailwind; en fosc s'inverteix (vegeu global.css). Així
        // totes les utilitats neutres (text-gray-*, bg-gray-*, border-gray-*)
        // s'adapten al tema sense haver d'afegir `dark:` a cada pantalla.
        gray: {
          50: 'rgb(var(--gray-50) / <alpha-value>)',
          100: 'rgb(var(--gray-100) / <alpha-value>)',
          200: 'rgb(var(--gray-200) / <alpha-value>)',
          300: 'rgb(var(--gray-300) / <alpha-value>)',
          400: 'rgb(var(--gray-400) / <alpha-value>)',
          500: 'rgb(var(--gray-500) / <alpha-value>)',
          600: 'rgb(var(--gray-600) / <alpha-value>)',
          700: 'rgb(var(--gray-700) / <alpha-value>)',
          800: 'rgb(var(--gray-800) / <alpha-value>)',
          900: 'rgb(var(--gray-900) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
