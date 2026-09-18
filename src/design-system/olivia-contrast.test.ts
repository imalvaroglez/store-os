import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OLIVIA_BRAND } from "./olivia";

// WCAG 2.x relative luminance + contrast ratio over the Olivia brand tokens.
// The storefront paints text with these pairs (eyebrow, prices, savings, CTA,
// footer notes, tinted rows, badges). They must hold >= 4.5:1 for body text
// so Lighthouse's color-contrast audit stays green.
function luminance(hex: string): number {
  const channels = hex.replace("#", "").match(/.{2}/g)!.map((byte) => parseInt(byte, 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const TEXT_CONTRAST = 4.5;

describe("Olivia brand contrast (WCAG)", () => {
  it("accent works as text on bg, surface and tinted blocks", () => {
    expect(ratio(OLIVIA_BRAND.accent, OLIVIA_BRAND.bg)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(ratio(OLIVIA_BRAND.accent, "#FFFDF9")).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(ratio(OLIVIA_BRAND.accent, OLIVIA_BRAND.accentSoft)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it("ink-soft works as muted text on bg and tinted blocks", () => {
    expect(ratio(OLIVIA_BRAND.inkSoft, OLIVIA_BRAND.bg)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(ratio(OLIVIA_BRAND.inkSoft, OLIVIA_BRAND.accentSoft)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it("surface text on accent buttons passes", () => {
    expect(ratio("#FFFDF9", OLIVIA_BRAND.accent)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });
});

// StoreChrome injects OLIVIA_BRAND as inline --olv-* vars that OVERRIDE the
// olivia.css declarations. If one side changes without the other, the page
// silently renders the stale token while this suite keeps passing brand
// checks. This test pins both sources together.
describe("Olivia token sync (olivia.ts vs olivia.css)", () => {
  const css = readFileSync(resolve(__dirname, "olivia.css"), "utf8");
  const rootBlock = css.match(/\.olivia-root\s*\{([^}]*)/)?.[1] ?? "";

  function cssVar(name: string): string {
    const match = rootBlock.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    return match?.[1]?.toLowerCase() ?? "";
  }

  it("declares the same token values as OLIVIA_BRAND", () => {
    expect(cssVar("olv-accent")).toBe(OLIVIA_BRAND.accent.toLowerCase());
    expect(cssVar("olv-accent-soft")).toBe(OLIVIA_BRAND.accentSoft.toLowerCase());
    expect(cssVar("olv-ink-soft")).toBe(OLIVIA_BRAND.inkSoft.toLowerCase());
  });

  it("remaps --terracotta-soft so admin badges use Olivia's tint, not the theme peach", () => {
    expect(rootBlock).toMatch(/--terracotta-soft:\s*var\(--olv-accent-soft\)/);
  });
});
