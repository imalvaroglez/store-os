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

  it("la conversión actualiza la ficha pública (colores) SIN «Republicar catálogo» manual (#361 UX)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      holder.db = db;
      // A published simple design with its public detail + catalog summary.
      await setDoc(doc(db, "stores/vc-store"), { id: "vc-store", storeId: "vc-store", name: "VC", slug: "vc-slug", type: "inventory_tiered" });
      const simple = {
        id: "vc-conv", storeId: "vc-store", slug: "reloj-vc", name: "Reloj VC", sku: "VC-R",
        category: "other", status: "published", isPublic: true,
        finish: "Plateado", quantityOnHand: 4, cost: 500,
        images: [{ id: "g1", url: "https://x.test/p.jpg", order: 0, isPrimary: true }],
      };
      await setDoc(doc(db, "products/vc-conv"), simple);
      await setDoc(doc(db, "publicProducts/vc-store__reloj-vc"), {
        storeId: "vc-store", storeSlug: "vc-slug", productSlug: "reloj-vc", name: "Reloj VC",
        price: 1200, imageUrl: "https://x.test/p.jpg", stockSignal: "disponible",
      });
      await setDoc(doc(db, "publicCatalogs/vc-slug"), {
        storeId: "vc-store",
        products: [{ storeId: "vc-store", productSlug: "reloj-vc", name: "Reloj VC", price: 1200, imageUrl: "https://x.test/p.jpg", stockSignal: "disponible" }],
      });

      // The form's save path: persistEntity writes the canonical doc FIRST,
      // then upsertProduct's projection step re-reads it — no manual republish
      // anywhere. (The detail projection re-reads canonical inside its tx.)
      const { upsertPublicProduct } = await import("./firestoreData");
      const converted = {
        ...simple,
        variants: [{ id: "v1", color: "Plateado", skuSuffix: "P", sku: "VC-R-P", quantityOnHand: 4, photos: [{ id: "g1", url: "https://x.test/p.jpg", order: 0, isPrimary: true }], createdAt: "", updatedAt: "" }],
      } as unknown as Product;
      delete (converted as Record<string, unknown>).quantityOnHand; // tombstone side
      await setDoc(doc(db, "products/vc-conv"), { ...converted, id: "vc-conv" });
      await upsertPublicProduct(converted as Product, "vc-slug", [converted as Product], [], undefined);

      const detail = (await getDoc(doc(db, "publicProducts/vc-store__reloj-vc"))).data()!;
      expect(detail.name).toBe("Reloj VC");
      // The public detail now carries the colors — what the public page renders.
      expect(Array.isArray(detail.variants)).toBe(true);
      expect(detail.variants[0]).toMatchObject({ color: "Plateado" });
      const catalog = (await getDoc(doc(db, "publicCatalogs/vc-slug"))).data();
      expect(catalog?.products[0]).toMatchObject({ productSlug: "reloj-vc", name: "Reloj VC" });
    });
  });
});
