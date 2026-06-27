import type { Theme } from "./types";

// Paper Ledger — the current default. Reproduces today's exact tokens so the
// existing look is a pixel-identical regression baseline. Warm paper, ink type,
// terracotta/forest/rose accents, Fraunces serif money, soft radii + shadows,
// calm motion.

export const paper: Theme = {
  id: "paper",
  name: "Paper Ledger",
  blurb: "Cálido y tranquilo. Como una libreta.",
  vars: {
    "--paper": "#f6f1e7",
    "--paper-2": "#efe7d6",
    "--ink": "#1c1917",
    "--ink-soft": "#57534e",
    "--rule": "#e0d6c0",
    "--terracotta": "#c2410c",
    "--terracotta-soft": "#fde7d7",
    "--forest": "#15803d",
    "--forest-soft": "#dcfce7",
    "--rose": "#be123c",
    "--rose-soft": "#ffe4e6",
    "--surface": "#ffffff",
    "--surface-muted": "#fbf8f1",
    "--surface-2": "#ffffff",
    "--on-surface": "#1c1917",
    "--on-surface-soft": "#57534e",
    "--border": "#e0d6c0",
    "--danger": "#be123c",
    "--success": "#15803d",
    "--on-accent": "#ffffff",
    "--radius-sm": "0.5rem",
    "--radius-md": "0.75rem",
    "--radius-lg": "1rem",
    "--radius-sheet": "1.5rem",
    "--shadow-card": "0 1px 2px 0 rgb(28 25 23 / 0.05), 0 1px 3px 0 rgb(28 25 23 / 0.07)",
    "--shadow-lift": "0 6px 24px -4px rgb(28 25 23 / 0.18)",
    "--label-tracking": "0.12em",
    "--card-tilt": "0deg",
  },
  fonts: {
    body: '"Plus Jakarta Sans", system-ui, sans-serif',
    display: '"Fraunces", Georgia, "Times New Roman", serif',
  },
  motion: {
    fast: "0.15s",
    base: "0.24s",
    slow: "0.32s",
    easeSmooth: "cubic-bezier(0.22, 1, 0.36, 1)",
    easeSpring: "cubic-bezier(0.34, 1.3, 0.64, 1)",
    easeLuxury: "cubic-bezier(0.16, 1, 0.3, 1)",
    keyframes: {
      slideUp: "from { transform: translateY(100%); } to { transform: translateY(0); }",
      fadeIn: "from { opacity: 0; } to { opacity: 1; }",
      riseIn: "from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); }",
    },
  },
};
