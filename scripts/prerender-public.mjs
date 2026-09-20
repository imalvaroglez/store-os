#!/usr/bin/env node
// Prerender the public storefronts' social/SEO shell at build time.
//
// Reads the anonymous public projections over the Firestore REST API (same
// apiKey the client bundle already carries; anonymous reads are allowed by
// firestore.rules) and rewrites dist/public.html per store into
// dist/catalogo/<slug>/index.html — full title/description/canonical/og +
// JSON-LD. Static files win over the vercel.json rewrite, so crawlers and
// social previews get real content, while the SPA still hydrates on the same
// URL and revalidates data from Firestore at runtime (freshness is bounded by
// the deploy cadence, not by this file).
//
// Zero cost: 1 + 2 reads per store per deploy, well inside the free tier.
// Skipped silently (exit 0) on local/demo builds without a Firebase config or
// PUBLIC_SITE_URL.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// CI passes real env vars; local builds fall back to the .env file Vite
// itself reads (those values never reach process.env on their own).
function envOrDotenv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const dotEnv = readFileSync(join(root, ".env"), "utf8");
    const match = dotEnv.match(new RegExp(`^${name}=(.*)$`, "m"));
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

const API_KEY = envOrDotenv("VITE_FIREBASE_API_KEY");
const PROJECT_ID = envOrDotenv("VITE_FIREBASE_PROJECT_ID");
const SITE_URL = (envOrDotenv("PUBLIC_SITE_URL")).replace(/\/$/, "");

if (!API_KEY || !PROJECT_ID || !SITE_URL) {
  console.log("[prerender-public] sin configuración de build (apiKey/projectId/PUBLIC_SITE_URL) — omitido (build local/demo).");
  process.exit(0);
}

const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Minimal REST decoder for the storefront fields we read. Firestore sends
// integers as strings; everything else maps 1:1. Unknown shapes still fail
// loudly — a silently mis-rendered meta tag is worse than a skipped store.
function decodeValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decodeValue);
  throw new Error(`campo prerender inesperado: ${Object.keys(value).join(",")}`);
}
function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decodeValue(value);
  return out;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`REST ${res.status} en ${url.slice(0, 120)}`);
  return res.json();
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Same priority order the screens pass to useSeo — one source of truth per tag.
function metaFor(store) {
  const sf = store.storefront ?? {};
  return {
    title: sf.seo?.title || `${store.name} — Catálogo`,
    description: sf.seo?.description || sf.hero?.body || "Explora el catálogo, elige tus piezas y prepara tu pedido por WhatsApp.",
    ogImage: sf.seo?.ogImageUrl || sf.hero?.imageUrl || null,
  };
}

function renderShell(template, slug, store) {
  const url = `${SITE_URL}/catalogo/${slug}`;
  const meta = metaFor(store);
  const tags = [
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    ...(meta.ogImage ? [`<meta property="og:image" content="${escapeHtml(meta.ogImage)}" />`] : []),
    // Tenant content is untrusted on a multi-tenant platform: escape "<" so a
    // store name like "</script><script>…" can never break out of the JSON-LD
    // block and execute in a visitor's browser. (\u003c is JSON-safe.)
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Store", name: store.name, url }).replace(/</g, "\\u003c")}</script>`,
  ].join("\n    ");
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(/<meta name="description"[^>]*\/>/, `<meta name="description" content="${escapeHtml(meta.description)}" />`)
    .replace("</head>", `    ${tags}\n  </head>`);
}

// The listing needs credentials: firestore.rules denies anonymous LIST on the
// public collections (no tenant enumeration with the public apiKey). In CI the
// deploy job provides a service account via GOOGLE_APPLICATION_CREDENTIALS and
// firebase-admin reads it (admin access bypasses rules). Without credentials
// the prerender degrades loudly to the static public/sitemap.xml — it never
// blocks a deploy and never silently ships a wrong sitemap.
async function listPublicStoreSlugs() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() }, "prerender-public");
  // Namespaced API: firebase-admin/firestore does NOT export the modular
  // collection()/getDocs() helpers (those live in the client SDK) — the first
  // production run failed with "collection is not a function" and degraded
  // to the static sitemap fallback.
  const snap = await getFirestore(app).collection("publicStores").get();
  return snap.docs.map((d) => d.id);
}

let slugs = null;
try {
  slugs = await listPublicStoreSlugs();
} catch (error) {
  console.warn(`[prerender-public] falló el listing autenticado: ${error.message}`);
}
if (!slugs) {
  console.warn(
    "[prerender-public] sin credenciales de servicio — se conserva el sitemap estático de public/ y NO se prerendera (el SPA sirve todas las rutas). Deploy continúa.",
  );
  process.exit(0);
}

if (!slugs.length) {
  console.log("[prerender-public] sin tiendas publicadas — nada que prerender.");
  process.exit(0);
}

const template = readFileSync(join(root, "dist", "public.html"), "utf8");
let written = 0;
for (const slug of slugs) {
  try {
    const doc = await getJson(`${DOCS}/publicStores/${slug}?key=${API_KEY}`);
    const store = decodeFields(doc.fields ?? {});
    const target = join(root, "dist", "catalogo", slug, "index.html");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderShell(template, slug, store));
    written++;
  } catch (error) {
    // One broken store must never block the deploy; the SPA fallback still
    // serves its route.
    console.warn(`[prerender-public] omitiendo "${slug}": ${error.message}`);
  }
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${slugs
  .map((slug) => `  <url>\n    <loc>${SITE_URL}/catalogo/${slug}</loc>\n  </url>`)
  .join("\n")}\n</urlset>\n`;
writeFileSync(join(root, "dist", "sitemap.xml"), sitemap);

console.log(`[prerender-public] ${written}/${slugs.length} vitrinas prerender + sitemap → dist/sitemap.xml`);
