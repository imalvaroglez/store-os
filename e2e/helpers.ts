import { expect, type Page } from "@playwright/test";

// Shared helpers for the Firebase-emulator e2e specs. Every helper here is the
// exact behavior that used to live as module-local copies in firebase.spec.ts,
// public-catalog.spec.ts, and theme.spec.ts — extracted verbatim so the suite
// has one source of truth for emulator login/navigation.
//
// Prereq: the app is served with VITE_FIREBASE_EMULATOR=true (see
// playwright.firebase.config.ts) and the emulator is running.

let counter = 0;
export function unique(prefix: string) {
  counter += 1;
  return `${prefix}+${Date.now()}_${counter}@example.com`;
}

export async function gotoClean(page: Page, path = "/") {
  // Don't use waitForLoadState("networkidle") — Firestore onSnapshot keeps the
  // network busy in cloud mode. domcontentloaded + a settle delay instead.
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
}

// Clear browser-stored auth/localStorage so no prior session leaks across tests.
// Firebase persists the session in indexedDB (firebaseLocalStorageDb) + localStorage.
export async function clearSession(page: Page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    // Best-effort: delete Firebase's known persistence DB. Errors are ignored.
    try { indexedDB.deleteDatabase("firebaseLocalStorageDb"); } catch {}
  });
}

export async function openSettings(page: Page) {
  // Ensure we're on the admin shell (which has the Opciones button). Navigating
  // home is a no-op if already there and guarantees the sidebar/header is present
  // even after a signup that landed elsewhere.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Opciones" }).first().click();
  await expect(page.getByRole("heading", { name: "Opciones" })).toBeVisible();
}

export async function ensureSignedOut(page: Page) {
  // Hard-reset auth by clearing session storage + reload (more reliable than
  // racing the async signOut() UI flow across tests).
  await clearSession(page);
  await gotoClean(page);
}

export async function signUp(page: Page, email: string, password: string) {
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
