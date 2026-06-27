// Theme system types. A theme is a full personality: colors, typography, radii,
// shadows, AND motion — all driven by tokens so switching a theme restyles
// (and re-feels) the whole app.

export type ThemeId = "paper" | "maximalist" | "luxury";

export type ThemeMotion = {
  /** CSS durations. */
  fast: string;
  base: string;
  slow: string;
  /** Named easings (CSS cubic-bezier strings). */
  easeSmooth: string;
  easeSpring: string;
  easeLuxury: string;
  /** Per-theme @keyframes, keyed by name -> full keyframe body (without the @keyframes wrapper). */
  keyframes?: Record<string, string>;
};

export type Theme = {
  id: ThemeId;
  /** UI label (Spanish-friendly). */
  name: string;
  /** One-line description for the picker. */
  blurb: string;
  /** CSS custom properties applied to :root[data-theme="..."]. */
  vars: Record<string, string>;
  /** Font stacks. */
  fonts: { body: string; display: string };
  /** Motion personality. */
  motion: ThemeMotion;
};
