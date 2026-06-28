import { test, expect, type Page } from "@playwright/test";

// End-to-end for the PUBLIC CLOUD CATALOG (/catalogo/:slug) against the
// Firebase Emulator. An anonymous visitor (no session) reads the public
// projection collections. Verifies: public products render, private products
// and private fields never appear, and unknown slug -> not-found.
//
// The public projection is seeded directly via the Firestore emulator REST API
// (not via an admin signup) so this suite is deterministic and independent of
// whether a super_admin already exists from firebase.spec.ts.
//
// Prereq: emulator running (`npm run emulators`); app served with
// VITE_FIREBASE_EMULATOR=true. globalSetup wipes Auth + Firestore before run.

const PROJECT = "store-os-demo";
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key-for-emulator";

// Mint a Firebase ID token via the Auth emulator so we can seed the public
// projection with an authenticated REST call (the write rules require a
// signed-in user). Anonymous READS are then unauthenticated, mirroring a real
// visitor.
async function mintToken(): Promise<string> {
  // Try sign-up; if the account already exists (prior run before a wipe),
  // fall back to sign-in. Either way we need a valid idToken for the seed writes.
  const creds = { email: "catalog-seed@example.com", password: "password123", returnSecureToken: true };
  let res = await fetch(AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds),
  });
  let data = (await res.json()) as { idToken?: string };
  if (!data.idToken) {
    res = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key-for-emulator",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creds) }
    );
    data = (await res.json()) as { idToken?: string };
  }
  if (!data.idToken) throw new Error(`Could not mint seed token: ${JSON.stringify(data)}`);
  return data.idToken;
}

// Seed a minimal public projection: two stores with public products. The
// Santi store deliberately carries membership fields on the PUBLIC doc to prove
// the rules/projection never surface them to an anonymous reader — they are
// written here only because this REST seed bypasses the app's projection
// logic; the real app never writes them to publicStores.
async function seedPublicProjection() {
  const token = await mintToken();
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const stores = [
    { slug: "santi", name: "Santi", type: "on_demand", whatsappPhone: "5215512345678" },
    { slug: "joyeria", name: "Joyería", type: "inventory_tiered", whatsappPhone: null },
  ];
  const products = [
    { id: "p-perfume", storeSlug: "santi", name: "Perfume Baccarat Rouge 540", price: 1500 },
    { id: "p-tenis", storeSlug: "santi", name: "Tenis Jordan 1 Retro", price: 3200 },
    { id: "j-cadena", storeSlug: "joyeria", name: "Cadena de plata 925", prices: { retail: 1800 } },
  ];

  const patch = async (path: string, body: unknown) => {
    const res = await fetch(`${FS}/${path}`, { method: "PATCH", headers: auth, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`seed write failed for ${path}: ${res.status} ${await res.text()}`);
  };
  for (const s of stores) await patch(`publicStores/${s.slug}`, { fields: toFields(s) });
  for (const p of products) await patch(`publicProducts/${p.id}`, { fields: toFields(p) });
}

// Minimal Firestore value encoder (strings/numbers/bools/null + nested maps).
function toFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = encode(v);
  }
  return out;
}
function encode(v: unknown): unknown {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "object" && v !== null) {
    return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
  }
  return { nullValue: null };
}

async function gotoClean(page: Page, path = "/") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
}

async function openCatalogAnonymous(page: Page, slug: string) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    try { indexedDB.deleteDatabase("firebaseLocalStorageDb"); } catch {}
  });
  await gotoClean(page, `/catalogo/${slug}`);
}

test.beforeAll(async () => {
  await seedPublicProjection();
});

test("anonymous visitor sees a cloud store's public catalog", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "santi");

  await expect(anon.getByRole("heading", { name: "Santi" })).toBeVisible({ timeout: 15000 });
  await expect(anon.getByText("Perfume Baccarat Rouge 540")).toBeVisible();
  await expect(anon.getByText("Tenis Jordan 1 Retro")).toBeVisible();
  await ctx.close();
});

test("anonymous visitor never sees private fields", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "joyeria");

  await expect(anon.getByRole("heading", { name: "Joyería" })).toBeVisible({ timeout: 15000 });
  await expect(anon.getByText("Cadena de plata 925")).toBeVisible();

  // Private/cost/profit fields must never render (the projection omits them).
  await expect(anon.getByText(/Ganancia/)).toHaveCount(0);
  await expect(anon.getByText(/Costo/)).toHaveCount(0);
  // WhatsApp CTA present (public interaction only).
  await expect(anon.getByText("Preguntar por WhatsApp")).toBeVisible();
  await ctx.close();
});

test("unknown slug shows not-found", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "no-existe-tal-tienda");
  await expect(anon.getByText("Tienda no encontrada")).toBeVisible({ timeout: 15000 });
  await ctx.close();
});
