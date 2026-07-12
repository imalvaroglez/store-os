import { test as base, expect, type Page } from "@playwright/test";
import { loginAsFirstAdmin, gotoSantiHome, openSettings } from "./helpers";

// Theme switching via the Settings picker, at both mobile + desktop viewports.
// One browser context per project (beforeAll), reused across tests so Firebase
// Auth's indexedDB session persists.

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
  await loginAsFirstAdmin(sharedPage, "theme");
});

test.afterAll(async () => {
  await sharedPage?.context().close();
  sharedPage = null;
});

test("switching theme updates data-theme and a CSS var", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await openSettings(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  for (const [name, expectedPaper] of [
    ["Maximalista", "#fef200"],
    ["Lujo", "#0b0b0d"],
    ["Paper Ledger", "#f6f1e7"],
  ] as const) {
    await page.locator("button", { hasText: name }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", name === "Paper Ledger" ? "paper" : name === "Maximalista" ? "maximalist" : "luxury");
    const paper = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--paper").trim()
    );
    expect(paper).toBe(expectedPaper);
  }
});

test("theme choice persists across reload", async ({ sharedPage: page }) => {
  await gotoSantiHome(page);
  await openSettings(page);
  await page.locator("button", { hasText: "Lujo" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "luxury");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "luxury");
});
