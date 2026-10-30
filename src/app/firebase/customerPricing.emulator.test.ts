import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { FIREBASE_DEV_PROJECT_ID } from "./projectIds";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { saveEntity } from "./firestoreData";
let env: RulesTestEnvironment;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("customer price levels", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: FIREBASE_DEV_PROJECT_ID, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "adminStores/price-store"), { ownerUid: "price-user", memberUids: ["price-user"] });
      await setDoc(doc(ctx.firestore(), "users/price-user"), { role: "member" });
    });
    holder.db = env.authenticatedContext("price-user").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });
  it("removes a previous assigned tier when the operator returns to the store default", async () => {
    const customer = { id: "price-customer", storeId: "price-store", name: "Sofía", segment: "entrepreneur", assignedPriceTierId: "iconic" };
    await saveEntity({ uid: "price-user" } as any, "customers", customer);
    await saveEntity({ uid: "price-user" } as any, "customers", { ...customer, assignedPriceTierId: undefined });
    const saved = (await getDoc(doc(holder.db, "customers/price-customer"))).data();
    expect(saved?.assignedPriceTierId).toBeUndefined();
    expect(saved?.segment).toBe("entrepreneur");
  });
});
