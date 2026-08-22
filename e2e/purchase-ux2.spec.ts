import { test as base, expect, type Page } from "@playwright/test";
import { gotoClean, loginAsFirstAdmin, writeEmulatorDoc } from "./helpers";

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
  await loginAsFirstAdmin(sharedPage, "ux2");
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


test("50-line review: filters, global resolution, bulk create, receive", async ({ sharedPage: page }) => {
  await gotoClean(page, "/productos/compras");
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

  // Totals reconcile (totalConfirmed was seeded to Σ sourceAmount) → receive.
  await expect(page.getByRole("button", { name: "Recibir mercancía" })).toBeEnabled();
  await page.getByRole("button", { name: "Recibir mercancía" }).click();
  await expect(page.getByText(/el inventario se actualizó/)).toBeVisible({ timeout: 30000 });
});

test("locked after receive: controls disabled", async ({ sharedPage: page }) => {
  await gotoClean(page, "/productos/compras");
  await page.getByText("#3023").first().click();
  await expect(page.getByText("Recibida").first()).toBeVisible();
  await expect(page.locator('input[aria-label="Producto"]').first()).toBeDisabled();
});
