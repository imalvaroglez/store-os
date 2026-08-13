#!/usr/bin/env node
// Reproduction harness for the "refresh should work as refresh" bug.
//
// Goal: determine whether a NORMAL reload (no hard reload) serves fresh
// content after the served build changes, when a service worker is registered.
// This is DIAGNOSIS, not a pass/fail gate. It records what happened and prints
// a conclusion; it does not assert success.
//
// Why a script and not a Playwright spec: the experiment must serve TWO
// different builds (A then B) on the SAME origin so the SW and the browser
// cache persist between them. Playwright's webServer fixture serves one build;
// rotating dist/ mid-suite fights the tool. We drive chromium directly.
//
// ponytail: stdlib static server (node:http + node:fs), no new dependency.
// Ceiling: single-origin, no range requests, no gzip — fine for local diagnosis
// against vite's build output. Upgrade to a real static server if we ever need
// that fidelity.
//
// Usage: node scripts/repro-stale.mjs   (or: npm run repro:stale)
// Builds ./dist-a and ./dist-b (reuses them if present; rm to rebuild).

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const PORT = 4319;
const ORIGIN = `http://localhost:${PORT}`;
const ROOT = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function run(cmd) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, encoding: "utf8", env: process.env });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`command failed: ${cmd.join(" ")}`);
  }
  return r;
}

// Bake a marker into the built index.html so the test can tell A from B.
// Injected as <meta name="repro-marker" content="A|B"> right after <head>.
async function bakeMarker(file, marker) {
  const html = await readFile(file, "utf8");
  const next = html.replace(/<head>/i, `<head><meta name="repro-marker" content="${marker}">`);
  if (next === html) throw new Error(`could not inject marker into ${file}`);
  await writeFile(file, next);
}

// Make /sw.js bytes differ between A and B so the browser detects a new SW and
// the update path is actually exercised. Cache name bump + comment tag.
async function bakeSwVersion(file, tag) {
  const sw = await readFile(file, "utf8");
  let next = sw.replace(/store-os-v1/, `store-os-repro-${tag}`);
  if (!next.includes(`repro build ${tag}`)) next = `// repro build ${tag}\n${next}`;
  await writeFile(file, next);
}

async function buildPair() {
  console.log("[repro] building A -> dist-a ...");
  run(["npm", "run", "build"]);
  if (!existsSync(join(ROOT, "dist"))) throw new Error("vite build did not produce ./dist");
  await bakeMarker(join(ROOT, "dist", "index.html"), "A");
  await bakeSwVersion(join(ROOT, "dist", "sw.js"), "A");
  await rm(join(ROOT, "dist-a"), { recursive: true, force: true });
  await cp(join(ROOT, "dist"), join(ROOT, "dist-a"), { recursive: true });

  console.log("[repro] building B -> dist-b ...");
  run(["npm", "run", "build"]);
  await bakeMarker(join(ROOT, "dist", "index.html"), "B");
  await bakeSwVersion(join(ROOT, "dist", "sw.js"), "B");
  await rm(join(ROOT, "dist-b"), { recursive: true, force: true });
  await cp(join(ROOT, "dist"), join(ROOT, "dist-b"), { recursive: true });
}

// Stdlib static server rooted at `dir`. setRoot swaps the served directory
// without restarting (same origin -> SW and cache persist).
function staticServer(initialDir) {
  let dir = initialDir;
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
    if (p === "/") p = "/index.html";
    const full = normalize(join(dir, p));
    if (!full.startsWith(dir)) { res.writeHead(403); res.end("forbidden"); return; }
    try {
      const body = await readFile(full);
      res.writeHead(200, { "Content-Type": MIME[extname(full)] || "application/octet-stream" });
      res.end(body);
    } catch {
      // SPA fallback (matches vercel.json rewrites) so client-side routes resolve.
      try {
        const idx = await readFile(join(dir, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(idx);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    }
  });
  return {
    setRoot: (d) => { dir = d; },
    start: () => new Promise((r) => server.listen(PORT, r)),
    stop: () => new Promise((r) => server.close(r)),
  };
}

async function readState(page) {
  return page.evaluate(() => {
    const markerMeta = document.querySelector('meta[name="repro-marker"]');
    return {
      marker: markerMeta?.getAttribute("content") ?? null,
      bundleScript: document.querySelector('script[src^="/assets/"]')?.getAttribute("src") ?? null,
      controllerUrl: navigator.serviceWorker?.controller?.scriptURL ?? null,
      controllerState: navigator.serviceWorker?.controller?.state ?? null,
    };
  });
}

function logState(label, s) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(s, null, 2));
}

async function main() {
  if (!existsSync(join(ROOT, "dist-a")) || !existsSync(join(ROOT, "dist-b"))) {
    await buildPair();
  } else {
    console.log("[repro] dist-a and dist-b exist; skipping build (rm them to rebuild).");
  }

  const userDataDir = mkdtempSync(join(tmpdir(), "repro-stale-"));
  console.log("[repro] persistent context:", userDataDir);
  const ctx = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const page = await ctx.newPage();

  const srv = staticServer(join(ROOT, "dist-a"));
  await srv.start();
  console.log(`[repro] serving dist-a on ${ORIGIN}`);

  // Step 1: load A, let the SW register + activate + claim.
  await page.goto(ORIGIN, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const stateA = await readState(page);
  logState("STATE A (initial load, dist-a served)", stateA);

  // Step 2: swap to build B on the SAME origin (no server restart).
  srv.setRoot(join(ROOT, "dist-b"));
  console.log("\n[repro] swapped server root to dist-b (same origin, same port).");

  // Step 3: NORMAL reload (no cache bypass) — the crux of the bug.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const stateReload = await readState(page);
  logState("STATE after NORMAL reload (dist-B now served)", stateReload);

  // Step 4: HARD reload for comparison.
  await page.reload({ waitUntil: "networkidle" }, { bypassCache: true });
  await page.waitForTimeout(1000);
  const stateHard = await readState(page);
  logState("STATE after HARD reload (bypass cache)", stateHard);

  // Conclusion.
  console.log("\n================ CONCLUSION ================");
  if (stateReload.marker === "A") {
    console.log("REPRODUCES: a normal reload still served marker A after build B");
    console.log("was swapped in. The SW and/or browser HTTP cache staled the HTML.");
    console.log("The hard-reload result above shows whether only a hard reload");
    console.log("recovers, or whether even that fails.");
  } else if (stateReload.marker === "B") {
    console.log("DOES NOT REPRODUCE locally: a normal reload served marker B once");
    console.log("build B was served. Under vite preview (no HTTP cache, no CDN), the");
    console.log("network-first navigate fetched fresh HTML as expected.");
    console.log("=> The production symptom is most likely Vercel's HTTP/CDN cache on");
    console.log("   index.html, not the SW. The fix (no-cache headers + updateViaCache");
    console.log("   none) targets that; confirm in prod once the domain is live.");
  } else {
    console.log(`INCONCLUSIVE: marker after reload was "${stateReload.marker}".`);
    console.log("Check the bundle script hash and controller state above.");
  }
  console.log("==========================================\n");

  await ctx.close();
  await srv.stop();
  await rm(userDataDir, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
