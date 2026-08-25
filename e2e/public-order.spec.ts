import { test, expect } from "@playwright/test";
// @functions tag: runs in the session-2 emulator (with the Functions emulator,
// see scripts/e2e-firebase.sh). Fresh state — this suite seeds its own store,
// products and public projections, then calls submitPublicOrder ANONYMOUSLY.
import { PROJECT, writeEmulatorDoc } from "./helpers";

const FN = `http://127.0.0.1:5001/${PROJECT}/us-east1/submitPublicOrder`;
const STORE_ID = "store_puborder";

async function callCallable(body: unknown) {
  // No Authorization header: the public checkout is anonymous by design.
  return fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: body }),
  });
}

// Sign up (first run) or sign in the seed account. Self-sufficient: works
// whether or not functions.spec ran first in this emulator session.
async function mintAdmin(): Promise<{ token: string; uid: string }> {
  const creds = { email: "admin@store.os", password: "password123", returnSecureToken: true };
  let r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creds),
  });
  let value = await r.json();
  if (!value.idToken) {
    r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creds),
    });
    value = await r.json();
  }
  return { token: value.idToken, uid: value.localId };
}

async function readDoc(collection: string, id: string) {
  const auth = await mintAdmin();
  const res = await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${id}`,
    { headers: { Authorization: `Bearer ${auth.token}` } }
  );
  if (!res.ok) return null;
  return res.json();
}

function fieldValue(doc: any, key: string): any {
  const f = doc?.fields?.[key];
  return f?.integerValue != null ? Number(f.integerValue) : f?.stringValue ?? f?.arrayValue?.values?.map((v: any) => v.stringValue ?? v.mapValue) ?? undefined;
}

async function seedStore() {
  // Grant ownership so the rules allow the (token-authenticated) seed writes.
  const auth = await mintAdmin();
  await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/adminStores/${STORE_ID}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ fields: {
        ownerUid: { stringValue: auth.uid },
        memberUids: { arrayValue: { values: [{ stringValue: auth.uid }] } },
      } }),
    }
  );
  await writeEmulatorDoc("publicStores", "puborder", { storeId: STORE_ID, slug: "puborder", name: "Tienda Prueba", whatsappPhone: "5215512345678" });
}

async function seedProduct(slug: string, opts: { price: number; quantityOnHand?: number; availability?: string }) {
  const productId = `prod_${slug}`;
  await writeEmulatorDoc("products", productId, {
    id: productId,
    storeId: STORE_ID,
    name: `Pieza ${slug}`,
    slug,
    status: "published",
    ...(opts.quantityOnHand != null ? { quantityOnHand: opts.quantityOnHand } : {}),
  });
  await writeEmulatorDoc("publicProducts", `${STORE_ID}__${slug}`, {
    storeId: STORE_ID,
    storeSlug: "puborder",
    productSlug: slug,
    productId,
    name: `Pieza ${slug}`,
    price: opts.price,
    availability: opts.availability ?? "available",
  });
}

test.beforeAll(async () => {
  await seedStore();
  await seedProduct("arete", { price: 150, quantityOnHand: 5 });
  await seedProduct("anillo", { price: 300 }); // on-demand: no quantityOnHand
  await seedProduct("agotado", { price: 100, quantityOnHand: 2, availability: "sold_out" });
});

const validCart = {
  storeSlug: "puborder",
  name: "Ana Test",
  phone: "5512345678",
  items: [
    { productSlug: "arete", quantity: 2 },
    { productSlug: "anillo", quantity: 1 },
  ],
};

test("@functions anonymous happy path: creates order + customer, reserves stock", async () => {
  const res = await callCallable(validCart);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.result.orderId).toBeTruthy();
  expect(body.result.items).toHaveLength(2);

  const order = await readDoc("orders", body.result.orderId);
  expect(order).toBeTruthy();
  expect(fieldValue(order, "storeId")).toBe(STORE_ID);
  expect(fieldValue(order, "status")).toBe("asked");
  expect(fieldValue(order, "origin")).toBe("public");
  expect(fieldValue(order, "items")).toHaveLength(2);

  // Stock reserved: 5 - 2 = 3. On-demand product untouched (no quantityOnHand).
  const product = await readDoc("products", "prod_arete");
  expect(fieldValue(product, "quantityOnHand")).toBe(3);

  // Customer created by phone, scoped to the store.
  const customerId = fieldValue(order, "customerId");
  const customer = await readDoc("customers", customerId);
  expect(fieldValue(customer, "phone")).toBe("5512345678");
  expect(fieldValue(customer, "name")).toBe("Ana Test");
});

test("@functions rejects an invalid phone", async () => {
  const res = await callCallable({ ...validCart, phone: "123" });
  expect(res.status).toBe(400);
});

test("@functions rejects an unknown product slug", async () => {
  const res = await callCallable({ ...validCart, items: [{ productSlug: "no-existe", quantity: 1 }] });
  expect([400, 409, 412]).toContain(res.status);
});

test("@functions rejects a sold-out product", async () => {
  const res = await callCallable({ ...validCart, items: [{ productSlug: "agotado", quantity: 1 }] });
  expect([400, 409, 412]).toContain(res.status);
});

test("@functions rejects insufficient stock and leaves it unchanged", async () => {
  const res = await callCallable({ ...validCart, items: [{ productSlug: "arete", quantity: 99 }] });
  expect([400, 409, 412]).toContain(res.status);
  const product = await readDoc("products", "prod_arete");
  expect(fieldValue(product, "quantityOnHand")).toBe(3); // unchanged from happy path
});
