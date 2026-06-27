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
