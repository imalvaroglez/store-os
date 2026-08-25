import { test, expect } from "@playwright/test";
// All tests carry the @functions tag: the script runs them in a SEPARATE
// emulator session (see scripts/e2e-firebase.sh) so the Functions emulator
// never contends with the photo/preview e2e on CI runners.
import { readFileSync } from "node:fs";
import { adminToken, PROJECT, writeEmulatorDoc } from "./helpers";

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
const BUCKET = "store-os-demo.appspot.com";

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
  let body = { email: "admin@store.os", password: "password123", returnSecureToken: true };
  let r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let value = await r.json();
  if (!value.idToken) {
    r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    value = await r.json();
  }
  const token = value.idToken as string;
  const uid = value.localId as string;
  await fetch(
    `http://127.0.0.1:8080/v1/projects/store-os-demo/databases/(default)/documents/adminStores/store_joyeria`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: {
        ownerUid: { stringValue: uid },
        memberUids: { arrayValue: { values: [{ stringValue: uid }] } },
      } }),
    }
  );
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
