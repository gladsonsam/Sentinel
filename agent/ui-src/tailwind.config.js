/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        primary: "var(--color-primary)",
        muted: "var(--color-muted)",
        accent: "var(--color-accent)",
        ok: "var(--color-ok)",
        danger: "var(--color-danger)",
        warn: "var(--color-warn)",
      },
    },
  },
  plugins: [],
};
