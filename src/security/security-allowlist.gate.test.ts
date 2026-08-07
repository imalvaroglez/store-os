import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import {
  FORBIDDEN_TELEMETRY_PACKAGES,
  FORBIDDEN_TELEMETRY_ROUTES,
  ADMIN_STORE_EXCLUSIONS,
} from "../app/firebase/rules-allowlist";

const SRC_FILES = [
  ...globSync("src/**/*.ts"),
  ...globSync("src/**/*.tsx"),
];

// Exempt: the allow-list source of truth legitimately declares the forbidden
// package names / route strings as literals (it defines the lists this gate
// scans for). It is the trusted normative source, not an offender. Mirrors the
// src/design-system/** self-exemption in design-system-gate.test.ts.
const isExempt = (f: string) =>
  f === "src/app/firebase/rules-allowlist.ts";

describe("security allow-list gate", () => {
  it("no source file imports a forbidden telemetry package", () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      if (isExempt(file)) continue;
      const src = readFileSync(file, "utf8");
      for (const pkg of FORBIDDEN_TELEMETRY_PACKAGES) {
        if (new RegExp(`from\\s+["']${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(src)) {
          offenders.push(`${file}: imports ${pkg}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no source file references a forbidden telemetry route", () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      if (isExempt(file)) continue;
      const src = readFileSync(file, "utf8");
      for (const route of FORBIDDEN_TELEMETRY_ROUTES) {
        if (src.includes(route)) {
          offenders.push(`${file}: references ${route}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("package.json declares no forbidden telemetry dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const offenders = FORBIDDEN_TELEMETRY_PACKAGES.filter((p) => p in all);
    expect(offenders, `forbidden deps present: ${offenders.join(", ")}`).toEqual([]);
  });

  it("AdminStore type excludes business content / PII fields", () => {
    const typesSrc = readFileSync("src/types/index.ts", "utf8");
    // The AdminStore type must exist and must not declare any excluded field.
    const adminStoreBlock = typesSrc.match(/export type AdminStore = \{[\s\S]*?\};/);
    expect(adminStoreBlock, "AdminStore type not found in src/types/index.ts").not.toBeNull();
    for (const excl of ADMIN_STORE_EXCLUSIONS) {
      expect(adminStoreBlock![0], `AdminStore must not include '${excl}'`).not.toContain(excl);
    }
  });
});
