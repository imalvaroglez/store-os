#!/usr/bin/env node
// Copy PRODUCTION data (store-os-f7cf8) into DEV (store-os-dev) so the team can
// rehearse against a realistic snapshot. RUN BY A HUMAN — reading production is
// an explicit, human-approved operation by design (LOOPS.md); this script never
// writes to production and refuses any other project pair.
//
// Usage (from the repo root, with credentials that can read prod + write dev):
//   GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json node scripts/copy-prod-to-dev.cjs \
//     --owner-uid <YOUR_DEV_UID> [--anonymize-customers] [--apply]
//
// - Dry-run by default: prints per-collection counts only.
// - --apply performs batched writes into dev.
// - Membership (ownerUid/memberUids/pendingInvites) is REMAPPED to --owner-uid:
//   prod auth users don't exist in dev and a raw copy would lock everyone out.
// - --anonymize-customers replaces real names/phones/notes (PII) with placeholders.
// - users (Auth lives elsewhere), slugs and public* projections are NOT copied:
//   re-publish the catalog from the store settings screen after copying.

"use strict";

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROD = "store-os-f7cf8";
const DEV = "store-os-dev";
// Private business collections only. `users` is an Auth projection, `slugs` is a
// global namespace dev already owns, `public*` regenerate on publish.
const COLLECTIONS = ["stores", "adminStores", "categories", "products", "suppliers", "purchases", "customers", "orders"];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const ownerUid = value("owner-uid");
const APPLY = flag("apply");
const ANON = flag("anonymize-customers");

if (!ownerUid) {
  console.error("Falta --owner-uid (tu UID de usuario en dev). Cópialo de Auth → Users en store-os-dev.");
  process.exit(2);
}

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error("Se requiere GOOGLE_APPLICATION_CREDENTIALS (una credencial con lectura en prod y escritura en dev).");
  process.exit(2);
}

const source = JSON.parse(require("node:fs").readFileSync(serviceAccountPath, "utf8"));
if (source.project_id && ![PROD, DEV, "firebase-admin-sdk-requests"].includes(source.project_id)) {
  // A service account tied to one project still works cross-project if IAM allows;
  // this is just an early heads-up, not a gate.
  console.warn(`Aviso: la credencial pertenece a '${source.project_id}'. Asegúrate de que tenga acceso a ${PROD} y ${DEV}.`);
}

const prodApp = initializeApp({ credential: cert(source), projectId: PROD }, "prod-copy-source");
const devApp = initializeApp({ credential: cert(source), projectId: DEV }, "dev-copy-target");
const prodDb = getFirestore(prodApp);
const devDb = getFirestore(devApp);

/** Remap store membership so the copy is operable in dev. */
function remapMembership(data) {
  return { ...data, ownerUid, memberUids: [ownerUid], pendingInvites: [] };
}

let customerCounter = 0;
/** Optionally strip PII from customer docs. */
function anonymizeCustomer(data) {
  if (!ANON) return data;
  customerCounter += 1;
  return {
    ...data,
    name: `Clienta de prueba ${customerCounter}`,
    phone: FieldValue.delete(),
    instagram: FieldValue.delete(),
    notes: FieldValue.delete(),
  };
}

const TRANSFORMS = {
  stores: remapMembership,
  adminStores: remapMembership,
  customers: anonymizeCustomer,
};

async function copyCollection(name) {
  const snapshot = await prodDb.collection(name).get();
  const transform = TRANSFORMS[name] || ((data) => data);
  if (!APPLY) {
    console.log(`  ${name}: ${snapshot.size} docs (dry-run)`);
    return snapshot.size;
  }
  let written = 0;
  // Chunked writes (Firestore batch limit: 499 ops).
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = devDb.batch();
    for (const doc of docs.slice(i, i + 400)) {
      batch.set(devDb.collection(name).doc(doc.id), transform(doc.data()));
    }
    await batch.commit();
    written += Math.min(400, docs.length - i);
  }
  console.log(`  ${name}: ${written} docs escritos`);
  return written;
}

async function main() {
  console.log(`Copia ${PROD} → ${DEV}  |  owner remap → ${ownerUid}`);
  console.log(`Modo: ${APPLY ? "APLICAR (escribe en dev)" : "DRY-RUN (solo conteos)"}  |  clientas: ${ANON ? "ANONIMIZADAS" : "tal cual"}`);
  const totals = {};
  for (const name of COLLECTIONS) {
    totals[name] = await copyCollection(name);
  }
  console.log(APPLY ? "Listo. Publica el catálogo desde Configuración si quieres probar la vitrina." : "Dry-run completo. Vuelve a correr con --apply para escribir.");
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
