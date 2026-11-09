import { test as base, expect, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  FIRESTORE_REST,
  adminToken,
  gotoClean,
  loginAsFirstAdmin,
  switchToStore,
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
