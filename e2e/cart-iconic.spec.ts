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
const LEGEND = "Los precios son estimados. Por WhatsApp confirmamos tu beneficio, disponibilidad, total y entrega. Envío no incluido. Tu selección no reserva las piezas.";

test("small cart shows the three tier rows and keeps the WhatsApp estimate format", async ({ page }) => {
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
  await expect(cart.getByText("Piezas totales")).toBeVisible();
  await expect(cart.getByText("Subtotal Regular")).toBeVisible();
  await expect(cart.getByText("Subtotal Girly")).toBeVisible();
  await expect(cart.getByText("Subtotal Iconic")).toBeVisible();
  await expect(cart.getByText("$260.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("$220.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("$170.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText(LEGEND, { exact: true })).toBeVisible();
  const href = await cart.getByRole("link", { name: "Enviar solicitud por WhatsApp" }).getAttribute("href");
  const text = new URL(href!).searchParams.get("text");
  expect(text).toContain("Subtotal estimado - precio Regular: $260.00 MXN");
  expect(text).toContain("¿Eres Iconic? Subtotal estimado: $170.00 MXN");
});

// #442 — Huggies Mezcal Gold: Regular $105, Girly $70 (5 pieces),
// Iconic $45 ($1,000 at Iconic prices). The PO's exact table.
const huggiesPrices = { regular: 105, girly: 70, iconic: 45 };
const huggies = { ...product, productSlug: "huggies-mezcal-gold", name: "Huggies Mezcal Gold", sku: "HMG-01" };
async function seedHuggies(page: import("@playwright/test").Page, qty: number) {
  await page.route("**/v1/projects/**/documents/**", async route => {
    const url = route.request().url();
    const data = url.includes("/publicStores/") ? store
      : { storeId: store.storeId, categories: [], products: [{ ...huggies, prices: huggiesPrices }] };
    const encoded = wire(data) as { mapValue: { fields: unknown } };
    await route.fulfill({ json: { fields: encoded.mapValue.fields } });
  });
  await page.addInitScript(({ huggies, huggiesPrices, qty }) => {
    localStorage.setItem("store-os:cart:olivia", JSON.stringify({
      v: 1, lines: [{ ...huggies, qty, unitPrices: huggiesPrices }],
    }));
  }, { huggies, huggiesPrices, qty });
  await page.goto("/catalogo/olivia");
  await page.getByRole("button", { name: "Abrir pedido" }).click();
  return page.getByRole("dialog", { name: "Tu pedido" });
}

test("Huggies 1 pieza: Regular activa; ayudas de Girly (4 piezas) e Iconic ($955), una a la vez", async ({ page }) => {
  const cart = await seedHuggies(page, 1);
  await expect(cart.locator(".olv-tier-active")).toHaveText(/Subtotal Regular/);
  await expect(cart.getByText("$105.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("$70.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("$45.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("1 pieza", { exact: true })).toBeVisible();
  // Ayuda de piezas para Girly.
  await cart.getByRole("button", { name: "Ayuda sobre Girly" }).click();
  await expect(cart.getByText("Agrega 4 piezas más para desbloquear este precio", { exact: true })).toBeVisible();
  // Ayuda de monto para Iconic — reemplaza a la de Girly (una a la vez).
  await cart.getByRole("button", { name: "Ayuda sobre Iconic" }).click();
  await expect(cart.getByText("Agrega $955 más en productos a precio Iconic para alcanzar los $1,000 y desbloquear este nivel de precios", { exact: true })).toBeVisible();
  await expect(cart.getByText("Agrega 4 piezas más para desbloquear este precio")).toHaveCount(0);
  await expect(cart.getByText(LEGEND, { exact: true })).toBeVisible();
});

test("Huggies 5 piezas: Girly activa y resaltada; Regular tachado; Iconic ayuda con $775", async ({ page }) => {
  const cart = await seedHuggies(page, 5);
  await expect(cart.locator(".olv-tier-active")).toHaveText(/Subtotal Girly/);
  await expect(cart.getByText("$350.00 MXN", { exact: true })).toBeVisible();
  // El importe anterior se tacha; la etiqueta sigue legible.
  const regular = cart.getByText("$525.00 MXN", { exact: true });
  await expect(regular).toBeVisible();
  expect(await regular.evaluate(el => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  await expect(cart.getByText("Subtotal Regular")).toBeVisible();
  // Girly alcanzada: su «?» desaparece; el de Iconic muestra $775.
  await expect(cart.getByRole("button", { name: "Ayuda sobre Girly" })).toHaveCount(0);
  await cart.getByRole("button", { name: "Ayuda sobre Iconic" }).click();
  await expect(cart.getByText(/Agrega \$775 más en productos a precio Iconic/)).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`Huggies 23 → 22 piezas: Iconic activa al mínimo; al quitar una vuelve Girly con ayuda de $10 (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const cart = await seedHuggies(page, 23);
    await expect(cart.locator(".olv-tier-active")).toHaveText(/Subtotal Iconic/);
    await expect(cart.getByText("$1,035.00 MXN", { exact: true })).toBeVisible();
    expect(await cart.getByText("$2,415.00 MXN", { exact: true }).evaluate(el => getComputedStyle(el).textDecorationLine)).toContain("line-through");
    expect(await cart.getByText("$1,610.00 MXN", { exact: true }).evaluate(el => getComputedStyle(el).textDecorationLine)).toContain("line-through");
    await expect(cart.getByRole("button", { name: /Ayuda sobre/ })).toHaveCount(0);
    await expect(cart.getByText(LEGEND, { exact: true })).toBeVisible();
    const href = await cart.getByRole("link", { name: "Enviar solicitud por WhatsApp" }).getAttribute("href");
    const text = new URL(href!).searchParams.get("text");
    expect(text).toContain("Subtotal estimado - precio Iconic: $1,035.00 MXN");
    expect(text).not.toContain("¿Eres");
    await cart.getByRole("button", { name: `Restar una pieza de ${huggies.name}` }).click();
    await expect(cart.locator(".olv-tier-active")).toHaveText(/Subtotal Girly/);
    await expect(cart.getByText("$1,540.00 MXN", { exact: true })).toBeVisible();
    await expect(cart.getByText("$990.00 MXN", { exact: true })).toBeVisible();
    await cart.getByRole("button", { name: "Ayuda sobre Iconic" }).click();
    await expect(cart.getByText(/Agrega \$10 más en productos a precio Iconic/)).toBeVisible();
    expect(await cart.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

// #420 regression lock — the necklace numbers must survive the new rows.
const collarPrices = { regular: 150, girly: 100, iconic: 70 };
const collarProduct = {
  ...product, productSlug: "collar-prueba", name: "Collar de prueba", sku: "COLLAR-01",
};
test("collar del PO: 4 → 5 piezas cruza a Girly con las tres filas visibles", async ({ page }) => {
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
  await expect(cart.locator(".olv-tier-active")).toHaveText(/Subtotal Regular/);
  await expect(cart.getByText("$600.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("$280.00 MXN", { exact: true })).toBeVisible();
  await cart.getByRole("button", { name: `Sumar una pieza de ${collarProduct.name}` }).click();
  await expect(cart.locator(".olv-tier-active")).toHaveText(/Subtotal Girly/);
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
  await expect(cart.locator(".olv-tier-active")).toHaveText(/Subtotal Iconic/);
  await expect(cart.getByText("$1,050.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByRole("button", { name: /Ayuda sobre/ })).toHaveCount(0);
  await expect(cart.getByText(LEGEND, { exact: true })).toBeVisible();
  const href = await cart.getByRole("link", { name: "Enviar solicitud por WhatsApp" }).getAttribute("href");
  const text = new URL(href!).searchParams.get("text");
  expect(text).toContain("Subtotal estimado - precio Iconic: $1,050.00 MXN");
  expect(text).not.toContain("¿Eres");
  await cart.getByRole("button", { name: `Restar una pieza de ${collarProduct.name}` }).click();
  await expect(cart.locator(".olv-tier-active")).toHaveText(/Subtotal Girly/);
  await expect(cart.getByText("$1,400.00 MXN", { exact: true })).toBeVisible();
  await expect(cart.getByText("$980.00 MXN", { exact: true })).toBeVisible();
  await cart.getByRole("button", { name: "Ayuda sobre Iconic" }).click();
  await expect(cart.getByText(/Agrega \$20 más en productos a precio Iconic/)).toBeVisible();
  expect(await cart.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
