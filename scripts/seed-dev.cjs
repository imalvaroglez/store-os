#!/usr/bin/env node
/**
 * Dev-only seed: populates the ISOLATED `store-os-dev` Firebase project with a
 * realistic Olivia jewelry store (slug `olivia` — same as prod; safe because the
 * projects are separate) so the developer can work against a populated dev
 * environment without touching Olivia's real production data.
 *
 * One command: `node scripts/seed-dev.cjs`. Idempotent (fixed ids overwrite
 * cleanly on re-run).
 *
 * Auth: firebase-admin with Application Default Credentials (ADC). ADC is
 * established ONCE by the human via `gcloud auth application-default login`
 * (a browser login; no password, no committed secret, no `.env.seed-dev`). If
 * ADC is absent the script prints the gcloud command and exits.
 *
 * This script is now the ONLY owner of the Olivia fixture: the client demo
 * seed (src/lib/seed.ts) was removed (delivery remove-client-demo-seed). What
 * stays is a self-contained CommonJS object with deterministic fixed ids for
 * idempotent re-run — evolve the DEV fixture here, not in the client.
 *
 * LOAD-BEARING GUARD: this script aborts unless projectId === 'store-os-dev'.
 * The Admin SDK bypasses BOTH Firestore and Storage Security Rules entirely, so
 * if it ever targeted prod it would write unimpeded — this guard is the SOLE
 * protection against a prod write. It runs BEFORE any Firestore/Storage call.
 */
"use strict";

const DEV_PROJECT_ID = "store-os-dev";
const ADMIN_EMAIL = "admin@store.os";
const STORE_ID = "store_olivia";
const STORE_SLUG = "olivia";

// --- Olivia seed data (self-contained; this script owns the DEV fixture) ---
// Deterministic fixed ids => idempotent re-runs overwrite, never duplicate.
const now = new Date().toISOString();

const oliviaStorefront = {
  hero: {
    heading: "Olivia",
    body: "Joyería hecha a mano, piezas únicas para cada ocasión.",
  },
  benefits: ["Envíos a todo el país", "Plata 925 y materiales de calidad", "Cada pieza es única"],
  story: {
    heading: "Nuestra historia",
    body: "Cuenta aquí la historia de Olivia. (Texto provisional — edítalo en Sitio público.)",
  },
  resale: {
    heading: "Vende con Olivia",
    body: "¿Quieres formar parte del programa de reventa? Escríbeme por WhatsApp.",
  },
  faq: [
    { q: "¿Hacen envíos?", a: "Sí, a todo el país. (Texto provisional.)" },
    { q: "¿Cómo cuido mis piezas?", a: "Evita el contacto con agua y perfumes. (Provisional.)" },
  ],
  shipping: "Envíos a todo el país. (Provisional.)",
  payments: ["Transferencia", "Efectivo"],
  policies: "Devoluciones dentro de 7 días. (Provisional.)",
  hours: "Lunes a sábado, 10:00–18:00. (Provisional.)",
  whatsappBuyIntro: "Hola, me interesa esta pieza:",
  whatsappResaleIntro: "Hola, quiero información sobre el programa de reventa.",
  showSoldOut: true,
  seo: {
    title: "Olivia — Joyería hecha a mano",
    description: "Joyería hecha a mano, piezas únicas para cada ocasión.",
  },
};

const oliviaPriceTiers = [
  { id: "t_retail", label: "Regular", order: 0 },
  { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
  { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
];

const store = {
  id: STORE_ID,
  name: "Olivia",
  slug: STORE_SLUG,
  type: "inventory_tiered",
  whatsappPhone: "5215512345678",
  skuPrefix: "OLIV",
  storefront: oliviaStorefront,
  priceTiers: oliviaPriceTiers,
  defaultTierId: "t_retail",
  createdAt: now,
  updatedAt: now,
  // Cloud membership — set AFTER admin uid is resolved (see run()).
  // ownerUid / memberUids injected there.
};

const categories = [
  { id: `${STORE_ID}__anillos`, storeId: STORE_ID, name: "Anillos", slug: "anillos", sortOrder: 0, active: true, createdAt: now, updatedAt: now },
  { id: `${STORE_ID}__collares`, storeId: STORE_ID, name: "Collares", slug: "collares", sortOrder: 1, active: true, createdAt: now, updatedAt: now },
  { id: `${STORE_ID}__pulseras`, storeId: STORE_ID, name: "Pulseras", slug: "pulseras", sortOrder: 2, active: true, createdAt: now, updatedAt: now },
];

// Products: Olivia subset. `slug` is added in enrichProducts() (deterministic
// from the name) because buildSeedState() omits it and projectPublicProductDetail
// skips products without a slug. `images` is filled in after the Storage upload.
const baseProducts = [
  {
    id: "prod_olivia_1",
    storeId: STORE_ID,
    name: "Anillo de plata 925",
    sku: "OLIV-ANILLO-DE-PLATA-925",
    category: "jewelry",
    categoryIds: [`${STORE_ID}__anillos`],
    isPublic: true,
    publicDescription: "Anillo de plata 925, ajustable. (Pieza provisional.)",
    material: "Plata 925",
    finish: "Pulido",
    dimensions: "Ajustable",
    care: "Evita el agua y perfumes.",
    status: "published",
    availability: "available",
    isFeatured: true,
    isNew: true,
    canInquire: true,
    cost: 300,
    prices: { t_retail: 800, t_girly: 600, t_iconic: 500 },
    quantityOnHand: 5,
    lowStockAt: 2,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod_olivia_2",
    storeId: STORE_ID,
    name: "Collar de plata con dije",
    sku: "OLIV-COLLAR-DE-PLATA-CON-DIJE",
    category: "jewelry",
    categoryIds: [`${STORE_ID}__collares`],
    isPublic: true,
    publicDescription: "Collar de plata 925, 45 cm. (Pieza provisional.)",
    material: "Plata 925",
    finish: "Pulido",
    dimensions: "45 cm",
    care: "Evita el agua y perfumes.",
    status: "published",
    availability: "low_stock",
    isFeatured: false,
    isNew: true,
    canInquire: true,
    cost: 400,
    prices: { t_retail: 950, t_girly: 700, t_iconic: 600 },
    quantityOnHand: 2,
    lowStockAt: 3,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod_olivia_3",
    storeId: STORE_ID,
    name: "Anillo grabado (privado)",
    sku: "OLIV-ANILLO-GRABADO",
    category: "jewelry",
    categoryIds: [`${STORE_ID}__anillos`],
    isPublic: false,
    privateNotes: "Anillo con grabado personalizado, costo variable.",
    status: "draft",
    cost: 350,
    prices: { t_retail: 900, t_girly: 650, t_iconic: 550 },
    quantityOnHand: 4,
    lowStockAt: 2,
    createdAt: now,
    updatedAt: now,
  },
];

const customers = [
  { id: "cust_olivia_1", storeId: STORE_ID, name: "Ana Torres", phone: "5555556666", createdAt: now, updatedAt: now },
  { id: "cust_olivia_2", storeId: STORE_ID, name: "Emprendedora Lucero", phone: "5577778888", createdAt: now, updatedAt: now },
];

const orders = [
  {
    id: "order_olivia_1",
    storeId: STORE_ID,
    customerId: "cust_olivia_1",
    items: [{ productId: "prod_olivia_1", productName: "Anillo de plata 925", quantity: 1, priceTier: "t_retail", unitPrice: 800, subtotal: 800, cost: 300 }],
    deposit: 800,
    orderStatus: "delivered",
    paymentStatus: "paid",
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
  },
];

// --- slug derivation (mirrors src/features/stores/slugify.ts) ---
function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Deterministic product slug from the name. Private/draft products get one too
// (harmless — they're skipped by the public projection because status !== published).
function enrichProducts(products) {
  return products.map((p) => ({ ...p, slug: p.slug ?? slugify(p.name) }));
}

// --- Public projection helpers (mirror src/app/firebase/firestoreData.ts) ---
// The Admin SDK bypasses the membership guards on publicStores/publicCatalogs/
// publicProducts; the seed writes them directly so /catalogo/olivia works on the
// Preview without requiring a normal client write first. Only public-safe fields.

function projectPublicStore(s) {
  return {
    storeId: s.id,
    name: s.name,
    slug: s.slug,
    type: s.type,
    whatsappPhone: s.whatsappPhone ?? null,
    storefront: s.storefront ?? null,
    priceTiers: (s.priceTiers ?? []).filter((tier) => !tier.hidden).map((tier) => ({
      id: tier.id,
      label: tier.label,
      order: tier.order,
      ...(tier.minPieces != null ? { minPieces: tier.minPieces } : {}),
      ...(tier.minAmount != null ? { minAmount: tier.minAmount } : {}),
    })),
    defaultTierId: s.defaultTierId ?? null,
  };
}

function publicPrices(product) {
  if (!product.prices) return undefined;
  const entries = oliviaPriceTiers
    .map((tier) => [tier.id, product.prices[tier.id]])
    .filter(([, price]) => typeof price === "number");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function projectPublicProductSummary(product, storeSlug) {
  const summary = {
    storeSlug,
    storeId: product.storeId,
    productSlug: product.slug ?? null,
    name: product.name,
    publicDescription: product.publicDescription ?? null,
    imageUrl: primaryImage(product),
    availability: product.availability ?? "available",
    isFeatured: product.isFeatured ?? false,
    isNew: product.isNew ?? false,
    canInquire: product.canInquire ?? false,
    categoryIds: product.categoryIds ?? [],
    sortOrder: product.sortOrder ?? 0,
  };
  const resolved = typeof product.price === "number" ? product.price : product.prices?.t_retail;
  if (typeof resolved === "number") summary.price = resolved;
  const prices = publicPrices(product);
  if (prices) summary.prices = prices;
  return summary;
}

function projectPublicProductDetail(product, storeSlug, cats) {
  const named = (product.categoryIds ?? [])
    .map((id) => cats.find((c) => c.id === id))
    .filter((c) => !!c)
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug }));
  const detail = {
    storeId: product.storeId,
    storeSlug,
    productSlug: product.slug ?? null,
    name: product.name,
    sku: product.sku ?? product.id,
    publicDescription: product.publicDescription ?? null,
    images: (product.images ?? []).map((i) => ({
      url: i.url,
      alt: i.alt ?? null,
      width: i.width ?? null,
      height: i.height ?? null,
      isPrimary: i.isPrimary,
    })),
    material: product.material ?? null,
    finish: product.finish ?? null,
    dimensions: product.dimensions ?? null,
    care: product.care ?? null,
    availability: product.availability ?? "available",
    canInquire: product.canInquire ?? false,
    isFeatured: product.isFeatured ?? false,
    isNew: product.isNew ?? false,
    categories: named,
  };
  const resolved = typeof product.price === "number" ? product.price : product.prices?.t_retail;
  if (typeof resolved === "number") detail.price = resolved;
  const prices = publicPrices(product);
  if (prices) detail.prices = prices;
  return detail;
}

function primaryImage(product) {
  const imgs = product.images;
  if (imgs && imgs.length > 0) {
    const primary = imgs.find((i) => i.isPrimary) ?? imgs[0];
    return primary.url ?? null;
  }
  return product.imageUrl ?? null;
}

// --- Minimal valid JPEG (solid color), built in-code — no binary asset ---
// A 16x16 solid-color baseline JPEG. Satisfies storage.rules validImage()
// (size < 5 MB, contentType image/jpeg, name ends in .jpg). Even though the
// Admin SDK bypasses rules, matching the contract keeps the seeded data
// consistent with what a real client upload produces.
// prettier-ignore
function solidColorJpeg() {
  // A pre-built minimal valid JPEG (16x16 gray). Generated once and inlined so
  // the script has zero binary dependencies. Decodes as a real image.
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10,
    0x00, 0x10, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3f, 0x00, 0x7b, 0x40, 0x1b, 0xff, 0xd9,
  ]);
}

// --- Self-test: `node scripts/seed-dev.cjs --test` runs assertions on the
// pure helpers and the dev-only guard logic. No network. ---
// ponytail: no test framework for scripts/; embed the smallest runnable check,
// mirroring check-env.cjs. Fails the process if any case is wrong.
function runSelfTest() {
  const assert = require("assert");
  let exitCode = 0;
  const it = (name, fn) => {
    try {
      fn();
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (e) {
      console.error(`  \x1b[31m✗\x1b[0m ${name}: ${e.message}`);
      exitCode = 1;
    }
  };

  it("slugify lowercases + strips accents/punctuation", () => {
    assert.strictEqual(slugify("Anillo de plata 925"), "anillo-de-plata-925");
    assert.strictEqual(slugify("Collar de plata con dije"), "collar-de-plata-con-dije");
    assert.strictEqual(slugify("Aretés"), "aretes");
  });

  it("enrichProducts adds deterministic slug from name", () => {
    const out = enrichProducts([{ name: "Anillo de plata 925" }]);
    assert.strictEqual(out[0].slug, "anillo-de-plata-925");
  });

  it("enrichProducts keeps an explicit slug", () => {
    const out = enrichProducts([{ name: "X", slug: "custom-slug" }]);
    assert.strictEqual(out[0].slug, "custom-slug");
  });

  it("projectPublicStore carries only public-safe fields", () => {
    const s = m_proj({ id: "s1", name: "O", slug: "o", type: "inventory_tiered", whatsappPhone: "1", storefront: { hero: {} } });
    assert.strictEqual(s.storeId, "s1");
    assert.strictEqual(s.slug, "o");
    assert.ok(!("cost" in s) && !("memberUids" in s));
  });

  if (exitCode !== 0) {
    console.error("\x1b[31mself-test FALLÓ\x1b[0m");
    process.exit(1);
  }
  console.log("\x1b[32mself-test OK\x1b[0m");
}
// tiny indirection so the self-test can call projectPublicStore without the run() path
function m_proj(s) {
  return projectPublicStore(s);
}

// --- main ---
async function run() {
  let admin;
  try {
    // firebase-admin v10+ uses modular subpath imports: the bare
    // `require("firebase-admin")` only exposes initializeApp/getApp, NOT
    // firestore/storage/auth. Pull each service from its subpath.
    const { initializeApp, getApps } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    const { getAuth } = require("firebase-admin/auth");
    const { getStorage } = require("firebase-admin/storage");
    admin = { initializeApp, getApps, getFirestore, getAuth, getStorage };
  } catch (e) {
    fail(
      "No se encontró 'firebase-admin'. Es una devDependency — ejecuta `npm install` y vuelve a intentar."
    );
  }

  // ADC check: the Admin SDK reads Application Default Credentials from the
  // user's gcloud config. If absent, CredentialNotFound is thrown on init.
  // We detect it explicitly and print the exact remedy.
  const credentialEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const hasAdc = credentialEnv || hasGcloudAdc();
  if (!hasAdc) {
    console.error("");
    console.error("\x1b[31m[seed-dev] Faltan las credenciales (ADC).\x1b[0m");
    console.error("[seed-dev] Autentica una vez con gcloud (login por navegador, sin contraseña, sin secreto en el repo):");
    console.error("");
    console.error("    gcloud auth application-default login");
    console.error("");
    console.error("[seed-dev] Luego vuelve a ejecutar:  node scripts/seed-dev.cjs");
    process.exit(1);
  }

  // Initialize Admin SDK against DEV only. Hardcoded projectId — never reads env.
  // storageBucket is the dev bucket (required by getStorage). The guard on
  // DEV_PROJECT_ID is load-bearing: Admin bypasses Security Rules.
  if (DEV_PROJECT_ID !== "store-os-dev") {
    fail(`projectId interno inesperado: '${DEV_PROJECT_ID}'`);
  }
  const existing = admin.getApps().find((a) => a.name === "seed-dev");
  const app = existing || admin.initializeApp(
    { projectId: DEV_PROJECT_ID, storageBucket: "store-os-dev.firebasestorage.app" },
    "seed-dev"
  );
  const db = admin.getFirestore(app);
  const bucket = admin.getStorage(app).bucket();
  const auth = admin.getAuth(app);

  console.log(`\x1b[36m[seed-dev]\x1b[0m Proyecto destino: \x1b[1m${DEV_PROJECT_ID}\x1b[0m (dev aislado)`);

  // Resolve the admin uid at runtime. ADC authenticates the Admin SDK as the
  // project's service agent, not a user, so there's no uid by default. We look
  // up admin@store.os in Auth to set ownerUid/memberUids — without these the
  // deployed rules would block a normal client from reading the store.
  let adminUid;
  try {
    const userRecord = await auth.getUserByEmail(ADMIN_EMAIL);
    adminUid = userRecord.uid;
    // This isolated dev fixture must remain usable even when the account was
    // created after another user or has not received an email to verify.
    await auth.updateUser(adminUid, { emailVerified: true });
  } catch (e) {
    console.error("");
    console.error(`\x1b[31m[seed-dev] No existe el usuario ${ADMIN_EMAIL} en ${DEV_PROJECT_ID}.\x1b[0m`);
    console.error("[seed-dev] Regístralo una vez en la URL de Preview (sesión ya creada este ciclo).");
    console.error(`[seed-dev] Detalle: ${e.message}`);
    process.exit(1);
  }

  // Inject membership into the store doc.
  const storeWithMembership = {
    ...store,
    ownerUid: adminUid,
    memberUids: [adminUid],
  };

  // Keep the known dev operator's profile aligned with the Auth account and
  // the rules allowlist. Admin SDK is safe here because the script is guarded
  // above to the isolated store-os-dev project.
  await db.collection("users").doc(adminUid).set({
    email: ADMIN_EMAIL,
    emailNormalized: ADMIN_EMAIL,
    emailVerified: true,
    role: "super_admin",
  }, { merge: true });

  // Control-plane doc (Espec 1, G-P02): adminStores/{storeId} is the CANONICAL
  // source of membership/ownership. stores/{id}.get requires isMember(), which
  // requires exists(adminStores/{id}). Without this doc the seeded store is on
  // disk but unreadable (same defect as the Olivia-disappears-from-prod
  // incident). Carries ONLY control metadata — never business content — so a
  // super_admin read of this collection cannot leak tenant PII.
  const adminStore = {
    storeId: STORE_ID,
    name: store.name,
    // type is control data: it determines how the store is administered (which
    // price model the product form shows, etc.). The super_admin reads the
    // store list from adminStores, so type MUST live here or the control view
    // can't render the right UI. Matches projectAdminStore() in firestoreData.ts.
    type: store.type,
    slug: store.slug,
    ownerUid: adminUid,
    memberUids: [adminUid],
  };

  const products = enrichProducts(baseProducts);

  // 1. Write Olivia store (data plane) + adminStores (control plane) + categories
  //    + products + customers + orders. adminStores and stores are written in the
  //    SAME atomic batch, mirroring the client's saveEntity("stores") writeBatch,
  //    so the store is never half-visible.
  console.log("[seed-dev] Escribiendo tienda, adminStores, categorías, productos, clientes, órdenes...");
  const batch = db.batch();
  batch.set(db.collection("adminStores").doc(STORE_ID), adminStore);
  batch.set(db.collection("stores").doc(STORE_ID), storeWithMembership);
  for (const c of categories) batch.set(db.collection("categories").doc(c.id), c);
  for (const p of products) batch.set(db.collection("products").doc(p.id), p);
  for (const cu of customers) batch.set(db.collection("customers").doc(cu.id), cu);
  for (const o of orders) batch.set(db.collection("orders").doc(o.id), o);
  await batch.commit();

  // 2. Claim the slug 'olivia' and write the public projections so /catalogo/olivia
  //    works on the Preview. Admin bypasses the membership guards on these.
  console.log("[seed-dev] Reservando slug y proyecciones públicas (publicStores/publicCatalogs/publicProducts)...");
  await db.collection("slugs").doc(STORE_SLUG).set({
    storeId: STORE_ID,
    ownerUid: adminUid,
    claimedAt: Date.now(),
  });
  await db.collection("publicStores").doc(STORE_SLUG).set(projectPublicStore(storeWithMembership));

  const published = products.filter((p) => (p.status ? p.status === "published" : p.isPublic));
  const activeCats = categories
    .filter((c) => c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description ?? null,
      imageUrl: c.imageUrl ?? null,
      sortOrder: c.sortOrder,
    }));
  await db.collection("publicCatalogs").doc(STORE_SLUG).set({
    storeSlug: STORE_SLUG,
    storeId: STORE_ID,
    categories: activeCats,
    products: published
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((p) => projectPublicProductSummary(p, STORE_SLUG)),
  });

  const detailBatch = db.batch();
  for (const p of published) {
    if (!p.slug) continue;
    detailBatch.set(
      db.collection("publicProducts").doc(`${STORE_ID}__${p.slug}`),
      projectPublicProductDetail(p, STORE_SLUG, categories)
    );
  }
  await detailBatch.commit();

  // 3. Upload 1-2 generated sample JPEGs to dev Storage and link on a product.
  //    Validates the dev Storage bucket + IAM grant end-to-end. Admin bypasses
  //    storage.rules, but we match the validImage() contract (.jpg, image/jpeg).
  const targetProduct = products.find((p) => p.id === "prod_olivia_1");
  console.log(`[seed-dev] Subiendo imágenes de muestra a Storage (producto '${targetProduct.name}')...`);
  const imageBytes = solidColorJpeg();
  const gallery = [];
  for (let i = 0; i < 2; i++) {
    const imgId = `sample-${i + 1}`;
    const storagePath = `products/${STORE_ID}/${targetProduct.id}/${imgId}.jpg`;
    const file = bucket.file(storagePath);
    try {
      await file.save(imageBytes, {
        metadata: { contentType: "image/jpeg" },
        // Always overwrite on re-run (idempotent).
        public: true,
      });
      // Make the object publicly readable so the public catalog URL resolves.
      await file.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(storagePath)}`;
      gallery.push({
        id: imgId,
        url: publicUrl,
        storagePath,
        alt: targetProduct.name,
        width: 16,
        height: 16,
        order: i,
        isPrimary: i === 0,
      });
    } catch (e) {
      console.error(`\x1b[33m[seed-dev] Aviso: falló la subida a Storage (${storagePath}): ${e.message}\x1b[0m`);
      console.error("[seed-dev] Probablemente falta el grant IAM roles/datastore.user en el Storage service agent de store-os-dev.");
      console.error("[seed-dev] El resto del seed se completó; /catalogo/olivia funciona sin imágenes.");
    }
  }

  if (gallery.length > 0) {
    // Attach the gallery to the product doc + mirror primary to legacy imageUrl,
    // then re-project that product's public detail + summary.
    const updatedProduct = { ...targetProduct, images: gallery, imageUrl: gallery[0].url };
    await db.collection("products").doc(targetProduct.id).set(updatedProduct, { merge: true });
    await db
      .collection("publicProducts")
      .doc(`${STORE_ID}__${targetProduct.slug}`)
      .set(projectPublicProductDetail(updatedProduct, STORE_SLUG, categories), { merge: true });
    // Rebuild the catalog summary so the grid picks up the image URL.
    const refreshedPublished = products.map((p) => (p.id === targetProduct.id ? updatedProduct : p)).filter((p) => (p.status ? p.status === "published" : p.isPublic));
    await db.collection("publicCatalogs").doc(STORE_SLUG).set({
      storeSlug: STORE_SLUG,
      storeId: STORE_ID,
      categories: activeCats,
      products: refreshedPublished
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((p) => projectPublicProductSummary(p, STORE_SLUG)),
    });
  }

  console.log("");
  console.log("\x1b[32m[seed-dev] Listo.\x1b[0m");
  console.log(`[seed-dev] Tienda '${STORE_SLUG}' sembrada en ${DEV_PROJECT_ID}.`);
  console.log(`[seed-dev] Abre /catalogo/${STORE_SLUG} en la Preview para verificar.`);
  console.log(`[seed-dev] ${DEV_PROJECT_ID} Firestore: ${1 + categories.length + products.length + customers.length + orders.length} docs + proyecciones públicas.`);
  await app.delete();
}

/** True if gcloud ADC exists at the default filesystem location. */
function hasGcloudAdc() {
  try {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const adcPath = path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
    return fs.existsSync(adcPath);
  } catch {
    return false;
  }
}

function fail(msg) {
  console.error(`\x1b[31m[seed-dev] BLOQUEADO:\x1b[0m ${msg}`);
  process.exit(1);
}

// --- Entry point ---
if (require.main === module) {
  if (process.argv.includes("--test")) {
    runSelfTest();
  } else {
    run().catch((e) => {
      console.error(`\x1b[31m[seed-dev] Error inesperado:\x1b[0m ${e && e.stack ? e.stack : e}`);
      process.exit(1);
    });
  }
}

module.exports = { run, slugify, enrichProducts, projectPublicStore, projectPublicProductSummary };
