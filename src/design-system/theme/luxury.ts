import type { Theme } from "./types";

// Luxury — deep black + ivory + gold, fashion serif (Didot/Bodoni), tight radii,
// hairline gold borders, wide letter-spacing, generous space, slow graceful motion.
// Boutique / jewelry feel.

export const luxury: Theme = {
  id: "luxury",
  name: "Lujo",
  blurb: "Negro, oro y serenidad. Boutique.",
  vars: {
    "--paper": "#0b0b0d",
    "--paper-2": "#141417",
    "--ink": "#f5f1e6",
    "--ink-soft": "#a39a82",
    "--rule": "#3a3326",
    "--terracotta": "#c9a14a",
    "--terracotta-soft": "#2a2418",
    "--forest": "#c9a14a",
    "--forest-soft": "#2a2418",
    "--rose": "#b07c5a",
    "--rose-soft": "#2a2418",
    "--surface": "#141417",
    "--surface-muted": "#0f0f12",
    "--radius-sm": "2px",
    "--radius-md": "4px",
    "--radius-lg": "4px",
    "--radius-sheet": "6px",
    "--shadow-card": "0 1px 2px 0 rgb(0 0 0 / 0.4)",
    "--shadow-lift": "0 10px 40px -8px rgb(0 0 0 / 0.6)",
    "--label-tracking": "0.3em",
    "--card-tilt": "0deg",
    "--border-w": "1px",
    "--accent": "#c9a14a",
  },
  fonts: {
    body: '"Inter", system-ui, sans-serif',
    display: '"Didot", "Bodoni MT", "Playfair Display", Georgia, serif',
  },
  motion: {
    fast: "0.3s",
    base: "0.45s",
    slow: "0.6s",
    easeSmooth: "cubic-bezier(0.16, 1, 0.3, 1)",
    easeSpring: "cubic-bezier(0.16, 1, 0.3, 1)",
    easeLuxury: "cubic-bezier(0.16, 1, 0.3, 1)",
    keyframes: {
      slideUp: "from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; }",
      fadeIn: "from { opacity: 0; } to { opacity: 1; }",
      riseIn: "from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); }",
    },
  },
};
