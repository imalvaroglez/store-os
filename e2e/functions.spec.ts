import { test, expect } from "@playwright/test";
// All tests carry the @functions tag: the script runs them in a SEPARATE
// emulator session (see scripts/e2e-firebase.sh) so the Functions emulator
// never contends with the photo/preview e2e on CI runners.
import { readFileSync } from "node:fs";
import { adminToken, mintUserToken, PROJECT, writeEmulatorDoc, FIRESTORE_REST } from "./helpers";
import { FIREBASE_DEV_STORAGE_BUCKET } from "../src/app/firebase/projectIds";

// Direct callable authorization + safe-cleanup tests against the Functions
// emulator. tesseract/mupdf load lazily AFTER these guards, so no OCR runs.

const FN = `http://127.0.0.1:5001/${PROJECT}/us-east1/importPurchasePdf`;

async function callCallable(body: unknown, token?: string) {
  return fetch(FN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data: body }),
  });
}

// Minimal valid PDF bytes (empty page) for storage-emulator uploads.
const MINIMAL_PDF = readFileSync("e2e/fixtures/minimal.pdf");

// Storage emulator REST calls carry the auth token: the emulator enforces the
// (permissive test) rules, which gate purchases/ on request.auth.
const BUCKET = FIREBASE_DEV_STORAGE_BUCKET;

async function uploadPdf(storeId: string, name: string, token: string) {
  const res = await fetch(
    `http://127.0.0.1:9199/v0/b/${BUCKET}/o/purchases%2F${storeId}%2F${name}.pdf?uploadType=media`,
    { method: "POST", headers: { "Content-Type": "application/pdf", Authorization: `Bearer ${token}` }, body: MINIMAL_PDF }
  );
  return res.ok;
}

async function pdfExists(storeId: string, name: string, token: string) {
  const res = await fetch(
    `http://127.0.0.1:9199/v0/b/${BUCKET}/o/purchases%2F${storeId}%2F${name}.pdf`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.ok;
}

// Session-2 state is self-contained (fresh emulator): create the admin
// account and its store membership if they don't exist yet.
async function ensureAdmin() {
  const { token, uid } = await mintUserToken();
  await writeEmulatorDoc("adminStores", "store_joyeria", { ownerUid: uid, memberUids: [uid] });
  return { token, uid };
}

let admin: { token: string; uid: string } | null = null;
test.beforeAll(async () => {
  // Seeded in beforeAll (not top-level): file load must stay side-effect-free
  // so session 1's --grep-invert never triggers emulator work at import time.
  admin = await ensureAdmin();
});

test("@functions unauthenticated call → unauthenticated", async () => {
  const res = await callCallable({ storagePath: "purchases/store_joyeria/x.pdf" });
  expect([401, 403]).toContain(res.status);
  const body = await res.json();
  expect(body.error?.status ?? body.error?.message).toMatch(/UNAUTHENTICATED|unauthenticated/i);
});

test("@functions member of another store → permission-denied (no OCR)", async () => {
  // Sign up an account that belongs to NO store via the Auth emulator REST API.
  const r = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ux2fn.outsider@example.com", password: "password123", returnSecureToken: true }),
    }
  );
  const { idToken } = await r.json();
  const res = await callCallable({ storagePath: "purchases/store_joyeria/x.pdf" }, idToken);
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error?.message).toMatch(/No tienes acceso|PERMISSION_DENIED/i);
});

test("@functions member with a missing path → not-found (authorization passed, no OCR)", async () => {
  const auth = admin!;
  const res = await callCallable({ storagePath: "purchases/store_joyeria/no-existe.pdf" }, auth.token);
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error?.message).toMatch(/No se encontró el PDF|NOT_FOUND/i);
});

// #176 (Funciones/importaciones): the storagePath regex is the ONLY thing
// standing between the callable and a Storage read — traversal, escapes from
// purchases/, and non-PDF suffixes must die on invalid-argument before the
// auth check even runs (no Storage access, no OCR).
test("@functions malformed storagePath → invalid-argument, no Storage/OCR access", async () => {
  const auth = admin!;
  const malformed = [
    "../etc/passwd.pdf",                              // traversal, no prefix
    "purchases/../secret.pdf",                        // escape after the prefix
    "purchases/store_joyeria/../../other-store/a.pdf", // nested escape
    "purchases/store_joyeria/notas.txt",              // not a PDF
    "purchases/store_joyeria/a%2Fb.pdf",              // encoded separator
    "orders/store_joyeria/a.pdf",                     // wrong collection
    "",                                               // empty
    "purchases/store_joyeria/",                       // missing file segment
  ];
  for (const storagePath of malformed) {
    const res = await callCallable({ storagePath }, auth.token);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/Ruta de PDF inválida|INVALID_ARGUMENT/i);
  }
  // Non-string shapes share the same fate.
  for (const storagePath of [null, 42, { evil: "purchases/store_joyeria/x.pdf" }]) {
    const res = await callCallable({ storagePath }, auth.token);
    expect(res.status).toBe(400);
  }
});

test("@functions failed OCR on an UNLINKED pdf deletes the file", async () => {
  const auth = admin!;
  await uploadPdf("store_joyeria", "cleanup-free", auth.token);
  await expect
    .poll(async () => pdfExists("store_joyeria", "cleanup-free", auth.token), { timeout: 10000 })
    .toBe(true);
  // The minimal PDF has no extractable text → no-text path → cleanup.
  const res = await callCallable({ storagePath: "purchases/store_joyeria/cleanup-free.pdf" }, auth.token);
  expect([200, 500]).toContain(res.status);
  await expect
    .poll(async () => pdfExists("store_joyeria", "cleanup-free", auth.token), { timeout: 15000 })
    .toBe(false);
});

test("@functions failed OCR on a LINKED pdf keeps the file", async () => {
  const auth = admin!;
  await uploadPdf("store_joyeria", "cleanup-linked", auth.token);
  // A purchase references the path → must survive a failed re-process.
  await writeEmulatorDoc("purchases", "ux2_fn_linked", {
    storeId: "store_joyeria",
    documentPath: "purchases/store_joyeria/cleanup-linked.pdf",
    lines: [],
    subtotal: 0,
    totalConfirmed: 0,
    status: "draft",
    createdAt: "2026-08-23T00:00:00Z",
    updatedAt: "2026-08-23T00:00:00Z",
  });
  const res = await callCallable({ storagePath: "purchases/store_joyeria/cleanup-linked.pdf" }, auth.token);
  expect([200, 500]).toContain(res.status);
  // Give the cleanup guard a moment, then assert the file is still there.
  await expect
    .poll(async () => pdfExists("store_joyeria", "cleanup-linked", auth.token), { timeout: 15000 })
    .toBe(true);
});

// ── #583 correctPointCut: atomic corte correction ──────────────────────────
// Direct callable tests against the Functions emulator: the replacement is
// ONE transaction (restore + new plan + links), eligibility mirrors the
// annulment guard, and the intentId idempotency answers already-applied.
const CUT_BASE = `http://${process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001"}/${PROJECT}/us-east1`;

async function callCut(name: string, body: unknown, token?: string) {
  return fetch(`${CUT_BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data: body }),
  });
}

// Typed-value decode for reading seeded/committed docs back.
function decodeValue(value: Record<string, unknown>): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return ((value.arrayValue as { values?: unknown[] }).values ?? []).map((v) => decodeValue(v as Record<string, unknown>));
  if ("mapValue" in value) {
    const fields = (value.mapValue as { fields?: Record<string, unknown> }).fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v as Record<string, unknown>)]));
  }
  return null;
}

async function readDoc(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${FIRESTORE_REST}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`read ${path}: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { fields?: Record<string, unknown> };
  return Object.fromEntries(Object.entries(body.fields ?? {}).map(([k, v]) => [k, decodeValue(v as Record<string, unknown>)]));
}

// pointEntries/pointOperations are callable-only (rules deny every client
// write), so the seed goes through the genuine paths: the product+point docs
// by REST, then stockPointFromWarehouse moves the warehouse pieces IN and
// creates the entry — the same world the operator lives in.
async function seed583Point(storeId: string, pointId: string, auth: { token: string; uid: string }, qty = 10) {
  await writeEmulatorDoc("adminStores", storeId, { ownerUid: auth.uid, memberUids: [auth.uid] });
  await writeEmulatorDoc("points", pointId, {
    id: pointId,
    storeId,
    name: "Mostrador centro",
    active: true,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
  });
  await writeEmulatorDoc("products", `prod_${storeId}`, {
    id: `prod_${storeId}`,
    storeId,
    name: "Cartera de piel",
    category: "other",
    isPublic: false,
    quantityOnHand: qty,
    cost: 300,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
  });
  const res = await callCut("stockPointFromWarehouse", {
    storeId,
    pointId,
    intentId: `stk_${storeId}`,
    physicalDate: "2026-11-20",
    lines: [{ productId: `prod_${storeId}`, qty, markedPriceCents: 68000, unitCostCents: 30000 }],
  }, auth.token);
  if (!res.ok) throw new Error(`stockPointFromWarehouse failed: ${res.status} ${await res.text()}`);
}

// The entry id is minted by the callable — recover it from the corte's own
// FIFO evidence (LIST is rule-denied; GET per doc is the members' path).
async function consumedQtyOf(corteId: string, token: string): Promise<number> {
  const corte = await readDoc(`pointOperations/${corteId}`, token);
  const allocations = (corte.saleAllocations as Array<{ allocations: Array<{ entryId: string; quantity: number }> }>)[0]?.allocations ?? [];
  const entryId = allocations[0]?.entryId;
  if (!entryId) throw new Error(`no allocation on ${corteId}`);
  const entry = await readDoc(`pointEntries/${entryId}`, token);
  return entry.consumedQty as number;
}

async function registerCut3(token: string, storeId: string, pointId: string, intent: string) {
  const res = await callCut("registerPointCut", {
    storeId,
    pointId,
    intentId: intent,
    effectiveDate: "2026-11-26",
    commissionRate: 0.2,
    lines: [{ productId: `prod_${storeId}`, markedPriceCents: 68000, soldQty: 3 }],
    writeOffs: [],
  }, token);
  const body = await res.json();
  expect(res.ok).toBe(true);
  return body.result as { corteId: string };
}

test("@functions #583 unauthenticated correction → unauthenticated", async () => {
  // Forma válida completa: la validación de argumentos pasa y el rechazo es
  // de autenticación, no un 400 temprano.
  const res = await callCut("correctPointCut", {
    storeId: "s583a",
    pointId: "s583a__mostrador",
    corteId: "x",
    intentId: "i",
    motive: "m",
    lines: [{ productId: "prod_x", markedPriceCents: 68000, soldQty: 2 }],
    writeOffs: [],
  });
  expect([401, 403]).toContain(res.status);
  const body = await res.json();
  expect(body.error?.status ?? body.error?.message).toMatch(/UNAUTHENTICATED|Inicia sesión/i);
});

test("@functions #583 corrige 3 → 2 en una transacción: entradas, vínculos y un solo corte vigente", async () => {
  const auth = admin!;
  const storeId = "s583_happy";
  const pointId = "s583_happy__mostrador";
  await seed583Point(storeId, pointId, auth);
  const cut = await registerCut3(auth.token, storeId, pointId, "i583happy");

  const res = await callCut("correctPointCut", {
    storeId,
    pointId,
    corteId: cut.corteId,
    intentId: "i583happy_corr",
    motive: "Eran 2 piezas, no 3",
    lines: [{ productId: `prod_${storeId}`, markedPriceCents: 68000, soldQty: 2 }],
    writeOffs: [],
  }, auth.token);
  const body = await res.json();
  expect(res.ok).toBe(true);
  expect(body.result.corrected).toBe(true);
  expect(body.result.totals.netCents).toBe(108800); // 2×680 − 20%

  // Entrada: el consumo neto es 2 (restaura 3, aplica 2).
  // El consumo neto de la entrada queda en 2 (restaura 3, aplica 2).
  expect(await consumedQtyOf("corte_corr_i583happy_corr", auth.token)).toBe(2);

  // Original: anulado, vinculado al reemplazo, con fecha y comisión intactas.
  const original = await readDoc(`pointOperations/${cut.corteId}`, auth.token);
  expect(original.status).toBe("anulado");
  expect(original.replacedByCorteId).toBe("corte_corr_i583happy_corr");
  expect(original.effectiveDate).toBe("2026-11-26");
  expect(original.commissionRate).toBeCloseTo(0.2);

  // Reemplazo: corte normal, pendiente de cobro, vinculado al original.
  const replacement = await readDoc("pointOperations/corte_corr_i583happy_corr", auth.token);
  expect(replacement.kind).toBe("corte");
  expect(replacement.status).toBe("pendiente_de_cobro");
  expect(replacement.replacesCorteId).toBe(cut.corteId);
  expect((replacement.lines as Array<{ soldQty: number }>)[0].soldQty).toBe(2);

  // Evidencia de la corrección: motivo, responsable y vínculos.
  const corr = await readDoc("pointOperations/corr_i583happy_corr", auth.token);
  expect(corr.kind).toBe("correccion");
  expect(corr.motive).toBe("Eran 2 piezas, no 3");
  expect(corr.confirmedBy).toBe(auth.uid);
  expect(corr.corteId).toBe(cut.corteId);

  // Eslabón de dinero: el reemplazo es un corte normal — se cobra como tal.
  const pay = await callCut("registerPointCutPayment", {
    storeId,
    pointId,
    corteId: "corte_corr_i583happy_corr",
    intentId: "i583happy_pay",
    method: "transfer",
    date: "2026-11-27",
  }, auth.token);
  expect(pay.ok).toBe(true);
  const paid = (await pay.json()).result;
  expect(paid.registered).toBe(true);
  expect(paid.amountCents).toBe(108800);
  const cobrado = await readDoc("pointOperations/corte_corr_i583happy_corr", auth.token);
  expect(cobrado.status).toBe("cobrado");
});

test("@functions #583 reintento con el MISMO intentId → alreadyApplied sin duplicar", async () => {
  const auth = admin!;
  const storeId = "s583_retry";
  const pointId = "s583_retry__mostrador";
  await seed583Point(storeId, pointId, auth);
  const cut = await registerCut3(auth.token, storeId, pointId, "i583retry");
  const payload = {
    storeId,
    pointId,
    corteId: cut.corteId,
    intentId: "i583retry_corr",
    motive: "Respuesta perdida",
    lines: [{ productId: `prod_${storeId}`, markedPriceCents: 68000, soldQty: 2 }],
    writeOffs: [],
  };
  const first = await callCut("correctPointCut", payload, auth.token);
  expect((await first.json()).result.corrected).toBe(true);
  // El reintento (misma intención) no duplica ni reescribe nada.
  const second = await callCut("correctPointCut", payload, auth.token);
  const body = (await second.json()).result;
  expect(body.corrected).toBe(false);
  expect(body.alreadyApplied).toBe(true);
  expect(body.corteId).toBe("corte_corr_i583retry_corr");
  expect(await consumedQtyOf("corte_corr_i583retry_corr", auth.token)).toBe(2);
});

test("@functions #583 corte cobrado → failed-precondition, nada cambia", async () => {
  const auth = admin!;
  const storeId = "s583_paid";
  const pointId = "s583_paid__mostrador";
  await seed583Point(storeId, pointId, auth);
  const cut = await registerCut3(auth.token, storeId, pointId, "i583paid");
  const pay = await callCut("registerPointCutPayment", {
    storeId,
    pointId,
    corteId: cut.corteId,
    intentId: "i583paid_pay",
    method: "cash",
    date: "2026-11-27",
  }, auth.token);
  expect(pay.ok).toBe(true);

  const res = await callCut("correctPointCut", {
    storeId,
    pointId,
    corteId: cut.corteId,
    intentId: "i583paid_corr",
    motive: "Tarde",
    lines: [{ productId: `prod_${storeId}`, markedPriceCents: 68000, soldQty: 2 }],
    writeOffs: [],
  }, auth.token);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error?.message).toMatch(/ya cobrado/i);
  expect(await consumedQtyOf(cut.corteId, auth.token)).toBe(3);
});

test("@functions #583 movimiento posterior → failed-precondition, nada cambia", async () => {
  const auth = admin!;
  const storeId = "s583_later";
  const pointId = "s583_later__mostrador";
  await seed583Point(storeId, pointId, auth);
  const cut = await registerCut3(auth.token, storeId, pointId, "i583later");
  // Un corte posterior genuino (vía callable) es el movimiento que bloquea.
  const later = await callCut("registerPointCut", {
    storeId,
    pointId,
    intentId: "i583later_cut2",
    effectiveDate: "2026-11-27",
    commissionRate: 0.2,
    lines: [{ productId: `prod_${storeId}`, markedPriceCents: 68000, soldQty: 1 }],
    writeOffs: [],
  }, auth.token);
  expect(later.ok).toBe(true);

  const res = await callCut("correctPointCut", {
    storeId,
    pointId,
    corteId: cut.corteId,
    intentId: "i583later_corr",
    motive: "Fuera de tiempo",
    lines: [{ productId: `prod_${storeId}`, markedPriceCents: 68000, soldQty: 2 }],
    writeOffs: [],
  }, auth.token);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error?.message).toMatch(/movimientos posteriores/i);
});

test("@functions #583 mes con cierre autorizado → failed-precondition", async () => {
  const auth = admin!;
  const storeId = "s583_sealed";
  const pointId = "s583_sealed__mostrador";
  await seed583Point(storeId, pointId, auth);
  const cut = await registerCut3(auth.token, storeId, pointId, "i583sealed");
  // Cierre autorizado del mes efectivo (owner siembra el periodo).
  await writeEmulatorDoc("closes", "close583", { id: "close583", storeId, period: "2026-11", createdBy: auth.uid });

  const res = await callCut("correctPointCut", {
    storeId,
    pointId,
    corteId: cut.corteId,
    intentId: "i583sealed_corr",
    motive: "Mes cerrado",
    lines: [{ productId: `prod_${storeId}`, markedPriceCents: 68000, soldQty: 2 }],
    writeOffs: [],
  }, auth.token);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error?.message).toMatch(/mes cerrado/i);
  expect(await consumedQtyOf(cut.corteId, auth.token)).toBe(3);
});

test("@functions #583 stock insuficiente en la corrección → failed-precondition con la línea exacta", async () => {
  const auth = admin!;
  const storeId = "s583_short";
  const pointId = "s583_short__mostrador";
  await seed583Point(storeId, pointId, auth, 5);
  const cut = await registerCut3(auth.token, storeId, pointId, "i583short");

  const res = await callCut("correctPointCut", {
    storeId,
    pointId,
    corteId: cut.corteId,
    intentId: "i583short_corr",
    motive: "Demasiado",
    lines: [{ productId: `prod_${storeId}`, markedPriceCents: 68000, soldQty: 6 }],
    writeOffs: [],
  }, auth.token);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error?.message).toMatch(/faltan 1/i);
  expect(await consumedQtyOf(cut.corteId, auth.token)).toBe(3);
});
