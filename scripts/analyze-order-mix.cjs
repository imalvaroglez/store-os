#!/usr/bin/env node
// Order-mix aggregation (#253/#254): grounds pricing/packaging decisions on
// REAL order data instead of illustrative numbers. Read-only by design.
//
// Answers, per price tier (Regular/Girly/Iconic...):
//   - mix of sales (orders, pieces, revenue share) → tests "most sales are Iconic"
//   - pieces-per-order distribution (median, p25/p75, % of 1-piece orders,
//     size buckets) → defines the real "pedido típico por nivel" or proves the
//     distribution is too wide to bake shared packaging into unit prices
//
// Usage: node scripts/analyze-order-mix.cjs --project store-os-f7cf8 [--store Olivia]
//        node scripts/analyze-order-mix.cjs --project store-os-dev   (fixture test)
//
// Auth: firebase-admin via Application Default Credentials
// (`gcloud auth application-default login`) or GOOGLE_APPLICATION_CREDENTIALS.
// Reading PRODUCTION is a human-approved operation by design (LOOPS.md /
// copy-prod-to-dev.cjs precedent): this script only ever calls .get(); it has
// no write code path. Allowed projects: store-os-dev, store-os-f7cf8.
//
// PRIVACY: output is AGGREGATES ONLY. No customer names, phones, notes,
// product names or any free-text field is read into the report. Order docs are
// streamed once and reduced in memory.
"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const ALLOWED_PROJECTS = new Set(["store-os-dev", "store-os-f7cf8"]);
const FIRM_STATUSES = new Set(["confirmed", "preparing", "ready", "delivered"]);
const CANONICAL_TIERS = { t_retail: "Regular", t_wholesale: "Girly", t_reseller: "Iconic" };

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function failWith(message) {
  console.error(message);
  process.exit(1);
}

const projectId = argumentValue("--project");
if (!projectId) failWith("Falta --project (store-os-dev | store-os-f7cf8).");
if (!ALLOWED_PROJECTS.has(projectId)) {
  failWith(`Proyecto no permitido: ${projectId}. Solo ${[...ALLOWED_PROJECTS].join(" / ")}.`);
}
const storeFilter = (argumentValue("--store") ?? "olivia").toLowerCase();

initializeApp({ projectId });
const db = getFirestore();

function percentile(sorted, q) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function pct(part, total) {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "—";
}

function emptyTierStats() {
  return {
    ordersFirmes: 0,
    ordersOther: 0,
    pieces: 0,
    revenueCents: 0,
    sizes: [],
    onePieceOrders: 0,
    manualPieces: 0,
    automaticPieces: 0,
  };
}

function bucketsOf(sizes) {
  const buckets = { "1": 0, "2-3": 0, "4-6": 0, "7-10": 0, "11+": 0 };
  for (const s of sizes) {
    if (s <= 1) buckets["1"] += 1;
    else if (s <= 3) buckets["2-3"] += 1;
    else if (s <= 6) buckets["4-6"] += 1;
    else if (s <= 10) buckets["7-10"] += 1;
    else buckets["11+"] += 1;
  }
  return buckets;
}

async function main() {
  const storesSnap = await db.collection("stores").get();
  const store = storesSnap.docs
    .map((d) => ({
      id: d.id,
      name: d.data().name ?? d.id,
      tiers: d.data().priceTiers,
      defaultTierId: d.data().defaultTierId ?? null,
    }))
    .find((s) => s.name.toLowerCase().includes(storeFilter));
  if (!store) {
    failWith(
      `No encontré una tienda que contenga "${storeFilter}". Tiendas: ` +
        storesSnap.docs.map((d) => d.data().name ?? d.id).join(", ")
    );
  }
  const tierLabels = {};
  for (const t of store.tiers ?? []) tierLabels[t.id] = t.label ?? t.id;
  for (const [id, label] of Object.entries(CANONICAL_TIERS)) tierLabels[id] ??= label;
  const labelOf = (tier) => tierLabels[tier] ?? `sin nivel (${tier ?? "?"})`;
  // Customer tier map: ONLY id → assignedPriceTierId is kept in memory (no
  // names/phones ever), to attribute lines captured without priceTier.
  const customerTier = new Map();
  const customersSnap = await db.collection("customers").where("storeId", "==", store.id).get();
  for (const c of customersSnap.docs) customerTier.set(c.id, c.data().assignedPriceTierId ?? null);
  const defaultTierId = store.defaultTierId ?? null;
  let attributedByCustomer = 0;
  let attributedByDefault = 0;

  console.log(`# Mix de pedidos — tienda "${store.name}" — proyecto ${projectId}`);
  console.log(`Generado: ${new Date().toISOString()}\n`);

  const ordersSnap = await db.collection("orders").where("storeId", "==", store.id).get();

  const byLineTier = new Map(); // mix de piezas/ingreso por nivel de LÍNEA
  const byOrderTier = new Map(); // tamaño de pedido por nivel DOMINANTE del pedido
  const statusCounts = {};
  const monthCounts = new Map();
  let cancelled = 0;
  let legacy = 0;
  let zeroTierPieces = 0;

  for (const doc of ordersSnap.docs) {
    const o = doc.data();
    const status = o.orderStatus ?? o.status ?? "?";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (status === "cancelled") {
      cancelled += 1;
      continue;
    }
    const month = typeof o.createdAt === "string" ? o.createdAt.slice(0, 7) : "?";
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);

    const items = Array.isArray(o.items) ? o.items : null;
    if (!items || items.length === 0) {
      legacy += 1;
      continue;
    }
    // Per-LINE tier mix. Lines without priceTier are attributed via the
    // customer's assigned tier, else the store default; counted separately.
    const piecesByTier = new Map();
    for (const it of items) {
      const qty = Math.max(0, Math.round(Number(it.quantity) || 0));
      const revenue = Math.round(
        (Number(it.subtotal ?? (Number(it.unitPrice) || 0) * qty) || 0) * 100
      );
      let tier = it.priceTier ?? null;
      if (!tier && customerTier.get(o.customerId)) {
        tier = customerTier.get(o.customerId);
        attributedByCustomer += qty;
      } else if (!tier && defaultTierId) {
        tier = defaultTierId;
        attributedByDefault += qty;
      }
      const key = labelOf(tier ?? "SIN_NIVEL");
      if (!byLineTier.has(key)) byLineTier.set(key, emptyTierStats());
      const st = byLineTier.get(key);
      st.pieces += qty;
      st.revenueCents += revenue;
      if (it.priceSource === "manual") st.manualPieces += qty;
      else st.automaticPieces += qty;
      if (tier) piecesByTier.set(key, (piecesByTier.get(key) ?? 0) + qty);
      else zeroTierPieces += qty;
    }
    // Order size attributed to its DOMINANT tier label (most pieces).
    const totalPieces = [...piecesByTier.values()].reduce((a, b) => a + b, 0);
    if (totalPieces <= 0) continue;
    let dominant = null;
    let max = -1;
    for (const [label, pieces] of piecesByTier) {
      if (pieces > max) {
        max = pieces;
        dominant = label;
      }
    }
    if (!byOrderTier.has(dominant)) byOrderTier.set(dominant, emptyTierStats());
    const ost = byOrderTier.get(dominant);
    if (FIRM_STATUSES.has(status)) {
      ost.ordersFirmes += 1;
      ost.sizes.push(totalPieces);
      if (totalPieces === 1) ost.onePieceOrders += 1;
    } else {
      ost.ordersOther += 1;
    }
  }

  const totalPieces = [...byLineTier.values()].reduce((a, s) => a + s.pieces, 0);
  const totalRevenue = [...byLineTier.values()].reduce((a, s) => a + s.revenueCents, 0);

  console.log("## Composición general");
  console.log(`- Pedidos leídos: ${ordersSnap.size} (cancelados: ${cancelled}, sin líneas/legacy: ${legacy})`);
  console.log(`- Por estado: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`- Por mes: ${[...monthCounts.entries()].sort().map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`- Piezas vendidas: ${totalPieces} · Ingreso: $${(totalRevenue / 100).toFixed(2)}`);
  if (attributedByCustomer > 0 || attributedByDefault > 0 || zeroTierPieces > 0) {
    console.log(`- Nivel atribuido por clienta: ${attributedByCustomer} piezas · por default de tienda: ${attributedByDefault} piezas · sin nivel posible: ${zeroTierPieces} piezas`);
  }
  console.log("\n## Mix por nivel (por línea de pedido)");
  console.log("| Nivel | Piezas | % piezas | Ingreso | % ingreso | Piezas a precio manual |");
  console.log("|---|---|---|---|---|---|");
  for (const [tier, st] of [...byLineTier.entries()].sort((a, b) => b[1].pieces - a[1].pieces)) {
    console.log(
      `| ${tier} | ${st.pieces} | ${pct(st.pieces, totalPieces)} | $${(st.revenueCents / 100).toFixed(2)} | ${pct(st.revenueCents, totalRevenue)} | ${st.manualPieces} |`
    );
  }
  console.log("\n## Tamaño de pedido por nivel dominante (solo pedidos firmes: confirmados/preparando/listos/entregados)");
  console.log("| Nivel | Pedidos firmes | Mediana piezas | p25–p75 | % de 1 pieza | 1 | 2-3 | 4-6 | 7-10 | 11+ |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  const jsonOut = { project: projectId, store: store.name, mixByLineTier: {}, sizeByOrderTier: {}, statusCounts, monthCounts: Object.fromEntries(monthCounts) };
  for (const [tier, st] of [...byOrderTier.entries()].sort((a, b) => b[1].ordersFirmes - a[1].ordersFirmes)) {
    const sizes = [...st.sizes].sort((a, b) => a - b);
    const b = bucketsOf(sizes);
    const median = percentile(sizes, 0.5);
    const p25 = percentile(sizes, 0.25);
    const p75 = percentile(sizes, 0.75);
    console.log(
      `| ${tier} | ${st.ordersFirmes}${st.ordersOther ? ` (+${st.ordersOther} no firmes)` : ""} | ${median} | ${p25}–${p75} | ${pct(st.onePieceOrders, st.ordersFirmes)} | ${b["1"]} | ${b["2-3"]} | ${b["4-6"]} | ${b["7-10"]} | ${b["11+"]} |`
    );
    jsonOut.sizeByOrderTier[tier] = {
      ordersFirmes: st.ordersFirmes, medianPieces: median, p25, p75,
      onePieceShare: st.ordersFirmes ? st.onePieceOrders / st.ordersFirmes : null, buckets: b,
    };
  }
  for (const [tier, st] of byLineTier) {
    jsonOut.mixByLineTier[tier] = {
      pieces: st.pieces, revenueCents: st.revenueCents, manualPieces: st.manualPieces,
    };
  }
  console.log("\n## JSON (para pegar como evidencia)");
  console.log("```json");
  console.log(JSON.stringify(jsonOut, null, 2));
  console.log("```");
  process.exit(0);
}

main().catch((error) => {
  failWith(`Fallo la lectura: ${error && error.message ? error.message : error}`);
});
