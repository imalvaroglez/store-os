import { expect, type Page } from "@playwright/test";
import { buildSeedState } from "./seed";

// Shared helpers for the Firebase-emulator e2e specs. Every helper here is the
// exact behavior that used to live as module-local copies in firebase.spec.ts,
// public-catalog.spec.ts, and theme.spec.ts — extracted verbatim so the suite
// has one source of truth for emulator login/navigation.
//
// Prereq: the app is served with VITE_FIREBASE_EMULATOR=true (see
// playwright.firebase.config.ts) and the emulator is running.

const PROJECT = "store-os-demo";

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

const FIRESTORE_REST = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

function encode(value: unknown): unknown {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === "object") return { mapValue: { fields: toFields(value as Record<string, unknown>) } };
  return { nullValue: null };
}

function toFields(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, encode(entry)]));
}

async function adminToken(email: string, password: string) {
  const response = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key-for-emulator",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
  );
  const value = (await response.json()) as { idToken?: string; localId?: string };
  if (!value.idToken || !value.localId) throw new Error(`Could not authenticate fixture owner: ${JSON.stringify(value)}`);
  return { token: value.idToken, uid: value.localId };
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
    // durable; a brief settle avoids a follow-up seedCloudIfEmpty seeing stale
    // stores and skipping the seed (leaving the new admin with no products).
    await new Promise((r) => setTimeout(r, 400));
  } catch {
    // Emulator not reachable — tests will fail loudly downstream.
  }
}

export async function gotoClean(page: Page, path = "/") {
  // Install the banner-killer before navigating (best-effort, see
  // hideEmulatorBanner).
  await hideEmulatorBanner(page);
  // Don't use waitForLoadState("networkidle") — Firestore onSnapshot keeps the
  // network busy in cloud mode. domcontentloaded + a settle delay instead.
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  // Imperatively hide the emulator banner on the now-live DOM too. addInitScript
  // races the SDK (the banner is injected post-load by the Firebase emulator
  // SDK); adding a <style> after the settle delay reliably neutralizes it for the
  // current page so it can't intercept clicks on small viewports.
  await killEmulatorBanner(page);
}

// Inject a <style> hiding the emulator banner on the live DOM. Unlike
// addInitScript (which races the SDK), this runs AFTER navigation so the banner
// node already exists. Persists until the next navigation.
export async function killEmulatorBanner(page: Page) {
  await page.addStyleTag({
    content: ".firebase-emulator-warning{display:none!important;pointer-events:none!important;}",
  }).catch(() => {});
}

// The Firebase emulator SDK injects a fixed-position <p class="firebase-emulator-
// warning"> banner that, on small viewports, overlays and intercepts pointer
// events on buttons (signUp was timing out on mobile because the banner sat on
// top of "¿No tienes cuenta? Crear una"). The SDK re-creates the node, so
// removing it races; instead we inject a <style> that neutralizes the class
// (pointer-events: none + display: none) which survives re-creation. The style
// is re-injected on every navigation via addInitScript.
const BANNER_KILLER = `
(() => {
  const css = '.firebase-emulator-warning{display:none!important;pointer-events:none!important;}';
  let s = document.getElementById('e2e-banner-killer');
  if (!s) {
    s = document.createElement('style');
    s.id = 'e2e-banner-killer';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  new MutationObserver(() => {
    if (!document.getElementById('e2e-banner-killer')) {
      const ns = document.createElement('style');
      ns.id = 'e2e-banner-killer';
      ns.textContent = css;
      (document.head || document.documentElement).appendChild(ns);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
`;
export async function hideEmulatorBanner(page: Page) {
  await page.addInitScript(BANNER_KILLER);
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
  await hideEmulatorBanner(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await killEmulatorBanner(page);
  await page.getByRole("button", { name: "Opciones" }).first().click();
  await expect(page.getByRole("heading", { name: "Opciones" })).toBeVisible();
}

export async function ensureSignedOut(page: Page) {
  // Hard-reset auth by clearing session storage + reload (more reliable than
  // racing the async signOut() UI flow across tests).
  await clearSession(page);
  await gotoClean(page);
}

// Emulator-only: complete the REAL email verification round-trip via REST
// (sendOobCode with returnOobLink is an emulator-privileged admin call, then
// accounts:update consumes the oobCode). Password signups in the emulator are
// unverified — the app's central guard correctly holds the profile back until
// the email is verified, so tests must verify before expecting a profile.
export async function verifyEmulatorEmail(email: string, password: string) {
  const base = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
  const idToken = await fetch(`${base}/accounts:signInWithPassword?key=fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
    .then((r) => r.json())
    .then((v: { idToken?: string }) => {
      if (!v.idToken) throw new Error(`verifyEmulatorEmail: cannot sign in ${email}`);
      return v.idToken;
    });
  const oobCode = await fetch(`${base}/accounts:sendOobCode?key=fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken, returnOobLink: true }),
  })
    .then((r) => r.json())
    .then((v: { oobCode?: string }) => {
      if (!v.oobCode) throw new Error(`verifyEmulatorEmail: no oobCode for ${email}`);
      return v.oobCode;
    });
  const done = await fetch(`${base}/accounts:update?key=fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oobCode }),
  }).then((r) => r.json());
  if (done.emailVerified !== true) throw new Error(`verifyEmulatorEmail: not verified for ${email}`);
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
  // The Firebase emulator injects a fixed-position banner that, on small
  // viewports, overlays and intercepts pointer events on the auth-sheet buttons.
  // addInitScript's banner-killer races the SDK, so also hide it imperatively on
  // the live DOM right before interacting (addStyleTag applies immediately and
  // persists until the next navigation; the sheet opens without navigating).
  await page.addStyleTag({
    content: ".firebase-emulator-warning{display:none!important;pointer-events:none!important;}",
  });
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
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
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
  await page.getByRole("button", { name: /^Catálogo/ }).click();
  const products = page.getByRole("menuitem", { name: "Productos" });
  if (await products.isVisible().catch(() => false)) await products.click();
  else await page.getByRole("button", { name: "Productos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Catálogo", exact: true })).toBeVisible();
}

// Deterministic super_admin login: wipe, authenticate the allow-listed test
// admin, install explicit emulator-only fixtures, and wait for them in the UI.
export async function loginAsFirstAdmin(page: Page, prefix: string, password = "password123") {
  await wipeEmulator();
  void prefix;
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
export async function ensureSantiActive(page: Page) {
  await killEmulatorBanner(page);
  // Wait for the shell (store switcher) to mount — it carries the active store's
  // initial in its avatar + name.
  const switcher = page
    .locator("header button, aside button")
    .filter({ hasText: "▾" })
    .filter({ visible: true })
    .first();
  await expect(switcher).toBeVisible({ timeout: 20000 });
  if ((await switcher.textContent())?.includes("Santi") !== true) {
    await switchToStore(page, "Santi");
  }
}
