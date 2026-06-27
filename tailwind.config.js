/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-body)"],
        display: ["var(--font-display)"],
      },
      colors: {
        // Theme-driven: each maps to a CSS var that ThemeProvider overrides per theme.
        paper: {
          DEFAULT: "var(--paper)",
          2: "var(--paper-2)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          soft: "var(--ink-soft)",
        },
        rule: "var(--rule)",
        terracotta: {
          DEFAULT: "var(--terracotta)",
          soft: "var(--terracotta-soft)",
        },
        forest: {
          DEFAULT: "var(--forest)",
          soft: "var(--forest-soft)",
        },
        rose: {
          DEFAULT: "var(--rose)",
          soft: "var(--rose-soft)",
        },
        accent: "var(--accent, var(--terracotta))",
        surface: {
          DEFAULT: "var(--surface)",
          muted: "var(--surface-muted)",
        },
        // Semantic aliases also follow the theme.
        brand: { 50: "var(--paper)", 100: "var(--paper-2)", 900: "var(--ink)", 950: "var(--ink)" },
        success: { 50: "var(--forest-soft)", 100: "var(--forest-soft)", 600: "var(--forest)", 700: "var(--forest)" },
        danger: { 50: "var(--rose-soft)", 100: "var(--rose-soft)", 600: "var(--rose)", 700: "var(--rose)" },
        warning: { 50: "var(--terracotta-soft)", 100: "var(--terracotta-soft)", 500: "var(--terracotta)", 700: "var(--terracotta)" },
      },
      borderRadius: {
        card: "var(--radius-lg)",
        sheet: "var(--radius-sheet)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-lg)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        lift: "var(--shadow-lift)",
      },
    },
  },
  plugins: [],
};
