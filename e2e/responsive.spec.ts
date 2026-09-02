import { test as base, expect, type Page } from "@playwright/test";
import { loginAsFirstAdmin, gotoSantiHome, openCatalog } from "./helpers";

// Responsive-layout assertions against the Firebase Emulator, at BOTH mobile and
// desktop viewports. One browser context per project (beforeAll), reused across
// tests so Firebase Auth's indexedDB session persists.

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

test("nav surface matches viewport (sidebar desktop / bottom-nav mobile)", async ({ sharedPage: page }, testInfo) => {
  await gotoSantiHome(page);
  const isDesktop = testInfo.project.name === "desktop";
  const aside = page.locator("aside");
  const bottomNav = page.locator("nav.fixed.bottom-0");
  if (isDesktop) {
    await expect(aside).toBeVisible();
    await expect(bottomNav).toBeHidden();
  } else {
    await expect(aside).toBeHidden();
    await expect(bottomNav).toBeVisible();
  }
});

test("no horizontal scroll at any viewport", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  const scrollX = await page.evaluate(() => window.scrollX);
  expect(Math.abs(scrollX)).toBeLessThan(2);
  await openCatalog(page);
  const scrollX2 = await page.evaluate(() => window.scrollX);
  expect(Math.abs(scrollX2)).toBeLessThan(2);
});

test("catalog uses a multi-column grid on desktop, single column on mobile", async ({ sharedPage: page }, testInfo) => {
  await gotoSantiHome(page);
  await openCatalog(page);
  const cols = await page.evaluate(() => {
    const g = document.querySelector(".grid.grid-cols-1");
    if (!g) return 0;
    return getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length;
  });
  if (testInfo.project.name === "desktop") {
    expect(cols).toBeGreaterThan(1);
  } else {
    expect(cols).toBe(1);
  }
});

test("form Sheet is centered modal on desktop, bottom-anchored on mobile", async ({ sharedPage: page }, testInfo) => {
  await gotoSantiHome(page);
  await openCatalog(page);
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await expect(page.getByRole("heading", { name: "Agregar producto" })).toBeVisible();
  const panel = page.locator(".bg-paper.shadow-lift");
  const box = await panel.boundingBox();
  expect(box).toBeTruthy();
  const viewportH = testInfo.project.use.viewport?.height ?? 844;
  if (testInfo.project.name === "desktop") {
    expect(box!.y).toBeGreaterThan(40);
    expect(box!.width).toBeGreaterThan(700);
    expect(box!.width).toBeLessThanOrEqual(1024);
  } else {
    expect(box!.y + box!.height).toBeGreaterThan(viewportH - 80);
  }
});

test("desktop sidebar navigates between tabs", async ({ sharedPage: page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sidebar nav is desktop-only");
  await gotoSantiHome(page);
  await page.getByRole("button", { name: "Pedidos" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clientes" }).click();
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
});
