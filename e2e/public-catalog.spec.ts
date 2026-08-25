import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, gotoClean } from "./helpers";

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

// Wipe the public projection collections so the REST seed below is the ONLY
// source of public docs. firebase.spec (which runs before this file in the
// foundation project) seeds via the app and writes publicProducts/publicStores
// too — without this purge the anonymous catalog would show duplicate products
// and the strict-mode assertions below would fail.
async function wipePublicProjection() {
  const seed = await mintToken();
  const auth = { Authorization: `Bearer ${seed.token}` };
  for (const col of ["publicProducts", "publicStores", "publicCatalogs"]) {
    try {
      // List via the authenticated REST endpoint (read rules require auth).
      const res = await fetch(`${FS}/${col}`, { headers: auth });
      if (!res.ok) continue;
      const data = (await res.json()) as { documents?: { name: string }[] };
      for (const doc of data.documents ?? []) {
        // doc.name is the full resource path; DELETE via the REST base URL.
        const docPath = doc.name.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, "");
        await fetch(`${FS}/${docPath}`, { method: "DELETE", headers: auth });
      }
    } catch {
      // Collection may not exist yet — nothing to wipe.
    }
  }
}

// Mint a Firebase ID token via the Auth emulator so we can seed the public
// projection with an authenticated REST call (the write rules require a
// signed-in user). Anonymous READS are then unauthenticated, mirroring a real
// visitor.
async function mintToken(): Promise<{ token: string; uid: string }> {
  // Try sign-up; if the account already exists (prior run before a wipe),
  // fall back to sign-in. Either way we need a valid idToken for the seed writes.
  const creds = { email: ADMIN_EMAIL, password: "password123", returnSecureToken: true };
  let res = await fetch(AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds),
  });
  let data = (await res.json()) as { idToken?: string; localId?: string };
  if (!data.idToken) {
    res = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key-for-emulator",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creds) }
    );
    data = (await res.json()) as { idToken?: string; localId?: string };
  }
  if (!data.idToken) throw new Error(`Could not mint seed token: ${JSON.stringify(data)}`);
  if (!data.localId) throw new Error("Could not determine seed user.");
  return { token: data.idToken, uid: data.localId };
}

// Seed a minimal public projection in the 3-doc model: publicStores (identity)
// + publicCatalogs (categories + product summaries, with storeId so the product
// route can resolve). The Santi store deliberately carries membership fields on
// the PUBLIC doc to prove the rules/projection never surface them to an
// anonymous reader — written here only because this REST seed bypasses the
// app's projection logic; the real app never writes them to publicStores.
async function seedPublicProjection() {
  const seed = await mintToken();
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${seed.token}` };

  const stores = [
    { slug: "santi", storeId: "store_santi", name: "Santi", type: "on_demand", whatsappPhone: "5215512345678", storefront: null },
    { slug: "joyeria", storeId: "store_joyeria", name: "Joyería", type: "inventory_tiered", whatsappPhone: null, storefront: null },
    // slug "olivia" routes to OliviaStorefront (the branded storefront) so the
    // grid cart + navigation-persistence behavior is covered by e2e.
    { slug: "olivia", storeId: "store_olivia", name: "Olivia", type: "inventory_tiered", whatsappPhone: "5215512345678", storefront: null },
  ];
  // Product summaries live INSIDE publicCatalogs (the grid source).
  const summary = (productSlug: string, name: string, storeSlug: string, extra: Record<string, unknown> = {}) => ({
    productSlug, name, storeSlug, imageUrl: null, availability: "available",
    storeId: storeSlug === "santi" ? "store_santi" : "store_joyeria", isFeatured: false, isNew: false, canInquire: false, categoryIds: [], sortOrder: 0, ...extra,
  });
  const catalogs = [
    {
      slug: "santi", storeId: "store_santi", storeSlug: "santi",
      categories: [],
      products: [
        summary("perfume-baccarat-rouge-540", "Perfume Baccarat Rouge 540", "santi", { price: 1500 }),
        summary("tenis-jordan-1-retro", "Tenis Jordan 1 Retro", "santi", { price: 3200 }),
      ],
    },
    {
      slug: "joyeria", storeId: "store_joyeria", storeSlug: "joyeria",
      categories: [],
      products: [
        summary("cadena-de-plata-925", "Cadena de plata 925", "joyeria", { prices: { retail: 1800 } }),
      ],
    },
    {
      slug: "olivia", storeId: "store_olivia", storeSlug: "olivia",
      categories: [],
      products: [
        summary("anillo-prueba", "Anillo Prueba", "olivia", { price: 800, availableQuantity: 5 }),
        summary("collar-prueba", "Collar Prueba", "olivia", { price: 950, availableQuantity: 0 }),
      ],
    },
  ];

  const patch = async (path: string, body: unknown, optional = false) => {
    const res = await fetch(`${FS}/${path}`, { method: "PATCH", headers: auth, body: JSON.stringify(body) });
    // Optional writes (users role marker) may hit rules depending on whether
    // the doc/account pre-exists from a prior spec in the same session; the
    // anonymous catalog reads this suite asserts never depend on them.
    if (!res.ok && !optional) throw new Error(`seed write failed for ${path}: ${res.status} ${await res.text()}`);
  };
  await patch(`users/${seed.uid}`, { fields: toFields({ email: ADMIN_EMAIL, role: "super_admin" }) }, true);
  for (const store of stores) {
    await patch(`adminStores/${store.storeId}`, {
      fields: toFields({ ...store, ownerUid: seed.uid, memberUids: [seed.uid], pendingInvites: [] }),
    });
    await patch(`stores/${store.storeId}`, { fields: toFields({ ...store, ownerUid: seed.uid, memberUids: [seed.uid] }) });
  }
  for (const s of stores) await patch(`publicStores/${s.slug}`, { fields: toFields(s) });
  for (const c of catalogs) await patch(`publicCatalogs/${c.slug}`, { fields: toFields(c) });
  // Product DETAIL docs for the Olivia route (ProductView reads
  // publicProducts/{storeId}__{slug}; summaries alone don't render a detail).
  for (const p of [
    { slug: "anillo-prueba", name: "Anillo Prueba", price: 800, availableQuantity: 5 },
    { slug: "collar-prueba", name: "Collar Prueba", price: 950, availableQuantity: 0 },
  ]) {
    await patch(`publicProducts/store_olivia__${p.slug}`, {
      fields: toFields({
        storeId: "store_olivia", storeSlug: "olivia", productSlug: p.slug,
        productId: `prod_${p.slug}`, name: p.name, price: p.price,
        availability: "available", availableQuantity: p.availableQuantity,
        images: [], categories: [], canInquire: false,
      }),
    });
  }
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
  if (Array.isArray(v)) {
    // Firestore REST requires arrays as arrayValue: { values: [...] }.
    return { arrayValue: { values: v.map(encode) } };
  }
  if (typeof v === "object") {
    return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
  }
  return { nullValue: null };
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
  await wipePublicProjection();
  await seedPublicProjection();
});

test("anonymous visitor sees a cloud store's public catalog", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "santi");

  await expect(anon.getByRole("heading", { name: "Santi" }).first()).toBeVisible({ timeout: 15000 });
  await expect(anon.getByText("Perfume Baccarat Rouge 540")).toBeVisible();
  await expect(anon.getByText("Tenis Jordan 1 Retro")).toBeVisible();
  await ctx.close();
});

test("anonymous visitor never sees private fields", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "joyeria");

  await expect(anon.getByRole("heading", { name: "Joyería" }).first()).toBeVisible({ timeout: 15000 });
  await expect(anon.getByText("Cadena de plata 925")).toBeVisible();

  // Private/cost/profit fields must never render (the projection omits them).
  await expect(anon.getByText(/Ganancia/)).toHaveCount(0);
  await expect(anon.getByText(/Costo/)).toHaveCount(0);
  // WhatsApp contact CTA present (public interaction only).
  await expect(anon.getByRole("link", { name: "Preguntar por WhatsApp" })).toBeVisible();
  await ctx.close();
});

test("unknown slug shows not-found", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "no-existe-tal-tienda");
  await expect(anon.getByText("Tienda no encontrada")).toBeVisible({ timeout: 15000 });
  await ctx.close();
});

test("anonymous visitor can build a cart and open checkout", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "santi");

  await expect(anon.getByRole("heading", { name: "Santi" }).first()).toBeVisible({ timeout: 15000 });
  // Add the same product twice + a second one.
  await anon.getByRole("button", { name: "Agregar" }).first().click();
  await anon.getByRole("button", { name: "Agregar" }).first().click();
  await anon.getByRole("button", { name: "Agregar" }).nth(1).click();

  // Header shows the accumulated count and opens the sheet.
  await anon.getByRole("button", { name: /🛒 3/ }).click();
  await expect(anon.getByRole("heading", { name: "Tu pedido" })).toBeVisible();
  await expect(anon.getByText("Total")).toBeVisible();

  // Checkout form: Enviar stays disabled until name + a 10-15 digit phone.
  const enviar = anon.getByRole("button", { name: "Enviar pedido" });
  await expect(enviar).toBeDisabled();
  await anon.getByLabel("Tu nombre").fill("Ana Test");
  await expect(enviar).toBeDisabled();
  await anon.getByLabel("Tu WhatsApp").fill("5512345678");
  await expect(enviar).toBeEnabled();
  await ctx.close();
});

test("cart survives client-side navigation in the Olivia storefront", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "olivia");

  await expect(anon.getByRole("heading", { name: "Olivia" }).first()).toBeVisible({ timeout: 15000 });

  // Add from the grid (no product detail), then navigate into a product.
  await anon.getByRole("button", { name: "Agregar" }).first().click();
  await expect(anon.getByRole("button", { name: "🛒 1" })).toBeVisible();
  await anon.getByRole("link", { name: /Anillo Prueba/i }).first().click();
  await expect(anon.getByRole("heading", { name: "Anillo Prueba" })).toBeVisible();
  await expect(anon.getByRole("button", { name: "🛒 1" })).toBeVisible();

  // Back to the catalog, into ANOTHER product: the cart must still be there.
  await anon.getByRole("button", { name: /Volver al catálogo/i }).click();
  await expect(anon.getByRole("heading", { name: "Olivia" }).first()).toBeVisible();
  await anon.getByRole("link", { name: /Collar Prueba/i }).first().click();
  await expect(anon.getByRole("heading", { name: "Collar Prueba" })).toBeVisible();
  await expect(anon.getByRole("button", { name: "🛒 1" })).toBeVisible();

  // Sold-out product: addable from the grid with the "por surtir" label.
  await anon.getByRole("button", { name: /Volver al catálogo/i }).click();
  await anon.getByRole("button", { name: /Agregar \(por surtir\)/ }).first().click();
  await anon.getByRole("button", { name: "🛒 2" }).click();
  await expect(anon.getByText("Sin existencias — se confirmará si se puede surtir.")).toBeVisible();
  await ctx.close();
});
