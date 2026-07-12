import { expect, type Page } from "@playwright/test";

// Shared helpers for the Firebase-emulator e2e specs. Every helper here is the
// exact behavior that used to live as module-local copies in firebase.spec.ts,
// public-catalog.spec.ts, and theme.spec.ts — extracted verbatim so the suite
// has one source of truth for emulator login/navigation.
//
// Prereq: the app is served with VITE_FIREBASE_EMULATOR=true (see
// playwright.firebase.config.ts) and the emulator is running.

const PROJECT = "store-os-demo";

let counter = 0;
export function unique(prefix: string) {
  counter += 1;
  return `${prefix}+${Date.now()}_${counter}@example.com`;
}

// Wipe Auth + Firestore in the emulator (same endpoints as firebase-global-setup).
// The first signup in the emulator becomes super_admin and seedCloudIfEmpty
// provisions the demo stores — but only the FIRST signup overall (role is
// "all.empty ? super_admin : member"). globalSetup wipes once at the start of
// the run, so without a per-test wipe every test after the first would sign up
// as a member with no stores. Calling this before signUp makes each test
// deterministic: the next signup is super_admin, Santi is the active store.
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

export async function signUp(page: Page, email: string, password: string) {
  await openSettings(page);
  // The Firebase emulator injects a fixed-position banner that, on small
  // viewports, overlays and intercepts pointer events on the auth-sheet buttons.
  // addInitScript's banner-killer races the SDK, so also hide it imperatively on
  // the live DOM right before interacting (addStyleTag applies immediately and
  // persists until the next navigation; the sheet opens without navigating).
  await page.addStyleTag({
    content: ".firebase-emulator-warning{display:none!important;pointer-events:none!important;}",
  });
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

// Navigate to "/" (reload), normalize to the Santi store, and land on Inicio.
// Use at the start of each test in a shared-page spec: page.goto resets the
// route and cloud activeStore (to stores[0] = Joyería), so we re-normalize.
export async function gotoSantiHome(page: Page) {
  await gotoClean(page);
  await ensureSantiActive(page);
  await page.getByRole("button", { name: "Inicio" }).click();
  await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
}

// Deterministic super_admin login: wipe the emulator so this signup is the first
// user, sign up, and wait for the seeded Santi store to be active + its products
// synced. Used from a spec file's beforeAll on a shared page (one login per file
// per project) — repeated wipe+seed cycles eventually flake, so we minimize them.
export async function loginAsFirstAdmin(page: Page, prefix: string, password = "password123") {
  await wipeEmulator();
  const email = unique(prefix);
  await signUp(page, email, password);
  await waitForCloudSeed(page);
}

// Wait for the cloud seed to land, then normalize on the Santi store. The seed
// creates Santi + Joyería, but loadCloudState() picks activeStoreId = stores[0],
// and Firestore returns docs in ID order — "store_joyeria" < "store_santi", so
// Joyería is active on cloud login (unlike the local demo where Santi is hard-
// set). Most specs assume Santi (its products/orders), so switch to it if needed
// via the in-app store switcher. Finally, confirm Santi's products have synced by
// reading the catalog (the home order list is transient during the cloud switch;
// the catalog grid is a stable signal that state.products has landed).
// Check via the Firestore emulator admin REST API whether a collection has any
// docs. Used by waitForCloudSeed to distinguish "seed didn't write products"
// (re-trigger needed) from "seed wrote them but the app's onSnapshot hasn't
// surfaced them" (a reload fixes it).
const ADMIN_LIST = `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
async function collectionCount(name: string): Promise<number> {
  try {
    const res = await fetch(`${ADMIN_LIST}/${name}`);
    if (!res.ok) return 0;
    const data = (await res.json()) as { documents?: unknown[] };
    return data.documents?.length ?? 0;
  } catch {
    return 0;
  }
}

// If the seed was skipped (Firestore has stores but no products — seedCloudIfEmpty
// bailed on the "existing.stores.length > 0" guard after an incomplete wipe),
// purge the stores collection so the next app load re-seeds from scratch.
async function forceReSeedIfPartial() {
  const stores = await collectionCount("stores");
  const products = await collectionCount("products");
  if (stores > 0 && products === 0) {
    try {
      const res = await fetch(`${ADMIN_LIST}/stores`);
      if (!res.ok) return;
      const data = (await res.json()) as { documents?: { name: string }[] };
      for (const doc of data.documents ?? []) {
        await fetch(doc.name, { method: "DELETE" });
      }
    } catch {
      // best-effort
    }
  }
}

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
  await page.getByRole("button", { name: "Catálogo" }).click();
  await expect(page.getByRole("heading", { name: "Catálogo", exact: true })).toBeVisible();
  const product = page.getByText("Perfume Baccarat Rouge 540");
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await product.isVisible().catch(() => false)) break;
    // The seed can fail two ways: (1) seedCloudIfEmpty bailed because an
    // incomplete wipe left stale stores (stores>0, products=0) — purge stores so
    // the next app load re-seeds; (2) the seed wrote products but the app's
    // onSnapshot (which only watches stores) hasn't surfaced them — a reload
    // re-runs loadCloudState and picks them up.
    await forceReSeedIfPartial();
    await gotoClean(page);
    await ensureSantiActive(page);
    await page.getByRole("button", { name: "Catálogo" }).click();
    await expect(page.getByRole("heading", { name: "Catálogo", exact: true })).toBeVisible();
  }
  await expect(product).toBeVisible({ timeout: 20000 });
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
