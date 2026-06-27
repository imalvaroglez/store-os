import type { Theme } from "./types";

// Maximalist — loud and punchy. Acid yellow + black + hot red, heavy display
// sans, hard 0 radii, hard offset shadows, tilted cards, uppercase, snappy
// spring/stamp motion. Energetic and unmistakable.

export const maximalist: Theme = {
  id: "maximalist",
  name: "Maximalista",
  blurb: "Fuerte, ruidoso, sin miedo.",
  vars: {
    "--paper": "#fef200",
    "--paper-2": "#fff59a",
    "--ink": "#0a0a0a",
    "--ink-soft": "#0a0a0a",
    "--rule": "#0a0a0a",
    "--terracotta": "#ff2d2d",
    "--terracotta-soft": "#ffe3e3",
    "--forest": "#16a34a",
    "--forest-soft": "#bbf7d0",
    "--rose": "#ff2d2d",
    "--rose-soft": "#ffe3e3",
    "--surface": "#ffffff",
    "--surface-muted": "#fff7b3",
    "--radius-sm": "0px",
    "--radius-md": "0px",
    "--radius-lg": "0px",
    "--radius-sheet": "0px",
    "--shadow-card": "4px 4px 0 #0a0a0a",
    "--shadow-lift": "8px 8px 0 #0a0a0a",
    "--label-tracking": "-0.01em",
    "--card-tilt": "-0.8deg",
    "--border-w": "3px",
  },
  fonts: {
    body: '"Archivo", "Helvetica Neue", system-ui, sans-serif',
    display: '"Archivo Black", "Arial Black", system-ui, sans-serif',
  },
  motion: {
    fast: "0.1s",
    base: "0.14s",
    slow: "0.2s",
    easeSmooth: "cubic-bezier(0.2, 1.4, 0.4, 1)",
    easeSpring: "cubic-bezier(0.2, 1.7, 0.4, 1)",
    easeLuxury: "cubic-bezier(0.2, 1.4, 0.4, 1)",
    keyframes: {
      slideUp: "from { transform: translateY(100%) rotate(-1deg); } to { transform: translateY(0) rotate(0); }",
      fadeIn: "from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); }",
      riseIn: "from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); }",
      stamp: "0% { transform: scale(1.15); } 60% { transform: scale(0.94); } 100% { transform: scale(1); }",
    },
  },
};
