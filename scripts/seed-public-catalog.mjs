// Seed a representative synthetic public catalog into the local Firestore
// emulator for scroll/perf measurement (1.13.1, #332). Idempotent: clears the
// public collections for the target slug first. Dev/emulator only.
//
// Usage: node scripts/seed-public-catalog.mjs   (expects emulators on 127.0.0.1)

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { setDoc, doc, deleteDoc, getDocs, query, collection, where } from "firebase/firestore";

const SLUG = "olivia";
// CAT_COUNT lets evidence runs try other compositions (7, 11, …); default 10 → 5 + 5.
const CAT_COUNT = Math.min(12, Math.max(1, Number(process.env.CAT_COUNT ?? 10)));
const ALL_CATEGORIES = ["Cadenas", "Aretes", "Anillos", "Brazaletes", "Collares", "Dijes", "Tobilleras", "Broches", "Sets", "Pulseras", "Pañuelos", "Sombreros"];
const CATEGORIES = ALL_CATEGORIES.slice(0, CAT_COUNT);
const PER_CATEGORY = 6;
const IMAGES = 12;

// Minimal deterministic PNG (RGB, solid-ish gradient) so product cards fetch
// LOCAL files of varied weight — no network variance in the measurements.
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
function gradientPng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const i = y * (stride + 1) + 1 + x * 3;
      const t = (x + y) / (width + height);
      raw[i] = Math.min(255, Math.round(rgb[0] + t * 40));
      raw[i + 1] = Math.min(255, Math.round(rgb[1] + t * 25));
      raw[i + 2] = Math.min(255, Math.round(rgb[2] + t * 15));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/images/synth", { recursive: true });
const imageUrls = [];
const PALETTE = [[217, 115, 147], [116, 0, 3], [231, 231, 231], [180, 160, 170], [120, 130, 150], [240, 225, 215]];
for (let i = 0; i < IMAGES; i++) {
  const width = 360 + (i % 4) * 140; // 360..780 px
  const height = width;
  const file = `public/images/synth/cat-${i}.png`;
  writeFileSync(file, gradientPng(width, height, PALETTE[i % PALETTE.length]));
  imageUrls.push(`/images/synth/cat-${i}.png`);
}

const env = await initializeTestEnvironment({
  projectId: "store-os-dev",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // Clear previous synthetic docs.
  for (const d of (await getDocs(query(collection(db, "publicProducts"), where("storeSlug", "==", SLUG)))).docs) {
    await deleteDoc(d.ref);
  }
  await deleteDoc(doc(db, "publicStores", SLUG));
  await deleteDoc(doc(db, "publicCatalogs", SLUG));

  const categories = CATEGORIES.map((name, index) => ({
    id: `cat_${index}`, name, slug: name.toLowerCase().replace(/é/g, "e"), sortOrder: index,
    imageUrl: imageUrls[index % imageUrls.length],
  }));
  const products = [];
  const tierPrices = (base) => ({ t_retail: base, t_girly: Math.round(base * 0.85), t_iconic: Math.round(base * 0.55) });
  let n = 0;
  for (const category of categories) {
    for (let k = 0; k < PER_CATEGORY; k++) {
      const base = 80 + ((n * 37) % 160);
      const slug = `pieza-${n}`;
      products.push({
        storeId: "store_olivia", storeSlug: SLUG, productSlug: slug,
        name: `Pieza ${category.name} ${k + 1}`, finish: k % 2 ? "Dorado" : "Plateado",
        categoryIds: [category.id], price: base, prices: tierPrices(base),
        stockSignal: n % 9 === 0 ? "agotado" : n % 5 === 0 ? "pocas" : "disponible",
        imageUrl: imageUrls[n % imageUrls.length],
        imageWidth: 360 + (n % 4) * 140, imageHeight: 360 + (n % 4) * 140,
      });
      await setDoc(doc(db, "publicProducts", `store_olivia__${slug}`), {
        ...products[n], sku: `S-${n}`, stockSignal: products[n].stockSignal,
        // The detail projection always carries an images array (the gallery
        // walks it) — mirror the real projection shape.
        images: [{ url: imageUrls[n % imageUrls.length], width: 360 + (n % 4) * 140, height: 360 + (n % 4) * 140 }],
        categories: [category],
      });
      n++;
    }
  }

  await setDoc(doc(db, "publicStores", SLUG), {
    storeId: "store_olivia", name: "Olivia", slug: SLUG, type: "inventory_tiered",
    whatsappPhone: "5210000000000", storefront: null,
    priceTiers: [
      { id: "t_retail", label: "Regular", order: 0 },
      { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
      { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
    ],
    defaultTierId: "t_retail",
  });
  // storeId is REQUIRED by the rules on publicCatalogs updates — without it
  // the admin dialog's save→reproject flow fails in the synthetic env.
  await setDoc(doc(db, "publicCatalogs", SLUG), { storeId: "store_olivia", categories, products });
  console.log(`seeded: ${categories.length} categories · ${products.length} products · ${IMAGES} local images`);
});
await env.cleanup();
