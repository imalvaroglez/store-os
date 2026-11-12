import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Product } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { saveEntity } from "./firestoreData";

let env: RulesTestEnvironment;

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("conversión «se vende por color» canónica (#355)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it("activar colores BORRA el estante de diseño del documento — el canónico no guarda un estante fantasma", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      holder.db = db;
      await setDoc(doc(db, "products/vc-1"), {
        id: "vc-1",
        storeId: "s1",
        name: "Reloj Austin",
        quantityOnHand: 4,
        finish: "Plateado",
      });

      // The form's save payload: variants seeded, design-level shelf explicit undefined.
      const converted = {
        id: "vc-1",
        storeId: "s1",
        name: "Reloj Austin",
        finish: "Plateado",
        variants: [{ id: "v1", color: "Plateado", skuSuffix: "P", sku: "SOL-P", quantityOnHand: 4, createdAt: "", updatedAt: "" }],
        quantityOnHand: undefined,
      } as unknown as Product;
      await saveEntity({ uid: "u1", email: "a@b.c" } as never, "products", converted);

      const saved = (await getDoc(doc(db, "products/vc-1"))).data()!;
      expect(saved.variants).toHaveLength(1);
      // The design-level shelf is DELETED, not kept as a stale 4.
      expect("quantityOnHand" in saved).toBe(false);
    });
  });

  it("desactivar colores BORRA el array de colores del documento — el producto deja de venderse por color en todas partes", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      holder.db = db;
      await setDoc(doc(db, "products/vc-2"), {
        id: "vc-2",
        storeId: "s1",
        name: "Aretes Gota",
        quantityOnHand: 5,
        variants: [
          { id: "v1", color: "Dorado", quantityOnHand: 2, createdAt: "", updatedAt: "" },
          { id: "v2", color: "Plateado", quantityOnHand: 3, createdAt: "", updatedAt: "" },
        ],
      });

      const backToSimple = {
        id: "vc-2",
        storeId: "s1",
        name: "Aretes Gota",
        quantityOnHand: 5,
        variants: undefined,
      } as unknown as Product;
      await saveEntity({ uid: "u1", email: "a@b.c" } as never, "products", backToSimple);

      const saved = (await getDoc(doc(db, "products/vc-2"))).data()!;
      expect(saved.quantityOnHand).toBe(5);
      // The color array is DELETED: no device may keep selling by color.
      expect("variants" in saved).toBe(false);
    });
  });

  it("un producto nuevo por color nace sin quantityOnHand — sin deleteField espurio", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      holder.db = db;
      await setDoc(doc(db, "products/vc-3"), {
        id: "vc-3",
        storeId: "s1",
        name: "Collar Nuevo",
        variants: [{ id: "v1", color: "Dorado", quantityOnHand: 0, createdAt: "", updatedAt: "" }],
      });

      // An edit that keeps variants (no transition): quantityOnHand stays absent.
      const edited = {
        id: "vc-3",
        storeId: "s1",
        name: "Collar Nuevo Renombrado",
        variants: [{ id: "v1", color: "Dorado", quantityOnHand: 1, createdAt: "", updatedAt: "" }],
        quantityOnHand: undefined,
      } as unknown as Product;
      await saveEntity({ uid: "u1", email: "a@b.c" } as never, "products", edited);

      const saved = (await getDoc(doc(db, "products/vc-3"))).data()!;
      expect(saved.name).toBe("Collar Nuevo Renombrado");
      expect("quantityOnHand" in saved).toBe(false);
      expect(saved.variants[0].quantityOnHand).toBe(1);
    });
  });
});
