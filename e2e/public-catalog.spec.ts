import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, FIRESTORE_REST as FS, gotoClean, mintUserToken, toFields } from "./helpers";

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


// Wipe the public projection collections so the REST seed below is the ONLY
// source of public docs. firebase.spec (which runs before this file in the
// foundation project) seeds via the app and writes publicProducts/publicStores
// too — without this purge the anonymous catalog would show duplicate products
// and the strict-mode assertions below would fail.
async function wipePublicProjection() {
  const seed = await mintUserToken();
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

// Seed a minimal public projection in the 3-doc model: publicStores (identity)
// + publicCatalogs (categories + product summaries, with storeId so the product
// route can resolve). The Santi store deliberately carries membership fields on
// the PUBLIC doc to prove the rules/projection never surface them to an
// anonymous reader — written here only because this REST seed bypasses the
// app's projection logic; the real app never writes them to publicStores.
async function seedPublicProjection() {
  const seed = await mintUserToken();
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${seed.token}` };

  const stores = [
    { slug: "santi", storeId: "store_santi", name: "Santi", type: "on_demand", whatsappPhone: "5215512345678", storefront: null },
    { slug: "joyeria", storeId: "store_joyeria", name: "Joyería", type: "inventory_tiered", whatsappPhone: null, storefront: null },
  ];
  // Product summaries live INSIDE publicCatalogs (the grid source).
  const summary = (productSlug: string, name: string, storeSlug: string, extra: Record<string, unknown> = {}) => ({
    productSlug, name, storeSlug, imageUrl: null, availability: "available",
    storeId: `store_${storeSlug.replace(/-/g, "_")}`, isFeatured: false, isNew: false, canInquire: false, categoryIds: [], sortOrder: 0, ...extra,
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
  ];

  const patch = async (path: string, body: unknown) => {
    const res = await fetch(`${FS}/${path}`, { method: "PATCH", headers: auth, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`seed write failed for ${path}: ${res.status} ${await res.text()}`);
  };
  await patch(`users/${seed.uid}`, { fields: toFields({ email: ADMIN_EMAIL, emailNormalized: ADMIN_EMAIL.toLowerCase(), emailVerified: true, role: "super_admin" }) });
  for (const store of stores) {
    await patch(`adminStores/${store.storeId}`, {
      fields: toFields({ ...store, ownerUid: seed.uid, memberUids: [seed.uid], pendingInvites: [] }),
    });
    await patch(`stores/${store.storeId}`, { fields: toFields({ ...store, ownerUid: seed.uid, memberUids: [seed.uid] }) });
  }
  for (const s of stores) await patch(`publicStores/${s.slug}`, { fields: toFields(s) });
  for (const c of catalogs) await patch(`publicCatalogs/${c.slug}`, { fields: toFields(c) });
}


// Seed the STALE-shape regression fixture: a store whose publicStores doc was
// written before storeId existed on that collection. publicStores/olivia has NO
// storeId, while publicCatalogs/olivia and the detail doc carry
// store_olivia — the product detail must still resolve through the catalog
// summary, not the (stale) store identity doc. Doc ids are disjoint from the
// seedPublicProjection fixtures above.
//
// Written with `Authorization: Bearer owner`, the emulator's admin backdoor that
// bypasses security rules: the current rules REQUIRE storeId on publicStores
// creates, so no ordinary authenticated write could produce the stale shape that
// production still carries (that doc predates the rule).
async function seedStaleOlivia() {
  const auth = { "Content-Type": "application/json", Authorization: "Bearer owner" };

  const staleStore = {
    slug: "olivia", name: "Olivia", type: "inventory_tiered", whatsappPhone: "5213344836691", storefront: null,
    priceTiers: [
      { id: "t_retail", label: "Regular", order: 0 },
      { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
      { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
    ],
    defaultTierId: "t_retail",
  };
  const catalog = {
    slug: "olivia", storeId: "store_olivia", storeSlug: "olivia",
    categories: [],
    products: [
      {
        productSlug: "anillo-blossom", name: "Anillo Blossom", storeSlug: "olivia", imageUrl: null, availability: "available",
        storeId: "store_olivia", isFeatured: false, isNew: false, canInquire: false, categoryIds: [], sortOrder: 0,
        sku: "AAN1385", price: 140, prices: { t_retail: 140, t_girly: 120, t_iconic: 90 }, stockSignal: "disponible",
      },
      {
        productSlug: "aretes-luna", name: "Aretes Luna", storeSlug: "olivia", imageUrl: null, availability: "available",
        storeId: "store_olivia", isFeatured: false, isNew: false, canInquire: false, categoryIds: [], sortOrder: 0,
        sku: "OLI-002", price: 120, prices: { t_retail: 120, t_girly: 100, t_iconic: 80 }, stockSignal: "pocas",
      },
    ],
  };
  const detail = {
    storeId: "store_olivia", storeSlug: "olivia", productSlug: "anillo-blossom", name: "Anillo Blossom",
    sku: "OLI-001", publicDescription: null, images: [], material: null, finish: null, dimensions: null, care: null,
    availability: "available", canInquire: false, isFeatured: false, isNew: false, price: 1250, categories: [],
  };

  const patch = async (path: string, body: unknown) => {
    const res = await fetch(`${FS}/${path}`, { method: "PATCH", headers: auth, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`seed write failed for ${path}: ${res.status} ${await res.text()}`);
  };
  await patch("publicStores/olivia", { fields: toFields(staleStore) });
  await patch("publicCatalogs/olivia", { fields: toFields(catalog) });
  await patch("publicProducts/store_olivia__anillo-blossom", { fields: toFields(detail) });
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
  await seedStaleOlivia();
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

test("generic public catalog accumulates pieces and sends one WhatsApp order", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "santi");

  await expect(anon.getByRole("heading", { name: "Santi" }).first()).toBeVisible({ timeout: 15000 });
  const adds = anon.getByRole("button", { name: "Agregar al carrito" });
  await adds.nth(0).click();
  // The first card is now a quantity stepper, so the remaining Add button is the second product.
  await anon.getByRole("button", { name: "Agregar al carrito" }).click();

  const open = anon.getByRole("button", { name: "Abrir pedido" });
  await expect(open).toContainText("2 piezas");
  await open.click();
  await expect(anon.getByRole("heading", { name: "Tu pedido" })).toBeVisible();

  const send = anon.getByRole("link", { name: "Enviar pedido por WhatsApp" });
  const href = (await send.getAttribute("href")) ?? "";
  expect(href).toContain("wa.me/5215512345678");
  const text = decodeURIComponent(href.split("text=")[1]);
  expect(text).toContain("• 1× Perfume Baccarat Rouge 540");
  expect(text).toContain("• 1× Tenis Jordan 1 Retro");
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

test("anonymous visitor opens a product detail from a stale publicStores doc", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "olivia");

  await expect(anon.getByRole("heading", { name: "Olivia" }).first()).toBeVisible({ timeout: 15000 });
  await expect(anon.getByText("desde $1,000 en productos a precio Iconic").first()).toBeVisible();
  await anon.getByRole("link", { name: "Anillo Blossom" }).click();
  await expect(anon).toHaveURL(/\/catalogo\/olivia\/producto\/anillo-blossom$/);
  await expect(anon.getByRole("heading", { name: "Anillo Blossom" })).toBeVisible({ timeout: 15000 });
  await expect(anon.getByText("Pieza no encontrada")).toHaveCount(0);
  await ctx.close();
});

test("cart: anonymous visitor accumulates pieces and sends ONE WhatsApp order", async ({ browser }) => {
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await openCatalogAnonymous(anon, "olivia");

  await expect(anon.getByRole("heading", { name: "Olivia" }).first()).toBeVisible({ timeout: 15000 });

  // Add two different pieces from the grid.
  await anon.getByRole("button", { name: "Agregar al carrito" }).nth(0).click();
  await anon.getByRole("button", { name: "Agregar al carrito" }).click();

  // Floating button shows the piece count and opens the drawer.
  const open = anon.getByRole("button", { name: "Abrir pedido" });
  await expect(open).toContainText("2");
  await open.click();

  await expect(anon.getByRole("heading", { name: "Tu pedido" })).toBeVisible();
  // Coarse stock legend — never an exact count.
  await expect(anon.getByText(/Quedan pocas/)).toBeVisible();

  // ONE wa.me message with both lines, SKUs, calculated price and catalog link.
  const send = anon.getByRole("link", { name: "Enviar pedido por WhatsApp" });
  const href = (await send.getAttribute("href")) ?? "";
  expect(href).toContain("wa.me/5213344836691");
  const text = decodeURIComponent(href.split("text=")[1]);
  expect(text).toContain("• 1× Anillo Blossom (AAN1385)");
  expect(text).toContain("• 1× Aretes Luna (OLI-002)");
  expect(text).toContain("Precio aplicable: Regular");
  expect(text).toContain("Subtotal estimado: $260 MXN");
  expect(text).toContain("/catalogo/olivia");

  // The cart survives a full reload (localStorage per store slug).
  await anon.reload();
  await expect(anon.getByRole("button", { name: "Abrir pedido" })).toContainText("2", { timeout: 15000 });
  await ctx.close();
});
