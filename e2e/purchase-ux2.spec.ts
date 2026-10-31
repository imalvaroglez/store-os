import { test as base, expect, type Page } from "@playwright/test";
import { adminToken, FIRESTORE_REST, ensureStoreActive, gotoClean, loginAsFirstAdmin, writeEmulatorDoc } from "./helpers";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ADMIN_EMAIL as _ADMIN } from "./helpers";

// purchase-ux2-fast-receive: review flow against the Firebase Emulator with a
// seeded 50-line purchase (NO Tesseract in e2e — the OCR pipeline has its own
// unit suite against the real fixture).

let sharedPage: Page | null = null;
const test = base.extend<{ sharedPage: Page }>({
  sharedPage: async ({}, use) => {
    if (!sharedPage) throw new Error("sharedPage not initialized in beforeAll");
    await use(sharedPage);
  },
});

const LINES = Array.from({ length: 50 }, (_, i) => ({
  productId: "",
  name: `Pieza sembrada ${i + 1}`,
  variant: i % 2 === 0 ? "Dorado" : "",
  quantity: 1,
  unitCost: 0,
  sourceAmount: 20 + i,
  sourceAmountType: "unknown",
  matchStatus: "unmatched",
}));

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  sharedPage = await ctx.newPage();
  await loginAsFirstAdmin(sharedPage);
  // Seed the 50-line draft AFTER login so the cloud listener already ran; the
  // onSnapshot picks it up live.
  const total = LINES.reduce((s, l) => s + (l.sourceAmount ?? 0), 0);
  await writeEmulatorDoc("purchases", "ux2_seed", {
    storeId: "store_joyeria",
    supplierName: "Colore",
    supplierOrder: "3023",
    origin: "pdf",
    date: "2026-08-19",
    dateInferred: true,
    lines: LINES,
    subtotal: 0,
    totalConfirmed: total,
    discount: 0,
    shipping: 0,
    tax: 0,
    status: "draft",
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-19T00:00:00Z",
  });
});

test.afterAll(async () => {
  await sharedPage?.context().close();
  sharedPage = null;
});

test("manual purchase keeps decimals and cost through search, save, themes and receipt", async ({ sharedPage: page }) => {
  test.setTimeout(90_000);
  await writeEmulatorDoc("products", "showcase_decimal_ring", {
    storeId: "store_joyeria", name: "Anillo de prueba decimal", sku: "QA-DECIMAL",
    cost: 99, quantityOnHand: 3, category: "jewelry", isPublic: false, status: "draft",
    prices: { t_retail: 150 }, createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z",
  });
  await gotoClean(page, "/productos/compras");
  await ensureStoreActive(page, "Joyería");
  await page.getByRole("button", { name: "+ Nueva compra" }).click();
  await page.getByLabel("Folio del ticket").fill("QA-DECIMALES");
  await page.getByRole("button", { name: "+ Agregar línea" }).click();
  await page.getByLabel("Producto", { exact: true }).fill("Pieza del ticket");
  await page.getByLabel("Cantidad", { exact: true }).fill("4");
  const cost = page.getByLabel("Costo unitario", { exact: true });
  await cost.fill("");
  await cost.pressSequentially("16.45");
  await expect(cost).toHaveValue("16.45");

  const product = page.getByRole("combobox", { name: "Producto en Store OS" });
  await product.fill("QA-DECIMAL");
  await expect(page.getByRole("button", { name: "+ Crear nuevo producto" })).toBeVisible();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: /Anillo de prueba decimal/ }).click();
  await expect(cost).toHaveValue("16.45");
  await expect(page.getByRole("button", { name: "Crear 1 producto", exact: true })).toHaveCount(0);
  await page.getByLabel("Total pagado", { exact: true }).fill("65.80");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador guardado.")).toBeVisible();

  for (const theme of ["paper", "luxury", "maximalist"]) {
    // Theme is a user preference; operational fixtures remain in Firestore.
    await page.evaluate((value) => localStorage.setItem("store_os_theme", value), theme);
    await gotoClean(page, "/productos/compras");
    await ensureStoreActive(page, "Joyería");
    await page.getByText("#QA-DECIMALES", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByLabel("Costo unitario", { exact: true })).toHaveValue("16.45");
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/purchase-${theme}-${width}.png`, fullPage: true });
    }
  }

  await page.getByRole("button", { name: "Recibir mercancía", exact: true }).click();
  await expect(page.getByText(/el inventario se actualizó/)).toBeVisible();
  const { token } = await adminToken("admin@store.os", "password123");
  const response = await fetch(`${FIRESTORE_REST}/products/showcase_decimal_ring`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok).toBe(true);
  const persisted = await response.json();
  expect(Number(persisted.fields.quantityOnHand.integerValue)).toBe(7);
  expect(Number(persisted.fields.cost.doubleValue ?? persisted.fields.cost.integerValue)).toBe(16.45);
  await page.evaluate(() => localStorage.setItem("store_os_theme", "paper"));
});

test("one journey receives two suppliers and distributes 44 pesos over 70 pieces at the latest cost", async ({ sharedPage: page }) => {
  test.setTimeout(90_000);
  await writeEmulatorDoc("products", "trip_ring", {
    storeId: "store_joyeria", name: "Anillo para viaje QA", sku: "QA-TRIP",
    cost: 4, quantityOnHand: 10, category: "jewelry", isPublic: false, status: "draft",
    prices: { t_retail: 50 }, createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z",
  });
  await gotoClean(page, "/productos/compras");
  await ensureStoreActive(page, "Joyería");
  await page.getByRole("button", { name: "+ Nueva compra" }).click();
  await page.getByLabel("Nombre de la compra", { exact: true }).fill("Centro joyero QA");

  for (const [index, supplierName, folio, quantity] of [
    [0, "Proveedor Centro QA", "QA-T-A", 40],
    [1, "Proveedor Sur QA", "QA-T-B", 30],
  ] as const) {
    if (index > 0) await page.getByRole("button", { name: "+ Agregar ticket" }).click();
    await page.getByRole("button", { name: "+ Nuevo proveedor" }).click();
    const supplier = page.getByRole("dialog", { name: "Nuevo proveedor" });
    await supplier.getByLabel("Nombre", { exact: true }).fill(supplierName);
    await supplier.getByRole("button", { name: "Guardar proveedor" }).click();
    await expect(supplier).toHaveCount(0);
    await page.getByLabel("Folio del ticket").fill(folio);
    await page.getByRole("button", { name: "+ Agregar línea" }).click();
    await page.getByLabel("Producto", { exact: true }).nth(index).fill("Anillo del ticket");
    await page.getByLabel("Cantidad", { exact: true }).nth(index).fill(String(quantity));
    await page.getByLabel("Costo unitario", { exact: true }).nth(index).fill("10");
    await page.getByRole("combobox", { name: "Producto en Store OS" }).nth(index).fill("QA-TRIP");
    await page.getByRole("option", { name: /Anillo para viaje QA/ }).click();
    await expect(page.getByRole("button", { name: "Recibir mercancía" })).toBeDisabled();
    await page.getByLabel("Total pagado", { exact: true }).fill(String(quantity * 10));
  }
  await page.getByRole("button", { name: "+ Agregar gasto" }).click();
  await page.getByLabel("Importe", { exact: true }).fill("44");
  await page.getByLabel("Descripción (opcional)").fill("Transporte de ida y vuelta");
  await expect(page.getByText("$744.00", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("$10.63 por pieza", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador guardado.")).toBeVisible();
  await gotoClean(page, "/productos/compras");
  await page.getByRole("heading", { name: "Centro joyero QA", exact: true }).click();
  await expect(page.getByLabel("Ticket que estás capturando").locator("option")).toHaveCount(2);
  await page.getByLabel("Ticket que estás capturando").selectOption({ label: "#QA-T-B · Proveedor Sur QA" });
  await expect(page.getByLabel("Folio del ticket")).toHaveValue("QA-T-B");
  await expect(page.getByLabel("Total pagado", { exact: true })).toHaveValue("300");
  await expect(page.getByRole("button", { name: "Recibir mercancía" })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/purchase-trip-390.png", fullPage: true });
  await page.getByRole("button", { name: "Recibir mercancía" }).click();
  await expect(page.getByText(/el inventario se actualizó/)).toBeVisible();
  const { token } = await adminToken("admin@store.os", "password123");
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetch(`${FIRESTORE_REST}/products/trip_ring`, { headers });
  expect(response.ok).toBe(true);
  const product = await response.json();
  expect(Number(product.fields.quantityOnHand.integerValue)).toBe(80);
  expect(Number(product.fields.cost.doubleValue)).toBeCloseTo(744 / 70, 10);
  const listResponse = await fetch(`${FIRESTORE_REST}/purchases?pageSize=100`, { headers });
  const saved = (await listResponse.json()).documents.find((document: { fields: { name?: { stringValue: string } } }) => document.fields.name?.stringValue === "Centro joyero QA");
  expect(saved.fields.status.stringValue).toBe("received");
  expect(saved.fields.tickets.arrayValue.values).toHaveLength(2);
  const allocations = saved.fields.costAllocations.arrayValue.values;
  expect(allocations.reduce((sum: number, entry: { mapValue: { fields: { sourcingExpenseCents: { integerValue: string } } } }) => sum + Number(entry.mapValue.fields.sourcingExpenseCents.integerValue), 0)).toBe(4400);
  await page.getByRole("heading", { name: "Centro joyero QA", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recibir mercancía" })).toHaveCount(0);
  await page.getByLabel("Ticket que estás revisando").selectOption({ label: "#QA-T-A · Proveedor Centro QA" });
  await expect(page.getByLabel("Folio del ticket")).toHaveValue("QA-T-A");
});

test("create one private product from purchase search and receive it only on confirmation", async ({ sharedPage: page }) => {
  await gotoClean(page, "/productos/compras");
  await ensureStoreActive(page, "Joyería");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "+ Nueva compra" }).click();
  await page.getByLabel("Nombre de la compra", { exact: true }).fill("Producto nuevo QA");
  await page.getByLabel("Folio del ticket").fill("QA-CREAR");
  await page.getByRole("button", { name: "+ Agregar línea" }).click();
  await page.getByLabel("Producto", { exact: true }).fill("Diseño nuevo unitario QA");
  await page.getByLabel("Cantidad", { exact: true }).fill("2");
  await page.getByLabel("Costo unitario", { exact: true }).fill("16.45");
  await page.getByRole("combobox", { name: "Producto en Store OS" }).fill("Diseño nuevo unitario QA");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(0);
  await page.getByRole("button", { name: "+ Crear nuevo producto" }).click();
  const productForm = page.getByRole("dialog", { name: "Nuevo producto" });
  await expect(productForm.getByLabel("Nombre", { exact: true })).toHaveValue("Diseño nuevo unitario QA");
  await expect(productForm.getByLabel("Costo", { exact: true })).toHaveValue("16.45");
  await productForm.getByLabel("Menudeo", { exact: true }).fill("50");
  await productForm.getByRole("button", { name: "Crear producto", exact: true }).click();
  await expect(productForm).toHaveCount(0);
  await expect(page.getByLabel("Costo unitario", { exact: true })).toHaveValue("16.45");
  await page.getByLabel("Total pagado", { exact: true }).fill("32.90");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador guardado.")).toBeVisible();
  const { token } = await adminToken("admin@store.os", "password123");
  const headers = { Authorization: `Bearer ${token}` };
  const purchases = await (await fetch(`${FIRESTORE_REST}/purchases?pageSize=100`, { headers })).json();
  const saved = purchases.documents.find((document: { fields: { name?: { stringValue: string } } }) => document.fields.name?.stringValue === "Producto nuevo QA");
  const productId = saved.fields.lines.arrayValue.values[0].mapValue.fields.productId.stringValue;
  const before = await (await fetch(`${FIRESTORE_REST}/products/${productId}`, { headers })).json();
  expect(Number(before.fields.quantityOnHand?.integerValue ?? before.fields.quantityOnHand?.doubleValue ?? 0)).toBe(0);
  expect(before.fields.isPublic.booleanValue).toBe(false);
  await page.getByRole("button", { name: "Recibir mercancía", exact: true }).click();
  await expect(page.getByText(/el inventario se actualizó/)).toBeVisible();
  const after = await (await fetch(`${FIRESTORE_REST}/products/${productId}`, { headers })).json();
  expect(Number(after.fields.quantityOnHand.integerValue)).toBe(2);
  expect(after.fields.status.stringValue).toBe("draft");
  expect(after.fields.isPublic.booleanValue).toBe(false);
});



test("50-line review: filters, global resolution, bulk create, receive", async ({ sharedPage: page }) => {
  await gotoClean(page, "/productos/compras");
  await ensureStoreActive(page, "Joyería");
  await expect(page.getByText(/50 productos/).first()).toBeVisible({ timeout: 15000 });

  // Open the seeded draft.
  await page.getByText("#3023").first().click();

  // Review table: all 50 rows, the unknown-amount filter chip, block reason.
  await expect(page.getByText("Importes (50)")).toBeVisible();
  await expect(page.getByText(/50 importes sin interpretar/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Recibir mercancía" })).toBeDisabled();
  await expect(page.getByText(/50 líneas tienen importes sin interpretar/)).toBeVisible();

  // Filter shows only the unknown lines.
  await page.getByRole("button", { name: "Importes (50)" }).click();
  const nameInputs = page.locator('input[aria-label="Producto"]');
  await expect(nameInputs.first()).toBeVisible();
  await expect(nameInputs).toHaveCount(50);

  // Global resolution: unitarios → every line gets unitCost = sourceAmount.
  await page.getByRole("button", { name: "Unitarios" }).click();
  await expect(page.getByText("Importes (50)")).toHaveCount(0);
  await expect(page.getByText(/Sin vincular \(50\)/)).toBeVisible();

  // Bulk create the 50 private products (cloud-only).
  await page.getByRole("button", { name: /Crear 50 productos/ }).click();
  await expect(page.getByText(/50 productos creados y vinculados/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Sin vincular/)).toHaveCount(0);

  // Extra costs are kept separate from the supplier total and must persist.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.getByRole("button", { name: "+ Agregar gasto" }).click();
  await expect(page.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Recibir mercancía" })).toBeDisabled();
  await page.getByLabel("Importe").nth(0).fill("44");
  await page.getByLabel("Descripción (opcional)").nth(0).fill("Cuatro camiones");

  await page.getByRole("button", { name: "+ Agregar gasto" }).click();
  await page.getByLabel("Tipo de gasto").nth(1).selectOption("customer_delivery");
  await page.getByLabel("Importe").nth(1).fill("22");
  await page.getByLabel("Descripción (opcional)").nth(1).fill("Traslado a Santa Fe");

  await page.getByRole("button", { name: "+ Agregar gasto" }).click();
  await page.getByLabel("Tipo de gasto").nth(2).selectOption("shared_packaging");
  await page.getByLabel("Importe").nth(2).fill("1");
  await page.getByLabel("Descripción (opcional)").nth(2).fill("Bolsa compartida");
  await page.getByRole("button", { name: "+ Agregar gasto" }).click();
  await page.getByLabel("Tipo de gasto").nth(3).selectOption("other");
  const smallExpenseAmount = page.getByLabel("Importe").nth(3);
  await smallExpenseAmount.focus();
  await smallExpenseAmount.pressSequentially("0.50");
  await expect(smallExpenseAmount).toHaveValue("0.50");
  await page.getByLabel("Descripción (opcional)").nth(3).fill("Cargo adicional");
  await expect(page.getByText("$2,292.50").last()).toBeVisible();
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador guardado.")).toBeVisible();

  await page.getByRole("button", { name: "← Compras" }).click();
  await page.getByText("#3023").first().click();
  await expect(page.getByLabel("Tipo de gasto").nth(0)).toHaveValue("sourcing_transport");
  await expect(page.getByLabel("Descripción (opcional)").nth(0)).toHaveValue("Cuatro camiones");
  await expect(page.getByLabel("Importe").nth(1)).toHaveValue("22.00");
  await expect(page.getByLabel("Importe").nth(3)).toHaveValue("0.50");
  await expect(page.getByRole("button", { name: "Recibir mercancía" })).toBeEnabled();

  // Totals reconcile (totalConfirmed was seeded to Σ sourceAmount) → receive.
  await page.getByRole("button", { name: "Recibir mercancía" }).click();
  await expect(page.getByText(/el inventario se actualizó/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Gastos \$67\.50 · Total \$2,292\.50/)).toBeVisible();
});

// Negative receive paths: a missing product surfaces as a rules read error on a
// null resource, mapped to a friendly message in receivePurchaseTx.
test("receive rejects a purchase whose product does not exist", async ({ sharedPage: page }) => {
  await writeEmulatorDoc("purchases", "ux2_ghost", {
    storeId: "store_joyeria",
    supplierName: "Colore",
    supplierOrder: "7777",
    date: "2026-08-19",
    lines: [{ productId: "does_not_exist", name: "Fantasma", quantity: 1, unitCost: 50 }],
    subtotal: 50,
    totalConfirmed: 50,
    status: "ready",
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-19T00:00:00Z",
  });
  await gotoClean(page, "/productos/compras");
  await ensureStoreActive(page, "Joyería");
  await page.getByText("#7777").first().click();
  await page.getByRole("button", { name: "Recibir mercancía" }).click();
  await expect(page.getByText(/No se encontró el producto/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Recibida")).toHaveCount(0);
});

test("receive rejects a product that belongs to another store", async ({ sharedPage: page }) => {
  await writeEmulatorDoc("purchases", "ux2_xstore", {
    storeId: "store_joyeria",
    supplierName: "Colore",
    supplierOrder: "8888",
    date: "2026-08-19",
    lines: [{ productId: "prod_santi_1", name: "Ajena", quantity: 1, unitCost: 50 }],
    subtotal: 50,
    totalConfirmed: 50,
    status: "ready",
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-19T00:00:00Z",
  });
  await gotoClean(page, "/productos/compras");
  await ensureStoreActive(page, "Joyería");
  await page.getByText("#8888").first().click();
  await page.getByRole("button", { name: "Recibir mercancía" }).click();
  await expect(page.getByText(/pertenece a otra tienda/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Recibida")).toHaveCount(0);
});

test("receive rejects a supplier from another store without changing inventory", async ({ sharedPage: page }) => {
  const { token } = await adminToken("admin@store.os", "password123");
  const headers = { Authorization: `Bearer ${token}` };
  const before = await (await fetch(`${FIRESTORE_REST}/products/prod_joyeria_1`, { headers })).json();
  await writeEmulatorDoc("suppliers", "foreign_supplier", { storeId: "store_santi", name: "Proveedor ajeno", createdAt: "", updatedAt: "" });
  await writeEmulatorDoc("purchases", "foreign_supplier_purchase", {
    storeId: "store_joyeria", name: "Proveedor fuera de tienda QA", date: "2026-10-30", status: "ready", costingMethod: "latest_purchase",
    tickets: [{ id: "foreign_ticket", supplierId: "foreign_supplier", totalConfirmed: 10 }],
    lines: [{ lineId: "foreign_line", ticketId: "foreign_ticket", productId: "prod_joyeria_1", name: "Pieza", quantity: 1, unitCost: 10 }],
    subtotal: 10, totalConfirmed: 10, createdAt: "", updatedAt: "",
  });
  await gotoClean(page, "/productos/compras");
  await ensureStoreActive(page, "Joyería");
  await page.getByRole("heading", { name: "Proveedor fuera de tienda QA" }).click();
  await page.getByRole("button", { name: "Recibir mercancía" }).click();
  await expect(page.getByText("Uno de los proveedores no pertenece a esta tienda.")).toBeVisible();
  const response = await fetch(`${FIRESTORE_REST}/purchases/foreign_supplier_purchase`, { headers: { Authorization: `Bearer ${token}` } });
  const saved = await response.json();
  expect(saved.fields.status.stringValue).toBe("ready");
  expect(saved.fields.receivedAt).toBeUndefined();
  const after = await (await fetch(`${FIRESTORE_REST}/products/prod_joyeria_1`, { headers })).json();
  expect(after.fields.quantityOnHand).toEqual(before.fields.quantityOnHand);
});

test("locked after receive: controls disabled", async ({ sharedPage: page }) => {
  // Deterministic: seed our own already-received purchase instead of relying
  // on the happy-path test's writes surviving sibling tests.
  await writeEmulatorDoc("purchases", "ux2_locked", {
    storeId: "store_joyeria",
    supplierName: "Colore",
    supplierOrder: "9999",
    date: "2026-08-19",
    lines: [{ productId: "", name: "Ya recibida", quantity: 1, unitCost: 10 }],
    subtotal: 10,
    totalConfirmed: 10,
    status: "received",
    receivedAt: "2026-08-20T00:00:00Z",
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
  });
  await gotoClean(page, "/productos/compras");
  await ensureStoreActive(page, "Joyería");
  await page.getByText("#9999").first().click();
  await expect(page.getByText("Recibida").first()).toBeVisible();
  await expect(page.locator('input[aria-label="Producto"]').first()).toBeDisabled();
  await expect(page.locator('input[aria-label="Cantidad"]').first()).toBeDisabled();
  await expect(page.locator('input[aria-label="Costo unitario"]').first()).toBeDisabled();
  await expect(page.getByLabel("Total pagado")).toBeDisabled();
});
