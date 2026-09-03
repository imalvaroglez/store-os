import { expect, test, type APIRequestContext } from "@playwright/test";
import { ids } from "./dev-global-setup";

const FUNCTION_URL = `https://us-east1-store-os-dev.cloudfunctions.net/submitPublicOrderRequest`;

function uuid(seed: string) {
  return `00000000-0000-4000-8000-${seed.padStart(12, "0")}`;
}

async function callPublicOrder(request: APIRequestContext, body: unknown) {
  return request.post(FUNCTION_URL, {
    headers: { "Content-Type": "application/json" },
    data: { data: body },
  });
}

test("catálogo real publica la existencia disponible", async ({ page }) => {
  await page.goto(`/catalogo/${ids.catalog}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Producto de pruebas")).toBeVisible({ timeout: 20_000 });
});

test("el carrito real no permite superar las 3 piezas publicadas", async ({ page }) => {
  await page.goto(`/catalogo/${ids.catalog}`, { waitUntil: "domcontentloaded" });
  const add = page.getByRole("button", { name: "Agregar al carrito" });
  await expect(add).toBeVisible({ timeout: 20_000 });
  await add.click();
  const quantity = page.getByRole("group", { name: "Cantidad de Producto de pruebas" });
  await quantity.getByRole("button", { name: "Sumar una pieza de Producto de pruebas" }).click();
  await quantity.getByRole("button", { name: "Sumar una pieza de Producto de pruebas" }).click();
  await expect(quantity).toContainText("3");
  await expect(quantity.getByRole("button", { name: "Sumar una pieza de Producto de pruebas" })).toBeDisabled();
});

test("callable real valida nombre, inventario, idempotencia y límite", async ({ request }) => {
  const line = { productId: ids.product, productSlug: ids.productSlug, quantity: 1 };
  const missingName = await callPublicOrder(request, {
    requestId: uuid("101"), clientId: uuid("201"), storeSlug: ids.catalog, customerName: "", lines: [line],
  });
  expect(missingName.status()).toBe(400);

  const excess = await callPublicOrder(request, {
    requestId: uuid("102"), clientId: uuid("202"), storeSlug: ids.catalog, customerName: "Ana", lines: [{ ...line, quantity: 4 }],
  });
  expect(excess.status()).toBe(400);

  const body = {
    requestId: uuid("103"), clientId: uuid("203"), storeSlug: ids.catalog, customerName: "Ana", lines: [line],
  };
  const first = await callPublicOrder(request, body);
  expect(first.status()).toBe(200);
  const retry = await callPublicOrder(request, body);
  expect(retry.status()).toBe(200);
  expect((await retry.json()).data?.idempotent).toBe(true);

  const limited = await callPublicOrder(request, {
    requestId: uuid("104"), clientId: uuid("204"), storeSlug: ids.catalog, customerName: "Otra persona", lines: [line],
  });
  expect(limited.status()).toBe(429);
});
