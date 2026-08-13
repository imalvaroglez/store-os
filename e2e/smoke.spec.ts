import { test as base, expect, type Page } from "@playwright/test";
import { loginAsFirstAdmin, gotoSantiHome, openCatalog } from "./helpers";

// Real end-to-end smoke against the Firebase Emulator. Firebase Auth persists to
// indexedDB, which Playwright's storageState does NOT capture — so the session
// can't be shared across separate contexts via storageState. Instead, each spec
// file creates ONE browser context in beforeAll, logs in once (wipe + signUp +
// seed), and reuses that same context's page for every test (indexedDB stays
// alive). This keeps the total seed invocations low (seedCloudIfEmpty flakes
// under repeated wipe+seed cycles).

let sharedPage: Page | null = null;
const test = base.extend<{ sharedPage: Page }>({
  sharedPage: async ({}, use) => {
    if (!sharedPage) throw new Error("sharedPage not initialized in beforeAll");
    await use(sharedPage);
  },
});

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  sharedPage = await ctx.newPage();
  await loginAsFirstAdmin(sharedPage, "smoke");
});

test.afterAll(async () => {
  await sharedPage?.context().close();
  sharedPage = null;
});

test("home renders seeded store with primary action", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
  await expect(page.getByText("¿Qué necesitas hacer hoy en Santi?")).toBeVisible();
  await expect(page.getByRole("button", { name: /Nuevo pedido/ })).toBeVisible();
});

test("store isolation: Santi product never appears on Joyería catalog", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await openCatalog(page);
  // Switch Santi -> Joyería via the in-app switcher.
  await page.locator("header button, aside button").filter({ hasText: "▾" }).filter({ visible: true }).first().click();
  await page.getByText("Joyería", { exact: true }).first().click();
  await page.waitForTimeout(500);
  await expect(page.getByText("Cadena de plata 925").first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Tenis Jordan 1 Retro")).toHaveCount(0);
});

test("create a customer via the sheet form", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  const name = `Cliente E2E ${Date.now()}`;
  await page.getByRole("button", { name: "Clientes" }).click();
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await expect(page.getByRole("heading", { name: "Agregar cliente" })).toBeVisible();
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill(name);
  await page.getByLabel("Teléfono").fill("5500000000");
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByText(name)).toBeVisible();
});

test("create a product and it appears in the catalog", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  const name = `Producto E2E ${Date.now()}`;
  await openCatalog(page);
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill(name);
  await page.getByLabel("Precio de venta").fill("999");
  // Publish validation requires a primary category. Santi has seeded categories
  // (Perfumes/Tenis/Gorras) after migration; pick one to satisfy it.
  await page.getByLabel(/Perfumes|Tenis|Gorras/).first().check();
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByText(name)).toBeVisible();
});

test("create an order and advance its status", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.getByRole("button", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: "+ Nuevo" }).click();
  await page.getByRole("combobox", { name: "Cliente" }).selectOption({ index: 1 });
  await page.getByRole("combobox", { name: "Producto" }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Guardar pedido" }).click();

  // The new order lands at "Preguntó"; the next-action button shows the NEXT
  // status's label (Confirmado / Comprar / Comprado / Llegó / Entregado / Cobrado).
  const advance = page
    .getByRole("button", { name: /^(Confirmado|Comprar|Comprado|Llegó|Entregado|Cobrado)$/ })
    .first();
  await expect(advance).toBeVisible();
  await advance.click();
  await page.waitForTimeout(200);

  // Persistence: gotoSantiHome reloads + normalizes; return to Pedidos.
  await gotoSantiHome(page);
  await page.getByRole("button", { name: "Pedidos" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
  await expect(page.locator("h3").first()).toBeVisible();
});

test("data persists across a full reload", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  const name = `Persistente E2E ${Date.now()}`;
  await openCatalog(page);
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill(name);
  await page.getByLabel("Precio de venta").fill("100");
  await page.getByLabel(/Perfumes|Tenis|Gorras/).first().check();
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByText(name)).toBeVisible();
  // Give the cloud write (saveEntity -> Firestore) a moment to become durable.
  await page.waitForTimeout(1500);
  // gotoSantiHome reloads to "/" + normalizes activeStore to Santi + Inicio.
  await gotoSantiHome(page);
  await openCatalog(page);
  await expect(page.getByText(name)).toBeVisible({ timeout: 15000 });
});

// The "public catalog shows only public products" scenario (originally in the
// local-demo smoke) is covered by public-catalog.spec against the emulator with a
// deterministic REST seed. Removed from smoke because the app-side public
// projection write (seedCloudIfEmpty -> projectPublicForStore) races under the
// emulator and the anonymous visit intermittently hits "Tienda no encontrada".
// public-catalog.spec is the authoritative cover for that surface.

test("mobile viewport: no horizontal scroll, primary button on-screen", async ({ sharedPage: page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-geometry assertion");
  await gotoSantiHome(page);
  const scrollX = await page.evaluate(() => window.scrollX);
  expect(scrollX).toBe(0);
  const box = await page.getByRole("button", { name: /Nuevo pedido/ }).boundingBox();
  expect(box).toBeTruthy();
  expect(box!.x + box!.width).toBeLessThanOrEqual(392);
});
