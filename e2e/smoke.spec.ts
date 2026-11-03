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
  await loginAsFirstAdmin(sharedPage);
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
  await expect(page.getByText("Tenis Jordan 1 Retro")).toBeVisible();
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

test("store isolation: an order from another store cannot open by deep link", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.goto("/pedidos/order_joyeria_1", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Pedido no encontrado")).toBeVisible();
  await expect(page.getByText("Cadena de plata 925")).toHaveCount(0);
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
  // getByRole, no getByLabel: el label "Categoría" del catálogo envuelve su <select>
  // y su texto incluye los nombres de las categorías — el rol checkbox evita el falso match.
  await page.getByRole("checkbox", { name: /Perfumes|Tenis|Gorras/ }).first().check();
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByText(name)).toBeVisible();
});

test("create an order and advance its status", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.getByRole("button", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: "+ Nuevo" }).click();
  await expect(page.getByRole("heading", { name: "Nuevo pedido" })).toBeVisible();
  await page.getByLabel("Cliente").fill("María López");
  await page.getByLabel("Producto").fill("Perfume Baccarat Rouge 540");
  await page.getByRole("button", { name: "Guardar pedido" }).click();

  // The new order lands at "Preguntó"; the action starts the quoted state.
  const advance = page
    .getByRole("button", { name: /^(Cotizar|Confirmar|Preparar|Marcar listo|Entregar)$/ })
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

test("order editor uses styled pickers and strict numeric fields", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.goto("/pedidos/nuevo", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  const customer = page.getByRole("combobox", { name: "Cliente", exact: true });
  await customer.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option", { name: /María López/ }).click();
  await expect(customer).toHaveValue("María López");

  const product = page.getByRole("combobox", { name: "Producto", exact: true }).first();
  await product.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option", { name: /Perfume Baccarat Rouge 540/ }).click();
  await expect(product).toHaveValue("Perfume Baccarat Rouge 540");
  await expect(page.locator("datalist")).toHaveCount(0);

  const quantity = page.getByLabel("Cantidad").first();
  await quantity.fill("2a.5");
  await expect(quantity).toHaveValue("25");
  const price = page.getByLabel("Precio unitario").first();
  await price.fill("175a.2.9");
  await expect(price).toHaveValue("175.29");
  const deposit = page.getByLabel("Anticipo");
  await deposit.fill("1000x.5");
  await expect(deposit).toHaveValue("1000.5");
});

test("inline customer creation keeps the order draft", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.goto("/pedidos/nuevo", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.getByLabel("Producto").first().fill("Tenis Jordan 1 Retro");
  await page.getByLabel("Cantidad").first().fill("2");
  await page.getByRole("button", { name: "+ Nuevo cliente" }).click();
  await expect(page.getByRole("heading", { name: "Nuevo cliente" })).toBeVisible();
  const name = `Cliente inline ${Date.now()}`;
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByRole("combobox", { name: "Cliente", exact: true })).toHaveValue(name);
  await expect(page.getByLabel("Cantidad").first()).toHaveValue("2");
  await expect(page.getByLabel("Producto").first()).toHaveValue("Tenis Jordan 1 Retro");
  await page.getByRole("button", { name: "Guardar pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
});

test("create a multi-line order with live totals", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.goto("/pedidos/nuevo", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.getByLabel("Cliente").fill("Carlos Ruiz");
  await page.getByLabel("Producto").first().fill("Perfume Baccarat Rouge 540");

  for (let index = 1; index <= 10; index++) {
    await page.getByRole("button", { name: "+ Agregar línea" }).click();
    const productFields = page.getByLabel("Producto");
    await productFields.first().fill(`Producto especial ${index}`);
    await page.getByLabel("Cantidad").first().fill(String(index + 1));
    await page.getByLabel("Precio unitario").first().fill("100");
  }

  await expect(page.getByText("Piezas").last()).toBeVisible();
  await expect(page.getByText("$8,700").last()).toBeVisible();
  await page.getByLabel("Anticipo").fill("8700");
  await expect(page.getByText("$0").last()).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await page.getByRole("button", { name: "Guardar pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
});

test("orders can be searched and filtered by KPI", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.getByRole("button", { name: "Pedidos" }).click();
  await expect(page.getByRole("button", { name: /Activos/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Pendientes/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Completados/ })).toBeVisible();
  await page.getByRole("button", { name: /Pendientes/ }).click();
  // Seed-backed assertion (order_santi_2: Carlos Ruiz, status "asked" →
  // pending): independent of whether an earlier test created a customer.
  await expect(page.getByRole("heading", { name: /#SANTI2 · Carlos Ruiz/ })).toBeVisible();
  await page.getByLabel("Buscar pedidos").fill("Tenis Jordan");
  await expect(page.getByText(/Tenis Jordan 1 Retro/).first()).toBeVisible();

  const searchBox = await page.getByLabel("Buscar pedidos").boundingBox();
  const firstTitle = await page.locator("h3").first().boundingBox();
  expect(searchBox).toBeTruthy();
  expect(firstTitle).toBeTruthy();
  expect(firstTitle!.y - (searchBox!.y + searchBox!.height)).toBeGreaterThanOrEqual(16);
});

test("data persists across a full reload", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  const name = `Persistente E2E ${Date.now()}`;
  await openCatalog(page);
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill(name);
  await page.getByLabel("Precio de venta").fill("100");
  await page.getByRole("checkbox", { name: /Perfumes|Tenis|Gorras/ }).first().check();
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
// unauthenticated local storage path) is covered by public-catalog.spec against the emulator with a
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

test("reload restores the selected store and its order draft", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.locator("header button, aside button").filter({ hasText: "▾" }).filter({ visible: true }).first().click();
  await page.getByText("Joyería", { exact: true }).first().click();
  await page.getByRole("button", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: "+ Nuevo" }).click();
  await page.getByLabel("Cliente").fill("Ana Torres");
  await page.getByLabel("Producto").first().fill("Cadena de plata 925");
  await page.getByLabel("Cantidad").first().fill("2");
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("store_os_order_draft_v3::") && item.endsWith("::store_joyeria::new"));
    if (!key) return false;
    return JSON.parse(localStorage.getItem(key) || "{}").lines?.[0]?.quantityText === "2";
  })).toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Borrador recuperado")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("header button, aside button").filter({ hasText: "Joyería" }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByLabel("Producto").first()).toHaveValue("Cadena de plata 925");
  await expect(page.getByLabel("Cantidad").first()).toHaveValue("2");
});

test("customer price level applies to new order lines", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.locator("header button, aside button").filter({ hasText: "▾" }).filter({ visible: true }).first().click();
  await page.getByText("Joyería", { exact: true }).first().click();
  await page.getByRole("button", { name: "Clientes" }).click();
  const name = `Precio cliente ${Date.now()}`;
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Tipo de cliente").selectOption("entrepreneur");
  await page.getByRole("combobox", { name: "Nivel de precio", exact: true }).selectOption("t_wholesale");
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole("button", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: "+ Nuevo" }).click();
  // Select the freshly created customer EXPLICITLY from the dropdown instead of
  // relying on the exact-name auto-bind: the customer list arrives via cloud
  // sync, and racing the sync made this test flaky when run after other tests.
  // Clear the restored draft's customer query so the FULL customer list shows
  // (the dropdown filters by the current text), then pick the freshly created
  // customer by partial match — the option's accessible name carries the
  // customer's phone as detail. The auto-waited click also absorbs any delay
  // of the cloud sync delivering the new customer.
  await page.getByLabel("Cliente").fill("");
  await page.getByRole("option", { name: new RegExp(name) }).click();
  // A restored draft of another customer turns this first switch into the
  // confirmation dialog; applying the new customer's prices is the point.
  const switchDialog = page.getByRole("dialog", { name: "Cambiar cliente" });
  if (await switchDialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await switchDialog.getByRole("button", { name: `Aplicar precios de ${name}` }).click();
  }
  await page.getByLabel("Producto").fill("Cadena de plata 925");
  await expect(page.getByLabel("Precio unitario")).toHaveValue("700");
  await page.getByLabel("Precio unitario").fill("650");
  await page.getByLabel("Cliente").fill("Ana Torres");
  const confirmation = page.getByRole("dialog", { name: "Cambiar cliente" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Aplicar precios de Ana Torres" }).click();
  await expect(page.getByLabel("Precio unitario")).toHaveValue("650");
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await page.getByRole("button", { name: "Guardar pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
});

test("review order lines by category and edit a selected line", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.goto("/pedidos/nuevo", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.getByLabel("Cliente").fill("Carlos Ruiz");
  await page.getByLabel("Producto").first().fill("Perfume Baccarat Rouge 540");
  await page.getByRole("button", { name: "+ Agregar línea" }).click();
  // Prepend (#91): the fresh line lands on TOP, so it is FIRST, not last.
  await page.getByLabel("Producto").first().fill("Encargo especial");
  await page.getByLabel("Precio unitario").first().fill("50");
  await page.getByRole("button", { name: "Revisar por categoría" }).click();
  await expect(page.getByRole("heading", { name: "Perfumes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sin categoría" })).toBeVisible();
  await page.getByRole("button", { name: "Editar Encargo especial" }).click();
  await expect(page.getByLabel("Producto").first()).toBeFocused();
  await page.getByRole("button", { name: "Guardar pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
  await page.getByText(/Encargo especial/).first().click();
  await expect(page.getByRole("heading", { name: "Editar pedido", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revisar por categoría" }).click();
  await expect(page.getByRole("heading", { name: "Perfumes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sin categoría" })).toBeVisible();
});
test("copy the saved order detail", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await page.getByRole("button", { name: "Pedidos" }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as any).__copiedOrder = text; } } });
  });
  await page.getByRole("button", { name: "Ver detalle para compartir" }).first().click();
  const detail = page.getByRole("dialog", { name: "Detalle para compartir" });
  await expect(detail.getByLabel("Detalle del pedido")).toHaveValue(/Total: \$/);
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await detail.getByRole("button", { name: "Copiar detalle" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__copiedOrder)).toContain("Saldo:");
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
});
