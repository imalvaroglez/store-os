import { test as base, expect, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  FIRESTORE_REST,
  adminToken,
  gotoClean,
  loginAsFirstAdmin,
  switchToStore,
  toFields,
  writeEmulatorDoc,
} from "./helpers";

// #280 — Estrategia de precios, against the Firebase Emulator: propose →
// edit → save a category table, verify it SURVIVES a reload, verify deleting
// it survives a reload too, and verify saving never touches product prices.
// Runs in both the mobile (390px) and desktop projects — Fer edits on a phone.

const STORE_NAME = "Estrategia E2E";
const STORE_ID = "estrategia_e2e";
const CAT_ID = `${STORE_ID}__relojes`;

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
  // Self-contained fixture: one tiered store, one category, two cost clusters
  // (cheap 20/22 ×12, pricey 95 ×8) with consistent per-tier prices — the
  // generator must propose 2 bands with a $60 boundary.
  const uid = (await adminToken(ADMIN_EMAIL, "password123")).uid;
  const now = new Date().toISOString();
  await writeEmulatorDoc("stores", STORE_ID, {
    name: STORE_NAME,
    slug: STORE_ID,
    type: "inventory_tiered",
    ownerUid: uid,
    memberUids: [uid],
    defaultTierId: "t_retail",
    priceTiers: [
      { id: "t_retail", label: "Regular", order: 1 },
      { id: "t_girly", label: "Girly", order: 2 },
      { id: "t_iconic", label: "Iconic", order: 3 },
    ],
    createdAt: now,
    updatedAt: now,
  });
  await writeEmulatorDoc("adminStores", STORE_ID, { storeId: STORE_ID, ownerUid: uid, memberUids: [uid] });
  await writeEmulatorDoc("categories", CAT_ID, {
    storeId: STORE_ID,
    name: "Relojes",
    slug: "relojes",
    sortOrder: 1,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  const cheap = { t_retail: 290, t_girly: 230, t_iconic: 160 };
  const pricey = { t_retail: 310, t_girly: 260, t_iconic: 170 };
  let index = 0;
  for (const [cost, prices] of [
    ...Array.from({ length: 8 }, () => [20, cheap] as const),
    ...Array.from({ length: 4 }, () => [22, cheap] as const),
    ...Array.from({ length: 8 }, () => [95, pricey] as const),
  ]) {
    index += 1;
    await writeEmulatorDoc("products", `estrategia_p${index}`, {
      storeId: STORE_ID,
      name: `Reloj e2e ${index}`,
      category: "other",
      categoryIds: [CAT_ID],
      isPublic: true,
      status: "published",
      cost,
      prices,
      quantityOnHand: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  // #289: representative volume — a real catalog, not a convenient 2-object
  // fixture. 260 extra pieces (200 Relojes with the same two cost clusters,
  // every 5th sold out; 60 in another category) on top of the 20 above.
  const now2 = new Date().toISOString();
  const auth = await adminToken(ADMIN_EMAIL, "password123");
  const batchWrite = async (id: string, data: Record<string, unknown>) => {
    const response = await fetch(`${FIRESTORE_REST}/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ fields: toFields(data) }),
    });
    if (!response.ok) throw new Error(`seed ${id}: ${response.status}`);
  };
  const cycle = [20, 22, 95];
  for (let i = 1; i <= 200; i += 1) {
    const cost = cycle[i % 3];
    const prices = cost < 60 ? { t_retail: 290, t_girly: 230, t_iconic: 160 } : { t_retail: 310, t_girly: 260, t_iconic: 170 };
    await batchWrite(`estrategia_vol_r${i}`, {
      storeId: STORE_ID, name: `Reloj volumen ${i}`, category: "other", categoryIds: [CAT_ID],
      isPublic: true, status: "published", cost, prices, quantityOnHand: i % 5 === 0 ? 0 : 1,
      createdAt: now2, updatedAt: now2,
    });
  }
  for (let i = 1; i <= 60; i += 1) {
    await batchWrite(`estrategia_vol_a${i}`, {
      storeId: STORE_ID, name: `Arete volumen ${i}`, category: "other", categoryIds: [`${STORE_ID}__aretes`],
      isPublic: true, status: "published", cost: 30, prices: { t_retail: 150, t_girly: 100, t_iconic: 60 },
      quantityOnHand: 1, createdAt: now2, updatedAt: now2,
    });
  }
  await writeEmulatorDoc("categories", `${STORE_ID}__aretes`, {
    storeId: STORE_ID, name: "Aretes", slug: "aretes", sortOrder: 2, active: true, createdAt: now2, updatedAt: now2,
  });
  sharedPage.on("pageerror", (error) => console.error(`[pageerror] ${error.message}\n${error.stack ?? ""}`));
  await switchToStore(sharedPage, STORE_NAME);
});

test.afterAll(async () => {
  await sharedPage?.context().close();
  sharedPage = null;
});

async function openStrategy(page: Page) {
  await gotoClean(page, "/productos/estrategia");
  await expect(page.getByRole("heading", { name: "Estrategia de precios" })).toBeVisible();
  const select = page.getByLabel("Categoría");
  await expect(select.locator(`option[value="${CAT_ID}"]`)).toBeAttached({ timeout: 15000 });
  await select.selectOption(CAT_ID);
  // The category summary card must be live before any interaction.
  await expect(page.getByText(/piezas en la categoría/)).toBeVisible({ timeout: 15000 });
}

test("propone dos bandas, Fer edita y guarda; la tabla persiste tras recargar", async ({ sharedPage: page }) => {
  await openStrategy(page);
  await expect(page.getByText(/Elegidas 2 bandas/)).toBeVisible();
  await page.getByRole("button", { name: /Editar esta propuesta/ }).click();
  await page.getByLabel("Iconic (pesos)").first().fill("165");
  await page.getByRole("button", { name: /Guardar tabla/ }).click();
  await expect(page.getByRole("button", { name: "Sin cambios" })).toBeVisible({ timeout: 10000 });

  // Reload: the saved table must come back exactly as saved.
  await openStrategy(page);
  await expect(page.getByLabel("Hasta $").first()).toHaveValue("60");
  await expect(page.getByLabel("Iconic (pesos)").first()).toHaveValue("165");
  await expect(page.getByText(/Si adoptaras esta tabla/)).toBeVisible();
});

test("guardar la tabla no cambia ningún precio de producto", async ({ sharedPage: page }) => {
  const auth = await adminToken(ADMIN_EMAIL, "password123");
  const response = await fetch(`${FIRESTORE_REST}/products/estrategia_p1`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(response.ok).toBeTruthy();
  const doc = (await response.json()) as { fields: { prices: { mapValue: { fields: Record<string, { integerValue: string }> } } } };
  const prices = Object.fromEntries(
    Object.entries(doc.fields.prices.mapValue.fields).map(([k, v]) => [k, Number(v.integerValue)])
  );
  expect(prices).toEqual({ t_retail: 290, t_girly: 230, t_iconic: 160 });
});

test("quitar la tabla elimina las reglas y no resucita tras recargar", async ({ sharedPage: page }) => {
  await openStrategy(page);
  // The saved table must load into the editor before the remove button exists.
  await expect(page.getByRole("button", { name: /Guardar tabla|Sin cambios/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /Quitar tabla de esta categoría/ }).click();
  await page.getByRole("button", { name: "Quitar tabla", exact: true }).click();
  await expect(page.getByText("Tabla eliminada.")).toBeVisible({ timeout: 10000 });

  // Reload: the category is back to proposal mode — no saved table left.
  await openStrategy(page);
  await expect(page.getByRole("button", { name: /Editar esta propuesta/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /Quitar tabla de esta categoría/ })).toHaveCount(0);
});

test("recorrido completo: tabla de Relojes → revisar por categoría → aplicar SOLO precios autorizados (#289)", async ({ sharedPage: page }) => {
  // #386 family: this journey legitimately waits up to 60s for the apply
  // confirmation alone; the default 40s test timeout cut it short under
  // emulator load.
  test.setTimeout(120_000);
  // 1) Estrategia: proponer, ajustar un precio (Iconic banda baja 160→150) y guardar.
  await openStrategy(page);
  await expect(page.getByText(/Elegidas 2 bandas/)).toBeVisible();
  await page.getByRole("button", { name: /Editar esta propuesta/ }).click();
  await page.getByLabel("Iconic (pesos)").first().fill("150");
  await page.getByRole("button", { name: /Guardar tabla/ }).click();
  await expect(page.getByRole("button", { name: "Sin cambios" })).toBeVisible({ timeout: 10000 });

  // 2) El puente ofrece la revisión contextual de UNA categoría (280 piezas de Relojes, no todo el catálogo).
  const bridge = page.getByRole("button", { name: /Revisar precios pendientes de esta categoría \(\d+\)/ });
  await expect(bridge).toBeVisible({ timeout: 10000 });
  await bridge.click();

  // 3) Reglas conserva el contexto: piezas con cambios primero, sin recorrer el catálogo completo.
  await expect(page.getByText(/Revisando la categoría Relojes/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Con cambios pendientes", { exact: true })).toBeVisible();
  // Las 60 piezas de Aretes no aparecen en la revisión de Relojes.
  await expect(page.getByText("Arete volumen 1", { exact: true })).toHaveCount(0);

  // 4) Selección masiva ACOTADA al filtro y a las disponibles; agotadas solo con opt-in.
  const eligible = await page.getByRole("button", { name: /Seleccionar elegibles \((\d+)\)/ }).innerText();
  const eligibleCount = Number(eligible.match(/\((\d+)\)/)![1]);
  expect(eligibleCount).toBeGreaterThan(0);
  await page.getByRole("button", { name: /Seleccionar elegibles/ }).click();
  await page.getByRole("button", { name: /Aplicar seleccionados/ }).click();

  // 5) Resumen antes de escribir; confirmación explícita.
  await expect(page.getByText(/precio\(s\) con cambio seguro en/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/Solo se escriben los precios/)).toBeVisible();
  await page.getByRole("button", { name: /^Aplicar \d+ precio/ }).click();
  await expect(page.getByText(/Precios actualizados en \d+ pieza/)).toBeVisible({ timeout: 60000 });

  // 6) Verificación REST: SOLO precios autorizados; inventario, costos y otras categorías intactos.
  const auth = await adminToken(ADMIN_EMAIL, "password123");
  const read = async (id: string) => {
    const response = await fetch(`${FIRESTORE_REST}/products/${id}`, { headers: { Authorization: `Bearer ${auth.token}` } });
    expect(response.ok).toBeTruthy();
    const doc = (await response.json()) as { fields: Record<string, { integerValue?: string;doubleValue?: number }> };
    const number = (key: string) => Number(doc.fields[key]?.integerValue ?? doc.fields[key]?.doubleValue);
    return { doc, number };
  };
  const cheap = await read("estrategia_p1"); // costo 20 → banda baja → Iconic 150
  const pricey = await read("estrategia_p13"); // costo 95 → banda alta → Iconic 170 SIN cambio
  const other = await read("estrategia_vol_a1"); // otra categoría → intacto
  const iconPrice = (entry: Awaited<ReturnType<typeof read>>) => {
    const map = entry.doc.fields.prices as unknown as { mapValue: { fields: Record<string, { integerValue?: string }> } };
    return Number(map.mapValue.fields.t_iconic.integerValue);
  };
  expect(iconPrice(cheap)).toBe(150); // precio autorizado aplicado
  expect(cheap.number("quantityOnHand")).toBe(1); // inventario intacto
  expect(cheap.number("cost")).toBe(20); // costo intacto
  expect(iconPrice(pricey)).toBe(170); // sin cambio: ya estaba en ese precio
  expect(pricey.number("quantityOnHand")).toBe(1);
  expect(iconPrice(other)).toBe(60); // otra categoría: intacta
});
