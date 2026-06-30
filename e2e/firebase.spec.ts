import { test, expect, type Page } from "@playwright/test";

// End-to-end against the Firebase Emulator (Auth + Firestore). Covers the
// foundation: first signup -> super_admin + cloud seed; sign out -> local demo;
// a second signup -> member with no stores until invited.
//
// Prereq: emulator running (`npm run emulators`); app served with
// VITE_FIREBASE_EMULATOR=true (see playwright.firebase.config.ts). A globalSetup
// wipes Auth + Firestore before the run so the bootstrap is deterministic.

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}+${Date.now()}_${counter}@example.com`;
}

async function gotoClean(page: Page, path = "/") {
  // Don't use waitForLoadState("networkidle") — Firestore onSnapshot keeps the
  // network busy in cloud mode. domcontentloaded + a settle delay instead.
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
}

// Clear browser-stored auth/localStorage so no prior session leaks across tests.
// Firebase persists the session in indexedDB (firebaseLocalStorageDb) + localStorage.
async function clearSession(page: Page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    // Best-effort: delete Firebase's known persistence DB. Errors are ignored.
    try { indexedDB.deleteDatabase("firebaseLocalStorageDb"); } catch {}
  });
}

async function openSettings(page: Page) {
  // Ensure we're on the admin shell (which has the Opciones button). Navigating
  // home is a no-op if already there and guarantees the sidebar/header is present
  // even after a signup that landed elsewhere.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Opciones" }).first().click();
  await expect(page.getByRole("heading", { name: "Opciones" })).toBeVisible();
}

async function ensureSignedOut(page: Page) {
  // Hard-reset auth by clearing session storage + reload (more reliable than
  // racing the async signOut() UI flow across tests).
  await clearSession(page);
  await gotoClean(page);
}

async function signUp(page: Page, email: string, password: string) {
  await openSettings(page);
  await page.getByRole("button", { name: /Entrar \/ Crear cuenta/ }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await page.getByRole("button", { name: /No tienes cuenta\? Crear una/ }).click();
  await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  // Wait for the auth sheet to close.
  await expect(page.getByRole("heading", { name: "Crear cuenta" })).toHaveCount(0, {
    timeout: 15000,
  });
}

test("first signup becomes super_admin and cloud data is seeded", async ({ page }) => {
  await gotoClean(page);
  await expect(page.getByText("¿Qué necesitas hacer hoy en Santi?")).toBeVisible();

  const email = unique("admin");
  await signUp(page, email, "password123");

  // Settings shows the connected admin email + cloud copy.
  await gotoClean(page);
  await openSettings(page);
  const emailRe = new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  await expect(page.getByText(emailRe)).toBeVisible();
  await expect(page.getByText(/administrador/)).toBeVisible();
  await expect(page.getByText(/viven en la nube/)).toBeVisible();

  // Cloud has the seeded demo stores (one of them is active on home).
  await gotoClean(page);
  await expect(page.getByText(/¿Qué necesitas hacer hoy en (Santi|Joyería)\?/)).toBeVisible({
    timeout: 15000,
  });
});

test("sign out returns to the local demo", async ({ page }) => {
  await gotoClean(page);
  await ensureSignedOut(page);

  // Sign up a user (admin or member — doesn't matter for sign-out behavior).
  await signUp(page, unique("signout"), "password123");
  await gotoClean(page);

  // Hard sign-out: clear the cached Firebase session + reload.
  await clearSession(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  // Back in local demo (no session): the local seeded Santi store is visible, and
  // Settings offers sign-in again.
  await expect(page.getByText("¿Qué necesitas hacer hoy en Santi?")).toBeVisible({
    timeout: 15000,
  });
  await openSettings(page);
  await expect(page.getByRole("button", { name: /Entrar \/ Crear cuenta/ })).toBeVisible();
});

test("picker: switch store + manage (rename / type change)", async ({ page }) => {
  await gotoClean(page);
  await ensureSignedOut(page);

  // Sign up admin (seeded with Santi + Joyería) and land in a store.
  await signUp(page, unique("pickeradmin"), "password123");
  await gotoClean(page);

  // This test only applies if the user is in a store (admin). If a prior test in
  // the run already created an admin, this signup is a member with no stores ->
  // skip gracefully.
  const cambiar = page.getByRole("button", { name: /Cambiar tienda/ });
  test.skip(!(await cambiar.count().catch(() => 0)), "not in a store (member w/ no stores)");

  // "Cambiar tienda" returns to the picker.
  await cambiar.click();
  await page.waitForTimeout(800);
  await expect(page.getByText("¿Quién opera hoy?")).toBeVisible();
  await expect(page.getByText("Santi")).toBeVisible();
  await expect(page.getByText("Joyería")).toBeVisible();

  // Pick Santi -> enters it.
  await page.getByText("Santi", { exact: false }).first().click();
  await page.waitForTimeout(800);
  await expect(page.getByText(/¿Qué necesitas hacer hoy en Santi\?/)).toBeVisible({
    timeout: 15000,
  });
});

test("picker: create a new store from the picker", async ({ page }) => {
  await gotoClean(page);
  await ensureSignedOut(page);
  await signUp(page, unique("createadmin"), "password123");
  await gotoClean(page);

  // Reach the store-creation form. If we're in a store (admin), use "Cambiar
  // tienda" -> "Nueva tienda". If we're on the empty state (no stores), use its
  // "Crear tienda" button directly.
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
  // The form's submit is the full-width "Crear tienda" button (distinct from the
  // empty-state opener, which is gone once the sheet is open).
  await page.getByRole("button", { name: "Crear tienda" }).last().click();
  await page.waitForTimeout(2000);
  // addStore makes the new store active -> we enter it.
  await expect(page.getByText(/¿Qué necesitas hacer hoy en Tienda Nueva\?/)).toBeVisible({
    timeout: 20000,
  });
});

test("an invited-less member sees no stores", async ({ page }) => {
  await gotoClean(page);
  await ensureSignedOut(page);

  // Sign up a first user (becomes admin, cloud seeded).
  await signUp(page, unique("memberadmin"), "password123");
  await gotoClean(page);

  // Hard-reset the Firebase session (clears cached auth) and reload to a clean
  // signed-out state before signing up the second user.
  await clearSession(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  // Second signup -> member (admin already exists) -> not seeded -> empty state.
  await signUp(page, unique("member"), "password123");
  await gotoClean(page);
  await expect(page.getByText("Crea tu primera tienda")).toBeVisible({ timeout: 15000 });
});

test("product photo uploads, resizes, and renders", async ({ page }) => {
  await gotoClean(page);
  await ensureSignedOut(page);
  await signUp(page, unique("photoadmin"), "password123");
  await gotoClean(page);

  // Ensure we're operating inside a store. If a prior test already created the
  // admin (making this signup a member with no stores), create one from the empty
  // state — otherwise an existing store is already active. Either way, wait until
  // the home screen confirms a store is active before navigating, so the cloud
  // write has propagated (mirrors the picker "create a store" test).
  const cambiar = page.getByRole("button", { name: /Cambiar tienda/ });
  if (!(await cambiar.count().catch(() => 0))) {
    await page.getByRole("button", { name: /Crear tienda/ }).click();
    await page.waitForTimeout(400);
    await page.getByLabel("Nombre de la tienda").fill("Tienda Foto");
    await page.getByRole("button", { name: "Crear tienda" }).last().click();
  }
  await expect(page.getByText(/¿Qué necesitas hacer hoy en/)).toBeVisible({ timeout: 20000 });

  // Open the catalog via the in-app nav (keeps the in-memory active store; a cold
  // route change would leave activeStore null and CatalogScreen renders nothing).
  await page.getByRole("button", { name: "Catálogo" }).click();
  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible();
  await page.getByRole("button", { name: "+ Agregar" }).click();
  await expect(page.getByRole("heading", { name: "Agregar producto" })).toBeVisible();
  await page.getByLabel("Nombre").fill("Producto con foto");

  // Generate a >1024px PNG at runtime (so resize actually downscales) and feed
  // it to the hidden file input. The buffer is produced in-browser via canvas.
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
    // base64-encode in-browser (no Buffer in page context).
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

  // Save: upload-on-submit, then the form closes.
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByRole("heading", { name: "Agregar producto" })).toHaveCount(0, {
    timeout: 20000,
  });

  // The product row renders its photo <img> from the uploaded (resized) URL.
  const img = page.locator("img").first();
  await expect(img).toBeVisible({ timeout: 10000 });
  const src = await img.getAttribute("src");
  expect(src).toBeTruthy();
  // A Storage-emulator download URL references the object path (URL-encoded)
  // and the emulator host. This proves the upload produced a real Storage URL.
  expect(src).toMatch(/products%2F.+\.jpg/);
  expect(src).toContain("9199");
});
