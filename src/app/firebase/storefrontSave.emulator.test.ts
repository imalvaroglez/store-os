import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Category, Product, Store, Storefront } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { projectPublicForStore, saveStorefrontBatch } from "./firestoreData";

let env: RulesTestEnvironment;

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("storefront save + public projection (#332)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it("borrar shipping/hours borra el campo en stores y publicStores — sin resurrección al recargar", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      holder.db = db;
      await setDoc(doc(db, "stores/sf2-store"), { storefront: { shipping: "Viejo", hours: "Viejo", notice: "Queda" } });
      await setDoc(doc(db, "publicStores/olivia-emul"), { storeId: "sf2-store", storefront: { shipping: "Viejo", hours: "Viejo", notice: "Queda" } });

      await saveStorefrontBatch(
        { id: "sf2-store", slug: "olivia-emul" },
        { shipping: "", hours: "", notice: "Queda" } as Storefront,
        "2026-11-11T00:00:00Z"
      );

      const priv = (await getDoc(doc(db, "stores/sf2-store"))).data()!.storefront;
      expect(priv.shipping).toBeUndefined(); // borrado de verdad, no "" ni "Viejo"
      expect(priv.hours).toBeUndefined();
      expect(priv.notice).toBe("Queda"); // los demás campos sobreviven

      const pub = (await getDoc(doc(db, "publicStores/olivia-emul"))).data()!.storefront;
      expect(pub.shipping).toBeUndefined();
      expect(pub.hours).toBeUndefined();
      expect(pub.notice).toBe("Queda");
    });
  });

  it("la república tolera un storefront local con undefined (la proyección no se rompe)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      holder.db = db;
      const store = {
        id: "sf3-store",
        slug: "olivia-emul2",
        name: "Olivia",
        type: "inventory_tiered",
        // Local state can carry nested undefineds (cleared inline fields);
        // setDoc would reject them ("Unsupported field value: undefined"). A
        // cleared slot ("") must land ABSENT here, same shape as the editor
        // batch — not as an empty string.
        storefront: { notice: undefined, shipping: "Envíos", hours: "", hero: { heading: "H", body: undefined } } as Storefront,
      } as unknown as Store;

      await expect(projectPublicForStore(store, [] as Product[], [] as Category[])).resolves.toBeUndefined();

      const pub = (await getDoc(doc(db, "publicStores/olivia-emul2"))).data()!;
      expect(pub.storefront.shipping).toBe("Envíos");
      expect(pub.storefront.notice).toBeUndefined(); // undefined anidado: fuera
      expect(pub.storefront.hours).toBeUndefined(); // "" → deleteField, no ""
    });
  });
});
