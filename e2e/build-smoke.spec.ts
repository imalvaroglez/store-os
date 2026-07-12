import { test, expect } from "@playwright/test";

// Fast build smoke for `npm run e2e` (no emulator). Boots the production preview
// build (DEV=false) and confirms the app forces the AuthScreen when signed out
// (the built app requires authentication before anything else). This is the only
// spec in the default config; the full suite runs against the emulator via
// `npm run e2e:firebase`.

test("prod build forces AuthScreen when signed out", async ({ page }) => {
  await page.goto("/");
  // AuthScreen renders a "Entrar" heading + a "Continuar con Google" button.
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continuar con Google/ })).toBeVisible();
});
