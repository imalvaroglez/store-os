import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("prints a long receipt from the admin sheet without clipping or unrelated content", async ({ page }) => {
  await page.goto("/e2e/receipt-print-fixture.html");
  await expect(page.getByRole("heading", { name: "Detalle para compartir" })).toBeVisible();
  const preview = page.getByTestId("receipt-preview");
  await expect(preview.getByText("Producto de prueba 60")).toBeVisible();

  const printRoot = page.locator("#receipt-print-root");
  expect(await printRoot.evaluate((node) => node.parentElement === document.body)).toBe(true);
  expect(await printRoot.evaluate((node) => getComputedStyle(node).display)).toBe("none");

  await page.emulateMedia({ media: "print" });
  expect(await printRoot.evaluate((node) => getComputedStyle(node).display)).toBe("block");
  await page.waitForTimeout(350); // Let the Sheet's opening animation finish before Chromium paginates.
  const pdf = await page.pdf({ format: "Letter", printBackground: true });
  const pdfText = execFileSync("pdftotext", ["-layout", "-", "-"], {
    input: Buffer.from(pdf),
    encoding: "utf8",
  });
  const pages = pdfText.split("\f").filter((pageText) => pageText.trim().length > 0);

  expect(pages.length).toBeGreaterThan(1);
  expect(pdfText).toContain("Producto de prueba 60");
  expect(pdfText).toContain("Total");
  expect(pdfText).toContain("$60.00");
  expect(pdfText).toContain("Cobrado");
  expect(pdfText).toContain("$10.00");
  expect(pdfText).toContain("Saldo");
  expect(pdfText).toContain("$50.00");
  expect(pdfText).not.toContain("Encabezado administrativo");
  expect(pdfText).not.toContain("Detalle para compartir");
  expect(pdfText).not.toContain("Control ajeno al recibo");
  expect(pdfText).not.toContain("Cerrar");
});
