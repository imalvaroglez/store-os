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

// Files that are part of the design system are NOT scoped (they implement primitives).
const isExempt = (f: string) => f.includes("src/design-system/");

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
});
