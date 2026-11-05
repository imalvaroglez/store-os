// Build-identity contract (#179, review #194 F3): the HTML marker and the
// __BUILD_SHA__ define MUST come from ONE resolution — they can never disagree.
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import viteConfig, { resolveBuildSha } from "../../vite.config";

type MarkerPlugin = { name: string; transformIndexHtml?: (html: string) => string };

function markerPlugin() {
  // Cast to a plain array: vite's Plugin union recurses too deep for TS here.
  const plugins = (viteConfig.plugins ?? []) as unknown as MarkerPlugin[][];
  const flat = ([] as MarkerPlugin[]).concat(...plugins);
  const plugin = flat.find((p) => p && p.name === "store-os-build-marker");
  if (!plugin?.transformIndexHtml) throw new Error("plugin store-os-build-marker no encontrado");
  return plugin;
}

describe("identidad de build compartida (review #194 F3)", () => {
  it("el SHA del pie (__BUILD_SHA__) y el meta x-build salen de la misma resolución", () => {
    const html = markerPlugin().transformIndexHtml!("<html><head></head><body></body></html>");
    const metaSha = /<meta name="x-build" content="([^"]*)"/.exec(html)?.[1];
    const defineSha = JSON.parse((viteConfig.define as Record<string, string>).__BUILD_SHA__);
    // Contrato: en un mismo proceso/entidad de build, ambos marcadores coinciden.
    // El bug original (lógicas separadas) producía pie "dev" + meta con SHA real.
    expect(metaSha).toBe(defineSha);
    expect(metaSha).toBeTruthy();
  });

  it("el meta de versión del HTML coincide con la primera entrada del historial", () => {
    const html = markerPlugin().transformIndexHtml!("<html><head></head><body></body></html>");
    const releases = JSON.parse(readFileSync(resolve(__dirname, "../../src/releases/releases.json"), "utf8")) as {
      version: string;
    }[];
    const metaVersion = /<meta name="store-os-version" content="([^"]*)"/.exec(html)?.[1];
    expect(metaVersion).toBe(releases[0].version);
  });

  it("resolveBuildSha: override explícito gana; sin él y sin producción queda en dev", () => {
    expect(resolveBuildSha({ STORE_OS_BUILD_SHA: "abc123" })).toBe("abc123");
    expect(resolveBuildSha({})).toBe("dev");
  });

  it("resolveBuildSha en producción usa el SHA de git del checkout", () => {
    const expected = execSync("git rev-parse --short HEAD").toString().trim();
    expect(resolveBuildSha({ NODE_ENV: "production" })).toBe(expected);
  });
});
