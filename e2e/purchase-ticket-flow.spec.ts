import { test, expect, type Page } from "@playwright/test";
import { adminToken, FIRESTORE_REST, ensureStoreActive, gotoClean, loginAsFirstAdmin, writeEmulatorDoc } from "./helpers";

async function openJourney(page: Page) {
  await gotoClean(page, "/productos/compras");
  await ensureStoreActive(page, "Joyería");
  await page.getByRole("heading", { name: "Viaje sintético por tickets", exact: true }).click();
}

test("seven tickets: capture, targeted errors, save/reopen, one scroll and receipt", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await loginAsFirstAdmin(page);
  await writeEmulatorDoc("products", "ticket_flow_product", {
    storeId: "store_joyeria", name: "Pieza QA por ticket", sku: "QA-TICKET",
    category: "jewelry", cost: 10, quantityOnHand: 3, prices: { t_retail: 25 }, isPublic: true, status: "published", slug: "pieza-qa-ticket",
    createdAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z",
  });
  const detailUrl = `${FIRESTORE_REST}/publicProducts/store_joyeria__pieza-qa-ticket`;
  expect((await fetch(detailUrl)).status).toBe(404);
  const tickets = Array.from({ length: 7 }, (_, i) => ({ id: `qa-ticket-${i}`, folio: `QA-T-${i + 1}`, supplierName: `Proveedor QA ${i + 1}`, totalConfirmed: 50 }));
  const lines = tickets.flatMap((ticket, i) => Array.from({ length: 5 }, (_, j) => ({
    lineId: `qa-line-${i}-${j}`, ticketId: ticket.id, productId: "ticket_flow_product",
    name: `Pieza QA ${i + 1}-${j + 1}`, quantity: 1, unitCost: 10,
  })));
  await writeEmulatorDoc("purchases", "ticket_flow_journey", {
    storeId: "store_joyeria", name: "Viaje sintético por tickets", date: "2026-11-05", status: "draft",
    costingMethod: "latest_purchase", tickets, lines, subtotal: 350, totalConfirmed: 350,
    createdAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z",
  });
  await openJourney(page);
  const names = page.getByLabel("Producto", { exact: true });
  await expect(names).toHaveCount(5);
  await expect(names.first()).toHaveValue("Pieza QA 1-1");
  await expect(page.getByLabel("Ticket de esta línea")).toHaveCount(0);
  await expect(page.getByText("Importe", { exact: true })).toHaveCount(0);

  // Manual activation: the arrow changes focus, not the ticket being edited.
  const firstTab = page.getByRole("tab", { name: /#QA-T-1/ });
  const secondTab = page.getByRole("tab", { name: /#QA-T-2/ });
  await firstTab.focus();
  await firstTab.press("ArrowRight");
  await expect(secondTab).toBeFocused();
  await expect(firstTab).toHaveAttribute("aria-selected", "true");
  await secondTab.press("Enter");
  await expect(names.first()).toHaveValue("Pieza QA 2-1");
  await page.getByLabel("Cantidad", { exact: true }).first().fill("2");
  await page.getByLabel("Total pagado", { exact: true }).fill("60.");
  await page.getByRole("tab", { name: /#QA-T-7/ }).click();
  await page.getByLabel("Total pagado", { exact: true }).fill("");
  await secondTab.click();
  await expect(page.getByLabel("Total pagado", { exact: true })).toHaveValue("60.");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByRole("region", { name: "Resumen de tickets" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Resumen de tickets" })).toBeInViewport();
  const fix = page.getByRole("button", { name: /#QA-T-7.*Total pagado: escribe/ });
  await fix.click();
  const paid = page.getByLabel("Total pagado", { exact: true });
  await expect(paid).toBeFocused();
  await expect(paid).toHaveValue("");
  await expect(paid).toHaveAttribute("aria-invalid", "true");
  await paid.fill("50");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador guardado.")).toBeVisible();

  // Independent read: a fresh page must load all tickets and the last edits.
  const reopened = await page.context().newPage();
  await openJourney(reopened);
  await expect(reopened.getByRole("tab")).toHaveCount(8);
  await reopened.getByRole("tab", { name: /#QA-T-2/ }).click();
  await expect(reopened.getByLabel("Cantidad", { exact: true }).first()).toHaveValue("2");
  await expect(reopened.getByLabel("Total pagado", { exact: true })).toHaveValue("60");
  await reopened.getByRole("tab", { name: "Revisión general" }).click();
  await reopened.getByText("Revisar productos (35 renglones)", { exact: true }).click();
  await expect(reopened.getByRole("button", { name: "Todas (35)" })).toBeVisible();
  await expect(reopened.getByLabel("Producto", { exact: true })).toHaveCount(35);
  await reopened.close();

  await page.getByRole("tab", { name: "Revisión general" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The wheel over the version footer scrolls the same document as the form.
  const version = page.getByRole("button", { name: /^Versión .*ver notas de versión$/ });
  await version.scrollIntoViewIfNeeded();
  const rect = await version.boundingBox();
  expect(rect).not.toBeNull();
  const before = await page.evaluate(() => scrollY);
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.mouse.wheel(0, -500);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(before);
  await expect.poll(() => page.locator("main").evaluate((main) => getComputedStyle(main).overflowY)).toBe("visible");
  await page.getByRole("tab", { name: /#QA-T-2/ }).click();
  await page.getByLabel("Total pagado", { exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Siguiente ticket", exact: true }).click();
  await expect(page.getByLabel("Total pagado", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Total pagado", { exact: true })).toHaveValue("50");
  await page.getByRole("button", { name: "Ticket anterior", exact: true }).click();
  await expect(page.getByLabel("Total pagado", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Total pagado", { exact: true })).toHaveValue("60.");
  await expect(page.getByRole("tablist", { name: "Tickets y revisión" })).toBeInViewport();
  if (testInfo.project.name === "mobile") {
    const header = await page.locator("header").boundingBox();
    const tabs = await page.getByRole("tablist").boundingBox();
    expect(header).not.toBeNull();
    expect(tabs!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    // These are actual click targets, not just rectangles in the viewport.
    await page.getByRole("button", { name: "Opciones", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Opciones" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.screenshot({ path: `test-results/ticket-capture-${testInfo.project.name}.png` });

  await page.getByRole("button", { name: "Recibir mercancía", exact: true }).click();
  await expect(page.getByText("Compra recibida: el inventario se actualizó.")).toBeVisible({ timeout: 30_000 });
  // #386: a failed background projection surfaces HERE (sync banner with
  // retry) — if this ever fires, the doc will never arrive and the poll below
  // would waste 30 s blaming a "late" write. Fail fast with the real cause.
  await expect(page.getByText("No se pudo actualizar la disponibilidad pública")).toHaveCount(0);
  await openJourney(page);
  await expect(page.getByLabel("Costo unitario", { exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Recibir mercancía", exact: true })).toHaveCount(0);
  const { token } = await adminToken("admin@store.os", "password123");
  const response = await fetch(`${FIRESTORE_REST}/products/ticket_flow_product`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok).toBe(true);
  const persisted = await response.json();
  expect(Number(persisted.fields.quantityOnHand.integerValue)).toBe(39);

  // #386: the projection lands in a BACKGROUND write after the receive toast —
  // the old default 5 s poll lost the race under emulator load. 30 s matches
  // the receive budget, keeps the full content assertion, and the poll's
  // actual distinguishes late/absent (null) from wrong content on failure.
  await expect.poll(async () => {
    const response = await fetch(detailUrl);
    if (!response.ok) return null;
    const detail = await response.json();
    return {
      name: detail.fields.name.stringValue,
      storeId: detail.fields.storeId.stringValue,
      stockSignal: detail.fields.stockSignal.stringValue,
    };
  }, { timeout: 30_000, message: "La proyección pública de la compra por ticket no llegó (null = escritura tardía o ausente)" })
    .toEqual({ name: "Pieza QA por ticket", storeId: "store_joyeria", stockSignal: "disponible" });

  await gotoClean(page, "/pedidos/nuevo");
  await ensureStoreActive(page, "Joyería");
  const product = page.getByRole("combobox", { name: "Producto", exact: true }).first();
  await product.fill("Pieza QA por ticket");
  await page.getByRole("option", { name: /Pieza QA por ticket/ }).click();
  await expect(product).toHaveValue("Pieza QA por ticket");
  const quantity = page.getByLabel("Cantidad", { exact: true }).first();
  await quantity.fill("40");
  await expect(page.getByText("Falta 1 pieza en 1 producto")).toBeVisible();
  await quantity.fill("39");
  await expect(page.getByText("Falta 1 pieza en 1 producto")).toHaveCount(0);
});
