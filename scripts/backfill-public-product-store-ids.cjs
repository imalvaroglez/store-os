#!/usr/bin/env node
// Backfill the `storeId` field on legacy `publicProducts/{id}` docs.
//
// BUG: docs created before commit 390e76a (2026-08-04) do NOT carry `storeId`
// (the old projection only wrote `storeSlug`). The deployed Firestore rule
//   match /publicProducts/{id} { allow update: if isMember(resource.data.storeId) ... }
// evaluates isMember(undefined) → false, denying the update — a catch-22: the
// doc cannot be edited or deleted through the app. Symptom in prod: editing a
// published product shows "No se pudo guardar. Intenta de nuevo."
//
// This script adds the missing `storeId` (derived from the doc id prefix,
// `${storeId}__${productSlug}`) using the Admin SDK, which bypasses the rules.
// It is SCOPED (--store) and GATED (dry-run by default; --apply to write).
//
// Usage (two forms):
//   node scripts/backfill-public-product-store-ids.cjs --test
//   node scripts/backfill-public-product-store-ids.cjs --env dev|prod --store store_olivia [--apply]
//
// Both --flag value and --flag=value forms are accepted. Unknown flags are
// rejected. --test is exclusive of --env/--store/--apply.
// Without --apply the script is a dry-run (reports candidates, writes nothing).
//
// Safety:
//   - Closed project map: dev → store-os-dev, prod → store-os-f7cf8. The --env
//     flag selects the target; there is no default and no env/var override.
//   - Admin SDK bypasses Security Rules, so the --store scope, the
//     derivedStoreId===store check, and the dry-run default are load-bearing.
//   - All-or-nothing: if ANY candidate is malformed or fails validation, the
//     script aborts before writing anything.
//   - Aborts if more than 500 candidates (Firestore batch limit).
//   - Reads are charged per document returned: ~N+1 reads (N docs in range + 1
//     adminStores validation) and M writes (one partial update per candidate).

"use strict";

const PROJECTS = {
  dev: "store-os-dev",
  prod: "store-os-f7cf8",
};
const BATCH_LIMIT = 500; // Firestore writeBatch max ops.

// --- Pure helpers (unit-tested by --test) ---

/** Parse a publicProducts doc id "${storeId}__${slug}" into its parts.
 *  Returns { storeId, slug } or null if malformed (non-string, no separator,
 *  empty prefix, or empty slug — e.g. "store_olivia__" has a valid prefix but
 *  an empty slug and is rejected before any write). */
function parsePublicProductId(docId) {
  if (typeof docId !== "string") return null;
  const idx = docId.indexOf("__");
  if (idx <= 0) return null; // no separator, or separator at position 0 (empty prefix)
  const storeId = docId.slice(0, idx);
  const slug = docId.slice(idx + 2);
  if (!slug) return null; // empty slug after "__" → malformed
  return { storeId, slug };
}

/** Derive storeId from a publicProducts doc id (the text before the first "__").
 *  Returns null for malformed ids. Kept as a thin wrapper for callers/tests that
 *  only need the storeId half. */
function deriveStoreId(docId) {
  const parsed = parsePublicProductId(docId);
  return parsed ? parsed.storeId : null;
}

/** A doc is a candidate if its storeId is absent or invalid (null/empty/non-string).
 *  A corrupted `storeId: null` still fails the Firestore rule (isMember(null) → false),
 *  so it MUST be treated as needing repair, not skipped. Returns a strict boolean. */
function isCandidate(data) {
  if (!data || typeof data !== "object") return false;
  const s = data.storeId;
  return typeof s !== "string" || !s; // absent, null, empty, or non-string → needs backfill
}

/**
 * Pure planning function — the load-bearing safety logic of the backfill,
 * extracted so it is unit-testable without Firestore or an emulator.
 *
 * Inputs:
 *   store: the --store value (already shape-validated by the caller).
 *   docs:  array of { id, data } plain objects (the docs in the --store id range).
 *   apply: whether the caller intends to write (only affects the reported mode).
 *
 * Returns one of:
 *   { status: "noop",          total, candidates: 0 }            — nothing to migrate
 *   { status: "too-many",      total, candidates, limit }        — > BATCH_LIMIT
 *   { status: "abort",         total, candidates, offenders, mismatched } — validation failed
 *   { status: "ready",         total, candidates, mismatched, writes, mode }
 *
 * Validation (all-or-nothing, runs BEFORE any write):
 *   - For each candidate, parsePublicProductId(id) must succeed AND its storeId
 *     must equal `store` (double-check: the range query already scopes, but this
 *     enforces the contract inside the batch).
 *   - A doc in the range whose data.storeId is a non-empty string DIFFERENT from
 *     `store` is a `mismatched` doc → reported and aborts. (Silently leaving it
 *     would let the script claim "all repaired" while a wrong-storeId doc remains.)
 *   - Empty/null/non-string storeId docs are candidates (repaired), not mismatched.
 */
function planBackfill({ store, docs, apply }) {
  const total = docs.length;
  const candidates = [];
  const offenders = []; // candidate ids whose derived storeId != store or malformed
  const mismatched = []; // range docs with a non-empty storeId that != store

  for (const { id, data } of docs) {
    const existing = data && typeof data === "object" && typeof data.storeId === "string" ? data.storeId : null;
    if (existing && existing !== store) {
      // A non-empty storeId pointing elsewhere in this store's id range is suspicious.
      mismatched.push({ id, storeId: existing });
      continue;
    }
    if (isCandidate(data)) {
      candidates.push(id);
      const parsed = parsePublicProductId(id);
      if (!parsed || parsed.storeId !== store) {
        offenders.push(id);
      }
    }
  }

  if (mismatched.length) {
    return { status: "abort", total, candidates, offenders, mismatched };
  }
  if (candidates.length === 0) {
    return { status: "noop", total, candidates: 0 };
  }
  if (candidates.length > BATCH_LIMIT) {
    return { status: "too-many", total, candidates, limit: BATCH_LIMIT };
  }
  if (offenders.length) {
    return { status: "abort", total, candidates, offenders, mismatched };
  }
  return {
    status: "ready",
    total,
    candidates,
    mismatched,
    writes: candidates.length,
    mode: apply ? "APPLY" : "DRY-RUN",
  };
}

// --- main ---
async function run(env, store, apply) {
  const projectId = PROJECTS[env];
  if (!projectId) {
    fail(`--env inválido: '${env}'. Debe ser 'dev' o 'prod'.`);
  }
  if (!store || typeof store !== "string" || !/^store_[a-z0-9_]+$/.test(store)) {
    fail(`--store inválido: '${store}'. Debe ser un storeId con shape 'store_<slug>' (ej. 'store_olivia').`);
  }

  let admin;
  try {
    const { initializeApp, getApps } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    admin = { initializeApp, getApps, getFirestore };
  } catch (e) {
    fail(
      "No se encontró 'firebase-admin'. Es una devDependency — ejecuta `npm install` y vuelve a intentar."
    );
  }

  const credentialEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const hasAdc = credentialEnv || hasGcloudAdc();
  if (!hasAdc) {
    console.error("");
    console.error("\x1b[31m[backfill] Faltan las credenciales (ADC).\x1b[0m");
    console.error("[backfill] Autentica una vez con gcloud (login por navegador, sin contraseña, sin secreto en el repo):");
    console.error("");
    console.error("    gcloud auth application-default login");
    console.error("");
    console.error(`[backfill] Luego vuelve a ejecutar:  node scripts/backfill-public-product-store-ids.cjs --env ${env} --store ${store}${apply ? " --apply" : ""}`);
    process.exit(1);
  }

  const appName = `backfill-${env}`;
  const existing = admin.getApps().find((a) => a.name === appName);
  const app = existing || admin.initializeApp({ projectId }, appName);
  const db = admin.getFirestore(app);
  // FieldPath must be imported after admin is loaded (it's a firestore type).
  const { FieldPath } = require("firebase-admin/firestore");

  const mode = apply ? "APPLY" : "DRY-RUN";
  console.log(`\x1b[36m[backfill]\x1b[0m Proyecto: \x1b[1m${projectId}\x1b[0m  Store: \x1b[1m${store}\x1b[0m  Modo: \x1b[1m${mode}\x1b[0m`);

  // 1) Validate adminStores/{store} exists ONCE (control-plane source of truth).
  const adminStoreSnap = await db.collection("adminStores").doc(store).get();
  if (!adminStoreSnap.exists) {
    fail(`No existe adminStores/${store} en ${projectId}. Abortando antes de cualquier escritura.`);
  }

  // 2) Range query on the doc id to scope to this store's publicProducts.
  const prefix = `${store}__`;
  const snap = await db
    .collection("publicProducts")
    .where(FieldPath.documentId(), ">=", prefix)
    .where(FieldPath.documentId(), "<", prefix + "")
    .get();

  const total = snap.size;
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));

  // Delegate all safety decisions to the pure, unit-tested planner.
  const plan = planBackfill({ store, docs, apply });
  console.log(`[backfill] Docs en el rango: ${total}. Candidatos sin storeId: ${plan.candidates.length}.`);

  if (plan.status === "noop") {
    console.log(`\x1b[32m[backfill] Nada que migrar.\x1b[0m Todos los docs de ${store} ya tienen storeId.`);
    await app.delete();
    return;
  }
  if (plan.status === "too-many") {
    fail(`${plan.candidates.length} candidatos superan el límite de batch (${plan.limit}). Abortando — divide el trabajo o migra manualmente.`);
  }
  if (plan.status === "abort") {
    if (plan.mismatched && plan.mismatched.length) {
      fail(
        `Docs en el rango con storeId != '${store}' (no se reparan, aborta). Abortando antes de escribir.\n` +
          plan.mismatched.map((m) => `  - ${m.id}  (storeId='${m.storeId}')`).join("\n")
      );
    }
    fail(
      `Candidatos con storeId derivado != '${store}' (o malformados). Abortando antes de escribir.\n` +
        plan.offenders.map((o) => `  - ${o}`).join("\n")
    );
  }

  // status === "ready"
  const candidateDocs = snap.docs.filter((d) => plan.candidates.includes(d.id));
  console.log(`[backfill] Candidatos a ${apply ? "escribir" : "reportar"} (${plan.candidates.length}):`);
  for (const id of plan.candidates) {
    console.log(`  - ${id}  →  storeId: '${store}'`);
  }

  if (!apply) {
    console.log(`\x1b[36m[backfill] DRY-RUN\x1b[0m — no se escribió nada. Re-ejecuta con --apply para aplicar.`);
    console.log(`[backfill] Consumo estimado en --apply: ~${total + 1} lecturas + ${plan.candidates.length} escrituras.`);
    await app.delete();
    return;
  }

  // 4) One batch, partial update per candidate.
  const batch = db.batch();
  for (const doc of candidateDocs) {
    batch.update(doc.ref, { storeId: store });
  }
  await batch.commit();

  console.log(`\x1b[32m[backfill] OK\x1b[0m ${plan.candidates.length} docs actualizados con storeId='${store}'.`);
  console.log(`[backfill] Consumo: ${total + 1} lecturas + ${plan.candidates.length} escrituras.`);
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
  console.error(`\x1b[31m[backfill] BLOQUEADO:\x1b[0m ${msg}`);
  process.exit(1);
}

// --- Self-test: `node scripts/backfill-public-product-store-ids.cjs --test` ---
// No network. Mirrors seed-dev.cjs's embedded self-test pattern.
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

  it("deriveStoreId extracts text before first __", () => {
    assert.strictEqual(deriveStoreId("store_olivia__collar-de-plata"), "store_olivia");
    assert.strictEqual(deriveStoreId("store_olivia__a__b"), "store_olivia"); // first __ only
  });

  it("deriveStoreId rejects malformed ids", () => {
    assert.strictEqual(deriveStoreId("noseparator"), null);
    assert.strictEqual(deriveStoreId("__leadseparator"), null); // empty prefix
    assert.strictEqual(deriveStoreId("store_olivia__"), null); // empty slug → malformed
    assert.strictEqual(deriveStoreId(""), null);
    assert.strictEqual(deriveStoreId(undefined), null);
    assert.strictEqual(deriveStoreId(123), null);
  });

  it("isCandidate flags docs whose storeId is absent or invalid", () => {
    assert.strictEqual(isCandidate({ name: "x", storeSlug: "o" }), true); // absent
    assert.strictEqual(isCandidate({ storeId: "store_olivia", name: "x" }), false); // valid
    assert.strictEqual(isCandidate({ storeId: null }), true); // null → still broken, must repair
    assert.strictEqual(isCandidate({ storeId: "" }), true); // empty → broken
    assert.strictEqual(isCandidate({ storeId: 123 }), true); // non-string → broken
    assert.strictEqual(isCandidate(null), false); // not a doc
  });

  it("planBackfill: noop when all docs already have storeId", () => {
    const plan = planBackfill({
      store: "store_olivia",
      docs: [{ id: "store_olivia__a", data: { storeId: "store_olivia" } }],
      apply: false,
    });
    assert.strictEqual(plan.status, "noop");
    assert.strictEqual(plan.candidates, 0);
  });

  it("planBackfill: ready with writes when a candidate lacks storeId", () => {
    const plan = planBackfill({
      store: "store_olivia",
      docs: [
        { id: "store_olivia__a", data: { storeId: "store_olivia" } },
        { id: "store_olivia__b", data: { storeSlug: "olivia" } }, // no storeId → candidate
      ],
      apply: false,
    });
    assert.strictEqual(plan.status, "ready");
    assert.strictEqual(plan.mode, "DRY-RUN");
    assert.deepStrictEqual(plan.candidates, ["store_olivia__b"]);
    assert.strictEqual(plan.writes, 1);
  });

  it("planBackfill: dry-run never changes the plan vs apply (apply only flips mode)", () => {
    const docs = [{ id: "store_olivia__b", data: {} }];
    const dry = planBackfill({ store: "store_olivia", docs, apply: false });
    const app = planBackfill({ store: "store_olivia", docs, apply: true });
    assert.strictEqual(dry.status, app.status);
    assert.deepStrictEqual(dry.candidates, app.candidates);
    assert.strictEqual(dry.mode, "DRY-RUN");
    assert.strictEqual(app.mode, "APPLY");
  });

  it("planBackfill: abort when a candidate's derived storeId != store (anomaly)", () => {
    // A doc id in the range but with a different prefix is a scope anomaly.
    const plan = planBackfill({
      store: "store_olivia",
      docs: [{ id: "store_other__b", data: {} }],
      apply: true,
    });
    assert.strictEqual(plan.status, "abort");
    assert.deepStrictEqual(plan.offenders, ["store_other__b"]);
  });

  it("planBackfill: abort when a range doc has a non-empty storeId != store (mismatch)", () => {
    // Silent skip would let the script claim 'all repaired' while a wrong-storeId
    // doc remains. It must abort and report.
    const plan = planBackfill({
      store: "store_olivia",
      docs: [{ id: "store_olivia__b", data: { storeId: "store_other" } }],
      apply: true,
    });
    assert.strictEqual(plan.status, "abort");
    assert.strictEqual(plan.mismatched.length, 1);
    assert.strictEqual(plan.mismatched[0].id, "store_olivia__b");
  });

  it("planBackfill: too-many when candidates exceed BATCH_LIMIT", () => {
    const docs = [];
    for (let i = 0; i < BATCH_LIMIT + 1; i++) {
      docs.push({ id: `store_olivia__p${i}`, data: {} });
    }
    const plan = planBackfill({ store: "store_olivia", docs, apply: true });
    assert.strictEqual(plan.status, "too-many");
    assert.strictEqual(plan.limit, BATCH_LIMIT);
  });

  it("BATCH_LIMIT is the Firestore batch ceiling (500)", () => {
    assert.strictEqual(BATCH_LIMIT, 500);
  });

  if (exitCode !== 0) {
    console.error("\x1b[31mself-test FALLÓ\x1b[0m");
    process.exit(1);
  }
  console.log("\x1b[32mself-test OK\x1b[0m");
}

// --- Entry point + CLI parsing ---
// Accepts both --flag=value and --flag value forms (so the documented
// `--env dev --store store_olivia` works the same as `--env=dev --store=store_olivia`).
// Rejects unknown flags so a typo (e.g. --envy) fails loudly instead of being
// silently ignored. --test is exclusive of --env/--store/--apply.
const KNOWN_FLAGS = new Set(["--test", "--env", "--store", "--apply"]);
function parseArgs(argv) {
  const raw = argv.slice(2);
  const opts = { test: false, env: undefined, store: undefined, apply: false };
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    if (tok === "--test") opts.test = true;
    else if (tok === "--apply") opts.apply = true;
    else if (tok.startsWith("--env=")) opts.env = tok.slice("--env=".length);
    else if (tok === "--env") opts.env = raw[++i];
    else if (tok.startsWith("--store=")) opts.store = tok.slice("--store=".length);
    else if (tok === "--store") opts.store = raw[++i];
    else {
      console.error(`\x1b[31m[backfill] Flag desconocido: '${tok}'.\x1b[0m`);
      console.error("Flags válidos: --test | --env <dev|prod> --store <store_id> [--apply]");
      process.exit(2);
    }
  }

  if (opts.test && (opts.env || opts.store || opts.apply)) {
    console.error("\x1b[31m[backfill] --test es exclusivo de --env/--store/--apply.\x1b[0m");
    process.exit(2);
  }
  if (opts.test) return { mode: "test" };
  if (!opts.env || !opts.store) {
    console.error("Uso: node scripts/backfill-public-product-store-ids.cjs --test");
    console.error("     node scripts/backfill-public-product-store-ids.cjs --env <dev|prod> --store <store_id> [--apply]");
    process.exit(2);
  }
  return { mode: "run", env: opts.env, store: opts.store, apply: opts.apply };
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (opts.mode === "test") {
    runSelfTest();
  } else {
    run(opts.env, opts.store, opts.apply).catch((e) => {
      console.error(`\x1b[31m[backfill] Error inesperado:\x1b[0m ${e && e.stack ? e.stack : e}`);
      process.exit(1);
    });
  }
}

module.exports = { run, deriveStoreId, parsePublicProductId, isCandidate, planBackfill, parseArgs };
