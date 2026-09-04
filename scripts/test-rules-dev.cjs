#!/usr/bin/env node
/**
 * Small black-box rules check against Firebase dev. Admin SDK prepares the
 * fixtures; the REST client performs every assertion through Security Rules.
 */
"use strict";

const { getApps, initializeApp, applicationDefault, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { check, loadEnv, DEV_PROJECT_ID } = require("./check-env.cjs");

const env = loadEnv("development");
check(env.VITE_VERCEL_ENV, env.VITE_FIREBASE_PROJECT_ID, {
  required: true,
  values: env,
});

const API_KEY = env.VITE_FIREBASE_API_KEY;
const REST_BASE = `https://firestore.googleapis.com/v1/projects/${DEV_PROJECT_ID}/databases/(default)/documents`;
const ids = {
  member: "rules_test_member",
  other: "rules_test_other",
  memberUser: "rules_test_member",
  otherUser: "rules_test_other",
  store: "rules_test_store",
  otherStore: "rules_test_other_store",
  ownCustomer: "rules_test_own_customer",
  otherCustomer: "rules_test_other_customer",
  publicStore: "rules_test_public_store",
};

function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
}

function fields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
}

async function rest(method, path, token, body) {
  const response = await fetch(`${REST_BASE}/${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify({ fields: fields(body) }) } : {}),
  });
  return response;
}

async function idTokenFor(uid) {
  const customToken = await getAuth().createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await response.json();
  if (!response.ok || !data.idToken) throw new Error(`No se pudo obtener token de pruebas: ${JSON.stringify(data)}`);
  return data.idToken;
}

async function ensureUser(uid, email) {
  try {
    await getAuth().getUser(uid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    await getAuth().createUser({ uid, email, emailVerified: true });
  }
}

async function setAdminDoc(path, value) {
  await getFirestore().doc(path).set(value);
}

async function cleanup() {
  const db = getFirestore();
  for (const path of [
    `adminStores/${ids.store}`,
    `adminStores/${ids.otherStore}`,
    `users/${ids.memberUser}`,
    `users/${ids.otherUser}`,
    `customers/${ids.ownCustomer}`,
    `customers/${ids.otherCustomer}`,
    `publicStores/${ids.publicStore}`,
  ]) await db.doc(path).delete().catch(() => {});
  for (const uid of [ids.member, ids.other]) await getAuth().deleteUser(uid).catch(() => {});
}

async function main() {
  let credential;
  if (env.FIREBASE_DEV_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(env.FIREBASE_DEV_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.project_id && serviceAccount.project_id !== DEV_PROJECT_ID) {
      throw new Error(`La cuenta de servicio apunta a ${serviceAccount.project_id}, no a ${DEV_PROJECT_ID}.`);
    }
    credential = cert(serviceAccount);
  } else {
    credential = applicationDefault();
  }
  const app = getApps()[0] ?? initializeApp({ projectId: DEV_PROJECT_ID, credential });
  try {
    await ensureUser(ids.member, "rules-test-member@store.os");
    await ensureUser(ids.other, "rules-test-other@store.os");
    await setAdminDoc(`users/${ids.memberUser}`, { email: "rules-test-member@store.os", emailNormalized: "rules-test-member@store.os", role: "member" });
    await setAdminDoc(`users/${ids.otherUser}`, { email: "rules-test-other@store.os", emailNormalized: "rules-test-other@store.os", role: "member" });
    await setAdminDoc(`adminStores/${ids.store}`, { ownerUid: ids.member, memberUids: [ids.member], storeId: ids.store });
    await setAdminDoc(`adminStores/${ids.otherStore}`, { ownerUid: ids.other, memberUids: [ids.other], storeId: ids.otherStore });
    await setAdminDoc(`customers/${ids.ownCustomer}`, { storeId: ids.store, name: "Cliente propio" });
    await setAdminDoc(`customers/${ids.otherCustomer}`, { storeId: ids.otherStore, name: "Cliente ajeno" });
    await setAdminDoc(`publicStores/${ids.publicStore}`, { storeId: ids.store, slug: ids.publicStore, name: "Prueba pública" });

    const memberToken = await idTokenFor(ids.member);
    const cases = [
      ["anónimo puede leer proyección pública", (r) => r.status === 200, () => rest("GET", `publicStores/${ids.publicStore}`)],
      ["anónimo no puede escribir clientes", (r) => r.status === 403, () => rest("PATCH", `customers/${ids.ownCustomer}`, undefined, { name: "intruso" })],
      ["miembro puede leer su cliente", (r) => r.status === 200, () => rest("GET", `customers/${ids.ownCustomer}`, memberToken)],
      ["miembro no puede leer cliente de otra tienda", (r) => r.status === 403, () => rest("GET", `customers/${ids.otherCustomer}`, memberToken)],
      ["anónimo no puede leer límite anti-abuso", (r) => r.status === 403, () => rest("GET", "publicOrderLimits/rules_test", undefined)],
    ];
    for (const [name, predicate, request] of cases) {
      const response = await request();
      if (!predicate(response)) throw new Error(`${name}: HTTP ${response.status}`);
      console.log(`✓ ${name}`);
    }
  } finally {
    await cleanup();
    if (getApps().includes(app)) await app.delete();
  }
}

main().catch((error) => {
  console.error(`\x1b[31mtest:rules FALLÓ:\x1b[0m ${error.message}`);
  if (/service account|metadata|credential/i.test(error.message)) {
    console.error("Configura gcloud ADC o FIREBASE_DEV_SERVICE_ACCOUNT_JSON para el proyecto store-os-dev.");
  }
  process.exit(1);
});
