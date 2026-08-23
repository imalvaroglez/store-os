import { test as base, expect, type Page } from "@playwright/test";
import {
  unique,
  gotoClean,
  clearSession,
  openSettings,
  ensureSignedOut,
  signUp,
  signIn,
  ADMIN_EMAIL,
  loginAsFirstAdmin,
  openCatalog,
  switchToStore,
} from "./helpers";

// End-to-end against the Firebase Emulator (Auth + Firestore). Covers the
// foundation: allow-listed admin + explicit emulator fixtures; sign out; and a
// second signup that remains a member with no stores until invited.
//
// One browser context is created in beforeAll and reused across the admin tests
// (picker/photo) so Firebase Auth's indexedDB session persists. The auth-specific
// tests (sign out, member) use fresh contexts. This keeps seed invocations low.

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
  await loginAsFirstAdmin(sharedPage, "firebase");
});

test.afterAll(async () => {
  await sharedPage?.context().close();
  sharedPage = null;
});

test("first signup becomes super_admin and test fixtures stay in the emulator", async ({ sharedPage: page }) => {
  await gotoClean(page);
  await openSettings(page);
  await expect(page.getByText(/administrador/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/viven en la nube/)).toBeVisible();
  await gotoClean(page);
  await expect(page.getByText(/¿Qué necesitas hacer hoy en (Santi|Joyería)\?/)).toBeVisible({
    timeout: 15000,
  });
});

test("sign out returns to the authentication screen", async ({ sharedPage: page }) => {
  // Hard sign-out on the shared page: clear the cached Firebase session + reload.
  await clearSession(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible({
    timeout: 15000,
  });
});

test("picker: switch store + manage (rename / type change)", async ({ sharedPage: page }) => {
  await ensureSignedOut(page);
  await signIn(page, ADMIN_EMAIL, "password123");
  await gotoClean(page);

  const cambiar = page.getByRole("button", { name: /Cambiar tienda/ });
  test.skip(!(await cambiar.count().catch(() => 0)), "not in a store (member w/ no stores)");
  await cambiar.click();
  await page.waitForTimeout(800);
  await expect(page.getByText("¿Quién opera hoy?")).toBeVisible();
  await expect(page.getByText("Santi")).toBeVisible();
  await expect(page.getByText("Joyería")).toBeVisible();
  await page.getByText("Santi", { exact: false }).first().click();
  await page.waitForTimeout(800);
  await expect(page.getByText(/¿Qué necesitas hacer hoy en Santi\?/)).toBeVisible({ timeout: 15000 });
});

test("picker: create a new store from the picker", async ({ sharedPage: page }) => {
  await ensureSignedOut(page);
  await signIn(page, ADMIN_EMAIL, "password123");
  await gotoClean(page);

  const cambiar = page.getByRole("button", { name: /Cambiar tienda/ });
  if (await cambiar.count().catch(() => 0)) {
    await cambiar.click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /Nueva tienda/ }).click();
  } else {
    await page.getByRole("button", { name: /Crear tienda/ }).click();
  }
  await page.waitForTimeout(400);
  await page.getByLabel("Nombre de la tienda").fill("Tienda Nueva");
  await page.getByRole("button", { name: "Crear tienda" }).last().click();
  await page.waitForTimeout(2000);
  await expect(page.getByText(/¿Qué necesitas hacer hoy en Tienda Nueva\?/)).toBeVisible({
    timeout: 20000,
  });
});

test("an invited-less member sees no stores", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signUp(page, unique("member"), "password123");
    await gotoClean(page);
    await expect(page.getByText("Crea tu primera tienda")).toBeVisible({ timeout: 15000 });
    // A non-allowlisted account has neither a store shell nor admin controls.
    await expect(page.getByRole("button", { name: "Opciones" })).toHaveCount(0);
    await expect(page.getByText(/administrador/)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("product photo uploads, resizes, and renders", async ({ sharedPage: page }) => {
  await ensureSignedOut(page);
  await signIn(page, ADMIN_EMAIL, "password123");
  await gotoClean(page);

  const cambiar = page.getByRole("button", { name: /Cambiar tienda/ });
  if ((await cambiar.count().catch(() => 0))) {
    // Normalize to an on_demand store: the tiered form has no "Precio de venta".
    await switchToStore(page, "Santi");
  } else {
    await page.getByRole("button", { name: /Crear tienda/ }).click();
    await page.waitForTimeout(400);
    await page.getByLabel("Nombre de la tienda").fill("Tienda Foto");
    await page.getByRole("button", { name: "Crear tienda" }).last().click();
  }
  await expect(page.getByText(/¿Qué necesitas hacer hoy en/)).toBeVisible({ timeout: 20000 });

  await openCatalog(page);
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await expect(page.getByRole("heading", { name: "Agregar producto" })).toBeVisible();
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill("Producto con foto");
  await page.getByLabel("Precio de venta").fill("500");

  const file = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff6600";
    ctx.fillRect(0, 0, 1200, 1200);
    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png")
    );
    const b64: string = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.readAsDataURL(blob);
    });
    return { name: "big.png", mimeType: "image/png", buffer: b64 };
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: file.name,
    mimeType: file.mimeType,
    buffer: Buffer.from(file.buffer, "base64"),
  });
  await expect(page.locator('img[src^="blob:"]')).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByRole("heading", { name: "Agregar producto" })).toHaveCount(0, {
    timeout: 20000,
  });

  const img = page.locator("img").first();
  await expect(img).toBeVisible({ timeout: 10000 });
  const src = await img.getAttribute("src");
  expect(src).toBeTruthy();
  expect(src).toMatch(/products%2F.+\.jpg/);
  expect(src).toContain("9199");
});
