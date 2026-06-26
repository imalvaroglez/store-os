// Design-system tokens. Single source of truth for status colors, radii, spacing.
// "Cuenta Claros" paper-ledger palette. Badge / status UIs read from here so no
// feature file hardcodes color classes.

export type StatusTone =
  | "neutral"
  | "info"
  | "warning"
  | "danger"
  | "success"
  | "accent";

// Badge classes per tone: subtle ledger chip on paper.
export const TONE_BADGE: Record<StatusTone, string> = {
  neutral: "bg-stone-200/70 text-stone-700 ring-1 ring-stone-300/60",
  info: "bg-sky-100 text-sky-800 ring-1 ring-sky-200",
  warning: "bg-terracotta-soft text-terracotta ring-1 ring-terracotta/20",
  danger: "bg-rose-100 text-rose-700 ring-1 ring-rose-200",
  success: "bg-forest-soft text-forest ring-1 ring-forest/20",
  accent: "bg-violet-100 text-violet-700 ring-1 ring-violet-200",
};

// Solid (filled) variant for stronger emphasis.
export const TONE_SOLID: Record<StatusTone, string> = {
  neutral: "bg-stone-800 text-paper",
  info: "bg-sky-600 text-white",
  warning: "bg-terracotta text-paper",
  danger: "bg-rose-600 text-white",
  success: "bg-forest text-paper",
  accent: "bg-violet-600 text-white",
};

// Order status -> tone, used by OrderCard / OrderForm status pills.
export const ORDER_STATUS_TONE: Record<string, StatusTone> = {
  asked: "neutral",
  confirmed: "info",
  to_buy: "warning",
  bought: "accent",
  arrived: "accent",
  delivered: "info",
  paid: "success",
};

export const RADII = {
  sm: "rounded-lg",
  md: "rounded-xl",
  lg: "rounded-2xl",
  xl: "rounded-3xl",
} as const;

export const SPACING = {
  card: "p-4",
  screen: "p-4",
  section: "space-y-3",
} as const;
