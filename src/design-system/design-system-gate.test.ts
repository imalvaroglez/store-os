import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

// Enforcement gate: "route all new UI through the library with no bypassing."
// Fails if any feature/app file renders a raw <button>/<select>/<input>, or imports
// UI primitives from anywhere other than the design-system barrel.
//
// Scope: src/features/** and src/app/**. The design-system itself is allowed to use
// raw elements internally (primitives are built on them). BottomNav/StoreSwitcher
// nav items live inside the DS, so they're exempt.

const SCOPED_FILES = [
  ...globSync("src/features/**/*.tsx"),
  ...globSync("src/app/**/*.tsx"),
];

// Files exempt from the gate:
// - anything in src/design-system/ (primitives are built on raw elements)
// - ErrorBoundary.tsx: a crash fallback that must render even when the design
//   system itself (or its providers) is broken, so it uses a minimal raw button.
const isExempt = (f: string) =>
  f.includes("src/design-system/") || f.endsWith("src/app/ErrorBoundary.tsx");

const RAW_ELEMENT_RE = /<(button|select|input)(\s|>|\/)/;

// Exact exported names of the design-system barrel. Matched as whole identifiers
// (word boundaries) so e.g. `formatMoney` doesn't trip the `Money` component check.
const DS_NAMES = [
  "Button",
  "IconButton",
  "Card",
  "Badge",
  "Money",
  "StatRow",
  "ScreenHeader",
  "EmptyState",
  "Sheet",
  "useEntitySheet",
  "ProductImage",
  "BottomNav",
  "StoreSwitcher",
  "FormField",
  "TextField",
  "TextArea",
  "CheckboxField",
  "SelectField",
  "fieldBase",
];
const DS_NAME_RE = new RegExp(`\\b(${DS_NAMES.join("|")})\\b`);

describe("design-system enforcement gate", () => {
  it("no scoped file imports UI primitives from outside the design system", () => {
    const offenders: string[] = [];
    for (const file of SCOPED_FILES) {
      if (isExempt(file)) continue;
      const src = readFileSync(file, "utf8");
      const importLines = src.match(/^import\s.+$/gm) ?? [];
      for (const line of importLines) {
        // Only consider lines that import a DS primitive by its exact name.
        if (!DS_NAME_RE.test(line)) continue;
        if (!/from\s+["'][^"']*design-system[^"']*["']/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no scoped file renders a raw <button>, <select>, or <input>", () => {
    const offenders: string[] = [];
    for (const file of SCOPED_FILES) {
      if (isExempt(file)) continue;
      const src = readFileSync(file, "utf8");
      if (RAW_ELEMENT_RE.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders, `Raw elements found in: ${offenders.join(", ")}`).toEqual([]);
  });

  // Layout consistency (docs/DESIGN.md): Screen owns the width — one width for
  // every view. The legacy Screen caps must not come back as hand-rolled
  // max-w-* wrappers in features; forms self-limit via max-w-5xl instead.
  // The PUBLIC storefront (OliviaStorefront / PublicCatalogScreen) is a separate
  // customer-facing surface with its own intentional widths — out of scope.
  it("no admin-panel file reintroduces legacy Screen widths (max-w-3xl / max-w-6xl)", () => {
    const offenders: string[] = [];
    for (const file of SCOPED_FILES) {
      if (isExempt(file)) continue;
      if (file.includes("OliviaStorefront") || file.includes("PublicCatalogScreen")) continue;
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(/\bmax-w-(3xl|6xl)\b/g)) {
        offenders.push(`${file}: max-w-${match[1]}`);
      }
    }
    expect(
      offenders,
      `Legacy Screen widths found (see docs/DESIGN.md — forms use max-w-5xl):\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
