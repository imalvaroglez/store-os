#!/usr/bin/env node
"use strict";

const PROJECT = "store-os-f7cf8";
const EMULATOR_PROJECT = "store-os-demo";

function parseArgs(argv) {
  const known = new Set(["--emulator", "--prod", "--apply"]);
  const flags = new Set(argv);
  for (const flag of flags) if (!known.has(flag)) throw new Error(`Opción desconocida: ${flag}`);
  if (flags.has("--emulator") === flags.has("--prod")) throw new Error("Indica exactamente una opción: --emulator o --prod.");
  return { target: flags.has("--prod") ? "prod" : "emulator", apply: flags.has("--apply") };
}

function buildAdminStore(id, store) {
  if (!store || typeof store !== "object") return { status: "skip", reason: "la tienda no contiene datos válidos" };
  if (!Array.isArray(store.memberUids) || typeof store.ownerUid !== "string" || !store.ownerUid
      || !store.memberUids.includes(store.ownerUid)) {
    return { status: "skip", reason: "faltan ownerUid o membresía del propietario; requiere revisión humana" };
  }
  const data = { storeId: id };
  for (const key of ["name", "slug", "type", "ownerUid", "memberUids", "createdAt", "updatedAt"]) {
    if (store[key] !== undefined) data[key] = store[key];
  }
  data.pendingInvites = Array.isArray(store.pendingInvites) ? store.pendingInvites : [];
  data.retainedPrivacyRequestCount = Number.isInteger(store.retainedPrivacyRequestCount)
    ? store.retainedPrivacyRequestCount : 0;
  return { status: "create", data };
}

async function planMigration(db) {
  const [stores, controls] = await Promise.all([
    db.collection("stores").get(),
    db.collection("adminStores").get(),
  ]);
  const existing = new Set(controls.docs.map((doc) => doc.id));
  const creates = [];
  const skipped = [];
  for (const snapshot of stores.docs) {
    if (existing.has(snapshot.id)) continue;
    const result = buildAdminStore(snapshot.id, snapshot.data());
    if (result.status === "create") creates.push({ id: snapshot.id, data: result.data });
    else skipped.push({ id: snapshot.id, reason: result.reason });
  }
  return { creates, skipped };
}

function validateTarget(target, emulatorHost) {
  if (target === "prod" && emulatorHost) {
    throw new Error("FIRESTORE_EMULATOR_HOST está configurado; quítalo antes de seleccionar producción.");
  }
  if (target === "emulator") {
    if (!emulatorHost) throw new Error("Emulador no detectado. Inícialo y vuelve a correr con --emulator.");
    if (emulatorHost !== "127.0.0.1:8080" && emulatorHost !== "localhost:8080") {
      throw new Error(`Host de emulador inesperado: ${emulatorHost}`);
    }
  }
}

async function confirmProduction(apply) {
  const readline = require("node:readline/promises");
  if (!process.stdin.isTTY) throw new Error("--prod requiere una terminal interactiva.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const project = await rl.question(`Escribe ${PROJECT} para confirmar lectura del proyecto de producción: `);
    if (project.trim() !== PROJECT) throw new Error("Confirmación de producción incorrecta.");
    if (apply) {
      const action = await rl.question("Escribe APLICAR para crear únicamente los documentos faltantes: ");
      if (action.trim() !== "APLICAR") throw new Error("Segunda confirmación incorrecta; no se escribió nada.");
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectId = options.target === "prod" ? PROJECT : EMULATOR_PROJECT;
  validateTarget(options.target, process.env.FIRESTORE_EMULATOR_HOST);
  if (options.target === "prod") await confirmProduction(options.apply);

  const { getFirestore } = require("firebase-admin/firestore");
  const { initializeApp, getApps } = require("firebase-admin/app");
  const app = getApps()[0] ?? initializeApp({ projectId });
  const db = getFirestore(app);
  const plan = await planMigration(db);
  console.log(`Destino: ${options.target === "prod" ? "PRODUCCIÓN" : "emulador local"} (${projectId})`);
  console.log(`Documentos faltantes que se crearían: ${plan.creates.length}`);
  for (const item of plan.creates) console.log(`  ${item.id}: ${JSON.stringify(item.data)}`);
  for (const item of plan.skipped) console.log(`  OMITIDO ${item.id}: ${item.reason}`);
  if (!options.apply) {
    console.log("Dry-run: no se escribió ningún documento. Agrega --apply para aplicar el plan.");
    return;
  }
  for (const item of plan.creates) {
    try {
      await db.collection("adminStores").doc(item.id).create(item.data);
      console.log(`CREADO ${item.id}`);
    } catch (error) {
      if (error.code === 6 || error.code === "already-exists") {
        console.log(`OMITIDO ${item.id}: otro proceso creó el documento; no se sobrescribió.`);
        continue;
      }
      throw error;
    }
  }
  console.log(`Listo. ${plan.creates.length} documento(s) faltante(s) procesado(s).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[migrate-adminstores] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildAdminStore, parseArgs, planMigration, validateTarget };
