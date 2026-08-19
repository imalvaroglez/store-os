import { test, expect, type Page } from "@playwright/test";
import { servePreview } from "./refresh-server";
import { killEmulatorBanner, loginAsFirstAdmin, openCatalog, writeEmulatorDoc } from "./helpers";

// The executable closure criterion for the refresh-hard-reload spec: a browser
// that lived through a "deploy" (same URL, new build marker) must show the new
// version + fresh data on a plain reload and on a hard reload. Each test plays
// the full cycle: serve build A → load (SW installs) → swap the server to
// build B on the SAME port ("deploy") → reload → assert marker B.

const MARKER_A = "refresh-a";
const MARKER_B = "refresh-b";
const MARKER_CLOUD = "refresh-c";

async function buildMarker(page: Page) {
  return page.locator("[data-build-marker]").getAttribute("data-build-marker");
}

async function expectAppLoaded(page: Page, expectedMarker: string) {
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  expect(await buildMarker(page)).toBe(expectedMarker);
}

test("SW installs on build A; normal reload after a deploy serves build B", async ({ page }) => {
  const stopA = await servePreview("dist-a");
  try {
    await page.goto("/");
    await expectAppLoaded(page, MARKER_A);
    // The service worker must actually control the page — that's the cache the
    // stale-report was blamed on.
    const swUrl = await page.evaluate(() =>
      navigator.serviceWorker.ready.then((r) => r.active?.scriptURL ?? "")
    );
    expect(swUrl).toContain("/sw.js");
  } finally {
    await stopA();
  }

  // "Deploy": same URL, new build. Reload (plain, no cache tricks).
  const stopB = await servePreview("dist-b");
  try {
    await page.reload();
    await expectAppLoaded(page, MARKER_B);
  } finally {
    await stopB();
  }
});

test("tab left open across a deploy reloads to build B", async ({ page }) => {
  const stopA = await servePreview("dist-a");
  try {
    await page.goto("/");
    await expectAppLoaded(page, MARKER_A);
  } finally {
    await stopA();
  }

  // The tab stays open while the "deploy" happens; before reloading it still
  // shows the old build (expected — no live reload claim), then a plain reload
  // must land on B.
  const stopB = await servePreview("dist-b");
  try {
    expect(await buildMarker(page)).toBe(MARKER_A);
    await page.reload();
    await expectAppLoaded(page, MARKER_B);
  } finally {
    await stopB();
  }
});

test("hard reload (cache bypass) after a deploy serves build B", async ({ page }) => {
  const stopA = await servePreview("dist-a");
  try {
    await page.goto("/");
    await expectAppLoaded(page, MARKER_A);
  } finally {
    await stopA();
  }

  const stopB = await servePreview("dist-b");
  try {
    // CDP hard reload = browser "Empty Cache and Hard Reload".
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.reload", { ignoreCache: true });
    await page.waitForLoadState("domcontentloaded");
    await expectAppLoaded(page, MARKER_B);
  } finally {
    await stopB();
  }
});

test("cloud: session survives reload and fresh data appears (emulator)", async ({ page }) => {
  // The admin bootstrap (wipe + signup + full fixture seed + catalog wait) is
  // expensive on its own; give the whole cycle room beyond the 90s default.
  test.setTimeout(180_000);
  const stop = await servePreview("dist-cloud");
  try {
    // Wipes the emulator, signs up the allow-listed admin, seeds Santi, ends at Inicio.
    await loginAsFirstAdmin(page, "refresh");
    expect(await buildMarker(page)).toBe(MARKER_CLOUD);

    // Data lands "between deploys" (here: mid-session, straight to Firestore).
    // Seeded into Joyería (stores[0]) — the deterministic active store after a
    // cloud reload — with its inventory-tiered shape so the catalog lists it.
    const FRESH = "Producto Refresh E2E";
    const now = Date.now();
    await writeEmulatorDoc("products", `prod_refresh_${now}`, {
      id: `prod_refresh_${now}`,
      storeId: "store_joyeria",
      name: FRESH,
      category: "jewelry",
      isPublic: true,
      publicDescription: "Dato sembrado entre deploys.",
      cost: 10,
      prices: { retail: 20, wholesale: 15, reseller: 12 },
      quantityOnHand: 5,
      lowStockAt: 2,
      createdAt: now,
      updatedAt: now,
    });

    await page.reload();
    // The Firebase emulator banner re-injects on load and intercepts clicks on
    // small viewports; neutralize it (same as gotoClean does for every helper
    // navigation — a raw reload skips that path).
    await killEmulatorBanner(page);
    // Session persisted (no AuthScreen) and the shell rehydrated.
    await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
    // Fresh data visible without any workaround.
    await openCatalog(page);
    await expect(page.getByText(FRESH)).toBeVisible({ timeout: 20_000 });
  } finally {
    await stop();
  }
});
