import { test, expect } from "@playwright/test";

// Fast build smoke for `npm run e2e` (no emulator). Boots the production preview
// build (DEV=false) and confirms the app forces the AuthScreen when signed out
// (the built app requires authentication before anything else). This is the only
// spec in the default config; the full suite runs against the emulator via
// `npm run e2e:firebase`.

test("prod build removes only old admin state before showing AuthScreen", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("store_os_state_v1", JSON.stringify({ stores: [{ id: "old", name: "Señuelo privado" }] }));
    localStorage.setItem("store_os_theme", "paper");
    localStorage.setItem("store-os:cart:olivia", JSON.stringify({ v: 1, lines: [] }));
    localStorage.setItem("store_os_order_draft_v3::uid_test::store_olivia::new", "draft");
  });
  await page.goto("/");
  // AuthScreen renders a "Entrar" heading + a "Continuar con Google" button.
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continuar con Google/ })).toBeVisible();
  await expect(page.getByText("Señuelo privado")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("store_os_state_v1"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("store_os_theme"))).toBe("paper");
  expect(await page.evaluate(() => localStorage.getItem("store-os:cart:olivia"))).toBe(JSON.stringify({ v: 1, lines: [] }));
  expect(await page.evaluate(() => localStorage.getItem("store_os_order_draft_v3::uid_test::store_olivia::new"))).toBe("draft");
});
