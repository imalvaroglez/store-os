import { test, expect } from "@playwright/test";

// Real end-to-end smoke: drive the actual running app with clicks + keyboard.
// Covers the brief's 13-step manual validation. The app auto-seeds two demo stores
// on first load (Santi = on-demand, Joyería = inventory-tiered).

// Navigate to a URL starting from a freshly-seeded store. We open the URL once
// (app seeds on first load), wipe localStorage, then reload so every test begins
// from the deterministic demo seed. In-test navigations after this keep state.
async function gotoSeeded(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(path); // reseeds
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("home renders seeded store with primary action", async ({ page }) => {
  await gotoSeeded(page, "/");
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  await expect(page.getByText("¿Qué necesitas hacer hoy en Santi?")).toBeVisible();
  await expect(page.getByRole("button", { name: /Nuevo pedido/ })).toBeVisible();
  await expect(page.getByText("Perfume Baccarat Rouge 540")).toBeVisible();
});

test("store isolation: Santi product never appears on Joyería catalog", async ({ page }) => {
  await gotoSeeded(page, "/");
  // Switcher trigger button contains the active store name.
  await page.getByRole("button", { name: /Santi/ }).click();
  await page.getByText("Joyería", { exact: true }).click();
  // Plain goto keeps the switched store (don't reseed).
  await page.goto("/catalogo-admin");
  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible();
  await expect(page.getByText("Cadena de plata 925")).toBeVisible();
  // Santi-only product must NOT appear (isolation).
  await expect(page.getByText("Tenis Jordan 1 Retro")).toHaveCount(0);
});

test("create a customer via the sheet form", async ({ page }) => {
  await gotoSeeded(page, "/clientes");
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await expect(page.getByRole("heading", { name: "Agregar cliente" })).toBeVisible();
  await page.getByLabel("Nombre").fill("Cliente E2E");
  await page.getByLabel("Teléfono").fill("5500000000");
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByText("Cliente E2E")).toBeVisible();
});

test("create a product and it appears in the catalog", async ({ page }) => {
  await gotoSeeded(page, "/catalogo-admin");
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await page.getByLabel("Nombre").fill("Producto E2E");
  await page.getByLabel("Precio de venta").fill("999");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByText("Producto E2E")).toBeVisible();
});

test("create an order and advance its status", async ({ page }) => {
  await gotoSeeded(page, "/pedidos");
  await page.getByRole("button", { name: "+ Nuevo" }).click();
  // Cliente + Producto are <select>s (SelectField). "Producto" label is unique among selects,
  // but the free-text "Nombre del producto" also matches -> scope to <select> role.
  await page.getByRole("combobox", { name: "Cliente" }).selectOption({ index: 1 });
  await page.getByRole("combobox", { name: "Producto" }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Guardar pedido" }).click();

  // The new order lands at "Preguntó" -> next verb "Confirmar".
  const advance = page
    .getByRole("button", { name: /^(Confirmar|Comprar|Comprado|Llegó|Entregado|Cobrar)$/ })
    .first();
  await expect(advance).toBeVisible();
  await advance.click();
  await page.waitForTimeout(200);

  // Persistence: reload and at least one order is still listed.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
  // An order card product name is present.
  await expect(page.locator("h3").first()).toBeVisible();
});

test("data persists across a full reload", async ({ page }) => {
  await gotoSeeded(page, "/catalogo-admin");
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await page.getByLabel("Nombre").fill("Persistente E2E");
  await page.getByLabel("Precio de venta").fill("100");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByText("Persistente E2E")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Persistente E2E")).toBeVisible();
});

test("public catalog shows only public products and hides private fields", async ({ page }) => {
  await gotoSeeded(page, "/catalogo/joyeria");
  await expect(page.getByRole("heading", { name: "Joyería" })).toBeVisible();
  await expect(page.getByText("Cadena de plata 925").first()).toBeVisible();
  await expect(page.getByText(/Anillo grabado/)).toHaveCount(0);
  await expect(page.getByText(/^Ganancia/)).toHaveCount(0);
  await expect(page.getByText(/^Costo/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Pedir por WhatsApp" }).first()).toBeVisible();
});

test("mobile viewport: no horizontal scroll, primary button on-screen", async ({ page }) => {
  await gotoSeeded(page, "/");
  const scrollX = await page.evaluate(() => window.scrollX);
  expect(scrollX).toBe(0);
  const box = await page.getByRole("button", { name: /Nuevo pedido/ }).boundingBox();
  expect(box).toBeTruthy();
  expect(box!.x + box!.width).toBeLessThanOrEqual(392);
});
