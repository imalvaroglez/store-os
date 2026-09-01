import { expect, type Page } from "@playwright/test";
import { buildSeedState } from "./seed";

// Shared helpers for the Firebase-emulator e2e specs. Every helper here is the
// exact behavior that used to live as module-local copies in firebase.spec.ts,
// public-catalog.spec.ts, and theme.spec.ts — extracted verbatim so the suite
// has one source of truth for emulator login/navigation.
//
// Prereq: the app is served with VITE_FIREBASE_EMULATOR=true (see
// playwright.firebase.config.ts) and the emulator is running.

export const PROJECT = "store-os-demo";

// The platform super-admin email. firestore.rules gates super_admin creation on
// this verified email (isAllowlistedSuperAdmin), so any test that needs an admin
// (first signup → super_admin) MUST register with it. Each such test wipes the
// emulator first (wipeEmulator empties Auth), so the fixed email re-registers
// without conflict. Tests that only need a member still use unique(...).
export const ADMIN_EMAIL = "admin@store.os";

let counter = 0;
export function unique(prefix: string) {
  counter += 1;
  return `${prefix}+${Date.now()}_${counter}@example.com`;
}

export const FIRESTORE_REST = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

export function encode(value: unknown): unknown {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === "object") return { mapValue: { fields: toFields(value as Record<string, unknown>) } };
  return { nullValue: null };
}

export function toFields(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, encode(entry)]));
}

export async function adminToken(email: string, password: string) {
  const response = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key-for-emulator",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
  );
  const value = (await response.json()) as { idToken?: string; localId?: string };
  if (!value.idToken || !value.localId) throw new Error(`Could not authenticate fixture owner: ${JSON.stringify(value)}`);
  return { token: value.idToken, uid: value.localId };
}

// Create-or-sign-in an emulator account (REST fixtures can outlive a wipe, so
// sign-up falls back to sign-in) and return its token + uid.
export async function mintUserToken(email = ADMIN_EMAIL, password = "password123") {
  const base = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
  const creds = { email, password, returnSecureToken: true };
  const post = (action: string) =>
    fetch(`${base}/accounts:${action}?key=fake-api-key-for-emulator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    }).then((r) => r.json() as Promise<{ idToken?: string; localId?: string }>);
  let data = await post("signUp");
  if (!data.idToken) data = await post("signInWithPassword");
  if (!data.idToken || !data.localId) throw new Error(`Could not mint token for ${email}: ${JSON.stringify(data)}`);
  await verifyEmulatorEmail(email, password);
  return adminToken(email, password);
}

// Explicit test-only fixture. Production code intentionally never auto-seeds a
// new account; emulator suites install their own data after authentication.
export async function seedEmulatorFixtures(email = ADMIN_EMAIL, password = "password123") {
  const auth = await adminToken(email, password);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` };
  const patch = async (collection: string, id: string, data: Record<string, unknown>) => {
    const response = await fetch(`${FIRESTORE_REST}/${collection}/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ fields: toFields(data) }),
    });
    if (!response.ok) throw new Error(`Fixture write failed for ${collection}/${id}: ${response.status} ${await response.text()}`);
  };
  const state = buildSeedState();
  for (const store of state.stores) {
    const membership = { ownerUid: auth.uid, memberUids: [auth.uid], pendingInvites: [] };
    await patch("adminStores", store.id, {
      storeId: store.id,
      name: store.name,
      slug: store.slug,
      type: store.type,
      ...membership,
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
      retainedPrivacyRequestCount: 0,
    });
    await patch("stores", store.id, { ...store, ...membership });
  }
  for (const [collection, values] of [
    ["products", state.products],
    ["categories", state.categories],
    ["suppliers", state.suppliers],
    ["purchases", state.purchases],
    ["customers", state.customers],
    ["orders", state.orders],
  ] as const) {
    for (const value of values) await patch(collection, value.id, value as unknown as Record<string, unknown>);
  }
}

// Test-only direct Firestore write (emulator REST). Used by the refresh e2e to
// simulate data landing "between deploys" without going through the UI.
export async function writeEmulatorDoc(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  email = ADMIN_EMAIL,
  password = "password123"
) {
  const auth = await adminToken(email, password);
  const response = await fetch(`${FIRESTORE_REST}/${collection}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!response.ok) {
    throw new Error(`Emulator write failed for ${collection}/${id}: ${response.status} ${await response.text()}`);
  }
}

// Wipe Auth + Firestore in the emulator (same endpoints as firebase-global-setup).
// The explicit fixture login below always starts from this deterministic state.
export async function wipeEmulator(): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, {
      method: "DELETE",
    });
    await fetch(
      `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
      { method: "DELETE" }
    );
    // The Firestore emulator's bulk DELETE can return before the deletion is fully
    // durable; a brief settle avoids a follow-up fixture seed seeing stale
    // stores and skipping (leaving the new admin with no products).
    await new Promise((r) => setTimeout(r, 400));
  } catch {
    // Emulator not reachable — tests will fail loudly downstream.
  }
}

export async function gotoClean(page: Page, path = "/") {
  // Don't use waitForLoadState("networkidle") — Firestore onSnapshot keeps the
  // network busy in cloud mode. domcontentloaded + a settle delay instead.
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await hideEmulatorBanner(page);
}

// The Firebase emulator SDK injects a fixed-position <p class="firebase-emulator-
// warning"> banner that, on small viewports, overlays and intercepts pointer
// events on buttons. A <style> added AFTER navigation hides the class for the
// rest of the page's life (also for banner nodes created later). Early injection
// via addInitScript does NOT survive the HTML parser, so post-navigation is the
// one reliable spot — call it from the navigation helpers, after the settle.
export async function hideEmulatorBanner(page: Page) {
  await page.addStyleTag({
    content: ".firebase-emulator-warning{display:none!important;pointer-events:none!important;}",
  }).catch(() => {});
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
  await hideEmulatorBanner(page);
  await page.getByRole("button", { name: "Opciones" }).first().click();
  await expect(page.getByRole("heading", { name: "Opciones" })).toBeVisible();
}

export async function ensureSignedOut(page: Page) {
  // Hard-reset auth by clearing session storage + reload (more reliable than
  // racing the async signOut() UI flow across tests).
  await clearSession(page);
  await gotoClean(page);
}

// Emulator-only: complete the real email verification round-trip via the
// emulator's documented OOB-code endpoint. Password signups start unverified,
// so tests must verify before Firestore accepts their identity token.
export async function verifyEmulatorEmail(email: string, password: string) {
  const base = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
  const signedIn = await fetch(`${base}/accounts:signInWithPassword?key=fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }).then((r) => r.json() as Promise<{ idToken?: string; error?: unknown }>);
  if (!signedIn.idToken) throw new Error(`verifyEmulatorEmail: cannot sign in ${email}: ${JSON.stringify(signedIn)}`);

  const lookup = await fetch(`${base}/accounts:lookup?key=fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: signedIn.idToken }),
  }).then((r) => r.json() as Promise<{ users?: { emailVerified?: boolean }[] }>);
  if (lookup.users?.[0]?.emailVerified) return;

  await fetch(`${base}/accounts:sendOobCode?key=fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken: signedIn.idToken }),
  });
  const codes = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`)
    .then((r) => r.json() as Promise<{ oobCodes?: { email: string; requestType: string; oobLink: string }[] }>);
  const verification = [...(codes.oobCodes ?? [])]
    .reverse()
    .find((code) => code.email === email && code.requestType === "VERIFY_EMAIL");
  if (!verification) throw new Error(`verifyEmulatorEmail: no verification code for ${email}`);
  const done = await fetch(verification.oobLink);
  if (!done.ok) throw new Error(`verifyEmulatorEmail: verification failed for ${email}: ${done.status}`);
}

export async function signUp(page: Page, email: string, password: string) {
  await signUpInUi(page, email, password);
  // Sign the fresh account in again with a verified email: the signup session's
  // token predates verification, so clear it and log in (the login path then
  // creates the profile and reconciles pending invites like any real user).
  await verifyEmulatorEmail(email, password);
  await clearSession(page);
  await signIn(page, email, password);
}

async function signUpInUi(page: Page, email: string, password: string) {
  await gotoClean(page);
  if ((await page.getByRole("heading", { name: "Entrar", exact: true }).count()) === 0) {
    await openSettings(page);
    await page.getByRole("button", { name: /Entrar \/ Crear cuenta/ }).click();
  }
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /No tienes cuenta\? Crear una/ }).click();
  await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  const existing = page.getByText("Ese correo ya está registrado. Intenta entrar.");
  if (await expect(existing).toBeVisible({ timeout: 5000 }).then(() => true).catch(() => false)) {
    await page.getByRole("button", { name: /Ya tienes cuenta\? Entrar/ }).click();
  }
  // Wait for the auth sheet to close.
  await expect(page.getByRole("heading", { name: "Crear cuenta" })).toHaveCount(0, {
    timeout: 15000,
  });
}

export async function signIn(page: Page, email: string, password: string) {
  await gotoClean(page);
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toHaveCount(0, {
    timeout: 15000,
  });
}

// Navigate to "/" (reload), normalize to the Santi store, and land on Inicio.
// Use at the start of each test in a shared-page spec: page.goto resets the
// route and cloud activeStore (to stores[0] = Joyería), so we re-normalize.
export async function gotoSantiHome(page: Page) {
  await gotoClean(page);
  await ensureSantiActive(page);
  await page.getByRole("button", { name: "Inicio" }).click();
  await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
}

export async function openCatalog(page: Page) {
  // The "Productos" parent navigates directly to the product list (the former
  // "Catálogo" tab; unified-products). Its chevron only expands children.
  await page.getByRole("button", { name: /^Productos/ }).first().click();
  await expect(page.getByRole("heading", { name: "Catálogo", exact: true })).toBeVisible();
}

// Deterministic super_admin login: wipe, authenticate the allow-listed test
// admin, install explicit emulator-only fixtures, and wait for them in the UI.
export async function loginAsFirstAdmin(page: Page, password = "password123") {
  await wipeEmulator();
  const email = ADMIN_EMAIL;
  await signUp(page, email, password);
  await seedEmulatorFixtures(email, password);
  await waitForCloudSeed(page);
}

// Wait for the explicit test fixture, then normalize on Santi.
export async function waitForCloudSeed(page: Page) {
  await gotoClean(page);
  await expect(page.getByText(/¿Qué necesitas hacer hoy en (Santi|Joyería)\?/)).toBeVisible({
    timeout: 20000,
  });
  // If Joyería (or anything else) is active, switch to Santi.
  if ((await page.getByText("¿Qué necesitas hacer hoy en Santi?").count()) === 0) {
    await switchToStore(page, "Santi");
    await expect(page.getByText("¿Qué necesitas hacer hoy en Santi?")).toBeVisible({
      timeout: 15000,
    });
  }
  // Open the catalog to check whether Santi's seeded products have synced.
  await openCatalog(page);
  await expect(page.getByText("Perfume Baccarat Rouge 540")).toBeVisible({ timeout: 20000 });
  // Return to Inicio so tests start from the home screen.
  await page.getByRole("button", { name: "Inicio" }).click();
  await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
}

// Switch the active store via the in-app StoreSwitcher dropdown. Assumes the
// shell is mounted (a store is active). The switcher is the button showing the
// current store name + a ▾ caret, in the mobile header or desktop sidebar.
export async function switchToStore(page: Page, name: string) {
  // Scope to header/sidebar (the store switcher only lives there at rest) and
  // pick the first VISIBLE one — on mobile the <aside> sidebar is rendered but
  // hidden via CSS, so an unfiltered .first() would grab an off-screen button.
  const candidates = page.locator("header button, aside button").filter({ hasText: "▾" });
  const switcher = candidates.filter({ visible: true }).first();
  await switcher.click();
  await page.getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(500);
}

// After a reload in cloud mode, activeStore resets to stores[0] (Joyería by doc
// id order) and the route stays where it was. Normalize back to Santi so tests
// that re-assert Santi's data keep working. Detects the active store from the
// switcher button (present on every admin screen), not the home text — after a
// reload the route may be a deep tab, not Inicio.
export async function ensureStoreActive(page: Page, name: string) {
  // Wait for the shell (store switcher) to mount — it carries the active store's
  // initial in its avatar + name.
  const switcher = page
    .locator("header button, aside button")
    .filter({ hasText: "▾" })
    .filter({ visible: true })
    .first();
  await expect(switcher).toBeVisible({ timeout: 20000 });
  if ((await switcher.textContent())?.includes(name) !== true) {
    await switchToStore(page, name);
  }
}

export async function ensureSantiActive(page: Page) {
  await ensureStoreActive(page, "Santi");
}
