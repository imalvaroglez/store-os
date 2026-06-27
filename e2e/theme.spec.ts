import { test, expect } from "@playwright/test";

// Theme switching via the Settings picker. Runs at both mobile + desktop projects.

async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Settings lives in the sidebar (desktop) or the ⚙️ header button (mobile).
  // Both expose an accessible name "Opciones".
  await page.getByRole("button", { name: "Opciones" }).first().click();
  await expect(page.getByRole("heading", { name: "Opciones" })).toBeVisible();
}

test("switching theme updates data-theme and a CSS var", async ({ page }) => {
  await openSettings(page);
  // Sanity: default is paper.
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

test("theme choice persists across reload", async ({ page }) => {
  await openSettings(page);
  await page.locator("button", { hasText: "Lujo" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "luxury");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "luxury");
});
