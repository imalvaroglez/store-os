import { test, expect, type Page } from "@playwright/test";

// Timed manual acceptance of purchase-ux2 against the REAL dev backend
// (store-os-dev, callable in us-east1). Creates an isolated QA account+store,
// imports the real supplier PDF, and runs the full review flow with a clock.
// NOT part of the regular suite: run explicitly with
//   npx playwright test e2e/manual-acceptance.spec.ts --config=playwright.acceptance.config.ts
const REAL_PDF = "docs/superpowers/specs/receipt.pdf";
const RUN = Date.now();
const QA_EMAIL = `qa-ux2+${RUN}@store.os`;
const STORE_NAME = `QA UX2 ${String(RUN).slice(-6)}`;
const QA_PASSWORD = "qa-ux2-password-2026";

let clock = 0;
const lap = (label: string) => {
  const now = Date.now();
  const delta = clock ? ((now - clock) / 1000).toFixed(1) : "0";
  clock = now;
  console.log(`CLOCK>>> ${label}: +${delta}s`);
};

test("50-line real-PDF acceptance (desktop flow, timed)", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("http://localhost:5173/entrar");

  // Isolated QA account + store (admin@store.os exists, so this is a member).
  await page.getByRole("button", { name: /¿No tienes cuenta\? Crear una/ }).click();
  await page.getByLabel(/Correo/).fill(QA_EMAIL);
  await page.getByLabel(/Contraseña/).fill(QA_PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("button", { name: /Crear tienda/ })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: /Crear tienda/ }).click();
  await page.getByLabel(/Nombre de la tienda/).fill(STORE_NAME);
  await page.getByRole("button", { name: /Crear tienda/ }).last().click();
  await expect(page.getByText(/¿Qué necesitas hacer hoy en/)).toBeVisible({ timeout: 30000 });
  lap("alta de cuenta QA + tienda");

  // Purchases → new → import the real PDF.
  await page.goto("http://localhost:5173/productos/compras");
  await page.getByRole("button", { name: "+ Nueva compra" }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Importar pedido (PDF)" }).click(),
  ]);
  await fileChooser.setFiles(REAL_PDF);
  // Real OCR in us-east1: up to ~3 minutes for 5 pages.
  await expect(page.getByText(/50 líneas|Mercancía \(50/)).toBeVisible({ timeout: 240_000 });
  lap("subida + OCR real (50 líneas)");

  // Resolve amounts globally, then bulk create, then receive.
  await page.getByRole("button", { name: "Unitarios" }).click();
  await expect(page.getByText(/Sin vincular \(50\)/)).toBeVisible();
  lap("resolución global de importes");

  await page.getByRole("button", { name: /Crear 50 productos/ }).click();
  await expect(page.getByText(/50 productos creados y vinculados/)).toBeVisible({ timeout: 120_000 });
  lap("creación masiva (writeBatch)");

  // The real receipt is internally inconsistent (discount > subtotal): fix the
  // discount to 0 so the totals reconcile, mirroring what the operator does.
  await page.getByLabel("Descuento").fill("0");
  // The real receipt is internally inconsistent (printed total ≠ Σ lines):
  // confirm the difference, exactly as the operator would.
  await page.getByRole("button", { name: /Recibir así, con diferencia/ }).click();
  await page.getByRole("button", { name: "Recibir mercancía" }).click();
  await expect(page.getByText(/el inventario se actualizó/)).toBeVisible({ timeout: 120_000 });
  lap("recepción de mercancía");
  console.log("CLOCK>>> TOTAL flujo de revisión (sin alta/OCR): ver deltas arriba");
});
