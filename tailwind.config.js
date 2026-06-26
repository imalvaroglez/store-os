/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
      },
      colors: {
        // Paper-ledger palette. Maps 1:1 to the CSS vars in index.css.
        paper: {
          DEFAULT: "#f6f1e7",
          2: "#efe7d6",
        },
        ink: {
          DEFAULT: "#1c1917",
          soft: "#57534e",
        },
        rule: "#e0d6c0",
        terracotta: {
          DEFAULT: "#c2410c",
          soft: "#fde7d7",
        },
        forest: {
          DEFAULT: "#15803d",
          soft: "#dcfce7",
        },
        // Semantic aliases kept for the design-system token map.
        brand: { 50: "#f6f1e7", 100: "#efe7d6", 900: "#1c1917", 950: "#0c0a09" },
        success: { 50: "#dcfce7", 100: "#bbf7d0", 600: "#15803d", 700: "#166534" },
        danger: { 50: "#ffe4e6", 100: "#fecdd3", 600: "#be123c", 700: "#9f1239" },
        warning: { 50: "#fde7d7", 100: "#fed7aa", 500: "#c2410c", 700: "#9a3412" },
      },
      borderRadius: {
        card: "1rem",
        sheet: "1.5rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(28 25 23 / 0.05), 0 1px 3px 0 rgb(28 25 23 / 0.07)",
        lift: "0 6px 24px -4px rgb(28 25 23 / 0.18)",
        inset: "inset 0 0 0 1px rgb(224 214 192 / 0.9)",
      },
    },
  },
  plugins: [],
};
