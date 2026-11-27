import { test as base, expect, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  adminToken,
  ensureStoreActive,
  gotoClean,
  signIn,
  signUp,
  writeEmulatorDoc,
} from "./helpers";

// #579 — layout regression for «Surtir del almacén». Desktop (~1280): one row
// per result (Producto y variante | Cantidad | Precio de etiqueta | Agregar)
// sharing vertical axes, results spanning the whole dialog while the capture
// is empty, and «Piezas para surtir» BELOW the results (a side column would
// halve the width and break the row). Mobile (~390): full variant names stay
// legible, no horizontal scroll, and a two-variant batch confirms in ONE
// movement through the real callable.

const STORE_ID = "store_579_layout";
const STORE_NAME = "Bodega 579";
const POINT_ID = `${STORE_ID}__vitrina`;
const POINT_NAME = "Vitrina norte";
const PASSWORD = "password123";
const NOW = new Date().toISOString();

const COLLAR = "Collar artesanal de doble vuelta";
const VERDE = "Verde azulado con destellos dorados del amanecer";
const TERRACOTA = "Terracota con vetas marrones del desierto";

/** Simple rows plus one design with two LONG variant names (legibility probe). */
function products(): Array<Record<string, unknown>> {
  const base = { storeId: STORE_ID, category: "jewelry", isPublic: false, status: "published", availability: "available", lowStockAt: 2, createdAt: NOW, updatedAt: NOW };
  return [
    { ...base, id: "p579l_anillo", name: "Anillo de cobre martillado", sku: "A579L-ANILLO", cost: 150, prices: { t_retail: 420 }, quantityOnHand: 6 },
    { ...base, id: "p579l_pulsera", name: "Pulsera tejida", sku: "A579L-PULSERA", cost: 120, prices: { t_retail: 350 }, quantityOnHand: 8 },
    { ...base, id: "p579l_aretes", name: "Aretes de luna", sku: "A579L-ARETES", cost: 90, prices: { t_retail: 260 }, quantityOnHand: 4 },
    {
      ...base,
      id: "p579l_collar",
      name: COLLAR,
      sku: "A579L-COLLAR",
      cost: 200,
      prices: { t_retail: 480 },
      quantityOnHand: 9,
      variants: [
        { id: "v579l_verde", color: VERDE, skuSuffix: "VERDE", sku: "A579L-COLLAR-VERDE", cost: 200, quantityOnHand: 6, lowStockAt: 2, createdAt: NOW, updatedAt: NOW },
        { id: "v579l_terracota", color: TERRACOTA, skuSuffix: "TERRA", sku: "A579L-COLLAR-TERRA", cost: 210, prices: { t_retail: 520 }, quantityOnHand: 3, lowStockAt: 2, createdAt: NOW, updatedAt: NOW },
      ],
    },
  ];
}

/** Signed-in admin page with the #579 fixtures visible on the points screen. */
async function openDialogOnDesktop(page: Page) {
  await gotoClean(page, "/ventas/puntos");
  await ensureStoreActive(page, STORE_NAME);
  await page.getByRole("button", { name: new RegExp(POINT_NAME) }).click();
  await page.getByRole("button", { name: "Surtir del almacén" }).click();
  await expect(page.getByRole("dialog", { name: "Surtir del almacén" })).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };
type RowBoxes = { name: string; qty: Box; price: Box; button: Box };

async function resultRows(page: Page): Promise<RowBoxes[]> {
  return page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    if (!panel) throw new Error("dialog not open");
    const qtyInputs = [...panel.querySelectorAll<HTMLInputElement>('input[aria-label^="Cantidad de"]')];
    return qtyInputs.map((qty) => {
      const name = qty.getAttribute("aria-label")!.replace("Cantidad de ", "");
      const price = panel.querySelector<HTMLInputElement>(`input[aria-label="Precio de etiqueta de ${name}"]`)!;
      // An added row drops its «Agregar …» aria-label («Agregado» text only),
      // so the action button is located structurally: the row grid's only button.
      const button = price.closest("label")!.parentElement!.querySelector("button")!;
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return { name, qty: box(qty), price: box(price), button: box(button) };
    });
  });
}

/** Same visual line = vertical ranges overlap (not a 1-2px kiss). */
function sharesLine(a: { y: number; height: number }, b: { y: number; height: number }) {
  return a.y < b.y + b.height - 2 && b.y < a.y + a.height - 2;
}

/** All rows keep one visual line for qty|price|button and identical axes. */
function expectAlignedSingleLineRows(rows: RowBoxes[]) {
  expect(rows.length).toBeGreaterThanOrEqual(3);
  for (const row of rows) {
    expect(sharesLine(row.qty, row.price), `qty/price same line: ${row.name}`).toBe(true);
    expect(sharesLine(row.price, row.button), `price/button same line: ${row.name}`).toBe(true);
  }
  const axis = (values: number[]) => Math.max(...values) - Math.min(...values);
  expect(axis(rows.map((r) => r.qty.x)), "cantidad comparte eje vertical").toBeLessThanOrEqual(2);
  expect(axis(rows.map((r) => r.price.x)), "precio comparte eje vertical").toBeLessThanOrEqual(2);
  expect(axis(rows.map((r) => r.button.x + r.button.width)), "Agregar comparte eje vertical").toBeLessThanOrEqual(2);
}

let sharedPage: Page | null = null;
const test = base.extend<{ sharedPage: Page }>({
  sharedPage: async ({}, use) => {
    if (!sharedPage) throw new Error("sharedPage not initialized in beforeAll");
    await use(sharedPage);
  },
});

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  sharedPage = await ctx.newPage();
  // The suite order may or may not have created the admin already; signIn
  // falls back to the signup path when the account is missing.
  try {
    await signIn(sharedPage, ADMIN_EMAIL, PASSWORD);
  } catch {
    await signUp(sharedPage, ADMIN_EMAIL, PASSWORD);
  }
  const { uid } = await adminToken(ADMIN_EMAIL, PASSWORD);
  await writeEmulatorDoc("stores", STORE_ID, {
    id: STORE_ID, name: STORE_NAME, slug: "bodega-579", type: "inventory_tiered",
    whatsappPhone: "5215512345678", skuPrefix: "A579", memberUids: [uid], ownerUid: uid,
    createdAt: NOW, updatedAt: NOW,
  });
  await writeEmulatorDoc("adminStores", STORE_ID, { ownerUid: uid, memberUids: [uid] });
  for (const product of products()) await writeEmulatorDoc("products", product.id as string, product);
  await writeEmulatorDoc("points", POINT_ID, {
    id: POINT_ID, storeId: STORE_ID, name: POINT_NAME, active: true,
    priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW,
  });
});

test.afterAll(async () => {
  await sharedPage?.context().close();
  sharedPage = null;
});

test("escritorio 1280: con la captura vacía los resultados usan todo el ancho y cada fila mantiene Cantidad|Precio|Agregar en una sola línea", async ({ sharedPage: page }) => {
  await openDialogOnDesktop(page);
  // Fixture guard: the measurement is only meaningful with real rows on screen.
  expect((await resultRows(page)).length, "renglones visibles").toBeGreaterThanOrEqual(5);
  const widths = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
    const results = document.querySelector('section[aria-label="Disponible en almacén"]')!.getBoundingClientRect();
    return { panel: panel.width, results: results.width };
  });
  // An empty capture has no side column: results span the usable dialog width.
  expect(widths.results / widths.panel, "resultados a todo el ancho").toBeGreaterThan(0.9);

  const rows = await resultRows(page);
  expectAlignedSingleLineRows(rows);

  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  expect(overflow, "sin scroll horizontal").toBeLessThanOrEqual(1);
});

test("escritorio 1280: al agregar, el resumen queda DEBAJO de los resultados sin partir la fila", async ({ sharedPage: page }) => {
  await openDialogOnDesktop(page);
  await page.getByLabel("Cantidad de Anillo de cobre martillado").fill("2");
  await page.getByRole("button", { name: "Agregar Anillo de cobre martillado" }).click();
  await expect(page.getByRole("region", { name: "Piezas para surtir" })).toBeVisible();

  const placement = await page.evaluate(() => {
    const results = document.querySelector('section[aria-label="Disponible en almacén"]')!.getBoundingClientRect();
    const summary = document.querySelector('section[aria-label="Piezas para surtir"]')!.getBoundingClientRect();
    // Stacked = the summary starts below the results' top and horizontally
    // overlaps them (a right-hand column leaves results.right behind its left).
    const horizontalOverlap = Math.min(results.right, summary.right) - Math.max(results.left, summary.left);
    return { summaryStartsBelow: summary.top >= results.top - 2, stacked: horizontalOverlap > summary.width * 0.5 };
  });
  expect(placement.summaryStartsBelow, "resumen debajo de los resultados").toBe(true);
  expect(placement.stacked, "resumen no en columna lateral").toBe(true);

  const rows = await resultRows(page);
  expectAlignedSingleLineRows(rows);

  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  expect(overflow, "sin scroll horizontal").toBeLessThanOrEqual(1);
});

test("móvil 390: variantes completas legibles, lote de dos variantes y UNA confirmación", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  try {
    await signIn(page, ADMIN_EMAIL, PASSWORD);
    await gotoClean(page, "/ventas/puntos");
    await ensureStoreActive(page, STORE_NAME);
    await page.getByRole("button", { name: new RegExp(POINT_NAME) }).click();
    await page.getByRole("button", { name: "Surtir del almacén" }).click();
    await expect(page.getByRole("dialog", { name: "Surtir del almacén" })).toBeVisible();
    // Fixture guard: the warehouse list must be populated before searching.
    await expect(page.getByLabel("Cantidad de Anillo de cobre martillado")).toBeVisible();

    // Search by variant narrows to the design with both sisters visible.
    await page.getByLabel("Buscar").fill("azulado");
    await expect(page.getByText(VERDE, { exact: true })).toBeVisible();
    await expect(page.getByText(TERRACOTA, { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "sin scroll horizontal a 390").toBeLessThanOrEqual(1);

    // Capture both variants (suggested prices prefilled) and confirm ONCE.
    await page.getByLabel(`Cantidad de ${COLLAR} · ${VERDE}`).fill("2");
    await page.getByRole("button", { name: `Agregar ${COLLAR} · ${VERDE}` }).click();
    await page.getByLabel(`Cantidad de ${COLLAR} · ${TERRACOTA}`).fill("1");
    await page.getByRole("button", { name: `Agregar ${COLLAR} · ${TERRACOTA}` }).click();
    await expect(page.getByText(/3 piezas en 2 renglones/)).toBeVisible();

    const callsBefore = await countSurtidoOps(page);
    await page.getByRole("button", { name: "Surtir piezas" }).click();
    await expect(page.getByText(/Surtido: 3 piezas/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("dialog", { name: "Surtir del almacén" })).toHaveCount(0);
    const callsAfter = await countSurtidoOps(page);
    expect(callsAfter - callsBefore, "un solo movimiento").toBe(1);
  } finally {
    await ctx.close();
  }
});

/** pointOperations evidence written by the callable (kind surtido). */
async function countSurtidoOps(page: Page): Promise<number> {
  const token = await adminToken(ADMIN_EMAIL, PASSWORD);
  const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  const response = await fetch(
    `http://${host}/v1/projects/store-os-dev/databases/(default)/documents/pointOperations?pageSize=150`,
    { headers: { Authorization: `Bearer ${token.token}` } }
  );
  const body = (await response.json()) as { documents?: Array<{ fields?: Record<string, { stringValue?: string }> }> };
  return (body.documents ?? []).filter((doc) => {
    const storeId = doc.fields?.storeId?.stringValue;
    const kind = doc.fields?.kind?.stringValue;
    return storeId === STORE_ID && (kind === "surtido" || kind === "first_surtido");
  }).length;
}
