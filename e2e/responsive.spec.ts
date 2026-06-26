import { test, expect } from "@playwright/test";

// Responsive-layout assertions. These run under BOTH the mobile and desktop
// projects; each asserts the correct nav surface for its own viewport.

test("nav surface matches viewport (sidebar desktop / bottom-nav mobile)", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/");
  await page.waitForLoadState("networkidle");

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

test("no horizontal scroll at any viewport", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const scrollX = await page.evaluate(() => window.scrollX);
  expect(Math.abs(scrollX)).toBeLessThan(2);
  // Also check a deep tab.
  await page.goto("/catalogo-admin");
  await page.waitForLoadState("networkidle");
  const scrollX2 = await page.evaluate(() => window.scrollX);
  expect(Math.abs(scrollX2)).toBeLessThan(2);
});

test("catalog uses a multi-column grid on desktop, single column on mobile", async ({ page }, testInfo) => {
  await page.goto("/catalogo-admin");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/catalogo-admin");
  await page.waitForLoadState("networkidle");

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

test("form Sheet is centered modal on desktop, bottom-anchored on mobile", async ({ page }, testInfo) => {
  await page.goto("/catalogo-admin");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/catalogo-admin");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await expect(page.getByRole("heading", { name: "Agregar producto" })).toBeVisible();

  // The sheet panel is the element with rounded-t-sheet (mobile) or rounded-sheet (desktop).
  const panel = page.locator(".bg-paper.shadow-lift");
  const box = await panel.boundingBox();
  expect(box).toBeTruthy();
  const viewportH = testInfo.project.use.viewport?.height ?? 844;
  if (testInfo.project.name === "desktop") {
    // Centered: panel top is well below 0 (not pinned to bottom as a sheet would be),
    // and width is capped (max-w-lg ~ 512px), not full viewport width.
    expect(box!.y).toBeGreaterThan(40);
    expect(box!.width).toBeLessThan(700);
  } else {
    // Bottom-anchored sheet: panel bottom near viewport bottom.
    expect(box!.y + box!.height).toBeGreaterThan(viewportH - 80);
  }
});

test("desktop sidebar navigates between tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sidebar nav is desktop-only");
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Pedidos" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
  await page.getByRole("button", { name: "Clientes" }).click();
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
});
