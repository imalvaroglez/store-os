import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Contract guard for vercel.json + the public entry's static files. The
// storefront stack (#77 + #81) resolved a real merge conflict on this file by
// UNION — "theirs" silently dropped every security header, "ours" kept
// rewrites pointing at a deleted olivia.html (broken catalog). No CI job
// validates Vercel config, so this test is the only thing standing between a
// bad conflict resolution and production. It runs in npm run test → CI on
// every PR.

const root = resolve(__dirname, "../..");
type VercelConfig = {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const config = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as VercelConfig;

function headerBlock(source: string) {
  return config.headers.find((rule) => rule.source === source)?.headers ?? [];
}

describe("vercel.json — routing contract", () => {
  it("the generic /catalogo rewrite exists and wins over the SPA catch-all", () => {
    const catalogIdx = config.rewrites.findIndex((r) => r.source === "/catalogo/(.*)");
    const catchAllIdx = config.rewrites.findIndex((r) => r.source === "/((?!assets/).*)");
    expect(catalogIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(catalogIdx);
    expect(config.rewrites[catalogIdx].destination).toBe("/public.html");
    expect(config.rewrites[catchAllIdx].destination).toBe("/index.html");
  });

  it("the Olivia-specific rewrites are gone (platform, not per-store hacks)", () => {
    expect(config.rewrites.some((r) => r.source.includes("olivia"))).toBe(false);
  });
});

describe("vercel.json — security headers (do not lose them on conflict resolution)", () => {
  const global = headerBlock("/(.*)");

  it("carries the full hardening set", () => {
    const keys = global.map((h) => h.key);
    for (const key of [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Cross-Origin-Opener-Policy",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy-Report-Only",
    ]) {
      expect(keys, `falta ${key} en el bloque /(.*), ¿se perdió en un merge?`).toContain(key);
    }
  });

  it("CSP stays REPORT-ONLY — never accidentally enforcing", () => {
    const keys = global.map((h) => h.key);
    expect(keys).not.toContain("Content-Security-Policy");
    const csp = global.find((h) => h.key === "Content-Security-Policy-Report-Only")?.value ?? "";
    // The origins the app legitimately needs (Firebase REST/auth/storage).
    expect(csp).toContain("firestore.googleapis.com");
  });

  it("COOP keeps the Google sign-in popup working", () => {
    expect(global.find((h) => h.key === "Cross-Origin-Opener-Policy")?.value).toBe("same-origin-allow-popups");
  });
});

describe("vercel.json — cache contract", () => {
  it("hashed assets are immutable; public images/fonts have a positive lifetime", () => {
    expect(headerBlock("/assets/(.*)").find((h) => h.key === "Cache-Control")?.value).toContain("immutable");
    for (const source of ["/images/(.*)", "/fonts/(.*)"]) {
      const value = headerBlock(source).find((h) => h.key === "Cache-Control")?.value ?? "";
      expect(value, `sin Cache-Control positivo para ${source}`).toMatch(/max-age=[1-9]/);
    }
  });

  it("the no-cache catch-all excludes every static with its own rule", () => {
    const rule = config.headers.find((r) => r.source.startsWith("/((?!assets/"));
    expect(rule, "falta la regla no-cache del catch-all").toBeTruthy();
    const value = rule!.headers[0].value;
    expect(value).toBe("no-cache");
    for (const excluded of [
      "assets/",
      "images/",
      "fonts/",
      "sw\\.js",
      "manifest\\.webmanifest",
      "icon\\.svg",
      "robots\\.txt",
      "llms\\.txt",
      "sitemap\\.xml",
    ]) {
      expect(rule!.source, `la exclusión de ${excluded} se perdió`).toContain(excluded);
    }
  });
});

describe("public entry statics", () => {
  it("public.html exists and olivia.html is gone", () => {
    expect(existsSync(resolve(root, "public.html"))).toBe(true);
    expect(existsSync(resolve(root, "olivia.html")), "olivia.html debe desaparecer (prerender + public.html lo sustituyen)").toBe(false);
  });

  it("well-known files are real (they must win over the SPA rewrite)", () => {
    for (const file of ["robots.txt", "llms.txt", "sitemap.xml"]) {
      expect(existsSync(resolve(root, "public", file)), `falta public/${file}`).toBe(true);
    }
  });
});
