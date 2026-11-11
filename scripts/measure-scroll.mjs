// Scroll smoothness probe for the public storefront (1.13.1, #332).
//
// Measures the realistic walkthrough (portada → scroll → categoría → scroll)
// against a LOCAL production build (npm run preview) on the dev catalog.
// For each scenario (desktop/mobile × cold/warm cache) it records, over
// ≥3 runs: dropped frames while scrolling (rAF deltas), long tasks, layout
// shifts, and image requests/bytes. Output: JSON per run + a summary table.
//
// Usage: node scripts/measure-scroll.mjs http://127.0.0.1:4319 out-dir [--cpu=4]
//
// Deliberately dependency-light: uses the repo's own playwright install.

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [, , base_url, outDirArg, ...flags] = process.argv;
if (!base_url || !outDirArg) {
  console.error("usage: node scripts/measure-scroll.mjs <base-url> <out-dir> [--cpu=4]");
  process.exit(1);
}
const cpuThrottle = Number(flags.find((f) => f.startsWith("--cpu="))?.split("=")[1] ?? 0);
const outDir = outDirArg;
mkdirSync(outDir, { recursive: true });

const SCENARIOS = [
  { name: "desktop-cold", viewport: { width: 1280, height: 800 }, mobile: false, warm: false },
  { name: "desktop-warm", viewport: { width: 1280, height: 800 }, mobile: false, warm: true },
  { name: "mobile-cold", viewport: { width: 390, height: 844 }, mobile: true, warm: false },
  { name: "mobile-warm", viewport: { width: 390, height: 844 }, mobile: true, warm: true },
];
const RUNS = 3;

// In-page collector: frame deltas during scroll, long tasks, layout shifts.
const COLLECTOR = `
window.__scrollMetrics = { frames: [], longTasks: [], shifts: [], resources: [] };
(function () {
  let last = performance.now();
  function tick(now) { window.__scrollMetrics.frames.push(now - last); last = now; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__scrollMetrics.longTasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ entryTypes: ["longtask"] });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__scrollMetrics.shifts.push(e.value);
  }).observe({ entryTypes: ["layout-shift"] });
})();
`;

async function scrollPage(page, mobile) {
  if (mobile) {
    // Touch-style scroll: three screens down, back up one. No taps — a tap
    // could land on a product card and navigate away from the catalog.
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" }));
      await page.waitForTimeout(700);
    }
    await page.evaluate(() => window.scrollBy({ top: -window.innerHeight * 0.8, behavior: "smooth" }));
    await page.waitForTimeout(700);
  } else {
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(250);
    }
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(500);
  }
}

async function measure(browser, scenario, run) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    hasTouch: scenario.mobile,
    isMobile: scenario.mobile,
    deviceScaleFactor: scenario.mobile ? 3 : 1,
  });
  const page = await context.newPage();
  if (cpuThrottle) {
    // CPU throttling is CDP-only in Playwright (mobile-class CPUs).
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  }
  if (scenario.warm) {
    // Warm the cache with a plain visit first (no measurement).
    await page.goto(base_url, { waitUntil: "networkidle" }).catch(() => {});
  }
  await page.addInitScript(COLLECTOR);
  await page.goto(base_url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("article", { timeout: 20000 });
  await page.waitForTimeout(600); // settle initial paint
  await scrollPage(page, scenario.mobile);
  const metrics = await page.evaluate(() => {
    const m = window.__scrollMetrics;
    const resources = performance.getEntriesByType("resource")
      .filter((r) => /\.(png|jpe?g|webp|avif)/.test(r.name) || r.name.includes("firebasestorage"))
      .map((r) => ({ url: r.name.split("?")[0].slice(-60), bytes: r.transferSize, cached: r.transferSize === 0 }));
    return {
      frames: m.frames,
      longTasks: m.longTasks,
      cls: m.shifts.reduce((a, b) => a + b, 0),
      imageResources: resources,
    };
  });
  await context.close();

  const frameGaps = metrics.frames.filter((d) => d > 32); // >2 frames at 60fps
  const slowest = Math.max(0, ...metrics.frames);
  const imageBytes = metrics.imageResources.reduce((sum, r) => sum + r.bytes, 0);
  const cachedImages = metrics.imageResources.filter((r) => r.cached).length;
  const scrollTasks = metrics.longTasks.filter((t) => t.duration >= 50);
  return {
    scenario: scenario.name,
    run,
    droppedFrameGaps: frameGaps.length,
    gapsOver100ms: metrics.frames.filter((d) => d > 100).length,
    slowestFrameMs: Math.round(slowest),
    longTasksDuringScroll: scrollTasks.length,
    worstLongTaskMs: Math.round(Math.max(0, ...metrics.longTasks.map((t) => t.duration))),
    cls: Number(metrics.cls.toFixed(4)),
    imageRequests: metrics.imageResources.length,
    imageBytes,
    cachedImages,
    raw: { frames: metrics.frames, longTasks: metrics.longTasks },
  };
}

const browser = await chromium.launch();
const results = [];
for (const scenario of SCENARIOS) {
  for (let run = 1; run <= RUNS; run++) {
    const result = await measure(browser, scenario, run);
    results.push(result);
    writeFileSync(`${outDir}/${scenario.name}-run${run}.json`, JSON.stringify(result, null, 2));
    console.log(
      `${scenario.name} #${run}: gaps>32ms=${result.droppedFrameGaps} gaps>100ms=${result.gapsOver100ms} ` +
      `slowest=${result.slowestFrameMs}ms longTasks=${result.longTasksDuringScroll} ` +
      `worstTask=${result.worstLongTaskMs}ms cls=${result.cls} imgs=${result.imageRequests} (${(result.imageBytes / 1024).toFixed(0)}KB, ${result.cachedImages} cached)`
    );
  }
}
await browser.close();

const summary = {};
for (const scenario of SCENARIOS) {
  const runs = results.filter((r) => r.scenario === scenario.name);
  const avg = (pick) => Math.round(runs.reduce((s, r) => s + pick(r), 0) / runs.length);
  summary[scenario.name] = {
    avgGapsOver32ms: avg((r) => r.droppedFrameGaps),
    avgGapsOver100ms: avg((r) => r.gapsOver100ms),
    avgSlowestFrameMs: avg((r) => r.slowestFrameMs),
    avgLongTasks: avg((r) => r.longTasksDuringScroll),
    avgCls: Number((runs.reduce((s, r) => s + r.cls, 0) / runs.length).toFixed(4)),
    avgImageBytes: avg((r) => r.imageBytes),
    warmCacheHit: runs.every((r) => r.cachedImages > 0),
  };
}
writeFileSync(`${outDir}/summary.json`, JSON.stringify({ baseUrl: base_url, cpuThrottle, summary }, null, 2));
console.log("\nsummary:", JSON.stringify(summary, null, 2));
