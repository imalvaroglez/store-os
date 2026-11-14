import { test, expect } from "@playwright/test";

// Exercise the production bundle against synthetic anonymous REST projections.
// No Firebase account, data writes or real storefront are used.
const prices = { regular: 140, girly: 120, iconic: 90 };
const store = {
  storeId: "store_cart_test", slug: "olivia", name: "Olivia", type: "inventory_tiered",
  whatsappPhone: "525500000000", defaultTierId: "regular",
  priceTiers: [
    { id: "regular", label: "Regular", order: 0 },
    { id: "girly", label: "Girly", order: 1, minPieces: 5 },
    { id: "iconic", label: "Iconic", order: 2, minAmount: 1000 },
  ],
};
const product = {
  storeId: store.storeId, storeSlug: store.slug, productSlug: "anillo-prueba",
  name: "Anillo ajustable con corazón de cristal rosa", sku: "TEST-01", prices, stockSignal: "disponible",
};
function wire(value: unknown): unknown {
  if (value == null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(wire) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, wire(v)])) } };
}

test("small cart sends both labeled estimates with the selected pieces", async ({ page }) => {
  const second = {
    ...product, productSlug: "aretes-prueba", name: "Aretes de prueba", sku: "TEST-02",
    prices: { regular: 120, girly: 100, iconic: 80 },
  };
  const products = [product, second];
  await page.route("**/v1/projects/**/documents/**", async route => {
    const data = route.request().url().includes("/publicStores/") ? store
      : { storeId: store.storeId, categories: [], products };
    const encoded = wire(data) as { mapValue: { fields: unknown } };
    await route.fulfill({ json: { fields: encoded.mapValue.fields } });
  });
  await page.addInitScript(products => {
    localStorage.setItem("store-os:cart:olivia", JSON.stringify({
      v: 1, lines: products.map(product => ({ ...product, qty: 1, unitPrices: product.prices })),
    }));
  }, products);
  await page.goto("/catalogo/olivia");
  await page.getByRole("button", { name: "Abrir pedido" }).click();
  const cart = page.getByRole("dialog", { name: "Tu pedido" });
  await expect(cart.getByText("$260.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("$170.00 MXN", { exact: true })).toBeVisible();
  const href = await cart.getByRole("link", { name: "Enviar solicitud por WhatsApp" }).getAttribute("href");
  const text = new URL(href!).searchParams.get("text");
  expect(text).toContain("Subtotal estimado - precio Regular: $260.00 MXN");
  expect(text).toContain("¿Eres Iconic? Subtotal estimado: $170.00 MXN");
});

for (const width of [390, 1280]) {
  test(`cart compares and reaches Iconic, then restores Girly (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/v1/projects/**/documents/**", async route => {
      const url = route.request().url();
      const data = url.includes("/publicStores/") ? store
        : { storeId: store.storeId, categories: [], products: [product] };
      const encoded = wire(data) as { mapValue: { fields: unknown } };
      await route.fulfill({ json: { fields: encoded.mapValue.fields } });
    });
    await page.addInitScript(({ product, prices }) => {
      localStorage.setItem("store-os:cart:olivia", JSON.stringify({
        v: 1, lines: [{ ...product, qty: 10, unitPrices: prices }],
      }));
    }, { product, prices });
    await page.goto("/catalogo/olivia");
    await page.getByRole("button", { name: "Abrir pedido" }).click();
    const cart = page.getByRole("dialog", { name: "Tu pedido" });
    await expect(cart.getByText("Subtotal estimado - precio Girly", { exact: true })).toBeVisible();
    await expect(cart.getByText("$1,200.00 MXN", { exact: true })).toBeVisible();
    await expect(cart.getByText("¿Eres Iconic? Subtotal estimado", { exact: true })).toBeVisible();
    await expect(cart.getByText("$900.00 MXN", { exact: true })).toBeVisible();
    await expect(cart.getByText(/Te faltan \$100.00 a precio Iconic/)).toBeVisible();
    const add = cart.getByRole("button", { name: `Sumar una pieza de ${product.name}` });
    await add.click();
    await expect(cart.getByText(/Te faltan \$10.00 a precio Iconic/)).toBeVisible();
    await add.click();
    await expect(cart.getByText("Subtotal estimado - precio Iconic", { exact: true })).toBeVisible();
    await expect(cart.getByText("Subtotal estimado - precio Girly", { exact: true })).toHaveCount(0);
    await expect(cart.getByText("$1,080.00 MXN", { exact: true })).toBeVisible();
    await expect(cart.getByText(/Te faltan/)).toHaveCount(0);
    const row = cart.getByRole("listitem");
    await expect(row.getByText("$90.00", { exact: true })).toBeVisible();
    await expect(row.getByText("$1,080.00", { exact: true })).toBeVisible();
    const href = await cart.getByRole("link", { name: "Enviar solicitud por WhatsApp" }).getAttribute("href");
    expect(new URL(href!).searchParams.get("text")).toContain("Subtotal estimado - precio Iconic: $1,080.00 MXN");
    await cart.getByRole("button", { name: `Restar una pieza de ${product.name}` }).click();
    await expect(cart.getByText("Subtotal estimado - precio Girly", { exact: true })).toBeVisible();
    await expect(cart.getByText("$990.00 MXN", { exact: true })).toBeVisible();
    await expect(cart.getByText(/Te faltan \$10.00 a precio Iconic/)).toBeVisible();
    expect(await cart.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

// #420 — the PO's exact necklace cases: Regular $150, Girly $100 (5 pieces),
// Iconic $70, Iconic minimum $1,000 at Iconic prices.
const collarPrices = { regular: 150, girly: 100, iconic: 70 };
const collarProduct = {
  ...product, productSlug: "collar-prueba", name: "Collar de prueba", sku: "COLLAR-01",
};
test("collar del PO: 4 → 5 piezas cruza a Girly con la fila Iconic visible", async ({ page }) => {
  await page.route("**/v1/projects/**/documents/**", async route => {
    const url = route.request().url();
    const data = url.includes("/publicStores/") ? store
      : { storeId: store.storeId, categories: [], products: [{ ...collarProduct, prices: collarPrices }] };
    const encoded = wire(data) as { mapValue: { fields: unknown } };
    await route.fulfill({ json: { fields: encoded.mapValue.fields } });
  });
  await page.addInitScript(({ collarProduct, collarPrices }) => {
    localStorage.setItem("store-os:cart:olivia", JSON.stringify({
      v: 1, lines: [{ ...collarProduct, qty: 4, unitPrices: collarPrices }],
    }));
  }, { collarProduct, collarPrices });
  await page.goto("/catalogo/olivia");
  await page.getByRole("button", { name: "Abrir pedido" }).click();
  const cart = page.getByRole("dialog", { name: "Tu pedido" });
  await expect(cart.getByText("Subtotal estimado - precio Regular", { exact: true })).toBeVisible();
  await expect(cart.getByText("$600.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("¿Eres Iconic? Subtotal estimado", { exact: true })).toBeVisible();
  await expect(cart.getByText("$280.00 MXN", { exact: true })).toBeVisible();
  await cart.getByRole("button", { name: `Sumar una pieza de ${collarProduct.name}` }).click();
  await expect(cart.getByText("Subtotal estimado - precio Girly", { exact: true })).toBeVisible();
  await expect(cart.getByText("$500.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("$350.00 MXN", { exact: true })).toBeVisible();
});

test("collar del PO: 15 piezas a precio Iconic; al quitar una vuelve Girly con $980", async ({ page }) => {
  await page.route("**/v1/projects/**/documents/**", async route => {
    const url = route.request().url();
    const data = url.includes("/publicStores/") ? store
      : { storeId: store.storeId, categories: [], products: [{ ...collarProduct, prices: collarPrices }] };
    const encoded = wire(data) as { mapValue: { fields: unknown } };
    await route.fulfill({ json: { fields: encoded.mapValue.fields } });
  });
  await page.addInitScript(({ collarProduct, collarPrices }) => {
    localStorage.setItem("store-os:cart:olivia", JSON.stringify({
      v: 1, lines: [{ ...collarProduct, qty: 15, unitPrices: collarPrices }],
    }));
  }, { collarProduct, collarPrices });
  await page.goto("/catalogo/olivia");
  await page.getByRole("button", { name: "Abrir pedido" }).click();
  const cart = page.getByRole("dialog", { name: "Tu pedido" });
  await expect(cart.getByText("Subtotal estimado - precio Iconic", { exact: true })).toBeVisible();
  await expect(cart.getByText("$1,050.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText(/¿Eres Iconic\?/)).toHaveCount(0);
  await expect(cart.getByText(/Te faltan/)).toHaveCount(0);
  await expect(cart.getByText("Los precios son estimados. Por WhatsApp confirmamos tu beneficio, disponibilidad, total y entrega. Envío no incluido. Tu selección no reserva las piezas.", { exact: true })).toBeVisible();
  const href = await cart.getByRole("link", { name: "Enviar solicitud por WhatsApp" }).getAttribute("href");
  const text = new URL(href!).searchParams.get("text");
  expect(text).toContain("Subtotal estimado - precio Iconic: $1,050.00 MXN");
  expect(text).not.toContain("¿Eres");
  await cart.getByRole("button", { name: `Restar una pieza de ${collarProduct.name}` }).click();
  await expect(cart.getByText("Subtotal estimado - precio Girly", { exact: true })).toBeVisible();
  await expect(cart.getByText("$1,400.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("¿Eres Iconic? Subtotal estimado", { exact: true })).toBeVisible();
  await expect(cart.getByText("$980.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText(/Te faltan \$20.00 a precio Iconic/)).toBeVisible();
  expect(await cart.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
