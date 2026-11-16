import { test as base, expect, type Page } from "@playwright/test";
import { loginAsFirstAdmin, gotoClean } from "./helpers";

// #454 — the admin navigation is organized into four AREAS. The walk Fer needs:
// Inicio → Ventas/Pedidos → Top emprendedoras → Compras → Gastos → Cierre
// mensual, WITHOUT passing through Gastos to reach the close. Deep-links open
// the right area; legacy paths keep working.
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
});

test.afterAll(async () => {
  await sharedPage?.context().close();
  sharedPage = null;
});

test("las cuatro áreas existen en orden y Gastos ya no es cajón de sastre", async ({ sharedPage: page }, testInfo) => {
  // The sidebar rail is desktop chrome; mobile uses the bottom-bar areas
  // (covered by unit tests + the responsive spec).
  test.skip(testInfo.project.name !== "desktop", "sidebar es chrome de escritorio");
  await gotoClean(page, "/");
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible({ timeout: 20000 });
  // Desktop sidebar (mobile bottom bar is covered by unit tests + responsive).
  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("button", { name: "Ventas" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Inventario y catálogo" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Compras y abastecimiento" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Administración" })).toBeVisible();
  // Order contract: the four labels appear in this DOM order.
  const labels = await sidebar.locator("nav > div > button, nav > button").allInnerTexts();
  const order = ["Ventas", "Inventario y catálogo", "Compras y abastecimiento", "Administración"]
    .map((label) => labels.findIndex((t) => t.includes(label)));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("deep-link a Cierre mensual abre Administración sin pasar por Gastos", async ({ sharedPage: page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sidebar es chrome de escritorio");
  await gotoClean(page, "/productos/cierre");
  await expect(page.getByRole("heading", { name: "Cierre mensual" })).toBeVisible({ timeout: 20000 });
  const sidebar = page.locator("aside");
  // The Administración group is open with the active leaf marked.
  await expect(sidebar.getByRole("button", { name: "Cierre mensual" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Cierre mensual" })).toHaveAttribute("aria-current", "page");
  // And the other areas are NOT expanded (no endless rail).
  await expect(sidebar.getByRole("button", { name: "Pedidos" })).toBeHidden();
});

test("recorrido Fer: Ventas→Top emprendedoras → Compras → Gastos → Cierre", async ({ sharedPage: page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sidebar es chrome de escritorio");
  await gotoClean(page, "/");
  const sidebar = page.locator("aside");
  // Ventas → Top emprendedoras (2 interacciones).
  await sidebar.getByRole("button", { name: "Ventas" }).click();
  await sidebar.getByRole("button", { name: "Top emprendedoras" }).click();
  await expect(page.getByRole("heading", { name: "Top emprendedoras" })).toBeVisible({ timeout: 20000 });
  // Compras y abastecimiento → Compras (the group opens; Empaques appears).
  await sidebar.getByRole("button", { name: "Compras y abastecimiento" }).click();
  await expect(sidebar.getByRole("button", { name: "Empaques" })).toBeVisible();
  await sidebar.getByRole("button", { name: "Compras", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Compras/ })).toBeVisible({ timeout: 20000 });
  // Administración → Gastos.
  await sidebar.getByRole("button", { name: "Administración" }).click();
  await sidebar.getByRole("button", { name: "Gastos" }).click();
  await expect(page.getByRole("heading", { name: /Gastos/ })).toBeVisible({ timeout: 20000 });
  // …y Cierre mensual directo, sin salir de la tienda ni pasar por Gastos.
  await sidebar.getByRole("button", { name: "Cierre mensual" }).click();
  await expect(page.getByRole("heading", { name: "Cierre mensual" })).toBeVisible({ timeout: 20000 });
});

test("rutas legacy siguen funcionando tras recarga", async ({ sharedPage: page }) => {
  for (const path of ["/pedidos", "/clientes", "/productos/categorias", "/productos/empaques", "/productos/gastos", "/productos/ranking"]) {
    await gotoClean(page, path);
    await expect(page.locator("main")).toBeVisible({ timeout: 20000 });
  }
});
