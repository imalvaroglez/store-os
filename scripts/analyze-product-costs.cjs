#!/usr/bin/env node
// Product-cost analysis by category (#280/#254): grounds the pricing-strategy
// band proposals on Olivia's REAL inventory — cost distribution, stock, current
// prices per tier, packaging coverage and cost provenance. Read-only by design.
//
// Answers, per PRIMARY category (categoryIds[0]; secondary categories reported
// separately as counts):
//   - how many SKUs / units, in stock vs sold out, with vs without a reliable cost
//   - cost distribution: min/max, P25/median/P75 (+P10/P90 when n>=30), distinct
//     costs, concentration by cost range
//   - current price min/median/max per tier, missing prices, negative margins
//     vs the FULL commercial base cost (acquisition + per-piece packaging),
//     commercial-order violations (Regular > Girly > Iconic)
//   - packaging coverage per tier: estimated per-piece cost, materials WITHOUT
//     an estimated cost (reported as missing, NEVER as $0), shared per-order
//     materials (informative — never part of a price)
//   - cost provenance: does Product.cost match the latest received purchase's
//     exact allocation (costAllocations)?
//
// Usage: node scripts/analyze-product-costs.cjs --project store-os-f7cf8 [--store Olivia]
//        node scripts/analyze-product-costs.cjs --project store-os-dev   (fixture test)
//        node scripts/analyze-product-costs.cjs --self-test             (pure-function checks)
//
// Auth: firebase-admin via Application Default Credentials
// (`gcloud auth application-default login`) or GOOGLE_APPLICATION_CREDENTIALS.
// Reading PRODUCTION is a human-approved operation by design (LOOPS.md /
// analyze-order-mix.cjs precedent): this script only ever calls .get(); it has
// no write code path. Allowed projects: store-os-dev, store-os-f7cf8.
//
// PRIVACY: output is AGGREGATES ONLY (the PO authorized reading Olivia and
// nothing else). No product names, ids, individualized costs or any free-text
// field is printed — anomaly counts and ranges only. Material and category
// names are business vocabulary, not personal data, and are kept.
"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const ALLOWED_PROJECTS = new Set(["store-os-dev", "store-os-f7cf8"]);
// Fixed, deterministic cost ladder for the concentration histogram (pesos).
const COST_BUCKETS = [25, 50, 75, 100, 125, 150, 175];
const MIN_SAMPLE_FOR_TAILS = 30; // P10/P90 only when the category has >= this many SKUs

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

let SELF_TEST_CHECKS = 0;

function failWith(message) {
  console.error(message);
  process.exit(1);
}

// Self-test runs offline, before any project guard or credential is needed.
if (process.argv.includes("--self-test")) {
  selfTest();
  console.log(`self-test OK (${SELF_TEST_CHECKS} verificaciones)`);
  process.exit(0);
}

const projectId = argumentValue("--project");
if (!projectId) failWith("Falta --project (store-os-dev | store-os-f7cf8).");
if (!ALLOWED_PROJECTS.has(projectId)) {
  failWith(`Proyecto no permitido: ${projectId}. Solo ${[...ALLOWED_PROJECTS].join(" / ")}.`);
}
const storeFilter = (argumentValue("--store") ?? "olivia").toLowerCase();

// Make pasted evidence unambiguous when the emulator is hijacking the
// connection — the SDK redirects silently, the report must not.
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? null;
if (EMULATOR_HOST) {
  console.error(
    `⚠️  FIRESTORE_EMULATOR_HOST=${EMULATOR_HOST} activo: esta corrida lee del EMULADOR, no del proyecto ${projectId}.`
  );
}

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

function toCents(pesos) {
  return Math.round(pesos * 100);
}

function money(cents) {
  const value = (cents / 100).toFixed(2);
  return `$${value.replace(/\.00$/, "")}`;
}

function bucketLabel(index) {
  if (index === 0) return `<${COST_BUCKETS[0]}`;
  if (index > COST_BUCKETS.length - 1) return `${COST_BUCKETS[COST_BUCKETS.length - 1]}+`;
  return `${COST_BUCKETS[index - 1]}–${COST_BUCKETS[index] - 0.01}`;
}

function bucketIndexOf(costPesos) {
  for (let i = 0; i < COST_BUCKETS.length; i += 1) {
    if (costPesos < COST_BUCKETS[i]) return i;
  }
  return COST_BUCKETS.length;
}

// IQR outliers over the reliable cost sample (count-only in the report).
function outlierCount(sortedCents) {
  if (sortedCents.length < 4) return 0;
  const q1 = percentile(sortedCents, 0.25);
  const q3 = percentile(sortedCents, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return sortedCents.filter((c) => c < lo || c > hi).length;
}

// Per-tier packaging profile: estimated per-piece cost in cents + the materials
// that lack an estimated cost (a missing cost is INFORMATION, never $0).
function packagingProfile(packaging, tierId) {
  const materials = new Map((packaging?.materials ?? []).map((m) => [m.id, m]));
  const profile = packaging?.byTier?.[tierId];
  let perPieceCents = 0;
  const missing = [];
  const perPieceLines = profile?.perPiece ?? [];
  for (const line of perPieceLines) {
    const material = materials.get(line.materialId);
    const cost = material?.estimatedCost;
    if (cost === undefined || cost === null) {
      missing.push(`${material?.name ?? line.materialId}×${line.units}`);
    } else {
      perPieceCents += toCents(cost) * Math.max(0, line.units);
    }
  }
  const perOrderNames = (profile?.perOrder ?? []).map((l) => materials.get(l.materialId)?.name ?? l.materialId);
  return { perPieceCents, missing, perOrderNames, configured: perPieceLines.length > 0 };
}

// Does the product's stored cost match the latest received purchase's exact
// allocation? Returns "match" | "diferente" | null (no evidence either way).
function provenanceStatus(productCostCents, line) {
  if (!line) return null;
  if (!line.alloc) return null;
  const allocatedUnitCents = line.alloc.totalCents / line.quantity;
  return Math.abs(allocatedUnitCents - productCostCents) <= 1 ? "match" : "diferente";
}

// The commercial-order check only runs when the store's tiers carry the
// Regular/Girly/Iconic labels Fer uses; otherwise it reports "no aplica".
function canonicalTierIds(tiers) {
  const find = (needle) =>
    (tiers ?? []).find((t) => String(t.label ?? "").toLowerCase().includes(needle))?.id ?? null;
  const regular = find("regular");
  const girly = find("girly");
  const iconic = find("iconic");
  return regular && girly && iconic ? { regular, girly, iconic } : null;
}

function assertEqual(actual, expected, label) {
  SELF_TEST_CHECKS += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failWith(`self-test FALLÓ (${label}): esperaba ${e}, obtuve ${a}`);
}

function selfTest() {
  assertEqual(percentile([1, 2, 3, 4], 0.5), 2.5, "mediana par");
  assertEqual(percentile([], 0.5), null, "percentil de vacío");
  assertEqual(bucketIndexOf(10), 0, "bucket bajo");
  assertEqual(bucketIndexOf(25), 1, "borde exacto de bucket sube");
  assertEqual(bucketIndexOf(300), COST_BUCKETS.length, "bucket abierto final");
  assertEqual(money(155), "$1.55", "dinero con centavos");
  assertEqual(money(9000), "$90", "dinero sin centavos");
  assertEqual(
    packagingProfile(
      {
        materials: [
          { id: "m1", name: "Bolsita", estimatedCost: 0.5 },
          { id: "m2", name: "Opalina" },
        ],
        byTier: {
          t_x: { perPiece: [{ materialId: "m1", units: 1 }, { materialId: "m2", units: 1 }] },
        },
      },
      "t_x"
    ).perPieceCents,
    50,
    "empaque por pieza sin contar material sin costo"
  );
  assertEqual(
    packagingProfile(
      { materials: [{ id: "m2", name: "Opalina" }], byTier: { t_x: { perPiece: [{ materialId: "m2", units: 2 }] } } },
      "t_x"
    ).missing.length,
    1,
    "material sin costo queda como faltante"
  );
  assertEqual(provenanceStatus(9000, { quantity: 2, alloc: { totalCents: 18000 } }), "match", "procedencia exacta");
  assertEqual(provenanceStatus(9000, { quantity: 3, alloc: { totalCents: 18000 } }), "diferente", "procedencia distinta");
  assertEqual(provenanceStatus(9000, null), null, "sin compra recibida");
  assertEqual(canonicalTierIds([{ id: "a", label: "Regular" }, { id: "b", label: "Girly" }]), null, "faltan niveles");
  assertEqual(outlierCount([10, 10, 10, 10, 1000]), 1, "atípico alto detectado");
}

function emptyCategoryStat() {
  return {
    skus: 0,
    published: 0,
    draft: 0,
    archived: 0,
    inStock: 0,
    soldOut: 0,
    unitsOnHand: 0,
    unitsQuarantined: 0,
    withCost: 0,
    noReliableCost: 0,
    costsCents: [],
    pricesByTier: new Map(), // tierId -> number[] (cents, only present prices)
    missingPriceByTier: new Map(), // tierId -> count
    negativeMarginByTier: new Map(), // tierId -> count (price < full base cost)
    minMarginCentsByTier: new Map(), // tierId -> lowest observed margin
    orderViolations: 0,
    provenance: { match: 0, diferente: 0, sinEvidencia: 0 },
    secondaryCounts: new Map(), // secondary categoryId -> pieza count
  };
}

async function main() {
  const storesSnap = await db.collection("stores").get();
  const storeDoc = storesSnap.docs
    .map((d) => ({ id: d.id, name: d.data().name ?? d.id, data: d.data() }))
    .find((s) => s.name.toLowerCase().includes(storeFilter));
  if (!storeDoc) {
    failWith(
      `No encontré una tienda que contenga "${storeFilter}". Tiendas: ` +
        storesSnap.docs.map((d) => d.data().name ?? d.id).join(", ")
    );
  }
  const store = storeDoc.data;
  const tiers = (store.priceTiers ?? []).filter((t) => !t.hidden).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tierLabels = {};
  for (const t of tiers) tierLabels[t.id] = t.label ?? t.id;
  const canonical = canonicalTierIds(tiers);
  const packagingByTier = new Map(tiers.map((t) => [t.id, packagingProfile(store.packaging, t.id)]));
  const anyPackagingGap = [...packagingByTier.values()].some((p) => p.missing.length > 0);

  const categoriesSnap = await db.collection("categories").where("storeId", "==", storeDoc.id).get();
  const categoryNames = new Map(categoriesSnap.docs.map((d) => [d.id, d.data().name ?? d.id]));

  const productsSnap = await db.collection("products").where("storeId", "==", storeDoc.id).get();
  const purchasesSnap = await db.collection("purchases").where("storeId", "==", storeDoc.id).get();

  // Latest received purchase line per product (provenance evidence).
  const received = purchasesSnap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((p) => (p.data.status ?? "received") === "received" && p.data.receivedAt)
    .sort((a, b) => String(b.data.receivedAt).localeCompare(String(a.data.receivedAt)));
  const allocByLine = new Map();
  for (const p of received) {
    for (const alloc of p.data.costAllocations ?? []) allocByLine.set(`${p.id}:${alloc.lineId}`, alloc);
  }
  const latestLine = new Map(); // productId -> { quantity, alloc }
  for (const p of received) {
    for (const line of p.data.lines ?? []) {
      if (latestLine.has(line.productId)) continue;
      latestLine.set(line.productId, {
        quantity: line.quantity,
        alloc: allocByLine.get(`${p.id}:${line.lineId}`) ?? null,
      });
    }
  }

  const stats = new Map(); // primary key -> category stat ("__sin" = not migrated
  const ensure = (key) => {
    if (!stats.has(key)) stats.set(key, emptyCategoryStat());
    return stats.get(key);
  };

  for (const doc of productsSnap.docs) {
    const p = doc.data();
    const primary = p.categoryIds?.[0] ?? "__sin";
    const stat = ensure(primary);
    stat.skus += 1;
    if (p.status === "draft") stat.draft += 1;
    else if (p.status === "archived") stat.archived += 1;
    else stat.published += 1;
    const onHand = typeof p.quantityOnHand === "number" ? p.quantityOnHand : 0;
    stat.unitsOnHand += onHand;
    stat.unitsQuarantined += typeof p.quantityQuarantined === "number" ? p.quantityQuarantined : 0;
    if (onHand > 0) stat.inStock += 1;
    else stat.soldOut += 1;
    for (const secondary of p.categoryIds?.slice(1) ?? []) {
      stat.secondaryCounts.set(secondary, (stat.secondaryCounts.get(secondary) ?? 0) + 1);
    }

    const hasCost = typeof p.cost === "number" && p.cost > 0;
    if (!hasCost) {
      stat.noReliableCost += 1;
      continue;
    }
    stat.withCost += 1;
    const costCents = toCents(p.cost);
    stat.costsCents.push(costCents);

    const prov = provenanceStatus(costCents, latestLine.get(doc.id) ?? null);
    if (prov === "match") stat.provenance.match += 1;
    else if (prov === "diferente") stat.provenance.diferente += 1;
    else stat.provenance.sinEvidencia += 1;

    for (const tier of tiers) {
      const price = p.prices?.[tier.id];
      const pack = packagingByTier.get(tier.id);
      if (typeof price === "number" && price > 0) {
        if (!stat.pricesByTier.has(tier.id)) stat.pricesByTier.set(tier.id, []);
        stat.pricesByTier.get(tier.id).push(toCents(price));
        const baseCents = costCents + pack.perPieceCents;
        const margin = toCents(price) - baseCents;
        stat.negativeMarginByTier.set(tier.id, (stat.negativeMarginByTier.get(tier.id) ?? 0) + (margin < 0 ? 1 : 0));
        const currentMin = stat.minMarginCentsByTier.get(tier.id);
        if (currentMin === undefined || margin < currentMin) stat.minMarginCentsByTier.set(tier.id, margin);
      } else {
        stat.missingPriceByTier.set(tier.id, (stat.missingPriceByTier.get(tier.id) ?? 0) + 1);
      }
    }
    if (canonical) {
      const r = p.prices?.[canonical.regular];
      const g = p.prices?.[canonical.girly];
      const i = p.prices?.[canonical.iconic];
      if ([r, g, i].every((v) => typeof v === "number" && v > 0) && !(r > g && g > i)) {
        stat.orderViolations += 1;
      }
    }
  }

  console.log(
    `# Análisis de costos por categoría — tienda "${storeDoc.name}" — proyecto ${projectId}${EMULATOR_HOST ? ` (⚠️ EMULADOR: ${EMULATOR_HOST})` : ""}`
  );
  console.log(`Generado: ${new Date().toISOString()}`);
  console.log(
    `Niveles: ${tiers.map((t) => `${t.id}=${t.label}`).join(" · ")} — chequeo de orden ${canonical ? "Regular>Girly>Iconic" : "no aplica (etiquetas distintas)"}`
  );
  console.log(`Método de costeo: ${store.costingMethod ?? "predeterminado (compra más reciente)"}\n`);

  console.log("## Empaques por nivel (estimado por pieza vendida)");
  for (const tier of tiers) {
    const pack = packagingByTier.get(tier.id);
    const perPiece = pack.configured ? `${money(pack.perPieceCents)} por pieza` : "sin empaque individual configurado";
    const missing = pack.missing.length > 0 ? ` — ⚠️ SIN costo estimado: ${pack.missing.join(", ")}` : "";
    const shared = pack.perOrderNames.length > 0 ? ` · compartido por pedido: ${pack.perOrderNames.join(", ")} (no entra al precio)` : "";
    console.log(`- ${tierLabels[tier.id]}: ${perPiece}${missing}${shared}`);
  }
  if (anyPackagingGap) {
    console.log("- ⚠️ Hay materiales sin costo estimado: los costos base y contribuciones de esos niveles están INCOMPLETOS; ningún dato debe presentarse como confiable hasta completarlos (sin ajustes retroactivos automáticos).");
  }
  console.log("");

  const sortedKeys = [...stats.entries()].sort((a, b) => b[1].skus - a[1].skus).map(([k]) => k);
  const nameOf = (key) => (key === "__sin" ? "(sin categoría principal)" : categoryNames.get(key) ?? key);
  const evidence = [];

  for (const key of sortedKeys) {
    const s = stats.get(key);
    const costs = [...s.costsCents].sort((a, b) => a - b);
    const distinct = new Set(costs).size;
    const n = costs.length;
    const secondary =
      s.secondaryCounts.size > 0
        ? ` · secundarias: ${[...s.secondaryCounts.entries()].map(([k, c]) => `${categoryNames.get(k) ?? k}×${c}`).join(", ")}`
        : "";

    console.log(`## ${nameOf(key)}`);
    console.log(
      `- Piezas: ${s.skus} (${s.published} publicados, ${s.draft} borrador, ${s.archived} archivados) · con existencia: ${s.inStock} · agotados: ${s.soldOut} · unidades: ${s.unitsOnHand} (cuarentena: ${s.unitsQuarantined})${secondary}`
    );
    console.log(`- Costo confiable: ${n} piezas · sin costo confiable: ${s.noReliableCost}`);
    if (n === 0) {
      console.log("- Sin costos para analizar: no se propone tabla.\n");
      evidence.push({ categoria: nameOf(key), skus: s.skus, conCosto: 0 });
      continue;
    }
    const tails = n >= MIN_SAMPLE_FOR_TAILS ? ` · P10 ${money(percentile(costs, 0.1))} · P90 ${money(percentile(costs, 0.9))}` : "";
    console.log(
      `- Costo: mín ${money(costs[0])} · P25 ${money(percentile(costs, 0.25))} · mediana ${money(percentile(costs, 0.5))} · P75 ${money(percentile(costs, 0.75))} · máx ${money(costs[n - 1])}${tails} · costos distintos: ${distinct} (${pct(distinct, n)} de los piezas)`
    );
    const buckets = new Array(COST_BUCKETS.length + 1).fill(0);
    for (const c of costs) buckets[bucketIndexOf(c / 100)] += 1;
    console.log(`- Concentración por rango de costo: ${buckets.map((c, i) => `${bucketLabel(i)}: ${c}`).join(" · ")}`);
    const counts = new Map();
    for (const c of costs) counts.set(c, (counts.get(c) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3);
    console.log(`- Costos más repetidos: ${top.map(([c, k]) => `${money(c)}×${k}`).join(" · ")}`);
    for (const tier of tiers) {
      const prices = (s.pricesByTier.get(tier.id) ?? []).sort((a, b) => a - b);
      const missing = s.missingPriceByTier.get(tier.id) ?? 0;
      const pack = packagingByTier.get(tier.id);
      const incomplete = pack.missing.length > 0;
      if (prices.length === 0) {
        console.log(`- ${tierLabels[tier.id]}: sin precios capturados (${missing} piezas)`);
        continue;
      }
      const negatives = s.negativeMarginByTier.get(tier.id) ?? 0;
      const minMargin = s.minMarginCentsByTier.get(tier.id);
      const flag = negatives > 0 || incomplete ? " ⚠️" : "";
      console.log(
        `- ${tierLabels[tier.id]}: precios ${money(prices[0])} / ${money(percentile(prices, 0.5))} / ${money(prices[prices.length - 1])} (mín/med/máx) · faltan ${missing} · margen negativo vs costo base: ${negatives}${minMargin !== undefined ? ` · peor margen ${money(minMargin)}` : ""}${incomplete ? " · costo base INCOMPLETO (empaque sin costo)" : ""}${flag}`
      );
    }
    const anomalies = [];
    if (s.noReliableCost > 0) anomalies.push(`${s.noReliableCost} sin costo`);
    if (outlierCount(costs) > 0) anomalies.push(`${outlierCount(costs)} costos atípicos`);
    if (canonical && s.orderViolations > 0) anomalies.push(`${s.orderViolations} violan Regular>Girly>Iconic`);
    const totalNegatives = tiers.reduce((acc, t) => acc + (s.negativeMarginByTier.get(t.id) ?? 0), 0);
    if (totalNegatives > 0) anomalies.push(`${totalNegatives} precios bajo el costo base`);
    console.log(
      `- Anomalías: ${anomalies.length > 0 ? anomalies.join(" · ") : "sin hallazgos"} · Procedencia del costo: ${s.provenance.match} cuadran con la última compra, ${s.provenance.diferente} difieren, ${s.provenance.sinEvidencia} sin compra recibida`
    );
    console.log("");

    evidence.push({
      categoria: nameOf(key),
      skus: s.skus,
      conCosto: n,
      unidades: s.unitsOnHand,
      costoMin: costs[0] / 100,
      costoP25: percentile(costs, 0.25) / 100,
      costoMediana: percentile(costs, 0.5) / 100,
      costoP75: percentile(costs, 0.75) / 100,
      costoMax: costs[n - 1] / 100,
      costosDistintos: distinct,
      sinCosto: s.noReliableCost,
      preciosMediana: Object.fromEntries(tiers.map((t) => [t.label ?? t.id, percentile([...(s.pricesByTier.get(t.id) ?? [])].sort((a, b) => a - b), 0.5) / 100])),
      margenesNegativos: Object.fromEntries(tiers.map((t) => [t.label ?? t.id, s.negativeMarginByTier.get(t.id) ?? 0])),
      violacionesOrden: s.orderViolations,
    });
  }

  console.log("```json");
  console.log(JSON.stringify({ tienda: storeDoc.name, niveles: tiers.map((t) => t.label ?? t.id), categorias: evidence }, null, 2));
  console.log("```");
}

main().catch((error) => {
  failWith(`Error leyendo Firestore: ${error instanceof Error ? error.message : String(error)}`);
});
